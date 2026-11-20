-- Operator-private snapshot. The journal supplies search keys, never observed authority.
-- Return only the three eligible synthetic subjects. Unexpected rows invalidate the inventory.
with settings as (
  select convert_from(decode(current_setting('fixture.binding'),'hex'),'UTF8')::jsonb as b
), slots as (
  select value as s, value->>'role' as slot, (value->>'plannedAuthId')::uuid as subject,
    (value->>'operationId')::uuid as operation
  from settings, jsonb_array_elements(b->'slots')
), users as (
  select s.slot, u.id, u.email, u.raw_app_meta_data->>'flyeye_fixture_create_operation' as marker,
    u.email_confirmed_at <= transaction_timestamp() and u.deleted_at is null and not u.is_anonymous
    and (u.banned_until is null or u.banned_until <= transaction_timestamp()) as eligible
  from auth.users u join slots s on u.email = s.slot || '@school.invalid' or u.id = s.subject
    or u.raw_app_meta_data->>'flyeye_fixture_create_operation' = s.operation::text
), grant_evidence as (
  select g.*, e.actor_kind, e.actor_subject_id, e.actor_user_id, e.correlation_id,
    e.source_code, e.source_instance_id
  from public.organization_admin_bootstrap_grants g
  left join public.authentication_events e on e.event_name = 'admin_bootstrap.grant_issued'
    and e.outcome = 'success' and e.target_id = g.id and e.organization_id = g.organization_id
    and e.target_kind = 'organization_admin_bootstrap_grant'
), members as (
  select m.id, m.user_id, m.organization_id, m.status, m.version, p.id as profile_id, r.code,
    u.slot, u.marker, x.operation_id, x.attempt_id, g.authorization_source_instance_id as issuance,
    e.id as admin_completion
  from public.organization_memberships m left join users u on u.id = m.user_id
  left join public.organization_member_profiles p on p.membership_id = m.id and p.organization_id = m.organization_id
  left join public.membership_roles mr on mr.membership_id = m.id and mr.organization_id = m.organization_id
  left join public.roles r on r.id = mr.role_id and r.is_active
  left join staging_private.retained_membership_receipts x on x.membership_id = m.id
    and x.organization_id = m.organization_id and x.profile_id = p.id and x.user_id = m.user_id
    and x.slot_code = u.slot and x.operation_id::text = u.marker
    and x.run_id = (select (b->>'runId')::uuid from settings)
    and x.package_sha256 = (select b->>'packageSha256' from settings)
    and x.database_system_id = (select system_identifier::text from pg_control_system())
  left join grant_evidence g on u.slot = 'admin' and g.eligible_user_id = m.user_id
    and g.completed_membership_id = m.id and g.organization_id = m.organization_id and g.status = 'completed'
  left join public.authentication_events e on e.event_name = 'admin_onboarding.completed'
    and e.outcome = 'success' and e.organization_id = m.organization_id and e.target_id = g.id
    and e.actor_user_id = m.user_id and e.actor_subject_id = m.user_id and e.actor_kind = 'authenticated_subject'
    and e.metadata->>'membershipId' = m.id::text and e.metadata->>'assuranceLevel' = 'aal2'
    and e.metadata->>'factorCount' = '1'
), factors as (
  select u.slot, f.id, f.user_id,
    f.factor_type = 'totp' and f.status = 'verified' and case u.slot
      when 'admin' then exists (select from members m where m.user_id = f.user_id and m.admin_completion is not null)
        and exists (select from public.admin_session_factor_bindings b where b.actor_user_id = f.user_id and b.factor_id = f.id)
      when 'instructor_pilot' then exists (
        select from public.member_mfa_readiness r join public.member_mfa_enrollment_operations o
          on o.membership_id = r.membership_id and o.organization_id = r.organization_id
          and o.subject_user_id = r.subject_user_id and o.factor_reference_hash = r.factor_reference_hash
        join public.authentication_events e on e.event_name = 'member_mfa.enrollment_completed'
          and e.outcome = 'success' and e.target_id = o.id and e.actor_user_id = f.user_id
          and e.organization_id = o.organization_id and e.idempotency_key_hash = o.complete_idempotency_key_hash
          and e.metadata->>'factorReferenceHash' = r.factor_reference_hash
        join members m on m.id = r.membership_id and m.user_id = f.user_id
        where r.subject_user_id = f.user_id and o.status = 'completed' and r.version = 1
          and r.factor_reference_hash = encode(sha256(convert_to(f.id::text,'UTF8')),'hex'))
      else false end as bound
  from auth.mfa_factors f join users u on u.id = f.user_id
), assignments as (
  select m.slot, jsonb_build_object('event', case when a.id is not null then e.event_name end, 'outcome', e.outcome, 'schoolId', e.organization_id,
    'actorId', e.actor_user_id, 'membershipId', e.target_membership_id, 'priorRole', e.metadata->'priorRoleCode',
    'newRole', e.metadata->'newRoleCode', 'priorVersion', e.metadata->'priorVersion',
    'newVersion', e.metadata->'newVersion', 'reason', e.reason_code, 'mfaReadinessVerified', e.metadata->'mfaReadinessVerified',
    'keyHash', e.idempotency_key_hash, 'correlationId', e.correlation_id) as event
  from public.member_administration_events e join members m on m.id = e.target_membership_id
  left join staging_private.instructor_assignment_uses used on used.event_id=e.id and used.organization_id=m.organization_id
  left join staging_private.instructor_assignment_authorizations a on a.id=used.authorization_id
    and a.organization_id=m.organization_id and a.receipt_operation_id=m.operation_id
    and a.candidate_user_id=m.user_id and a.candidate_membership_id=m.id and a.admin_user_id=e.actor_user_id
    and a.key_hash=e.idempotency_key_hash and a.package_sha256=(select b->>'packageSha256' from settings)
    and a.grant_id=(select (b->>'grantId')::uuid from settings)
    and exists (select from factors f where f.bound and f.user_id=m.user_id and f.id=a.candidate_factor_id)
  where e.event_name = 'member_role.changed'
)
select jsonb_build_object('projectRef', b->>'projectRef', 'schools', array(select jsonb_build_object(
  'id', id, 'active', status = 'active') from public.organizations),
  'inventoryComplete', (select system_identifier::text from pg_control_system()) = b->>'systemId'
    and (select count(*) from users) = (select count(*) from auth.users)
    and not exists (select from auth.users u where not exists (select from users x where x.id = u.id))
    and not exists (select from members where slot is null or not coalesce(version =
      case when slot = 'instructor_pilot' and code = 'instructor_pilot' then 2 else 1 end,false))
    and not exists (select from staging_private.retained_membership_receipts x where not exists
      (select from members m where m.operation_id = x.operation_id))
    and not exists (select from staging_private.student_fixture_receipts)
    and not exists (select from public.member_mfa_enrollment_operations where status <> 'completed')
    and not exists (select from public.member_mfa_readiness r where not exists
      (select from factors f where f.bound and f.user_id = r.subject_user_id))
    and (select count(*) from public.member_mfa_enrollment_operations) =
        (select count(*) from factors where slot = 'instructor_pilot' and bound),
  'otherAdminOrLiveGrant', exists (select from grant_evidence g where g.id::text <> b->>'grantId'
      or g.authorization_source_instance_id::text <> b->>'sourceInstanceId'
      or g.source_instance_id is distinct from g.authorization_source_instance_id
      or g.issuance_correlation_id is distinct from g.correlation_id
      or g.issuance_correlation_id::text <> b->>'issuanceCorrelationId'
      or g.source_code is distinct from g.authorization_source_code),
  'slots', array(select jsonb_build_object('role', slot, 'operationId', operation,
    'confirmedRollback', null,
    'assignmentPermit',(select jsonb_build_object('id',a.id,'schoolId',a.organization_id,
      'adminId',a.admin_user_id,'candidateId',a.candidate_user_id,'membershipId',a.candidate_membership_id,
      'factorId',a.candidate_factor_id,'keyHash',a.key_hash,'usable',a.expires_at > clock_timestamp()
        and not exists(select from staging_private.instructor_assignment_uses u where u.authorization_id=a.id))
      from staging_private.instructor_assignment_authorizations a where s.slot='instructor_pilot'
        and a.receipt_operation_id=s.operation and a.package_sha256=b->>'packageSha256'
        and a.grant_id=(b->>'grantId')::uuid),
    'users', array(select jsonb_build_object('id', u.id, 'email', case when u.email = s.slot || '@school.invalid'
      then u.email end, 'operationId', u.marker, 'eligible', u.eligible) from users u where u.slot = s.slot),
    'memberships', array(select jsonb_build_object('id', m.id, 'authId', m.user_id, 'schoolId', m.organization_id,
      'role', m.code, 'active', m.status = 'active', 'profileId', m.profile_id, 'auditedOperationId',
      case when m.admin_completion is not null then m.marker else m.operation_id::text end,
      'databaseAttemptId', coalesce(m.attempt_id, m.issuance)) from members m where m.slot = s.slot),
    'grant', (select jsonb_build_object('id',g.id,'authId',g.eligible_user_id,'schoolId',g.organization_id,
      'auditedOperationId',u.marker,'issuanceAttemptId',g.authorization_source_instance_id,
      'provenance',jsonb_build_object('source',g.authorization_source_kind,'sourceCode',g.source_code,
        'actorKind',g.actor_kind,'actorId',g.actor_user_id,'actorSubjectId',g.actor_subject_id,
        'authorizedBySubjectId',g.authorized_by_subject_id,'correlationId',g.correlation_id),
      'status',case when g.status = 'completed' then 'completed' when g.status = 'pending'
        and g.expires_at > clock_timestamp() then 'live' else 'conflict' end)
      from grant_evidence g left join users u on u.id = g.eligible_user_id where s.slot = 'admin'),
    'factor',(select jsonb_build_object('id',f.id,'authId',f.user_id,'slotOperationId',operation,
      'state',case when f.bound then 'verified-bound' else 'conflict' end) from factors f where f.slot = s.slot),
    'assignments',array(select a.event from assignments a where a.slot = s.slot)
  ) from slots s order by s.slot))
from settings
