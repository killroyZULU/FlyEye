begin;

set constraints organizations_single_school_deployment_key deferred;
set constraints organization_memberships_single_school_user_key deferred;

select plan(56);

select ok(
  exists (
    select 1 from public.roles role
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.code = 'admin' and permission.code = 'aircraft.record.read'
  ),
  'Organization Admin receives aircraft read permission'
);
select ok(
  exists (
    select 1 from public.roles role
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.code = 'admin' and permission.code = 'aircraft.record.manage'
  ),
  'Organization Admin receives aircraft manage permission'
);
select ok(
  not exists (
    select 1 from public.roles role
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.code <> 'admin' and permission.code like 'aircraft.record.%'
  ),
  'No other current role receives aircraft registry permission'
);
select ok((select relrowsecurity from pg_class where oid = 'public.aircraft_records'::regclass), 'Aircraft rows have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.aircraft_registry_events'::regclass), 'Aircraft audit has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.aircraft_records', 'select'), 'Browser roles cannot select aircraft directly');
select ok(not has_table_privilege('authenticated', 'public.aircraft_records', 'insert'), 'Browser roles cannot insert aircraft directly');
select ok(
  not has_function_privilege(
    'authenticated',
    'public.mutate_aircraft_record(uuid,uuid,text,uuid,text,text,text,text,text,bigint,text,text,uuid)',
    'execute'
  ),
  'Browser roles cannot execute the aircraft mutation RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.mutate_aircraft_record(uuid,uuid,text,uuid,text,text,text,text,text,bigint,text,text,uuid)',
    'execute'
  ),
  'Only the server role can execute the protected aircraft mutation RPC'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select user_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', email, crypt('Synthetic-password-007A!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (
  values
    ('71000000-0000-4000-8000-000000000001'::uuid, 'aircraft-admin-a@example.test'),
    ('71000000-0000-4000-8000-000000000002'::uuid, 'aircraft-student@example.test'),
    ('71000000-0000-4000-8000-000000000003'::uuid, 'aircraft-admin-b@example.test')
) as users(user_id, email);

insert into public.organizations (id, name, status) values
  ('72000000-0000-4000-8000-000000000001', 'Synthetic Aircraft School A', 'active'),
  ('72000000-0000-4000-8000-000000000002', 'Synthetic Aircraft School B', 'active');

insert into public.organization_memberships (
  id, organization_id, user_id, status, created_by, updated_by
) values
  ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'active', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001'),
  ('73000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'active', '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001'),
  ('73000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000003', 'active', '71000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003');

insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
select membership.organization_id, membership.id, role.id, membership.created_by
from public.organization_memberships membership
join public.roles role on role.code = case
  when membership.user_id = '71000000-0000-4000-8000-000000000002' then 'student_pilot'
  else 'admin' end
where membership.id::text like '73000000-%';

select is(
  public.resolve_aircraft_registry_context('71000000-0000-4000-8000-000000000001')->>'canManage',
  'true',
  'The server derives Organization Admin aircraft authority'
);
select is(
  public.resolve_aircraft_registry_context('71000000-0000-4000-8000-000000000002')->>'canRead',
  'false',
  'Student Pilot has no aircraft read authority'
);
select is(
  public.mutate_aircraft_record(
    '71000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000001',
    'create', null, 'RP-C100', 'rpc100', 'Synthetic Maker', 'Model A', null, null,
    repeat('0', 64), repeat('a', 64), '74000000-0000-4000-8000-000000000001'
  )->>'decision',
  'unauthorized',
  'A student cannot create an aircraft record through the RPC'
);
select is(
  public.lookup_aircraft_registry_idempotency(
    '71000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000001',
    'create', null, null, repeat('0', 64), repeat('a', 64)
  )->>'decision',
  'unauthorized',
  'A student idempotency lookup is denied without being misclassified as a conflict'
);

create temp table feat007_create as
select public.mutate_aircraft_record(
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'create', null, 'RP-C100', 'rpc100', 'Synthetic Maker', 'Model A', null, null,
  repeat('1', 64), repeat('a', 64), '74000000-0000-4000-8000-000000000002'
) as result;

select is((select result->>'decision' from feat007_create), 'created', 'An authorized versionless create succeeds');
select is((select result->'record'->>'registryState' from feat007_create), 'tracked', 'A new record starts Tracked');
select is((select result->'record'->>'version' from feat007_create), '1', 'A new record starts at version one');
select is(
  (select count(*)::integer from public.aircraft_registry_events where event_name = 'aircraft_record.created'),
  1,
  'Create commits one aircraft audit event'
);
select is(
  public.lookup_aircraft_registry_idempotency(
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'create', null, null, repeat('1', 64), repeat('a', 64)
  )->>'decision',
  'replay',
  'The pre-limit lookup finds an exact stored create replay'
);
select is(
  public.mutate_aircraft_record(
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'create', null, 'RP-C100', 'rpc100', 'Synthetic Maker', 'Model A', null, null,
    repeat('1', 64), repeat('a', 64), '74000000-0000-4000-8000-000000000003'
  )->>'replayed',
  'true',
  'An exact replay returns the prior result without a second change'
);
select is(
  (select count(*)::integer from public.aircraft_registry_events where event_name = 'aircraft_record.created'),
  1,
  'An exact replay creates no duplicate audit event'
);
select is(
  public.lookup_aircraft_registry_idempotency(
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'create', null, null, repeat('1', 64), repeat('b', 64)
  )->>'decision',
  'conflict',
  'Changed input cannot reuse a stored idempotency key'
);
select is(
  public.mutate_aircraft_record(
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'create', null, 'RP-C 100', 'rpc100', 'Another Maker', 'Model B', null, null,
    repeat('2', 64), repeat('b', 64), '74000000-0000-4000-8000-000000000004'
  )->>'decision',
  'duplicate_registration',
  'A normalized Tracked registration duplicate is rejected'
);

create temp table feat007_update as
select public.mutate_aircraft_record(
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'update', (select (result->'record'->>'id')::uuid from feat007_create),
  'RP-C100', 'rpc100', 'Synthetic Maker', 'Model B', null, 1,
  repeat('3', 64), repeat('c', 64), '74000000-0000-4000-8000-000000000005'
) as result;

select is((select result->>'decision' from feat007_update), 'updated', 'A versioned Tracked edit succeeds');
select is((select result->'record'->>'version' from feat007_update), '2', 'Edit advances the record version');
select is(
  public.mutate_aircraft_record(
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'update', (select (result->'record'->>'id')::uuid from feat007_create),
    'RP-C100', 'rpc100', 'Synthetic Maker', 'Stale Model', null, 1,
    repeat('4', 64), repeat('d', 64), '74000000-0000-4000-8000-000000000006'
  )->>'decision',
  'version_conflict',
  'A stale edit cannot overwrite the record'
);

create temp table feat007_archive as
select public.mutate_aircraft_record(
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'archive', (select (result->'record'->>'id')::uuid from feat007_create),
  null, null, null, null, 'no_longer_tracked', 2,
  repeat('5', 64), repeat('e', 64), '74000000-0000-4000-8000-000000000007'
) as result;

select is((select result->>'decision' from feat007_archive), 'archived', 'An approved reason archives a Tracked record');
create temp table feat007_replacement as
select public.mutate_aircraft_record(
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'create', null, 'RP-C 100', 'rpc100', 'Replacement Maker', 'Model C', null, null,
  repeat('7', 64), repeat('1', 64), '74000000-0000-4000-8000-000000000009'
) as result;

select is((select result->>'decision' from feat007_replacement), 'created', 'Archived history does not reserve a registration key');
select is(
  public.mutate_aircraft_record(
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'archive', (select (result->'record'->>'id')::uuid from feat007_replacement),
    null, null, null, null, 'invented_reason', 1,
    repeat('6', 64), repeat('f', 64), '74000000-0000-4000-8000-000000000008'
  )->>'decision',
  'validation_failed',
  'An unapproved archive reason is rejected'
);
select is(
  public.mutate_aircraft_record(
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'reactivate', (select (result->'record'->>'id')::uuid from feat007_create),
    null, null, null, null, 'tracking_resumed', 3,
    repeat('8', 64), repeat('2', 64), '74000000-0000-4000-8000-000000000010'
  )->>'decision',
  'duplicate_registration',
  'Reactivation fails while another Tracked record uses the key'
);
select is(
  public.get_aircraft_record(
    '71000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000002',
    (select (result->'record'->>'id')::uuid from feat007_replacement),
    '74000000-0000-4000-8000-000000000011'
  )->>'decision',
  'not_found',
  'A cross-school direct ID does not disclose the record'
);
select is(
  public.list_aircraft_records(
    '71000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000001',
    null, true, 1, 25, '74000000-0000-4000-8000-000000000020'
  )->>'decision',
  'unauthorized',
  'A cross-school forged-organization list is denied'
);
select is(
  public.list_aircraft_records(
    '71000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000001',
    'RP-C100', true, 1, 25, '74000000-0000-4000-8000-000000000021'
  )->>'decision',
  'unauthorized',
  'A cross-school forged-organization search is denied'
);
select is(
  public.mutate_aircraft_record(
    '71000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000001',
    'create', null, 'RP-X100', 'rpx100', 'Synthetic Maker', 'Model X', null, null,
    repeat('d', 64), repeat('e', 64), '74000000-0000-4000-8000-000000000022'
  )->>'decision',
  'unauthorized',
  'A cross-school forged-organization mutation is denied'
);
select is(
  public.lookup_aircraft_registry_idempotency(
    '71000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000001',
    'create', null, null, repeat('1', 64), repeat('a', 64)
  )->>'decision',
  'unauthorized',
  'A cross-school forged-organization idempotency lookup is denied'
);
select is(
  jsonb_array_length(
    public.list_aircraft_records(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '%_', true, 1, 25, '74000000-0000-4000-8000-000000000012'
    )->'records'
  ),
  0,
  'Search wildcard characters are treated literally'
);
select is(
  public.list_aircraft_records(
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    null, false, 101, 25, '74000000-0000-4000-8000-000000000013'
  )->>'decision',
  'validation_failed',
  'Search cannot exceed the bounded page window'
);
select is(
  public.list_aircraft_records(
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    null, false, 1, 25, '74000000-0000-4000-8000-000000000014'
  )->>'decision',
  'listed',
  'An authorized bounded registry list succeeds'
);
select is(
  (select count(*)::integer from public.aircraft_registry_events where event_name = 'aircraft_registry.listed'),
  2,
  'Successful list and literal search requests each create an audit event'
);
select is(
  (
    with listed as (
      select public.list_aircraft_records(
        '71000000-0000-4000-8000-000000000001',
        '72000000-0000-4000-8000-000000000001',
        null, true, 1, 25, '74000000-0000-4000-8000-00000000001f'
      ) as result
    )
    select string_agg(item.value->>'id', ',' order by item.ordinality)
    from listed, jsonb_array_elements(listed.result->'records') with ordinality as item(value, ordinality)
  ),
  (
    select string_agg(record.id::text, ',' order by record.registration_key, record.id)
    from public.aircraft_records record
    where record.organization_id = '72000000-0000-4000-8000-000000000001'::uuid
  ),
  'The registry JSON array preserves registration-key and record-ID ordering'
);

select is(
  public.consume_aircraft_registry_rate_limit(
    repeat('9', 64), 'general', '74000000-0000-4000-8000-000000000015'
  )->>'allowed',
  'true',
  'The general limiter starts with an available token'
);
select is(
  (select tokens::integer from public.aircraft_registry_rate_limit_state
   where limiter_key_hash = repeat('9', 64) and bucket = 'general'),
  59,
  'The general limiter charges exactly one token'
);
select is(
  public.consume_aircraft_registry_rate_limit(
    repeat('a', 64), 'lifecycle', '74000000-0000-4000-8000-000000000016'
  )->>'policyVersion',
  'aircraft-registry-v1',
  'The limiter returns the exact reviewed policy version'
);
select is(
  public.consume_aircraft_registry_rate_limit(
    repeat('c', 64), 'read', '74000000-0000-4000-8000-000000000018'
  )->>'allowed',
  'true',
  'The read limiter starts with an available token'
);
select is(
  (select tokens::integer from public.aircraft_registry_rate_limit_state
   where limiter_key_hash = repeat('c', 64) and bucket = 'read'),
  29,
  'The read limiter starts at capacity 30 and charges one token'
);
select is(
  public.consume_aircraft_registry_rate_limit(
    repeat('d', 64), 'mutation', '74000000-0000-4000-8000-000000000019'
  )->>'allowed',
  'true',
  'The shared create/update limiter starts with an available token'
);
select is(
  (select tokens::integer from public.aircraft_registry_rate_limit_state
   where limiter_key_hash = repeat('d', 64) and bucket = 'mutation'),
  5,
  'The mutation limiter starts at capacity six and charges one token'
);

update public.aircraft_registry_rate_limit_state
set tokens = 0, updated_at = clock_timestamp()
where limiter_key_hash = repeat('a', 64) and bucket = 'lifecycle';
select is(
  public.consume_aircraft_registry_rate_limit(
    repeat('a', 64), 'lifecycle', '74000000-0000-4000-8000-000000000020'
  )->>'allowed',
  'false',
  'An empty lifecycle bucket denies without borrowing'
);
select ok(
  (select tokens >= 0 from public.aircraft_registry_rate_limit_state
   where limiter_key_hash = repeat('a', 64) and bucket = 'lifecycle'),
  'A denied lifecycle request never creates a negative balance'
);
select ok(
  exists (
    select 1 from public.aircraft_registry_rate_limit_events
    where correlation_id = '74000000-0000-4000-8000-000000000020'
      and outcome = 'rate_limited'
      and retry_after_seconds between 1 and 3600
  ),
  'Lifecycle denial records a bounded retry interval'
);

update public.aircraft_registry_rate_limit_state
set tokens = 0, updated_at = clock_timestamp() - interval '31 seconds'
where limiter_key_hash = repeat('a', 64) and bucket = 'lifecycle';
select is(
  public.consume_aircraft_registry_rate_limit(
    repeat('a', 64), 'lifecycle', '74000000-0000-4000-8000-000000000021'
  )->>'allowed',
  'true',
  'The lifecycle bucket refills one token per 30 seconds'
);
select ok(
  (select tokens >= 0 and tokens < 1 from public.aircraft_registry_rate_limit_state
   where limiter_key_hash = repeat('a', 64) and bucket = 'lifecycle'),
  'The refilled lifecycle request charges exactly one available token'
);

create function public.feat007_reject_audit()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.event_name = 'aircraft_record.created' then
    raise exception using errcode = 'P0001', message = 'synthetic audit failure';
  end if;
  return new;
end;
$$;

create trigger feat007_reject_audit
before insert on public.aircraft_registry_events
for each row execute function public.feat007_reject_audit();

select throws_ok(
  $$
    select public.mutate_aircraft_record(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      'create', null, 'RP-C999', 'rpc999', 'Audit Maker', 'Audit Model', null, null,
      repeat('b', 64), repeat('3', 64), '74000000-0000-4000-8000-000000000017'
    )
  $$,
  'P7001',
  'Aircraft registry audit write failed.',
  'Audit failure aborts an aircraft mutation'
);
select is(
  (select count(*)::integer from public.aircraft_records where registration_key = 'rpc999'),
  0,
  'Audit failure rolls back the aircraft record'
);
select is(
  (select count(*)::integer from public.aircraft_registry_idempotency where idempotency_key_hash = repeat('b', 64)),
  0,
  'Audit failure also leaves no idempotency outcome'
);

drop trigger feat007_reject_audit on public.aircraft_registry_events;
drop function public.feat007_reject_audit();

create function public.feat007_reject_read_audit()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.event_name in ('aircraft_registry.listed', 'aircraft_record.viewed') then
    raise exception using errcode = 'P0001', message = 'synthetic read audit failure';
  end if;
  return new;
end;
$$;

create trigger feat007_reject_read_audit
before insert on public.aircraft_registry_events
for each row execute function public.feat007_reject_read_audit();

select throws_ok(
  $$
    select public.list_aircraft_records(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      null, false, 1, 25, '74000000-0000-4000-8000-000000000022'
    )
  $$,
  'P7001',
  'Aircraft registry audit write failed.',
  'List audit failure returns no registry result'
);
select throws_ok(
  format(
    'select public.get_aircraft_record(%L::uuid, %L::uuid, %L::uuid, %L::uuid)',
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    (select result->'record'->>'id' from feat007_replacement),
    '74000000-0000-4000-8000-000000000023'
  ),
  'P7001',
  'Aircraft registry audit write failed.',
  'Detail audit failure returns no aircraft result'
);

drop trigger feat007_reject_read_audit on public.aircraft_registry_events;
drop function public.feat007_reject_read_audit();

select * from finish();
rollback;
