-- Private operator transaction. Bind a reviewed one-shot policy after protected onboarding and enrollment.
-- No RPC, no browser role and no overwrite or renewal on conflict.
do $issue$
declare
  b jsonb := convert_from(decode(current_setting('fixture.binding'),'hex'),'UTF8')::jsonb;
  p jsonb := convert_from(decode(current_setting('fixture.assignment_policy'),'hex'),'UTF8')::jsonb;
  s jsonb;
  admin_slot jsonb;
  membership uuid;
begin
  select value into strict s from jsonb_array_elements(b->'slots') where value->>'role'='instructor_pilot';
  select value into strict admin_slot from jsonb_array_elements(b->'slots') where value->>'role'='admin';
  if p->>'version' is distinct from 'retained-instructor-once-v1' or b->>'projectRef' is distinct from 'ubzihnhmskkdinydlzlb'
    or b->>'systemId' is distinct from (select system_identifier::text from pg_control_system())
    or b->>'packageSha256' is distinct from p->>'packageSha256' or b->>'schoolId' is distinct from p->>'schoolId'
    or admin_slot->>'authId' is distinct from p->>'adminId' or s->>'authId' is distinct from p->>'candidateId'
    or s->>'membershipId' is distinct from p->>'membershipId' or (admin_slot->>'complete')::boolean is not true
    or (p->>'expiresAt')::timestamptz <= clock_timestamp() then raise exception 'Retained authorization conflict'; end if;
  select g.completed_membership_id into strict membership from public.organization_admin_bootstrap_grants g
    where g.organization_id=(b->>'schoolId')::uuid and g.id=(b->>'grantId')::uuid and g.status='completed'
      and g.authorization_source_kind='staging_fixture' and g.eligible_user_id=(p->>'adminId')::uuid
      and g.completed_membership_id=(admin_slot->>'membershipId')::uuid and g.authorized_by_subject_id is null
      and g.authorization_source_instance_id=(b->>'sourceInstanceId')::uuid and g.issuance_correlation_id=(b->>'issuanceCorrelationId')::uuid;
  perform 1 from staging_private.retained_membership_receipts x where x.slot_code='instructor_pilot'
    and x.operation_id=(s->>'operationId')::uuid and x.attempt_id=(s->>'databaseAttemptId')::uuid
    and x.membership_id=(p->>'membershipId')::uuid and x.profile_id=(s->>'profileId')::uuid
    and x.user_id=(p->>'candidateId')::uuid and x.organization_id=(p->>'schoolId')::uuid
    and x.package_sha256=p->>'packageSha256' and x.run_id=(b->>'runId')::uuid and x.database_system_id=b->>'systemId';
  if not found then raise exception 'Retained receipt conflict'; end if;
  insert into staging_private.instructor_assignment_authorizations(id,organization_id,receipt_operation_id,grant_id,
    admin_user_id,admin_operation_id,admin_membership_id,candidate_user_id,candidate_membership_id,
    candidate_factor_id,package_sha256,key_hash,expires_at)
    values((p->>'authorizationId')::uuid,(b->>'schoolId')::uuid,(s->>'operationId')::uuid,(b->>'grantId')::uuid,
    (p->>'adminId')::uuid,(admin_slot->>'operationId')::uuid,membership,(p->>'candidateId')::uuid,
    (p->>'membershipId')::uuid,current_setting('fixture.candidate_factor')::uuid,b->>'packageSha256',
    p->>'keyHash',(p->>'expiresAt')::timestamptz);
end;
$issue$;
