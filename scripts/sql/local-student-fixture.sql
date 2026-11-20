-- Executed only by the local fixture, after durable write intent. No installed writer.
do $student$
declare
  school constant uuid := '00000000-0000-4000-8000-000000000099';
  student uuid := current_setting('fixture.user_id')::uuid;
  operation uuid := current_setting('fixture.operation_id')::uuid;
  membership uuid := current_setting('fixture.membership_id')::uuid;
  student_role uuid;
  profile uuid;
begin
  -- An empty inventory is required for this first Student, including absence
  -- predicates. Lock the inventories for the duration of this short transaction.
  lock table public.organizations, auth.users, public.organization_memberships,
    public.membership_roles, public.organization_member_profiles,
    public.organization_admin_bootstrap_grants, staging_private.student_fixture_receipts
    in share row exclusive mode;
  if (select system_identifier::text from pg_catalog.pg_control_system())
       <> current_setting('fixture.database_system_id')
     or (select count(*) from public.organizations) <> 1
     or not exists (select from public.organizations where id = school and status = 'active')
     or (select count(*) from auth.users) <> 1
     or not exists (
       select from auth.users where id = student and email = 'student_pilot@school.invalid'
         and raw_app_meta_data->>'flyeye_fixture_create_operation' = operation::text
         and email_confirmed_at <= transaction_timestamp() and deleted_at is null
         and (banned_until is null or banned_until <= transaction_timestamp())
         and is_anonymous is false
     )
     or exists (select from public.organization_memberships)
     or exists (select from public.organization_admin_bootstrap_grants)
     or exists (select from staging_private.student_fixture_receipts) then
    raise exception 'Local Student inventory rejected.';
  end if;
  select id into strict student_role from public.roles
    where code = 'student_pilot' and is_active for share;
  insert into public.organization_memberships (organization_id, id, user_id, status)
    values (school, membership, student, 'active');
  -- The existing membership trigger is the sole profile creator.
  select id into strict profile from public.organization_member_profiles
    where organization_id = school and membership_id = membership
      and created_by is null and updated_by is null;
  insert into public.membership_roles (organization_id, membership_id, role_id)
    values (school, membership, student_role);
  insert into staging_private.student_fixture_receipts
    (operation_id, attempt_id, run_id, target, instance_digest, database_system_id,
     event_name, role_code, organization_id, user_id, membership_id, profile_id)
  values (operation, current_setting('fixture.attempt_id')::uuid,
    current_setting('fixture.run_id')::uuid, 'flyeye-nosend-p3d1',
    current_setting('fixture.instance_digest'), current_setting('fixture.database_system_id'),
    'fixture.local_student_established', 'student_pilot', school, student, membership, profile);
end;
$student$;
