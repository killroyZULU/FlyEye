begin;
create function credential_private.valid_evidence_manifest(files jsonb) returns boolean
language sql immutable strict set search_path='' as $$
  select case when jsonb_typeof(files)<>'array' then false else
    jsonb_array_length(files) between 1 and 2 and not exists (
      select from jsonb_array_elements(files) e where case when jsonb_typeof(e)<>'object' then true else
        not(e ?& array['mime','size','digest']) or e-array['mime','size','digest']<>'{}'::jsonb
        or jsonb_typeof(e->'mime')<>'string' or e->>'mime' not in ('image/jpeg','image/png','application/pdf')
        or jsonb_typeof(e->'digest')<>'string' or e->>'digest' !~ '^[0-9a-f]{64}$'
        or case when jsonb_typeof(e->'size')='number' and e->>'size' ~ '^[1-9][0-9]{0,7}$'
          then (e->>'size')::integer>10000000 else true end end
      or (jsonb_array_length(files)>1 and e->>'mime'='application/pdf')
    ) end
$$;
create function credential_private.evidence_key(base text, files jsonb, slot integer) returns text
language sql immutable strict set search_path='' as $$
  select base || case slot when 0 then '.' else '-back.' end ||
    case files->slot->>'mime' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'application/pdf' then 'pdf' end
$$;
revoke all on function credential_private.valid_evidence_manifest(jsonb),credential_private.evidence_key(text,jsonb,integer) from public,anon,authenticated,service_role;
-- The manifest is ordered (front, back). Legacy single-PNG rows keep their original key and digest.
alter table credential_private.versions add column evidence_manifest jsonb;
alter table credential_private.versions drop constraint versions_evidence_sha256_check;
alter table credential_private.versions add constraint credential_version_evidence_check check (
  (evidence_manifest is null and evidence_sha256='b75368e414a64c223ffb18fef090a45ff203704613e11bdb922757ac5b00ee06') or
  (evidence_manifest is not null and credential_private.valid_evidence_manifest(evidence_manifest)
   and evidence_sha256=evidence_manifest->0->>'digest'));
update storage.buckets set file_size_limit=10000000, allowed_mime_types=array['image/png','image/jpeg','application/pdf']
  where id='credential-synthetic' and not public;

create or replace function public.credential_owner_submission(p_actor uuid,p_session uuid,p_mfa boolean,p_school uuid,
  p_token_exp bigint,p_member uuid,p_action text,p_version uuid,p_details jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  w credential_private.session_windows%rowtype;
  factor uuid;
  requires_mfa boolean;
  applicability text;
  completeness jsonb;
  state_key text;
  deadline timestamptz;
  result jsonb;
  key text;
  prior credential_private.versions%rowtype;
  op uuid;
  expected uuid;
  record_category text;
  files jsonb := p_details->'evidenceManifest';
  base text;
  slot integer;
  prior_pending_state text;
  issued date;
  expires date;
begin
  if p_token_exp is null or p_token_exp < 0 or p_token_exp > 253402300799 or p_action is null or p_action not in ('status','prepare','commit','locate','serve','reconcile','withdraw','withdraw_outcome','declare_elp','declare_ntc') then return null; end if;
  select * into w from credential_private.session_windows where session_id=p_session and user_id=p_actor for update;
  if not found then return null; end if;
  deadline := least(w.started_at+interval '12 hours',w.active_at+interval '45 minutes',to_timestamp(p_token_exp));
  if clock_timestamp()>=deadline then return null; end if;
  select r.required_assurance_level='aal2' or p_action<>'status', f.credential_applicability into requires_mfa, applicability
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
  if p_action in ('prepare','commit') and files is not null and (not credential_private.valid_evidence_manifest(files) or
    p_details->>'digest' is distinct from files->0->>'digest') then return null; end if;
  record_category := coalesce(p_details->>'category','mother_license');
  if p_action in ('declare_elp','declare_ntc') then
    record_category := case p_action when 'declare_elp' then 'elp' else 'ntc' end;
  end if;
  if record_category not in ('elp','ntc','medical','fi','gi','mother_license') then return null; end if;
  if record_category in ('fi','gi') and applicability not in ('instructor','both')
    and p_action in ('prepare','commit') and p_details->>'expectedPendingId' is null then return null; end if;
  if record_category in ('medical','fi','gi') then
    if p_action in ('prepare','commit') and (
      (p_details - array['category','operationId','issueDate','expiryDate','noExpiry','digest','expectedPendingId','evidenceManifest']) <> '{}'::jsonb
      or (p_details ? 'expectedPendingId' and jsonb_typeof(p_details->'expectedPendingId') <> 'string')
      or jsonb_typeof(p_details->'issueDate') is distinct from 'string'
      or (p_details->>'issueDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (p_details->'expiryDate' <> 'null'::jsonb and
        (jsonb_typeof(p_details->'expiryDate') is distinct from 'string' or (p_details->>'expiryDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
    ) then return null; end if;
  end if;
  -- The profile row lock above serializes declaration, submission and applicability changes.
  if p_action in ('prepare','commit','reconcile','withdraw','withdraw_outcome') and exists (
    select from credential_private.declarations where organization_id=p_school and membership_id=p_member
      and operation_id=(p_details->>'operationId')::uuid
  ) then return jsonb_build_object('conflict',true); end if;
  if p_action in ('status','declare_elp','declare_ntc') then
    select jsonb_object_agg(c.kind||'Completeness',case
      when exists(select from credential_private.versions v where v.organization_id=p_school and v.membership_id=p_member and v.category=c.kind and v.state='approved') then 'approved'
      when exists(select from credential_private.versions v where v.organization_id=p_school and v.membership_id=p_member and v.category=c.kind and v.state='pending') then 'pending'
      when applicability <> 'trainee' then 'required'
      when exists(select from credential_private.declarations d where d.organization_id=p_school and d.membership_id=p_member and d.category=c.kind) then 'not_yet_obtained'
      else 'undeclared' end) into completeness from (values ('elp'),('ntc')) as c(kind);
  end if;
  if p_action in ('declare_elp','declare_ntc') then
    state_key := record_category||'Completeness';
    op := (p_details->>'operationId')::uuid;
    if applicability <> 'trainee' or op is null then return null; end if;
    if exists (select from credential_private.declarations where organization_id=p_school and membership_id=p_member and category<>record_category and operation_id=op)
      or completeness->>state_key in ('approved','pending') or exists (
      select from credential_private.versions where organization_id=p_school and membership_id=p_member
      and (operation_id=op or withdrawal_operation_id=op)
    ) then return jsonb_build_object('conflict',true); end if;
    result := jsonb_build_object(state_key,'not_yet_obtained');
    if completeness->>state_key='not_yet_obtained' then
      result := result || jsonb_build_object('replayed',true);
    else
      insert into credential_private.declarations(organization_id,membership_id,category,actor_id,operation_id)
        values(p_school,p_member,record_category,p_actor,op);
    end if;
  elsif p_action='status' then
    select completeness || jsonb_build_object('instructorApplicable',applicability in ('instructor','both'),
      'instructorHistory',array(select distinct v.category from credential_private.versions v
        where v.organization_id=p_school and v.membership_id=p_member and v.category in ('fi','gi') order by v.category),
      'versions',coalesce(jsonb_agg(jsonb_build_object('id',id,'state',state,
      'issueDate',issued_on,'expiryDate',expires_on,'category',category) ||
      case when evidence_manifest is null then '{}'::jsonb else jsonb_build_object('evidenceTypes',
        (select jsonb_agg(part->>'mime' order by ord) from jsonb_array_elements(evidence_manifest) with ordinality f(part,ord))) end ||
      case when category='elp' then jsonb_build_object('elpLevel',elp_level,'noExpiry',no_expiry)
        when category in ('ntc','medical','fi','gi') then jsonb_build_object('noExpiry',no_expiry)
        else jsonb_build_object('licenseType',license_type,'licenseNumber',license_number) end), '[]'::jsonb))
      into result from credential_private.versions where organization_id=p_school and membership_id=p_member and state in ('pending','approved');
  elsif p_action in ('withdraw','withdraw_outcome') then
    op := (p_details->>'operationId')::uuid;
    if op is null or p_version is null then return null; end if;
    select * into prior from credential_private.versions
      where organization_id=p_school and membership_id=p_member and id=p_version and category=record_category for update;
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
    if record_category in ('ntc','elp','medical','fi','gi') and p_action<>'reconcile' then
      if (record_category='ntc' and p_details ? 'elpLevel') or (record_category='elp' and (jsonb_typeof(p_details->'elpLevel') is distinct from 'number'
        or (p_details->'elpLevel') not in ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)))
        or p_details ?| array['licenseType','licenseNumber']
        or jsonb_typeof(p_details->'noExpiry') is distinct from 'boolean'
        or not (p_details ? 'expiryDate') then return null; end if;
      issued := (p_details->>'issueDate')::date;
      expires := (p_details->>'expiryDate')::date;
      if issued is null or not isfinite(issued) or issued>(clock_timestamp() at time zone 'Asia/Manila')::date
        or (p_details->>'noExpiry')::boolean<>(expires is null)
        or (expires is not null and (not isfinite(expires) or expires<issued)) then return null; end if;
    end if;
    op := (p_details->>'operationId')::uuid;
    if op is null then return null; end if;
    select * into prior from credential_private.versions where organization_id=p_school and membership_id=p_member and operation_id=op;
    if not found and exists(select from credential_private.versions where organization_id=p_school
      and membership_id=p_member and withdrawal_operation_id=op) then return jsonb_build_object('conflict',true); end if;
    if prior.id is not null and (prior.replaces_version_id is distinct from expected or prior.category<>record_category) then
      return jsonb_build_object('conflict',true);
    end if;
    if p_action='reconcile' then
      result := case when found then jsonb_build_object('state',prior.state,'id',prior.id)
        else jsonb_build_object('state','unconfirmed') end;
    elsif found then
      if (jsonb_build_object('operationId',prior.operation_id,'issueDate',prior.issued_on,'expiryDate',prior.expires_on,
          'noExpiry',prior.no_expiry,'digest',prior.evidence_sha256) || case when prior.evidence_manifest is null then '{}'::jsonb
          else jsonb_build_object('evidenceManifest',prior.evidence_manifest) end || case when prior.category='elp'
          then jsonb_build_object('category','elp','elpLevel',prior.elp_level)
          when prior.category in ('ntc','medical','fi','gi') then jsonb_build_object('category',prior.category)
          else jsonb_build_object('licenseType',prior.license_type,'licenseNumber',prior.license_number) end)
          is distinct from (p_details-'expectedPendingId') then return jsonb_build_object('conflict',true); end if;
      -- Replay the recorded submission acknowledgement even if the version has since been withdrawn.
      result := jsonb_build_object('replayed',true,'id',prior.id,'state','pending');
    else
    if expected is not null then
      select state into prior_pending_state from credential_private.versions
        where id=expected and organization_id=p_school and membership_id=p_member and category=record_category for update;
      if not found then return null; end if;
      if prior_pending_state<>'pending' then return jsonb_build_object('conflict',true); end if;
    elsif exists(select from credential_private.versions where organization_id=p_school and membership_id=p_member
      and category=record_category and state='pending') then return jsonb_build_object('conflict',true); end if;
    if p_version is null then return null; end if;
    base := p_school::text||'/'||p_member::text||'/'||p_version::text;
    key := coalesce(credential_private.evidence_key(base,files,0),base||'.png');
    result := jsonb_build_object('key',key);
    if files is not null then result := result || jsonb_build_object('keys',
      (select jsonb_agg(credential_private.evidence_key(base,files,i) order by i) from generate_series(0,jsonb_array_length(files)-1) i)); end if;
    if p_action='commit' then
      issued := (p_details->>'issueDate')::date;
      expires := (p_details->>'expiryDate')::date;
      if issued is null or not isfinite(issued) or issued>(clock_timestamp() at time zone 'Asia/Manila')::date
        or (expires is not null and not isfinite(expires)) then return null; end if;
      if files is not null then
        if exists (select from jsonb_array_elements(files) with ordinality parts(part,ord) where not exists (
          select from storage.objects where bucket_id='credential-synthetic' and name=credential_private.evidence_key(base,files,ord::int-1)
            and metadata->>'mimetype'=part->>'mime' and metadata->>'size'=part->>'size'
        )) then return null; end if;
      elsif not exists (select from storage.objects where bucket_id='credential-synthetic' and name=key
        and metadata->>'mimetype'='image/png' and metadata->>'size'='69') then return null; end if;
      if expected is not null then
        update credential_private.versions set state='withdrawn',withdrawal_operation_id=op where id=expected and state='pending';
        if not found then return jsonb_build_object('conflict',true); end if;
        insert into credential_private.events(organization_id,version_id,actor_id,event) values(p_school,expected,p_actor,'withdrawn');
      end if;
      insert into credential_private.versions(id,organization_id,membership_id,category,state,license_type,license_number,
        issued_on,expires_on,no_expiry,object_key,submitted_by,operation_id,evidence_sha256,replaces_version_id,elp_level,evidence_manifest) values(p_version,p_school,p_member,record_category,'pending',
        p_details->>'licenseType',p_details->>'licenseNumber',issued,expires,(p_details->>'noExpiry')::boolean,key,p_actor,op,p_details->>'digest',expected,(p_details->>'elpLevel')::numeric,files);
      insert into credential_private.events(organization_id,version_id,actor_id,event) values(p_school,p_version,p_actor,'submitted');
      result := jsonb_build_object('id',p_version,'state','pending');
    end if;
    end if;
  else
    slot := coalesce((p_details->>'slot')::integer,0);
    select case when evidence_manifest is null then jsonb_build_object('key',object_key,'digest',evidence_sha256)
      else evidence_manifest->slot || jsonb_build_object('key', credential_private.evidence_key(p_school||'/'||p_member||'/'||id,evidence_manifest,slot)) end
      into result from credential_private.versions where id=p_version and organization_id=p_school and membership_id=p_member
      and slot>=0 and slot < coalesce(jsonb_array_length(evidence_manifest),1);
    if result is null then return null; end if;
    if p_action='serve' then insert into credential_private.events(organization_id,version_id,actor_id,event) values(p_school,p_version,p_actor,'evidence_served'); end if;
  end if;
  if clock_timestamp()>=deadline or not public.credential_session_is_current(p_actor,p_session,factor,requires_mfa)
    or clock_timestamp()>=deadline then raise exception using errcode='P9009'; end if;
  if p_action in ('commit','serve','withdraw','declare_elp','declare_ntc') and not (result ? 'replayed') then
    update credential_private.session_windows set active_at=clock_timestamp() where session_id=p_session and clock_timestamp()<deadline returning active_at into w.active_at;
    if not found then raise exception using errcode='P9009'; end if;
  end if;
  return result || jsonb_build_object('validUntil',least(w.started_at+interval '12 hours',w.active_at+interval '45 minutes',to_timestamp(p_token_exp)));
exception when sqlstate 'P9009' then return null;
when others then
  -- The enclosing PL/pgSQL block has rolled back all version and event mutations.
  -- A transport failure never supplies this definitive refusal to the object writer.
  if p_action='commit' and (expected is not null or record_category in ('ntc','elp','medical','fi','gi')) then return jsonb_build_object('rolledBack',true); end if;
  raise;
end; $$;

commit;
