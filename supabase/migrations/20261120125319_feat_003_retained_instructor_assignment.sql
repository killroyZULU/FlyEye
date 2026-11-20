begin;

-- Only the private operator can issue this exact-package authorization. Neither table has a client policy.
create table staging_private.instructor_assignment_authorizations (
  id uuid primary key,
  organization_id uuid not null references public.organizations,
  receipt_operation_id uuid not null unique references staging_private.retained_membership_receipts,
  grant_id uuid not null unique references public.organization_admin_bootstrap_grants,
  admin_user_id uuid not null references auth.users,
  admin_operation_id uuid not null,
  admin_membership_id uuid not null,
  candidate_user_id uuid not null references auth.users,
  candidate_membership_id uuid not null unique,
  candidate_factor_id uuid not null,
  package_sha256 text not null check (package_sha256 ~ '^[0-9a-f]{64}$'),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null check (isfinite(expires_at)),
  check (admin_user_id <> candidate_user_id),
  foreign key (organization_id,admin_membership_id,admin_user_id)
    references public.organization_memberships (organization_id,id,user_id),
  foreign key (organization_id,candidate_membership_id,candidate_user_id)
    references public.organization_memberships (organization_id,id,user_id)
);
create table staging_private.instructor_assignment_uses (
  authorization_id uuid primary key references staging_private.instructor_assignment_authorizations,
  organization_id uuid not null references public.organizations,
  event_id uuid not null unique references public.member_administration_events,
  consumed_at timestamptz not null default clock_timestamp()
);
alter table staging_private.instructor_assignment_authorizations enable row level security;
alter table staging_private.instructor_assignment_uses enable row level security;
revoke all on staging_private.instructor_assignment_authorizations, staging_private.instructor_assignment_uses
  from public, anon, authenticated, service_role, supabase_auth_admin;
create trigger immutable_assignment_authorization before update or delete or truncate
  on staging_private.instructor_assignment_authorizations for each statement
  execute function staging_private.reject_student_receipt_change();
create trigger immutable_assignment_use before update or delete or truncate
  on staging_private.instructor_assignment_uses for each statement
  execute function staging_private.reject_student_receipt_change();

create function public.consume_retained_instructor_assignment(
  p_authorization_id uuid, p_package_sha256 text, p_actor_user_id uuid, p_session_id uuid,
  p_school_id uuid, p_membership_id uuid, p_candidate_id uuid, p_expires_at timestamptz, p_key_hash text, p_correlation_id uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog set lock_timeout = '3s'
as $fn$
declare
  a staging_private.instructor_assignment_authorizations%rowtype;
  denied jsonb := jsonb_build_object('decision','state_conflict','correlationId',p_correlation_id);
  result jsonb;
  admin_factor uuid;
  factor_hash text;
  audit_id uuid;
begin
  select * into a from staging_private.instructor_assignment_authorizations where id=p_authorization_id for update;
  if not found or a.package_sha256 is distinct from p_package_sha256 or a.key_hash is distinct from p_key_hash
    or a.organization_id is distinct from p_school_id or a.candidate_membership_id is distinct from p_membership_id
    or a.admin_user_id is distinct from p_actor_user_id or a.candidate_user_id is distinct from p_candidate_id
    or a.expires_at is distinct from p_expires_at or p_session_id is null or p_correlation_id is null
    or a.expires_at <= clock_timestamp() or exists (select from staging_private.instructor_assignment_uses
      where authorization_id=a.id) then return denied; end if;
  -- Protect absence predicates against provider, membership and grant churn until commit.
  lock table public.organizations,auth.users,auth.sessions,auth.mfa_amr_claims,auth.mfa_factors,
    public.admin_session_factor_bindings,public.organization_memberships,public.membership_roles,
    public.roles,public.role_permissions,public.permissions,public.organization_member_profiles,
    public.organization_admin_bootstrap_grants,public.authentication_events,public.member_mfa_readiness,
    public.member_mfa_enrollment_operations,public.member_administration_events,
    staging_private.retained_membership_receipts,staging_private.student_fixture_receipts in share row exclusive mode;
  if (select count(*) from auth.users) <> 3 or (select count(*) from public.organization_memberships) <> 3
    or (select count(*) from public.organization_member_profiles) <> 3 or (select count(*) from public.membership_roles) <> 3
    or (select count(*) from public.organization_admin_bootstrap_grants) <> 1
    or (select count(*) from staging_private.retained_membership_receipts) <> 2
    or exists (table staging_private.student_fixture_receipts)
    or (select count(*) from auth.mfa_factors) <> 2
    or (select count(*) from public.member_mfa_readiness) <> 1
    or (select count(*) from public.member_mfa_enrollment_operations) <> 1
    or not exists (
      select from staging_private.retained_membership_receipts x
      join staging_private.retained_membership_receipts c on c.operation_id=a.receipt_operation_id
        and c.run_id=x.run_id and c.database_system_id=x.database_system_id and c.package_sha256=x.package_sha256
      join auth.users u on u.id=x.user_id and u.email='student_pilot@school.invalid'
        and u.raw_app_meta_data->>'flyeye_fixture_create_operation'=x.operation_id::text
      join public.organization_memberships m on m.id=x.membership_id and m.user_id=u.id and m.organization_id=x.organization_id
      join public.membership_roles mr on mr.membership_id=m.id and mr.organization_id=m.organization_id
      join public.roles r on r.id=mr.role_id and r.code='student_pilot' and r.is_active
      where x.slot_code='student_pilot' and x.organization_id=p_school_id and m.version=1 and m.status='active'
        and u.email_confirmed_at <= clock_timestamp() and u.deleted_at is null and not u.is_anonymous
        and (u.banned_until is null or u.banned_until <= clock_timestamp()))
    or (select count(*) from public.organizations) <> 1 or not exists (
    select from public.organizations where id=p_school_id and status='active')
    or not exists (
      select from public.organization_admin_bootstrap_grants g
      join public.authentication_events i on i.target_id=g.id and i.organization_id=g.organization_id
        and i.event_name='admin_bootstrap.grant_issued' and i.outcome='success' and i.actor_kind='staging_fixture'
        and i.actor_subject_id is null and i.actor_user_id is null and i.source_code=g.authorization_source_code
        and i.source_instance_id=g.authorization_source_instance_id and i.correlation_id=g.issuance_correlation_id
      join public.authentication_events e on e.target_id=g.id and e.organization_id=g.organization_id
        and e.event_name='admin_onboarding.completed' and e.outcome='success'
        and e.actor_user_id=a.admin_user_id and e.actor_subject_id=a.admin_user_id
        and e.metadata->>'membershipId'=a.admin_membership_id::text and e.metadata->>'assuranceLevel'='aal2'
      join public.organization_memberships m on m.id=g.completed_membership_id and m.organization_id=g.organization_id
      join public.membership_roles mr on mr.membership_id=m.id and mr.organization_id=m.organization_id
      join public.roles r on r.id=mr.role_id and r.code='admin' and r.is_active
      where g.id=a.grant_id and g.organization_id=p_school_id and g.completed_membership_id=a.admin_membership_id
        and g.eligible_user_id=p_actor_user_id and g.status='completed' and m.status='active' and m.version=1
        and g.authorization_source_kind='staging_fixture' and g.authorization_source_code='feat-003-staging-synthetic-cli')
    or not public.member_administration_actor_is_authorized(p_actor_user_id,p_school_id,'membership.role.assign')
    or not exists (
      select from staging_private.retained_membership_receipts x
      join public.organization_memberships m on m.id=x.membership_id and m.organization_id=x.organization_id
      join public.membership_roles mr on mr.membership_id=m.id and mr.organization_id=m.organization_id
      join public.roles r on r.id=mr.role_id and r.code='student_pilot' and r.is_active
      join auth.users u on u.id=x.user_id and u.email='instructor_pilot@school.invalid'
      where x.operation_id=a.receipt_operation_id and x.project_ref='ubzihnhmskkdinydlzlb'
        and x.database_system_id=(select system_identifier::text from pg_control_system())
        and x.package_sha256=a.package_sha256 and x.slot_code='instructor_pilot'
        and x.organization_id=p_school_id and x.membership_id=p_membership_id and x.user_id=a.candidate_user_id
        and m.status='active' and m.version=1 and u.raw_app_meta_data->>'flyeye_fixture_create_operation'=x.operation_id::text)
    or not exists (select from auth.users where id=p_actor_user_id and email='admin@school.invalid'
      and raw_app_meta_data->>'flyeye_fixture_create_operation'=a.admin_operation_id::text)
    or (select count(*) from auth.users where id in (a.admin_user_id,a.candidate_user_id)
      and email_confirmed_at <= clock_timestamp() and deleted_at is null and not is_anonymous
      and (banned_until is null or banned_until <= clock_timestamp())) <> 2
    or exists (select from public.member_administration_events where event_name='member_role.changed'
      and (target_membership_id=p_membership_id or idempotency_key_hash=p_key_hash))
    then return denied; end if;
  select b.factor_id into admin_factor from public.admin_session_factor_bindings b
    where b.session_id=p_session_id and b.actor_user_id=p_actor_user_id;
  if admin_factor is null or not public.validate_admin_session_factor(p_actor_user_id,p_session_id,admin_factor,true)
    or not exists (select from auth.mfa_amr_claims where session_id=p_session_id and authentication_method='password'
      and updated_at between clock_timestamp()-interval '10 minutes' and clock_timestamp())
    or (select count(*) from auth.mfa_factors where user_id=a.candidate_user_id) <> 1 then return denied; end if;
  select encode(sha256(convert_to(f.id::text,'UTF8')),'hex') into factor_hash
    from auth.mfa_factors f where f.id=a.candidate_factor_id and f.user_id=a.candidate_user_id
      and f.factor_type='totp' and f.status='verified';
  if factor_hash is null or not exists (
    select from public.member_mfa_readiness r join public.member_mfa_enrollment_operations o
      on o.organization_id=r.organization_id and o.membership_id=r.membership_id
      and o.subject_user_id=r.subject_user_id and o.factor_reference_hash=r.factor_reference_hash
    join public.authentication_events e on e.target_id=o.id and e.organization_id=o.organization_id
      and e.event_name='member_mfa.enrollment_completed' and e.outcome='success'
      and e.actor_user_id=o.subject_user_id and e.idempotency_key_hash=o.complete_idempotency_key_hash
      and e.metadata->>'factorReferenceHash'=factor_hash
    where r.organization_id=p_school_id and r.membership_id=p_membership_id and r.subject_user_id=a.candidate_user_id
      and r.factor_reference_hash=factor_hash and r.version=1 and o.status='completed') then return denied; end if;
  if a.expires_at <= clock_timestamp() then return denied; end if;
  result := public.change_organization_member_role(p_actor_user_id,p_school_id,p_membership_id,
    'instructor_pilot','responsibility_changed',1,p_key_hash,factor_hash,p_correlation_id);
  if result->>'decision' <> 'changed' then return result; end if;
  if result->>'replayed' is distinct from 'false' or result->>'version' is distinct from '2'
    then raise exception 'Unexpected retained assignment result'; end if;
  select id into strict audit_id from public.member_administration_events where organization_id=p_school_id
    and actor_user_id=p_actor_user_id and target_membership_id=p_membership_id and event_name='member_role.changed'
    and outcome='success' and reason_code='responsibility_changed' and correlation_id=p_correlation_id
    and idempotency_key_hash=p_key_hash and metadata @> '{"priorRoleCode":"student_pilot","newRoleCode":"instructor_pilot","priorVersion":1,"newVersion":2,"mfaReadinessVerified":true}';
  insert into staging_private.instructor_assignment_uses(authorization_id,organization_id,event_id)
    values(a.id,p_school_id,audit_id);
  return result;
end;
$fn$;
revoke all on function public.consume_retained_instructor_assignment(uuid,text,uuid,uuid,uuid,uuid,uuid,timestamptz,text,uuid)
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.consume_retained_instructor_assignment(uuid,text,uuid,uuid,uuid,uuid,uuid,timestamptz,text,uuid) to service_role;
commit;
