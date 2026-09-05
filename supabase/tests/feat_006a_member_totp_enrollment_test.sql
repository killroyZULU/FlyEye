begin;

set constraints organizations_single_school_deployment_key deferred;
set constraints organization_memberships_single_school_user_key deferred;

select plan(43);

select has_table('public', 'member_mfa_enrollment_operations', 'FEAT-006A operation table exists');
select has_table('public', 'member_mfa_readiness', 'FEAT-006A readiness table exists');
select has_table('public', 'member_mfa_rate_limit_state', 'FEAT-006A limiter state exists');
select has_table('public', 'member_mfa_rate_limit_events', 'FEAT-006A limiter evidence exists');
select is(
  (select count(*)::integer from pg_class where oid in (
    'public.member_mfa_enrollment_operations'::regclass,
    'public.member_mfa_readiness'::regclass,
    'public.member_mfa_rate_limit_state'::regclass,
    'public.member_mfa_rate_limit_events'::regclass
  ) and relrowsecurity),
  4,
  'RLS is enabled on every FEAT-006A table'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public'
    and tablename like 'member_mfa_%'),
  0,
  'FEAT-006A tables are deny-by-default without browser policies'
);
select is(
  (select count(*)::integer from information_schema.role_table_grants
    where grantee in ('PUBLIC', 'anon', 'authenticated') and table_schema = 'public'
      and table_name like 'member_mfa_%'),
  0,
  'Browser roles receive no FEAT-006A table privileges'
);

select ok(not has_function_privilege('authenticated', 'public.consume_member_mfa_rate_limit(text,text,uuid)', 'execute'), 'Browser cannot execute member MFA limiter');
select ok(not has_function_privilege('authenticated', 'public.get_member_mfa_status(uuid,text,uuid)', 'execute'), 'Browser cannot execute member MFA status RPC');
select ok(not has_function_privilege('authenticated', 'public.start_member_mfa_enrollment(uuid,text,text,uuid)', 'execute'), 'Browser cannot execute member MFA start RPC');
select ok(not has_function_privilege('authenticated', 'public.bind_member_mfa_factor(uuid,uuid,bigint,text,text,uuid)', 'execute'), 'Browser cannot execute factor binding RPC');
select ok(not has_function_privilege('authenticated', 'public.complete_member_mfa_enrollment(uuid,uuid,bigint,text,text[],uuid,bigint,text,text,uuid)', 'execute'), 'Browser cannot execute member MFA completion RPC');
select ok(not has_function_privilege('authenticated', 'public.cancel_member_mfa_enrollment(uuid,uuid,bigint,text,text,text,uuid)', 'execute'), 'Browser cannot execute member MFA cancellation RPC');
select ok(not has_function_privilege('authenticated', 'public.write_member_mfa_event(uuid,text,text,uuid,text,uuid,uuid,uuid,text,jsonb)', 'execute'), 'Browser cannot execute member MFA audit writer');

select ok(has_function_privilege('service_role', 'public.consume_member_mfa_rate_limit(text,text,uuid)', 'execute'), 'Service role can execute member MFA limiter');
select ok(has_function_privilege('service_role', 'public.get_member_mfa_status(uuid,text,uuid)', 'execute'), 'Service role can execute member MFA status RPC');
select ok(has_function_privilege('service_role', 'public.start_member_mfa_enrollment(uuid,text,text,uuid)', 'execute'), 'Service role can execute member MFA start RPC');
select ok(has_function_privilege('service_role', 'public.bind_member_mfa_factor(uuid,uuid,bigint,text,text,uuid)', 'execute'), 'Service role can execute factor binding RPC');
select ok(has_function_privilege('service_role', 'public.complete_member_mfa_enrollment(uuid,uuid,bigint,text,text[],uuid,bigint,text,text,uuid)', 'execute'), 'Service role can execute member MFA completion RPC');
select ok(has_function_privilege('service_role', 'public.cancel_member_mfa_enrollment(uuid,uuid,bigint,text,text,text,uuid)', 'execute'), 'Service role can execute member MFA cancellation RPC');
select ok(has_function_privilege('service_role', 'public.write_member_mfa_event(uuid,text,text,uuid,text,uuid,uuid,uuid,text,jsonb)', 'execute'), 'Service role can execute member MFA audit writer');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'feat006a-member@example.test',
  crypt('synthetic-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.organizations (id, name, status)
values ('92000000-0000-4000-8000-000000000001', 'Synthetic MFA School', 'active');

insert into public.organization_memberships (id, organization_id, user_id, status)
values (
  '93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'active'
);

select is(
  public.get_member_mfa_status(
    '91000000-0000-4000-8000-000000000001', null,
    '94000000-0000-4000-8000-000000000001'
  )->>'decision',
  'available',
  'An active sole-school member has a server-derived MFA context'
);
insert into public.organizations (id, name, status)
values ('92000000-0000-4000-8000-000000000002', 'Synthetic Foreign School', 'active');
insert into public.organization_memberships (id, organization_id, user_id, status)
values (
  '93000000-0000-4000-8000-000000000004',
  '92000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000001',
  'active'
);
select is(
  public.get_member_mfa_status(
    '91000000-0000-4000-8000-000000000001', null,
    '94000000-0000-4000-8000-000000000012'
  )->>'decision',
  'conflict',
  'Ambiguous cross-school membership state discloses no selected organization'
);
delete from public.organization_member_profiles
where membership_id = '93000000-0000-4000-8000-000000000004';
delete from public.organization_memberships where id = '93000000-0000-4000-8000-000000000004';
delete from public.aircraft_document_categories
where organization_id = '92000000-0000-4000-8000-000000000002';
delete from public.organizations where id = '92000000-0000-4000-8000-000000000002';

create temp table feat006a_start_result as
select public.start_member_mfa_enrollment(
  '91000000-0000-4000-8000-000000000001',
  repeat('a', 64), repeat('b', 64),
  '94000000-0000-4000-8000-000000000002'
) as result;

select is((select result->>'decision' from feat006a_start_result), 'ready', 'Bound confirmation operation starts');
select is(
  (select count(*)::integer from public.member_mfa_enrollment_operations
    where membership_id = '93000000-0000-4000-8000-000000000001' and status = 'bound'),
  1,
  'Start creates one bounded server operation'
);
select is(
  (select count(*)::integer from public.authentication_events
    where event_name = 'member_mfa.enrollment_started'
      and actor_user_id = '91000000-0000-4000-8000-000000000001'),
  1,
  'Start records one minimized audit event'
);
select is(
  public.start_member_mfa_enrollment(
    '91000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64),
    '94000000-0000-4000-8000-000000000006'
  )->>'replayed',
  'true',
  'An active start idempotency key replays the same operation'
);
select is(
  public.get_member_mfa_status(
    '91000000-0000-4000-8000-000000000001', repeat('a', 64),
    '94000000-0000-4000-8000-000000000004'
  )->>'operationState',
  'bound',
  'Status exposes an interrupted operation only when the current factor hash matches'
);
select is(
  public.get_member_mfa_status(
    '91000000-0000-4000-8000-000000000001', repeat('d', 64),
    '94000000-0000-4000-8000-000000000005'
  )->>'decision',
  'conflict',
  'Status rejects cleanup when the current factor hash does not match the operation'
);

insert into public.organizations (id, name, status)
values ('92000000-0000-4000-8000-000000000003', 'Synthetic Completion Conflict', 'active');
insert into public.organization_memberships (id, organization_id, user_id, status)
values (
  '93000000-0000-4000-8000-000000000005',
  '92000000-0000-4000-8000-000000000003',
  '91000000-0000-4000-8000-000000000001',
  'active'
);
select is(
  public.complete_member_mfa_enrollment(
    '91000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',
    floor(extract(epoch from transaction_timestamp()))::bigint,
    'aal2', array['password', 'totp']::text[],
    ((select result->>'operationId' from feat006a_start_result))::uuid,
    1, repeat('a', 64), repeat('9', 64),
    '94000000-0000-4000-8000-000000000013'
  )->>'decision',
  'conflict',
  'Completion rejects membership ambiguity introduced after start'
);
select is(
  (select count(*)::integer from public.member_mfa_readiness
   where membership_id = '93000000-0000-4000-8000-000000000001'),
  0,
  'Ambiguous completion creates no readiness authority'
);
delete from public.organization_member_profiles
where membership_id = '93000000-0000-4000-8000-000000000005';
delete from public.organization_memberships where id = '93000000-0000-4000-8000-000000000005';
delete from public.aircraft_document_categories
where organization_id = '92000000-0000-4000-8000-000000000003';
delete from public.organizations where id = '92000000-0000-4000-8000-000000000003';

create temp table feat006a_complete_result as
select public.complete_member_mfa_enrollment(
  '91000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  floor(extract(epoch from transaction_timestamp()))::bigint,
  'aal2', array['password', 'totp']::text[],
  ((select result->>'operationId' from feat006a_start_result))::uuid,
  1, repeat('a', 64), repeat('c', 64),
  '94000000-0000-4000-8000-000000000003'
) as result;

select is((select result->>'decision' from feat006a_complete_result), 'completed', 'Verified evidence completes readiness');
select is(
  (select count(*)::integer from public.member_mfa_readiness
    where membership_id = '93000000-0000-4000-8000-000000000001'
      and factor_reference_hash = repeat('a', 64)),
  1,
  'Completion stores only the matching factor-reference hash'
);
select is(
  (select count(*)::integer from public.member_mfa_enrollment_operations
    where membership_id = '93000000-0000-4000-8000-000000000001'
      and status = 'completed' and version = 2),
  1,
  'Completion advances the same bounded operation'
);
select is(
  (select count(*)::integer from public.authentication_events
    where event_name = 'member_mfa.enrollment_completed'
      and actor_user_id = '91000000-0000-4000-8000-000000000001'),
  1,
  'Readiness completion commits with its audit event'
);
select is(
  public.start_member_mfa_enrollment(
    '91000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64),
    '94000000-0000-4000-8000-000000000007'
  )->>'decision',
  'conflict',
  'A completed operation is not replayed as a usable start'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'feat006a-cancel@example.test',
  crypt('synthetic-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.organization_memberships (id, organization_id, user_id, status)
values (
  '93000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  'active'
);
create temp table feat006a_unbound_start as
select public.start_member_mfa_enrollment(
  '91000000-0000-4000-8000-000000000002', null, repeat('e', 64),
  '94000000-0000-4000-8000-000000000008'
) as result;
insert into public.organizations (id, name, status)
values ('92000000-0000-4000-8000-000000000004', 'Synthetic Binding Conflict', 'active');
insert into public.organization_memberships (id, organization_id, user_id, status)
values (
  '93000000-0000-4000-8000-000000000006',
  '92000000-0000-4000-8000-000000000004',
  '91000000-0000-4000-8000-000000000002',
  'active'
);
select is(
  public.bind_member_mfa_factor(
    '91000000-0000-4000-8000-000000000002',
    ((select result->>'operationId' from feat006a_unbound_start))::uuid,
    1, repeat('7', 64), repeat('8', 64),
    '94000000-0000-4000-8000-000000000014'
  )->>'decision',
  'conflict',
  'Factor binding rejects membership ambiguity introduced after start'
);
select is(
  (select status || ':' || version::text from public.member_mfa_enrollment_operations
   where id = ((select result->>'operationId' from feat006a_unbound_start))::uuid),
  'started:1',
  'Rejected ambiguous binding leaves the operation unchanged'
);
delete from public.organization_member_profiles
where membership_id = '93000000-0000-4000-8000-000000000006';
delete from public.organization_memberships where id = '93000000-0000-4000-8000-000000000006';
delete from public.aircraft_document_categories
where organization_id = '92000000-0000-4000-8000-000000000004';
delete from public.organizations where id = '92000000-0000-4000-8000-000000000004';
create temp table feat006a_cancel_result as
select public.cancel_member_mfa_enrollment(
  '91000000-0000-4000-8000-000000000002',
  ((select result->>'operationId' from feat006a_unbound_start))::uuid,
  1, null, 'not_required', repeat('f', 64),
  '94000000-0000-4000-8000-000000000009'
) as result;
select is(
  (select result->>'decision' from feat006a_cancel_result),
  'cancelled',
  'An operation with no provider factor can be cancelled safely'
);
select is(
  (select count(*)::integer from public.authentication_events
   where actor_user_id = '91000000-0000-4000-8000-000000000002'
     and event_name = 'member_mfa.enrollment_cancelled'),
  1,
  'Unbound cancellation records one minimized audit event'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91000000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'feat006a-audit@example.test',
  crypt('synthetic-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.organization_memberships (id, organization_id, user_id, status)
values (
  '93000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000003',
  'active'
);
create temp table feat006a_audit_start as
select public.start_member_mfa_enrollment(
  '91000000-0000-4000-8000-000000000003', repeat('1', 64), repeat('2', 64),
  '94000000-0000-4000-8000-000000000010'
) as result;
create function pg_temp.reject_feat006a_completion_audit()
returns trigger language plpgsql as $$
begin
  raise exception 'synthetic FEAT-006A audit failure';
end;
$$;
create trigger reject_feat006a_completion_audit
before insert on public.authentication_events
for each row when (new.event_name = 'member_mfa.enrollment_completed')
execute function pg_temp.reject_feat006a_completion_audit();
select throws_ok(
  format(
    $sql$select public.complete_member_mfa_enrollment(
      '91000000-0000-4000-8000-000000000003',
      '95000000-0000-4000-8000-000000000003',
      floor(extract(epoch from transaction_timestamp()))::bigint,
      'aal2', array['password', 'totp']::text[], %L::uuid,
      1, repeat('1', 64), repeat('3', 64),
      '94000000-0000-4000-8000-000000000011'
    )$sql$,
    (select result->>'operationId' from feat006a_audit_start)
  ),
  'P0001', 'synthetic FEAT-006A audit failure',
  'Mandatory completion audit failure aborts readiness creation'
);
select is(
  (select count(*)::integer from public.member_mfa_readiness
   where membership_id = '93000000-0000-4000-8000-000000000003'),
  0,
  'Audit failure leaves no readiness authority'
);
select is(
  (select status || ':' || version::text from public.member_mfa_enrollment_operations
   where membership_id = '93000000-0000-4000-8000-000000000003'),
  'bound:1',
  'Audit failure rolls the enrollment operation back to its retryable state'
);
drop trigger reject_feat006a_completion_audit on public.authentication_events;

select * from finish();
rollback;
