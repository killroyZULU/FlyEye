begin;

set constraints organizations_single_school_deployment_key deferred;
set constraints organization_memberships_single_school_user_key deferred;

select plan(60);

select has_table(
  'public',
  'organization_admin_bootstrap_grants',
  'FEAT-003 bootstrap grants table exists'
);
select has_table(
  'public',
  'admin_onboarding_rate_limit_state',
  'FEAT-003 limiter state table exists'
);
select has_table(
  'public',
  'admin_onboarding_rate_limit_events',
  'FEAT-003 limiter event table exists'
);
select is(
  (
    select count(*)::integer
    from pg_class
    where oid in (
      'public.organization_admin_bootstrap_grants'::regclass,
      'public.admin_onboarding_rate_limit_state'::regclass,
      'public.admin_onboarding_rate_limit_events'::regclass
    )
      and relrowsecurity
  ),
  3,
  'RLS is enabled on every FEAT-003 table'
);
select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where grantee in ('PUBLIC', 'anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'organization_admin_bootstrap_grants',
        'admin_onboarding_rate_limit_state',
        'admin_onboarding_rate_limit_events'
      )
  ),
  0,
  'browser roles have no FEAT-003 table privileges'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'organization_admin_bootstrap_grants',
        'admin_onboarding_rate_limit_state',
        'admin_onboarding_rate_limit_events'
      )
  ),
  0,
  'FEAT-003 tables are deny-by-default without browser policies'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.consume_admin_onboarding_rate_limit(text,text,uuid)',
    'execute'
  ),
  'authenticated cannot execute the limiter'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_organization_admin_onboarding_status(uuid,uuid)',
    'execute'
  ),
  'authenticated cannot execute onboarding status'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.start_organization_admin_onboarding(uuid,uuid,bigint,text,uuid)',
    'execute'
  ),
  'authenticated cannot execute onboarding start'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.cancel_organization_admin_onboarding(uuid,uuid,text,uuid)',
    'execute'
  ),
  'authenticated cannot execute onboarding cancel'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_first_organization_admin_bootstrap(uuid,uuid,uuid,bigint,text,text[],uuid,integer,uuid,bigint,text,uuid)',
    'execute'
  ),
  'authenticated cannot execute onboarding completion'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.write_admin_onboarding_event(uuid,uuid,text,text,uuid,uuid,uuid[],text,uuid,text,jsonb)',
    'execute'
  ),
  'authenticated cannot execute the onboarding audit writer'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.consume_admin_onboarding_rate_limit(text,text,uuid)',
    'execute'
  ),
  'service role can execute the limiter'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_organization_admin_onboarding_status(uuid,uuid)',
    'execute'
  ),
  'service role can execute onboarding status'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.start_organization_admin_onboarding(uuid,uuid,bigint,text,uuid)',
    'execute'
  ),
  'service role can execute onboarding start'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.cancel_organization_admin_onboarding(uuid,uuid,text,uuid)',
    'execute'
  ),
  'service role can execute onboarding cancel'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_first_organization_admin_bootstrap(uuid,uuid,uuid,bigint,text,text[],uuid,integer,uuid,bigint,text,uuid)',
    'execute'
  ),
  'service role can execute onboarding completion'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.write_admin_onboarding_event(uuid,uuid,text,text,uuid,uuid,uuid[],text,uuid,text,jsonb)',
    'execute'
  ),
  'service role can execute the onboarding audit writer'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  user_id,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  email,
  crypt('synthetic-password', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
from (
  values
    ('81000000-0000-4000-8000-000000000001'::uuid, 'first-admin-a@example.test'),
    ('81000000-0000-4000-8000-000000000002'::uuid, 'attacker-b@example.test'),
    ('81000000-0000-4000-8000-000000000003'::uuid, 'existing-admin-b@example.test'),
    ('81000000-0000-4000-8000-000000000004'::uuid, 'expired-admin-a@example.test'),
    ('81000000-0000-4000-8000-000000000005'::uuid, 'rollback-admin-a@example.test'),
    ('81000000-0000-4000-8000-000000000006'::uuid, 'inactive-admin-a@example.test'),
    ('81000000-0000-4000-8000-000000000007'::uuid, 'staging-fixture@example.test')
) as users(user_id, email);

insert into public.organizations (id, name, status)
values
  ('82000000-0000-4000-8000-000000000001', 'Synthetic Bootstrap School A', 'active'),
  ('82000000-0000-4000-8000-000000000002', 'Synthetic Existing Admin School B', 'active'),
  ('82000000-0000-4000-8000-000000000003', 'Synthetic Expired School A', 'active'),
  ('82000000-0000-4000-8000-000000000004', 'Synthetic Rollback School A', 'active'),
  ('82000000-0000-4000-8000-000000000005', 'Synthetic Inactive School A', 'suspended'),
  ('82000000-0000-4000-8000-000000000006', 'Synthetic Staging Provenance School', 'active');

insert into public.organization_memberships (
  id, organization_id, user_id, status, created_by, updated_by
)
values (
  '83000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000003',
  'active',
  '81000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000003'
);

insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
select
  '82000000-0000-4000-8000-000000000002',
  '83000000-0000-4000-8000-000000000001',
  id,
  '81000000-0000-4000-8000-000000000003'
from public.roles
where code = 'admin';

insert into public.organization_admin_bootstrap_grants (
  id,
  organization_id,
  eligible_user_id,
  issued_at,
  expires_at,
  authorization_source_kind,
  authorization_source_code,
  authorization_source_instance_id,
  issuance_correlation_id
)
values
  (
    '84000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    transaction_timestamp(),
    transaction_timestamp() + interval '30 minutes',
    'local_fixture',
    'feat-003-local-cli-fixture',
    '85000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000001'
  ),
  (
    '84000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000002',
    transaction_timestamp(),
    transaction_timestamp() + interval '30 minutes',
    'local_fixture',
    'feat-003-local-cli-fixture',
    '85000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000002'
  ),
  (
    '84000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000004',
    transaction_timestamp() - interval '31 minutes',
    transaction_timestamp() - interval '1 minute',
    'local_fixture',
    'feat-003-local-cli-fixture',
    '85000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000003'
  ),
  (
    '84000000-0000-4000-8000-000000000004',
    '82000000-0000-4000-8000-000000000004',
    '81000000-0000-4000-8000-000000000005',
    transaction_timestamp(),
    transaction_timestamp() + interval '30 minutes',
    'local_fixture',
    'feat-003-local-cli-fixture',
    '85000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000004'
  ),
  (
    '84000000-0000-4000-8000-000000000005',
    '82000000-0000-4000-8000-000000000005',
    '81000000-0000-4000-8000-000000000006',
    transaction_timestamp(),
    transaction_timestamp() + interval '30 minutes',
    'local_fixture',
    'feat-003-local-cli-fixture',
    '85000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000005'
  );

select is(
  (
    select extract(epoch from (expires_at - issued_at))::integer
    from public.organization_admin_bootstrap_grants
    where id = '84000000-0000-4000-8000-000000000001'
  ),
  1800,
  'grant lifetime is exactly 30 minutes and non-sliding'
);
select is(
  (
    select authorization_source_kind || ':' || authorization_source_code
    from public.organization_admin_bootstrap_grants
    where id = '84000000-0000-4000-8000-000000000001'
  ),
  'local_fixture:feat-003-local-cli-fixture',
  'grant attribution is fixed to the local fixture'
);
select is(
  (
    select authorized_by_subject_id
    from public.organization_admin_bootstrap_grants
    where id = '84000000-0000-4000-8000-000000000001'
  ),
  null::uuid,
  'the local fixture does not fabricate a human authorizer'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_admin_bootstrap_grants'
      and column_name in ('authorization_source_kind', 'authorization_source_code')
      and column_default is null
  ),
  2,
  'fixture provenance must be supplied explicitly and cannot silently default to local'
);

insert into public.organization_admin_bootstrap_grants (
  id,
  organization_id,
  eligible_user_id,
  issued_at,
  expires_at,
  authorization_source_kind,
  authorization_source_code,
  authorization_source_instance_id,
  issuance_correlation_id
)
values (
  '84000000-0000-4000-8000-000000000006',
  '82000000-0000-4000-8000-000000000006',
  '81000000-0000-4000-8000-000000000007',
  transaction_timestamp(),
  transaction_timestamp() + interval '30 minutes',
  'staging_fixture',
  'feat-003-staging-synthetic-cli',
  '85000000-0000-4000-8000-000000000002',
  '86000000-0000-4000-8000-000000000006'
);

insert into public.authentication_events (
  organization_id,
  organization_ids,
  actor_kind,
  event_name,
  outcome,
  correlation_id,
  reason_code,
  source_code,
  source_instance_id,
  target_kind,
  target_id,
  metadata
)
values (
  '82000000-0000-4000-8000-000000000006',
  array['82000000-0000-4000-8000-000000000006'::uuid],
  'staging_fixture',
  'admin_bootstrap.grant_issued',
  'success',
  '86000000-0000-4000-8000-000000000006',
  'staging_fixture_grant_issued',
  'feat-003-staging-synthetic-cli',
  '85000000-0000-4000-8000-000000000002',
  'organization_admin_bootstrap_grant',
  '84000000-0000-4000-8000-000000000006',
  '{"grantVersion":1}'::jsonb
);

select is(
  (
    select authorization_source_kind || ':' || authorization_source_code
    from public.organization_admin_bootstrap_grants
    where id = '84000000-0000-4000-8000-000000000006'
  ),
  'staging_fixture:feat-003-staging-synthetic-cli',
  'dormant staging grant provenance uses one exact non-human source pair'
);
select is(
  (
    select actor_kind || ':' || source_code
    from public.authentication_events
    where correlation_id = '86000000-0000-4000-8000-000000000006'
  ),
  'staging_fixture:feat-003-staging-synthetic-cli',
  'dormant staging issuance audit uses the matching non-human source pair'
);
select throws_ok(
  $$insert into public.organization_admin_bootstrap_grants (
    organization_id, eligible_user_id, authorization_source_kind,
    authorization_source_code, authorization_source_instance_id,
    issuance_correlation_id
  ) values (
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'staging_fixture', 'feat-003-local-cli-fixture',
    '85000000-0000-4000-8000-000000000003',
    '86000000-0000-4000-8000-000000000007'
  )$$,
  '23514',
  null,
  'mixed staging and local grant provenance is rejected'
);
select throws_ok(
  $$insert into public.authentication_events (
    organization_id, organization_ids, actor_user_id, actor_subject_id,
    actor_kind, event_name, outcome, correlation_id, reason_code, source_code,
    source_instance_id, target_kind, target_id, metadata
  ) values (
    '82000000-0000-4000-8000-000000000001',
    array['82000000-0000-4000-8000-000000000001'::uuid],
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'staging_fixture', 'admin_bootstrap.grant_issued', 'success',
    '86000000-0000-4000-8000-000000000008',
    'staging_fixture_grant_issued', 'feat-003-staging-synthetic-cli',
    '85000000-0000-4000-8000-000000000003',
    'organization_admin_bootstrap_grant',
    '84000000-0000-4000-8000-000000000006', '{}'::jsonb
  )$$,
  '23514',
  null,
  'staging fixture audit cannot fabricate a human actor'
);

set local role service_role;

select is(
  jsonb_array_length(
    public.get_organization_admin_onboarding_status(
      '81000000-0000-4000-8000-000000000001',
      '87000000-0000-4000-8000-000000000001'
    ) -> 'grants'
  ),
  1,
  'eligible subject receives its safe pending grant'
);
select is(
  jsonb_array_length(
    public.get_organization_admin_onboarding_status(
      '81000000-0000-4000-8000-000000000002',
      '87000000-0000-4000-8000-000000000002'
    ) -> 'grants'
  ),
  0,
  'a subject whose organization already has an admin receives no hidden grant detail'
);
select is(
  public.start_organization_admin_onboarding(
    '81000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    1,
    repeat('a', 64),
    '87000000-0000-4000-8000-000000000003'
  ) ->> 'decision',
  'ready',
  'eligible actor can start the pending grant'
);
select is(
  (
    public.start_organization_admin_onboarding(
      '81000000-0000-4000-8000-000000000001',
      '84000000-0000-4000-8000-000000000001',
      1,
      repeat('a', 64),
      '87000000-0000-4000-8000-000000000004'
    ) ->> 'replayed'
  )::boolean,
  true,
  'same start idempotency key replays without a duplicate audit transition'
);
select is(
  public.start_organization_admin_onboarding(
    '81000000-0000-4000-8000-000000000002',
    '84000000-0000-4000-8000-000000000001',
    1,
    repeat('b', 64),
    '87000000-0000-4000-8000-000000000005'
  ) ->> 'decision',
  'not_available',
  'another tenant cannot start a grant by direct identifier'
);
select is(
  public.start_organization_admin_onboarding(
    '81000000-0000-4000-8000-000000000004',
    '84000000-0000-4000-8000-000000000003',
    1,
    repeat('c', 64),
    '87000000-0000-4000-8000-000000000006'
  ) ->> 'decision',
  'expired',
  'expired grant cannot be started'
);
select is(
  public.start_organization_admin_onboarding(
    '81000000-0000-4000-8000-000000000002',
    '84000000-0000-4000-8000-000000000002',
    1,
    repeat('d', 64),
    '87000000-0000-4000-8000-000000000007'
  ) ->> 'decision',
  'conflict',
  'an existing active administrator blocks first-admin onboarding'
);
select is(
  public.start_organization_admin_onboarding(
    '81000000-0000-4000-8000-000000000006',
    '84000000-0000-4000-8000-000000000005',
    1,
    repeat('f', 64),
    '87000000-0000-4000-8000-000000000021'
  ) ->> 'decision',
  'conflict',
  'an inactive organization cannot start first-admin onboarding'
);
select is(
  public.complete_first_organization_admin_bootstrap(
    '81000000-0000-4000-8000-000000000006',
    '81000000-0000-4000-8000-000000000006',
    '88000000-0000-4000-8000-000000000003',
    floor(extract(epoch from transaction_timestamp()))::bigint,
    'aal2',
    array['password', 'totp'],
    '89000000-0000-4000-8000-000000000003',
    1,
    '84000000-0000-4000-8000-000000000005',
    1,
    repeat('0', 64),
    '87000000-0000-4000-8000-000000000022'
  ) ->> 'decision',
  'conflict',
  'an inactive organization cannot complete first-admin onboarding'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.organization_memberships
    where organization_id = '82000000-0000-4000-8000-000000000005'
      and user_id = '81000000-0000-4000-8000-000000000006'
  ),
  0,
  'inactive-organization denial creates no membership authority'
);

set local role service_role;

select is(
  public.complete_first_organization_admin_bootstrap(
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000001',
    floor(extract(epoch from transaction_timestamp()))::bigint,
    'aal2',
    array['password', 'totp'],
    '89000000-0000-4000-8000-000000000001',
    1,
    '84000000-0000-4000-8000-000000000001',
    1,
    repeat('e', 64),
    '87000000-0000-4000-8000-000000000008'
  ) ->> 'decision',
  'completed',
  'completion atomically creates the first Organization Admin'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.organization_memberships
    where organization_id = '82000000-0000-4000-8000-000000000001'
      and user_id = '81000000-0000-4000-8000-000000000001'
      and status = 'active'
  ),
  1,
  'completion creates exactly one active membership'
);
select is(
  (
    select role.code
    from public.organization_memberships membership
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id
    where membership.organization_id = '82000000-0000-4000-8000-000000000001'
      and membership.user_id = '81000000-0000-4000-8000-000000000001'
  ),
  'admin',
  'completion assigns only the built-in admin role'
);
select is(
  (
    select status
    from public.organization_admin_bootstrap_grants
    where id = '84000000-0000-4000-8000-000000000001'
  ),
  'completed',
  'completion consumes the grant'
);
select is(
  (
    select count(*)::integer
    from public.authentication_events
    where event_name = 'admin_onboarding.completed'
      and target_id = '84000000-0000-4000-8000-000000000001'
  ),
  1,
  'completion writes exactly one attributable audit event'
);

set local role service_role;

select is(
  public.complete_first_organization_admin_bootstrap(
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000001',
    floor(extract(epoch from transaction_timestamp()))::bigint,
    'aal2',
    array['password', 'totp'],
    '89000000-0000-4000-8000-000000000001',
    1,
    '84000000-0000-4000-8000-000000000001',
    1,
    repeat('e', 64),
    '87000000-0000-4000-8000-000000000009'
  ) ->> 'decision',
  'already_completed',
  'same completion idempotency key safely replays'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.organization_memberships
    where organization_id = '82000000-0000-4000-8000-000000000001'
      and user_id = '81000000-0000-4000-8000-000000000001'
  ),
  1,
  'completion replay does not duplicate authority'
);

set local role service_role;

select is(
  public.complete_first_organization_admin_bootstrap(
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000001',
    floor(extract(epoch from transaction_timestamp()))::bigint,
    'aal2',
    array['password', 'totp'],
    '89000000-0000-4000-8000-000000000001',
    1,
    '84000000-0000-4000-8000-000000000001',
    2,
    repeat('f', 64),
    '87000000-0000-4000-8000-000000000010'
  ) ->> 'decision',
  'conflict',
  'different completion idempotency key cannot reuse consumed authority'
);

reset role;

create function pg_temp.fail_feat_003_completion_audit()
returns trigger
language plpgsql
as $$
begin
  if new.event_name = 'admin_onboarding.completed' then
    raise exception 'synthetic audit failure';
  end if;
  return new;
end;
$$;

create trigger test_fail_feat_003_completion_audit
before insert on public.authentication_events
for each row execute function pg_temp.fail_feat_003_completion_audit();

do $$
begin
  set local role service_role;
  perform public.complete_first_organization_admin_bootstrap(
    '81000000-0000-4000-8000-000000000005',
    '81000000-0000-4000-8000-000000000005',
    '88000000-0000-4000-8000-000000000002',
    floor(extract(epoch from transaction_timestamp()))::bigint,
    'aal2',
    array['password', 'totp'],
    '89000000-0000-4000-8000-000000000002',
    1,
    '84000000-0000-4000-8000-000000000004',
    1,
    repeat('1', 64),
    '87000000-0000-4000-8000-000000000011'
  );
  raise exception 'completion unexpectedly succeeded';
exception
  when others then
    if sqlerrm <> 'synthetic audit failure' then
      raise;
    end if;
end;
$$;

drop trigger test_fail_feat_003_completion_audit on public.authentication_events;

select is(
  (
    select count(*)::integer
    from public.organization_memberships
    where organization_id = '82000000-0000-4000-8000-000000000004'
  ),
  0,
  'audit failure rolls back the membership'
);
select is(
  (
    select status
    from public.organization_admin_bootstrap_grants
    where id = '84000000-0000-4000-8000-000000000004'
  ),
  'pending',
  'audit failure rolls back grant consumption'
);

set local role service_role;

select is(
  (
    select array_agg(
      (
        public.consume_admin_onboarding_rate_limit(
          repeat('2', 64),
          'status',
          correlation_id
        ) ->> 'allowed'
      )::boolean
      order by correlation_id
    )
    from (
      values
        ('8a000000-0000-4000-8000-000000000001'::uuid),
        ('8a000000-0000-4000-8000-000000000002'::uuid),
        ('8a000000-0000-4000-8000-000000000003'::uuid),
        ('8a000000-0000-4000-8000-000000000004'::uuid)
    ) as calls(correlation_id)
  ),
  array[true, true, true, true],
  'status limiter permits the approved burst of four'
);
select is(
  (
    public.consume_admin_onboarding_rate_limit(
      repeat('2', 64),
      'status',
      '8a000000-0000-4000-8000-000000000005'
    ) ->> 'allowed'
  )::boolean,
  false,
  'status limiter rejects the fifth immediate request'
);
select is(
  (
    select array_agg(
      (
        public.consume_admin_onboarding_rate_limit(
          repeat('6', 64),
          'start',
          correlation_id
        ) ->> 'allowed'
      )::boolean
      order by correlation_id
    )
    from (
      values
        ('8a000000-0000-4000-8000-000000000011'::uuid),
        ('8a000000-0000-4000-8000-000000000012'::uuid)
    ) as calls(correlation_id)
  ),
  array[true, true],
  'start limiter permits the approved burst of two'
);
select is(
  (
    public.consume_admin_onboarding_rate_limit(
      repeat('6', 64),
      'start',
      '8a000000-0000-4000-8000-000000000013'
    ) ->> 'allowed'
  )::boolean,
  false,
  'start limiter rejects the third immediate request'
);
select is(
  (
    public.consume_admin_onboarding_rate_limit(
      repeat('7', 64),
      'complete',
      '8a000000-0000-4000-8000-000000000014'
    ) ->> 'allowed'
  )::boolean,
  true,
  'complete limiter permits the approved burst of one'
);
select is(
  (
    public.consume_admin_onboarding_rate_limit(
      repeat('7', 64),
      'complete',
      '8a000000-0000-4000-8000-000000000015'
    ) ->> 'allowed'
  )::boolean,
  false,
  'complete limiter rejects the second immediate request'
);
select is(
  (
    select array_agg(
      (
        public.consume_admin_onboarding_rate_limit(
          repeat('8', 64),
          'cancel',
          correlation_id
        ) ->> 'allowed'
      )::boolean
      order by correlation_id
    )
    from (
      values
        ('8a000000-0000-4000-8000-000000000016'::uuid),
        ('8a000000-0000-4000-8000-000000000017'::uuid)
    ) as calls(correlation_id)
  ),
  array[true, true],
  'cancel limiter permits the approved burst of two'
);
select is(
  (
    public.consume_admin_onboarding_rate_limit(
      repeat('8', 64),
      'cancel',
      '8a000000-0000-4000-8000-000000000018'
    ) ->> 'allowed'
  )::boolean,
  false,
  'cancel limiter rejects the third immediate request'
);
select is(
  (
    public.consume_admin_onboarding_rate_limit(
      repeat('3', 64),
      'start',
      '8a000000-0000-4000-8000-000000000006'
    ) ->> 'networkSourceUsed'
  )::boolean,
  false,
  'limiter never trusts local IP or forwarded headers'
);
select is(
  public.consume_admin_onboarding_rate_limit(
    repeat('9', 64),
    'status',
    '8a000000-0000-4000-8000-000000000019'
  ) ->> 'policyVersion',
  'subject-action-v1',
  'limiter returns the exact versioned Edge contract'
);

reset role;

insert into public.admin_onboarding_rate_limit_state (
  limiter_key_hash, action, tokens_milli, last_refill_at, last_decision_at
)
values (
  repeat('4', 64),
  'cancel',
  0,
  transaction_timestamp() - interval '16 minutes',
  transaction_timestamp() - interval '16 minutes'
);

set local role service_role;

select lives_ok(
  $$
    select public.consume_admin_onboarding_rate_limit(
      repeat('5', 64),
      'cancel',
      '8a000000-0000-4000-8000-000000000007'
    )
  $$,
  'limiter processes a request while removing inactive state'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.admin_onboarding_rate_limit_state
    where limiter_key_hash = repeat('4', 64)
  ),
  0,
  'limiter state older than 15 inactive minutes is removed'
);
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'admin_onboarding_rate_limit_state',
        'admin_onboarding_rate_limit_events'
      )
      and (
        column_name ilike '%ip%'
        or column_name ilike '%header%'
        or column_name ilike '%email%'
        or column_name ilike '%token%'
      )
  ),
  1,
  'limiter persistence contains only token-bucket state and no IP, header, email, or credential fields'
);
select is(
  (
    select count(*)::integer
    from public.authentication_events
    where event_name like 'admin_onboarding.%'
      and (
        metadata ? 'password'
        or metadata ? 'totpCode'
        or metadata ? 'totpSecret'
        or metadata ? 'qrCode'
        or metadata ? 'provisioningUri'
        or metadata ? 'email'
        or metadata ? 'token'
      )
  ),
  0,
  'onboarding audit metadata contains no credential or identity secret fields'
);

select * from finish();
rollback;
