-- One bounded result. Missing, competing or changed evidence cannot acknowledge a write.
select p.id from staging_private.student_fixture_receipts s
join public.organizations o on o.id = s.organization_id
join auth.users u on u.id = s.user_id
join public.organization_memberships m
  on (m.organization_id, m.id, m.user_id) = (s.organization_id, s.membership_id, s.user_id)
join public.membership_roles mr on (mr.organization_id, mr.membership_id) = (o.id, m.id)
join public.roles r on r.id = mr.role_id
join public.organization_member_profiles p
  on (p.organization_id, p.membership_id, p.id) = (o.id, m.id, s.profile_id)
where s.operation_id = current_setting('fixture.operation_id')::uuid
  and s.attempt_id = current_setting('fixture.attempt_id')::uuid
  and s.run_id = current_setting('fixture.run_id')::uuid
  and s.user_id = current_setting('fixture.user_id')::uuid
  and s.membership_id = current_setting('fixture.membership_id')::uuid
  and s.instance_digest = current_setting('fixture.instance_digest')
  and s.database_system_id = current_setting('fixture.database_system_id')
  and s.database_system_id = (select system_identifier::text from pg_catalog.pg_control_system())
  and s.target = 'flyeye-nosend-p3d1' and s.event_name = 'fixture.local_student_established'
  and o.id = '00000000-0000-4000-8000-000000000099' and o.status = 'active'
  and (select count(*) from public.organizations) = 1
  and (select count(*) from auth.users) = 1
  and (select count(*) from public.organization_memberships) = 1
  and (select count(*) from public.membership_roles) = 1
  and (select count(*) from public.organization_member_profiles) = 1
  and (select count(*) from staging_private.student_fixture_receipts) = 1
  and not exists (select from public.organization_admin_bootstrap_grants g where g.organization_id = o.id)
  and u.email = 'student_pilot@school.invalid'
  and u.raw_app_meta_data->>'flyeye_fixture_create_operation' = s.operation_id::text
  and u.email_confirmed_at <= transaction_timestamp() and u.deleted_at is null
  and (u.banned_until is null or u.banned_until <= transaction_timestamp())
  and u.is_anonymous is false
  and m.status = 'active' and m.created_by is null and m.updated_by is null
  and mr.assigned_by is null and r.code = 'student_pilot' and r.is_active
  and s.role_code = r.code and p.created_by is null;
