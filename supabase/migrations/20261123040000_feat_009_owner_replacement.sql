begin;
alter table credential_private.versions
  add column replaces_version_id uuid unique,
  add unique (organization_id,membership_id,id),
  add foreign key (organization_id,membership_id,replaces_version_id)
    references credential_private.versions(organization_id,membership_id,id),
  add check (replaces_version_id is distinct from id);

-- Preserve the existing service-only signatures, privileges and session checks.
create or replace function public.credential_request_guard(p_actor uuid,p_action text,p_denial boolean) returns boolean
language plpgsql security definer set search_path='' as $limiter$
declare used integer; cap integer;
begin
  cap := case p_action when 'withdraw' then 12 when 'withdraw_outcome' then 30 when 'replace' then 12 when 'submit' then 12 when 'evidence' then 30 when 'status' then 60 when 'reconcile' then 30 end;
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

create or replace function public.credential_owner_submission(p_actor uuid,p_session uuid,p_mfa boolean,p_school uuid,
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
  expected uuid;
  prior_pending_state text;
  issued date;
  expires date;
begin
  if p_token_exp is null or p_token_exp < 0 or p_token_exp > 253402300799 or p_action is null or p_action not in ('status','prepare','commit','locate','serve','reconcile','withdraw','withdraw_outcome') then return null; end if;
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
      into result from credential_private.versions where organization_id=p_school and membership_id=p_member and state in ('pending','approved');
  elsif p_action in ('withdraw','withdraw_outcome') then
    op := (p_details->>'operationId')::uuid;
    if op is null or p_version is null then return null; end if;
    select * into prior from credential_private.versions
      where organization_id=p_school and membership_id=p_member and id=p_version for update;
    if not found then return null; end if;
    if prior.withdrawal_operation_id=op and not exists(select from credential_private.versions where replaces_version_id=prior.id) then
      result := jsonb_build_object('id',prior.id,'state','withdrawn','replayed',true);
    elsif exists (select from credential_private.versions where organization_id=p_school and membership_id=p_member
                  and (operation_id=op or withdrawal_operation_id=op)) or prior.state<>'pending' then
      return jsonb_build_object('conflict',true);
    elsif p_action='withdraw_outcome' then
      result := jsonb_build_object('id',prior.id,'state','unconfirmed');
    else
      update credential_private.versions set state='withdrawn',withdrawal_operation_id=op
        where id=prior.id and state='pending';
      insert into credential_private.events(organization_id,version_id,actor_id,event)
        values(p_school,prior.id,p_actor,'withdrawn');
      result := jsonb_build_object('id',prior.id,'state','withdrawn');
    end if;
  elsif p_action in ('reconcile','prepare','commit') then
    expected := (p_details->>'expectedPendingId')::uuid;
    op := (p_details->>'operationId')::uuid;
    if op is null then return null; end if;
    select * into prior from credential_private.versions where organization_id=p_school and membership_id=p_member and operation_id=op;
    if not found and exists(select from credential_private.versions where organization_id=p_school
      and membership_id=p_member and withdrawal_operation_id=op) then return jsonb_build_object('conflict',true); end if;
    if prior.id is not null and prior.replaces_version_id is distinct from expected then
      return jsonb_build_object('conflict',true);
    end if;
    if p_action='reconcile' then
      result := case when found then jsonb_build_object('state',prior.state,'id',prior.id)
        else jsonb_build_object('state','unconfirmed') end;
    elsif found then
      if jsonb_build_object('operationId',prior.operation_id,'licenseType',prior.license_type,'licenseNumber',prior.license_number,
          'issueDate',prior.issued_on,'expiryDate',prior.expires_on,'noExpiry',prior.no_expiry,'digest',prior.evidence_sha256)
          is distinct from (p_details-'expectedPendingId') then return jsonb_build_object('conflict',true); end if;
      -- Replay the recorded submission acknowledgement even if the version has since been withdrawn.
      result := jsonb_build_object('replayed',true,'id',prior.id,'state','pending');
    else
    if expected is not null then
      select state into prior_pending_state from credential_private.versions
        where id=expected and organization_id=p_school and membership_id=p_member and category='mother_license' for update;
      if not found then return null; end if;
      if prior_pending_state<>'pending' then return jsonb_build_object('conflict',true); end if;
    elsif exists(select from credential_private.versions where organization_id=p_school and membership_id=p_member
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
      if expected is not null then
        update credential_private.versions set state='withdrawn',withdrawal_operation_id=op where id=expected and state='pending';
        if not found then return jsonb_build_object('conflict',true); end if;
        insert into credential_private.events(organization_id,version_id,actor_id,event) values(p_school,expected,p_actor,'withdrawn');
      end if;
      insert into credential_private.versions(id,organization_id,membership_id,category,state,license_type,license_number,
        issued_on,expires_on,no_expiry,object_key,submitted_by,operation_id,evidence_sha256,replaces_version_id) values(p_version,p_school,p_member,'mother_license','pending',
        p_details->>'licenseType',p_details->>'licenseNumber',issued,expires,(p_details->>'noExpiry')::boolean,key,p_actor,op,p_details->>'digest',expected);
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
  if p_action in ('commit','serve','withdraw') and not (result ? 'replayed') then
    update credential_private.session_windows set active_at=clock_timestamp() where session_id=p_session and clock_timestamp()<deadline returning active_at into w.active_at;
    if not found then raise exception using errcode='P9009'; end if;
  end if;
  return result || jsonb_build_object('validUntil',least(w.started_at+interval '12 hours',w.active_at+interval '45 minutes',to_timestamp(p_token_exp)));
exception when sqlstate 'P9009' then return null;
when others then
  -- The enclosing PL/pgSQL block has rolled back all version and event mutations.
  -- A transport failure never supplies this definitive refusal to the object writer.
  if p_action='commit' and expected is not null then return jsonb_build_object('rolledBack',true); end if;
  raise;
end; $$;

commit;
