begin;
create schema credential_private;
revoke all on schema credential_private from public, anon, authenticated, service_role;

-- Create a window only on the provider's first password authentication in a new session.
-- No lazy initialization, refresh renewal or historical session backfill.
create table credential_private.session_windows (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  active_at timestamptz not null
);
create function credential_private.capture_password_window() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into credential_private.session_windows
    select s.id,s.user_id,s.created_at,s.created_at from auth.sessions s where s.id=new.session_id
    and s.created_at is not null and s.created_at <= clock_timestamp()
    on conflict (session_id) do nothing;
  return new;
end; $$;
revoke all on function credential_private.capture_password_window() from public,anon,authenticated,service_role;
create trigger credential_password_window after insert on auth.mfa_amr_claims
  for each row when (new.authentication_method='password') execute function credential_private.capture_password_window();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('credential-synthetic','credential-synthetic',false,69,array['image/png']);
-- A restrictive policy also fences this bucket against unrelated permissive object policies.
create policy credential_evidence_service_only on storage.objects as restrictive to anon,authenticated
  using (bucket_id <> 'credential-synthetic') with check (bucket_id <> 'credential-synthetic');

create table credential_private.versions (
  id uuid primary key,
  organization_id uuid not null,
  membership_id uuid not null,
  category text not null check (category='mother_license'),
  state text not null check (state in ('approved','pending')),
  license_type text not null check (license_type in ('SPL','PPL','CPL','ATPL')),
  license_number text not null check (length(license_number) between 1 and 80 and license_number=btrim(license_number) and license_number !~ '[[:cntrl:]]'),
  issued_on date not null,
  expires_on date,
  no_expiry boolean not null check (no_expiry=(expires_on is null)),
  check (expires_on >= issued_on),
  object_key text not null unique,
  operation_id uuid not null,
  evidence_sha256 text not null check(evidence_sha256='b75368e414a64c223ffb18fef090a45ff203704613e11bdb922757ac5b00ee06'),
  unique(organization_id,membership_id,operation_id),
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,membership_id) references public.organization_memberships(organization_id,id),
  unique(organization_id,membership_id,category,state),
  unique(organization_id,id)
);
create table credential_private.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  version_id uuid not null,
  actor_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default clock_timestamp(),
  event text not null check(event in ('submitted','evidence_served')),
  foreign key(organization_id,version_id) references credential_private.versions(organization_id,id)
);
-- Authenticated subject and fixed action only. Tenant-denial events never persist a caller-supplied school or target.
create table credential_private.request_limits (
  actor_id uuid not null references auth.users(id) on delete cascade, action text not null,
  since timestamptz not null, hits integer not null, primary key(actor_id,action)
);
create table credential_private.security_events (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null,
  action text not null, outcome text not null check(outcome in ('denied','rate_limited')),
  occurred_at timestamptz not null default clock_timestamp()
);
alter table credential_private.request_limits enable row level security;
alter table credential_private.security_events enable row level security;
create function public.credential_request_guard(p_actor uuid,p_action text,p_denial boolean) returns boolean
language plpgsql security definer set search_path='' as $limiter$
declare used integer; cap integer;
begin
  cap := case p_action when 'submit' then 12 when 'evidence' then 30 when 'status' then 60 when 'reconcile' then 30 end;
  if cap is null or p_actor is null or p_denial is null then return false; end if;
  if p_denial then
    insert into credential_private.security_events(actor_id,action,outcome) values(p_actor,p_action,'denied');
    return true;
  end if;
  insert into credential_private.request_limits as l(actor_id,action,since,hits) values(p_actor,p_action,clock_timestamp(),1)
  on conflict(actor_id,action) do update set
    hits=case when clock_timestamp()>=l.since+interval '1 minute' then 1 else least(cap+2,l.hits+1) end,
    since=case when clock_timestamp()>=l.since+interval '1 minute' then clock_timestamp() else l.since end
  returning hits into used;
  if used=cap+1 then insert into credential_private.security_events(actor_id,action,outcome) values(p_actor,p_action,'rate_limited'); end if;
  return used<=cap;
end; $limiter$;
revoke all on function public.credential_request_guard(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.credential_request_guard(uuid,text,boolean) to service_role;
alter table credential_private.versions enable row level security;
alter table credential_private.events enable row level security;
alter table credential_private.session_windows enable row level security;
revoke all on all tables in schema credential_private from public,anon,authenticated,service_role;

create function public.credential_owner_submission(p_actor uuid,p_session uuid,p_mfa boolean,p_school uuid,
  p_token_exp bigint,p_member uuid,p_action text,p_version uuid,p_details jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  w credential_private.session_windows%rowtype;
  factor uuid;
  requires_mfa boolean;
  deadline timestamptz;
  result jsonb;
  key text;
  prior credential_private.versions%rowtype;
  op uuid;
  issued date;
  expires date;
begin
  if p_token_exp is null or p_token_exp < 0 or p_token_exp > 253402300799 or p_action is null or p_action not in ('status','prepare','commit','locate','serve','reconcile') then return null; end if;
  select * into w from credential_private.session_windows where session_id=p_session and user_id=p_actor for update;
  if not found then return null; end if;
  deadline := least(w.started_at+interval '12 hours',w.active_at+interval '45 minutes',to_timestamp(p_token_exp));
  if clock_timestamp()>=deadline then return null; end if;
  select r.required_assurance_level='aal2' or p_action<>'status' into requires_mfa
    from public.organizations o join public.organization_memberships m on m.organization_id=o.id
    join public.organization_member_profiles f on (f.organization_id,f.membership_id)=(o.id,m.id)
    join public.membership_roles mr on (mr.organization_id,mr.membership_id)=(o.id,m.id)
    join public.roles r on r.id=mr.role_id
    join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id
    join public.permissions portal on portal.code=r.workspace_permission_code
    join public.role_permissions pr on (pr.role_id,pr.permission_id)=(r.id,portal.id)
    where o.id=p_school and m.id=p_member and m.user_id=p_actor and m.status='active' and o.status='active'
    and r.is_active and p.code='credential.own.read' and f.credential_applicability is not null
    for update of f for share of o,m,mr,r,rp,p,pr,portal;
  if not found or (requires_mfa and p_mfa is not true) then return null; end if;
  select factor_id into factor from auth.sessions where id=p_session and user_id=p_actor;
  if not public.credential_session_is_current(p_actor,p_session,factor,requires_mfa)
    or clock_timestamp()>=deadline then return null; end if;
  if p_action='status' then
    select jsonb_build_object('versions',coalesce(jsonb_agg(jsonb_build_object('id',id,'state',state,
      'licenseType',license_type,'licenseNumber',license_number,'issueDate',issued_on,'expiryDate',expires_on)), '[]'::jsonb))
      into result from credential_private.versions where organization_id=p_school and membership_id=p_member;
  elsif p_action in ('reconcile','prepare','commit') then
    op := (p_details->>'operationId')::uuid;
    if op is null then return null; end if;
    select * into prior from credential_private.versions where organization_id=p_school and membership_id=p_member and operation_id=op;
    if p_action='reconcile' then
      result := case when found then jsonb_build_object('state',prior.state,'id',prior.id)
        else jsonb_build_object('state','unconfirmed') end;
    elsif found then
      if jsonb_build_object('operationId',prior.operation_id,'licenseType',prior.license_type,'licenseNumber',prior.license_number,
          'issueDate',prior.issued_on,'expiryDate',prior.expires_on,'noExpiry',prior.no_expiry,'digest',prior.evidence_sha256)
          is distinct from p_details then return jsonb_build_object('conflict',true); end if;
      result := jsonb_build_object('replayed',true,'id',prior.id,'state',prior.state);
    else
    if exists(select from credential_private.versions where organization_id=p_school and membership_id=p_member
      and category='mother_license' and state='pending') then return jsonb_build_object('conflict',true); end if;
    if p_version is null then return null; end if;
    key := p_school::text||'/'||p_member::text||'/'||p_version::text||'.png';
    result := jsonb_build_object('key',key);
    if p_action='commit' then
      issued := (p_details->>'issueDate')::date;
      expires := (p_details->>'expiryDate')::date;
      if issued is null or not isfinite(issued) or issued>(clock_timestamp() at time zone 'Asia/Manila')::date
        or (expires is not null and not isfinite(expires)) then return null; end if;
      if not exists (select from storage.objects where bucket_id='credential-synthetic' and name=key
        and metadata->>'mimetype'='image/png' and metadata->>'size'='69') then return null; end if;
      insert into credential_private.versions(id,organization_id,membership_id,category,state,license_type,license_number,
        issued_on,expires_on,no_expiry,object_key,submitted_by,operation_id,evidence_sha256) values(p_version,p_school,p_member,'mother_license','pending',
        p_details->>'licenseType',p_details->>'licenseNumber',issued,expires,(p_details->>'noExpiry')::boolean,key,p_actor,op,p_details->>'digest');
      insert into credential_private.events(organization_id,version_id,actor_id,event) values(p_school,p_version,p_actor,'submitted');
      result := jsonb_build_object('id',p_version,'state','pending');
    end if;
    end if;
  else
    select jsonb_build_object('key',object_key,'digest',evidence_sha256) into result from credential_private.versions
      where id=p_version and organization_id=p_school and membership_id=p_member;
    if result is null then return null; end if;
    if p_action='serve' then insert into credential_private.events(organization_id,version_id,actor_id,event) values(p_school,p_version,p_actor,'evidence_served'); end if;
  end if;
  if clock_timestamp()>=deadline or not public.credential_session_is_current(p_actor,p_session,factor,requires_mfa)
    or clock_timestamp()>=deadline then raise exception using errcode='P9009'; end if;
  if p_action in ('commit','serve') and not (result ? 'replayed') then
    update credential_private.session_windows set active_at=clock_timestamp() where session_id=p_session and clock_timestamp()<deadline returning active_at into w.active_at;
    if not found then raise exception using errcode='P9009'; end if;
  end if;
  return result || jsonb_build_object('validUntil',least(w.started_at+interval '12 hours',w.active_at+interval '45 minutes',to_timestamp(p_token_exp)));
exception when sqlstate 'P9009' then return null;
end; $$;
revoke all on function public.credential_owner_submission(uuid,uuid,boolean,uuid,bigint,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.credential_owner_submission(uuid,uuid,boolean,uuid,bigint,uuid,text,uuid,jsonb) to service_role;
commit;
