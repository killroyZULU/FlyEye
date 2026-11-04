-- Invoked inside the CLI transaction, never installed as an RPC or database function.
do $issuer$
declare
  v_org uuid := current_setting('flyeye.issuer_organization_id')::uuid;
  v_user uuid := current_setting('flyeye.issuer_user_id')::uuid;
  v_grant uuid := current_setting('flyeye.issuer_grant_id')::uuid;
  v_source uuid := current_setting('flyeye.issuer_source_id')::uuid;
  v_correlation uuid := current_setting('flyeye.issuer_correlation_id')::uuid;
  v_status text;
begin
  -- The existing onboarding completion path also locks the school before its grant.
  select status into v_status from public.organizations where id = v_org for update;
  if v_status is distinct from 'active'
     or (select count(*) from public.organizations) <> 1 then
    raise exception using errcode = 'P0001', message = 'Staging issuance rejected.';
  end if;

  perform 1 from auth.users where id = v_user and email_confirmed_at is not null
    and deleted_at is null and (banned_until is null or banned_until <= transaction_timestamp())
    for update;
  if not found or exists (
    select 1 from public.organization_memberships where user_id = v_user
  ) or exists (
    select 1 from public.organization_memberships m
    join public.membership_roles mr on mr.membership_id = m.id and mr.organization_id = m.organization_id
    join public.roles r on r.id = mr.role_id
    where m.organization_id = v_org and m.status = 'active' and r.code = 'admin'
  ) or exists (
    select 1 from public.organization_admin_bootstrap_grants
    where organization_id = v_org and status = 'pending' and expires_at > transaction_timestamp()
  ) then
    raise exception using errcode = 'P0001', message = 'Staging issuance rejected.';
  end if;

  insert into public.organization_admin_bootstrap_grants (
    id, organization_id, eligible_user_id, authorization_source_kind,
    authorization_source_code, authorization_source_instance_id,
    authorized_by_subject_id, issuance_correlation_id
  ) values (
    v_grant, v_org, v_user, 'staging_fixture', 'feat-003-staging-synthetic-cli',
    v_source, null, v_correlation
  );
  insert into public.authentication_events (
    organization_id, organization_ids, actor_user_id, actor_subject_id, actor_kind,
    event_name, outcome, correlation_id, reason_code, source_code, source_instance_id,
    target_kind, target_id, metadata
  ) values (
    v_org, array[v_org], null, null, 'staging_fixture', 'admin_bootstrap.grant_issued',
    'success', v_correlation, 'staging_fixture_grant_issued', 'feat-003-staging-synthetic-cli',
    v_source, 'organization_admin_bootstrap_grant', v_grant, '{"grantVersion":1}'::jsonb
  );
  if not exists (
    select 1 from public.organization_admin_bootstrap_grants
    where id = v_grant and organization_id = v_org and eligible_user_id = v_user
      and status = 'pending' and version = 1 and issued_at = transaction_timestamp()
      and expires_at = issued_at + interval '30 minutes'
      and authorization_source_kind = 'staging_fixture'
      and authorization_source_code = 'feat-003-staging-synthetic-cli'
      and authorization_source_instance_id = v_source and authorized_by_subject_id is null
      and issuance_correlation_id = v_correlation
  ) or (
    select count(*) from public.authentication_events
    where correlation_id = v_correlation and organization_id = v_org
      and source_instance_id = v_source and actor_kind = 'staging_fixture'
      and actor_user_id is null and actor_subject_id is null
      and event_name = 'admin_bootstrap.grant_issued' and outcome = 'success'
      and source_code = 'feat-003-staging-synthetic-cli'
      and target_kind = 'organization_admin_bootstrap_grant' and target_id = v_grant
  ) <> 1 then
    raise exception using errcode = 'P0001', message = 'Staging issuance rejected.';
  end if;
end;
$issuer$;
