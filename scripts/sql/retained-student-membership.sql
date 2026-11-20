-- Runs only after a durable attempt and a locked re-read of the complete accepted inventory.
do $establish$
declare
  b constant jsonb := convert_from(decode(current_setting('fixture.binding'),'hex'),'UTF8')::jsonb;
  s jsonb;
  slot constant text := current_setting('fixture.slot');
  school constant uuid := (b->>'schoolId')::uuid;
  subject uuid;
  membership constant uuid := current_setting('fixture.membership')::uuid;
  profile uuid;
  student_role uuid;
begin
  select value into strict s from jsonb_array_elements(b->'slots') where value->>'role' = slot;
  subject := (s->>'authId')::uuid;
  if slot not in ('student_pilot','instructor_pilot') or b->>'projectRef' is distinct from 'ubzihnhmskkdinydlzlb'
    or (select system_identifier::text from pg_control_system()) is distinct from b->>'systemId'
    or subject is null or s->>'plannedAuthId' is distinct from subject::text
    or s->>'databaseAttempt' is distinct from 'unacknowledged'
    or (select count(*) from public.organizations) <> 1
    or not exists (select from public.organizations where id = school and status = 'active')
    or not exists (select from auth.users where id = subject and email = slot || '@school.invalid'
        and raw_app_meta_data->>'flyeye_fixture_create_operation' = s->>'operationId'
        and email_confirmed_at <= clock_timestamp() and deleted_at is null and is_anonymous is false
        and (banned_until is null or banned_until <= clock_timestamp()))
    or exists (select from public.organization_memberships where user_id = subject or id = membership)
    or exists (select from staging_private.retained_membership_receipts
      where (organization_id = school and slot_code = slot) or user_id = subject
        or operation_id = (s->>'operationId')::uuid or attempt_id = (s->>'databaseAttemptId')::uuid)
    then raise exception 'retained membership inventory conflict'; end if;
  select id into strict student_role from public.roles where code = 'student_pilot' and is_active;
  insert into public.organization_memberships(id, organization_id, user_id) values (membership, school, subject);
  insert into public.membership_roles(organization_id, membership_id, role_id) values (school, membership, student_role);
  select id into strict profile from public.organization_member_profiles where membership_id = membership and organization_id = school;
  insert into staging_private.retained_membership_receipts(operation_id, attempt_id, run_id, project_ref,
    package_sha256, database_system_id, organization_id, slot_code, initial_role_code, event_name,
    user_id, membership_id, profile_id) values ((s->>'operationId')::uuid, (s->>'databaseAttemptId')::uuid,
    (b->>'runId')::uuid, b->>'projectRef', b->>'packageSha256', b->>'systemId', school,
    slot,'student_pilot','fixture.retained_membership_established',subject,membership,profile);
end;
$establish$;
