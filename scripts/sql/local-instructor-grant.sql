-- Disposable-only grant and audit in the same transaction, before protected onboarding.
do $grant$
declare
  school constant uuid := '00000000-0000-4000-8000-000000000099';
  subject uuid := current_setting('fixture.userid')::uuid;
  grant_id uuid := current_setting('fixture.grantid')::uuid;
  source_id uuid := current_setting('fixture.sourceid')::uuid;
  correlation uuid := current_setting('fixture.correlationid')::uuid;
begin
  lock table public.organizations, auth.users, public.organization_memberships,
    public.organization_admin_bootstrap_grants in share row exclusive mode;
  if (select system_identifier::text from pg_catalog.pg_control_system()) <> current_setting('fixture.system_id')
    or school <> current_setting('fixture.schoolid')::uuid
    or (select count(*) from public.organizations) <> 1
    or not exists (select from public.organizations where id = school and status = 'active')
    or (select count(*) from auth.users) <> 2
    or not exists (select from auth.users where id = subject and email = 'admin@school.invalid'
      and raw_app_meta_data->>'flyeye_fixture_create_operation' = current_setting('fixture.marker')
      and email_confirmed_at <= transaction_timestamp() and deleted_at is null and is_anonymous is false
      and (banned_until is null or banned_until <= transaction_timestamp()))
    or exists (select from public.organization_admin_bootstrap_grants)
    or exists (select from public.organization_memberships where user_id = subject) then
    raise exception 'Local grant inventory rejected.';
  end if;
  insert into public.organization_admin_bootstrap_grants
    (id,organization_id,eligible_user_id,authorization_source_kind,authorization_source_code,
     authorization_source_instance_id,issuance_correlation_id)
  values (grant_id,school,subject,'local_fixture','feat-003-local-cli-fixture',source_id,correlation);
  insert into public.authentication_events
    (organization_id,organization_ids,actor_kind,event_name,outcome,correlation_id,
     reason_code,source_code,source_instance_id,target_kind,target_id,metadata)
  values (school,array[school],'local_fixture','admin_bootstrap.grant_issued','success',correlation,
     'local_fixture_grant_issued','feat-003-local-cli-fixture',source_id,'organization_admin_bootstrap_grant',
     grant_id,jsonb_build_object('grantVersion',1));
end;
$grant$;
