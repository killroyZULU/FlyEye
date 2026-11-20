-- One snapshot. Keep unmatched, duplicate and foreign rows visible to reconciliation.
-- No raw factor identifiers, unrestricted metadata, or unrecognised addresses leave SQL.
with schools as (
  select id as "schoolId", status from public.organizations
), users as (
  select id as "userId", case when email in ('instructor_pilot@school.invalid','admin@school.invalid')
    then email end as email, raw_app_meta_data->>'flyeye_fixture_create_operation' as "createOperationId",
    email_confirmed_at <= transaction_timestamp() and deleted_at is null and is_anonymous is false
    and (banned_until is null or banned_until <= transaction_timestamp()) as eligible from auth.users
), memberships as (
  select organization_id as "schoolId", user_id as "userId", id as "membershipId", status,
    version, created_by as "createdBy", updated_by as "updatedBy" from public.organization_memberships
), profiles as (
  select organization_id as "schoolId", membership_id as "membershipId", id as "profileId",
    created_by as "createdBy", updated_by as "updatedBy" from public.organization_member_profiles
), roles as (
  select m.organization_id as "schoolId", m.membership_id as "membershipId", r.code as role,
    m.assigned_by as "assignedBy" from public.membership_roles m
    left join public.roles r on r.id = m.role_id and r.is_active
), grants as (
  select organization_id as "schoolId", id as "grantId", eligible_user_id as "eligibleUserId",
    floor(extract(epoch from expires_at))::bigint as "expiresAt", authorization_source_kind as source,
    authorization_source_code as "sourceCode", authorization_source_instance_id as "sourceId",
    issuance_correlation_id as "correlationId", status, completed_membership_id as "membershipId",
    completion_idempotency_key_hash as "completionKeyHash" from public.organization_admin_bootstrap_grants
), receipts as (
  select event_name as event, run_id as "runId", instance_digest as instance, database_system_id as "systemId",
    organization_id as "schoolId", user_id as "userId", membership_id as "membershipId", profile_id as "profileId",
    role_code as role, operation_id as "operationId", attempt_id as "attemptId" from staging_private.student_fixture_receipts
), factors as (
  select user_id as "userId", factor_type as type, status,
    encode(sha256(convert_to(id::text,'UTF8')),'hex') as "referenceHash" from auth.mfa_factors
), enrollments as (
  select organization_id as "schoolId", subject_user_id as "userId", membership_id as "membershipId",
    id as "operationId", status, complete_idempotency_key_hash as "completeKeyHash",
    factor_reference_hash as "factorHash" from public.member_mfa_enrollment_operations
), readiness as (
  select organization_id as "schoolId", subject_user_id as "userId", membership_id as "membershipId",
    factor_reference_hash as "factorHash", version from public.member_mfa_readiness
), events as (
  select jsonb_build_object('schoolId',organization_id,'event',event_name,'outcome',outcome) ||
    case event_name when 'admin_bootstrap.grant_issued' then jsonb_build_object('actorKind',actor_kind,
      'actorId',actor_user_id,'sourceId',source_instance_id,'correlationId',correlation_id,'grantId',target_id)
    when 'admin_onboarding.completed' then jsonb_build_object('actorId',actor_user_id,
      'membershipId',metadata->'membershipId','grantId',target_id,'assurance',metadata->'assuranceLevel')
    else jsonb_build_object('userId',actor_user_id,'membershipId',metadata->'membershipId',
      'operationId',target_id,'factorHash',metadata->'factorReferenceHash','version',metadata->'readinessVersion',
      'keyHash',idempotency_key_hash) end as row
  from public.authentication_events where outcome = 'success' and event_name in
    ('admin_bootstrap.grant_issued','admin_onboarding.completed','member_mfa.enrollment_completed')
  union all
  select jsonb_build_object('schoolId',organization_id,'event',event_name,'outcome',outcome,
    'actorId',actor_user_id,'membershipId',target_membership_id,'priorRole',metadata->'priorRoleCode',
    'newRole',metadata->'newRoleCode','priorVersion',metadata->'priorVersion','newVersion',metadata->'newVersion',
    'reason',reason_code,'mfaReadinessVerified',metadata->'mfaReadinessVerified',
    'keyHash',idempotency_key_hash,'correlationId',correlation_id) from public.member_administration_events
    where outcome = 'success' and event_name = 'member_role.changed'
), actor as (
  select s.id as "sessionId", s.user_id as "userId", s.aal as assurance,
    floor(extract(epoch from s.not_after))::bigint as "notAfter",
    encode(sha256(convert_to(s.factor_id::text,'UTF8')),'hex') as "sessionFactorHash",
    exists(select from auth.mfa_amr_claims a where a.session_id = s.id and a.authentication_method = 'password') as "passwordMethod",
    exists(select from auth.mfa_amr_claims a where a.session_id = s.id and a.authentication_method = 'totp') as "totpMethod",
    b.session_id as "bindingSessionId", b.actor_user_id as "bindingUserId",
    encode(sha256(convert_to(b.factor_id::text,'UTF8')),'hex') as "boundFactorHash",
    public.member_administration_actor_is_authorized(s.user_id,'00000000-0000-4000-8000-000000000099',
      'membership.role.assign') as "canAssignRole"
  from auth.sessions s left join public.admin_session_factor_bindings b on b.session_id = s.id
  where s.id = nullif(current_setting('fixture.session_id'),'')::uuid
)
select jsonb_build_object('systemId',(select system_identifier::text from pg_catalog.pg_control_system()),
  'nowSeconds',floor(extract(epoch from transaction_timestamp()))::bigint,
  'actor',(select to_jsonb(a) from actor a),'inventory',jsonb_build_object(
  'schools',array(select to_jsonb(s) from schools s order by to_jsonb(s)),'users',array(select to_jsonb(u) from users u order by to_jsonb(u)),
  'memberships',array(select to_jsonb(m) from memberships m order by to_jsonb(m)),'profiles',array(select to_jsonb(p) from profiles p order by to_jsonb(p)),
  'roles',array(select to_jsonb(r) from roles r order by to_jsonb(r)),'grants',array(select to_jsonb(g) from grants g order by to_jsonb(g)),
  'candidateReceipts',array(select to_jsonb(r) from receipts r order by to_jsonb(r)),'factors',array(select to_jsonb(f) from factors f order by to_jsonb(f)),
  'enrollments',array(select to_jsonb(e) from enrollments e order by to_jsonb(e)),'readiness',array(select to_jsonb(r) from readiness r order by to_jsonb(r)),
  'events',array(select row from events order by row)));
