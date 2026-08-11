begin;

set constraints organizations_single_school_deployment_key deferred;
set constraints organization_memberships_single_school_user_key deferred;

select plan(45);

select has_table('public', 'organizations', 'organizations table exists');
select has_table('public', 'organization_memberships', 'memberships table exists');
select has_table('public', 'roles', 'roles table exists');
select has_table('public', 'permissions', 'permissions table exists');
select has_table('public', 'role_permissions', 'role permissions table exists');
select has_table('public', 'membership_roles', 'membership roles table exists');
select has_table('public', 'authentication_events', 'authentication events table exists');

select is(
  (
    select count(*)::integer
    from pg_class
    where oid in (
      'public.organizations'::regclass,
      'public.organization_memberships'::regclass,
      'public.roles'::regclass,
      'public.permissions'::regclass,
      'public.role_permissions'::regclass,
      'public.membership_roles'::regclass,
      'public.authentication_events'::regclass
    ) and relrowsecurity
  ),
  7,
  'RLS is enabled on every FEAT-001 table'
);
select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'organizations', 'organization_memberships', 'roles', 'permissions',
        'role_permissions', 'membership_roles', 'authentication_events'
      )
  ),
  0,
  'anon and authenticated have no FEAT-001 table action grants'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'organizations', 'organization_memberships', 'roles', 'permissions',
        'role_permissions', 'membership_roles', 'authentication_events'
      )
  ),
  0,
  'FEAT-001 tables remain deny-by-default with no browser policies'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_my_access_context()', 'execute'),
  'authenticated cannot execute the deprecated direct bootstrap RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_auth_access_context(uuid,text,uuid)',
    'execute'
  ),
  'authenticated cannot execute the server-only resolver RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_authentication_access_decision(uuid,uuid,text,text,uuid,uuid,uuid[],text,jsonb)',
    'execute'
  ),
  'authenticated cannot execute the server-only audit RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.resolve_auth_access_context(uuid,text,uuid)',
    'execute'
  ),
  'service role can execute the resolver RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_authentication_access_decision(uuid,uuid,text,text,uuid,uuid,uuid[],text,jsonb)',
    'execute'
  ),
  'service role can execute the audit RPC'
);
select has_check(
  'public',
  'authentication_events',
  'event name and outcome combinations are constrained'
);
select has_column(
  'public',
  'authentication_events',
  'actor_subject_id',
  'audit events preserve a pseudonymous actor subject'
);
select has_column(
  'public',
  'authentication_events',
  'organization_ids',
  'audit events preserve multi-organization context'
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
  metadata,
  now(),
  now()
from (
  values
    ('10000000-0000-4000-8000-000000000001'::uuid, 'student-a@example.test', '{"role":"admin","organization_id":"attacker"}'::jsonb),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'instructor-a@example.test', '{}'::jsonb),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'admin-b@example.test', '{}'::jsonb),
    ('10000000-0000-4000-8000-000000000004'::uuid, 'suspended-b@example.test', '{}'::jsonb),
    ('10000000-0000-4000-8000-000000000005'::uuid, 'revoked-a@example.test', '{}'::jsonb),
    ('10000000-0000-4000-8000-000000000006'::uuid, 'mixed@example.test', '{}'::jsonb),
    ('10000000-0000-4000-8000-000000000007'::uuid, 'removed-actor@example.test', '{}'::jsonb)
) as users(user_id, email, metadata);

insert into public.organizations (id, name)
values
  ('20000000-0000-4000-8000-000000000001', 'Synthetic School A'),
  ('20000000-0000-4000-8000-000000000002', 'Synthetic School B');

insert into public.organization_memberships (id, organization_id, user_id, status)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'active'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'active'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'active'),
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004', 'suspended'),
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'revoked'),
  ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006', 'active'),
  ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006', 'active');

insert into public.membership_roles (organization_id, membership_id, role_id)
select membership.organization_id, membership.id, role.id
from public.organization_memberships membership
join public.roles role on role.code = case membership.id
  when '30000000-0000-4000-8000-000000000002'::uuid then 'instructor_pilot'
  when '30000000-0000-4000-8000-000000000003'::uuid then 'admin'
  when '30000000-0000-4000-8000-000000000007'::uuid then 'admin'
  else 'student_pilot'
end;

set local role service_role;

select is(
  public.resolve_auth_access_context('10000000-0000-4000-8000-000000000001', 'aal1', null) ->> 'decision',
  'granted',
  'Student AAL1 is granted'
);
select is(
  public.resolve_auth_access_context('10000000-0000-4000-8000-000000000001', 'aal1', null)
    -> 'memberships' -> 0 ->> 'accessStatus',
  'granted',
  'Student membership is explicitly granted at AAL1'
);
select is(
  public.resolve_auth_access_context('10000000-0000-4000-8000-000000000002', 'aal1', null) ->> 'decision',
  'mfa_required',
  'Instructor AAL1 fails closed for workspace access'
);
select is(
  public.resolve_auth_access_context('10000000-0000-4000-8000-000000000002', 'aal1', null)
    -> 'memberships' -> 0 ->> 'requiredAssuranceLevel',
  'aal2',
  'Instructor membership requires AAL2'
);
select is(
  public.resolve_auth_access_context('10000000-0000-4000-8000-000000000002', 'aal2', null) ->> 'decision',
  'granted',
  'Instructor AAL2 is granted'
);
select is(
  public.resolve_auth_access_context('10000000-0000-4000-8000-000000000003', 'aal1', null) ->> 'decision',
  'mfa_required',
  'Admin AAL1 fails closed for workspace access'
);
select is(
  public.resolve_auth_access_context('10000000-0000-4000-8000-000000000003', 'aal2', null) ->> 'decision',
  'granted',
  'Admin AAL2 is granted'
);
select is(
  jsonb_array_length(public.resolve_auth_access_context('10000000-0000-4000-8000-000000000004', 'aal2', null) -> 'memberships'),
  0,
  'Suspended membership is denied'
);
select is(
  jsonb_array_length(public.resolve_auth_access_context('10000000-0000-4000-8000-000000000005', 'aal2', null) -> 'memberships'),
  0,
  'Revoked membership is denied'
);
select is(
  public.resolve_auth_access_context('10000000-0000-4000-8000-000000000001', 'aal1', null)
    -> 'memberships' -> 0 ->> 'organizationId',
  '20000000-0000-4000-8000-000000000001',
  'School A user receives only School A'
);
select is(
  public.resolve_auth_access_context(
    '10000000-0000-4000-8000-000000000001',
    'aal1',
    '20000000-0000-4000-8000-000000000002'
  ) ->> 'decision',
  'denied',
  'Cross-tenant direct organization selection is denied'
);
select is(
  jsonb_array_length(public.resolve_auth_access_context('10000000-0000-4000-8000-000000000006', 'aal1', null) -> 'memberships'),
  2,
  'Mixed-role user receives two deterministic organization choices'
);
select is(
  public.resolve_auth_access_context('10000000-0000-4000-8000-000000000006', 'aal1', null)
    -> 'memberships' -> 1 ->> 'accessStatus',
  'mfa_required',
  'Mixed-role AAL1 does not grant the privileged organization'
);
select is(
  public.resolve_auth_access_context(
    '10000000-0000-4000-8000-000000000006',
    'aal1',
    '20000000-0000-4000-8000-000000000002'
  ) ->> 'decision',
  'mfa_required',
  'Selected privileged organization still requires MFA at AAL1'
);
select is(
  public.resolve_auth_access_context(
    '10000000-0000-4000-8000-000000000006',
    'aal2',
    '20000000-0000-4000-8000-000000000002'
  ) ->> 'decision',
  'granted',
  'Selected privileged organization is granted after AAL2 revalidation'
);
select is(
  public.resolve_auth_access_context('10000000-0000-4000-8000-000000000001', 'aal1', null)
    -> 'memberships' -> 0 ->> 'role',
  'student_pilot',
  'User-editable admin metadata cannot change the database role'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  'select * from public.organizations',
  '42501',
  null,
  'Authenticated browser cannot list FEAT-001 tenant tables'
);
select throws_ok(
  $$select * from public.organizations where id = '20000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'Authenticated browser cannot directly query another tenant by ID'
);
select throws_ok(
  $$select public.resolve_auth_access_context('10000000-0000-4000-8000-000000000001', 'aal2', null)$$,
  '42501',
  null,
  'Authenticated browser cannot bypass Edge authorization through the resolver RPC'
);
select throws_ok(
  $$select public.record_authentication_access_decision(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'authentication.access_context_loaded', 'success',
    '80000000-0000-4000-8000-000000000099', null, '{}',
    'access_context_granted', '{}'
  )$$,
  '42501',
  null,
  'Authenticated browser cannot forge authentication audit evidence'
);

reset role;
set local role service_role;

select lives_ok(
  $$select public.record_authentication_access_decision(
    '10000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000006',
    'authentication.access_context_loaded', 'success',
    '80000000-0000-4000-8000-000000000001', null,
    array['20000000-0000-4000-8000-000000000001'::uuid],
    'access_context_granted', '{"membershipCount":1}'
  )$$,
  'Server records one single-school access decision'
);
reset role;
select is(
  (select count(*)::integer from public.authentication_events where correlation_id = '80000000-0000-4000-8000-000000000001'),
  1,
  'Exactly one audit event exists for the access decision'
);
select is(
  (
    select event_name || ':' || outcome
    from public.authentication_events
    where correlation_id = '80000000-0000-4000-8000-000000000001'
  ),
  'authentication.access_context_loaded:success',
  'Successful access has the correct event and outcome combination'
);
select is(
  (
    select cardinality(organization_ids)
    from public.authentication_events
    where correlation_id = '80000000-0000-4000-8000-000000000001'
  ),
  1,
  'Single-school audit evidence preserves the resolved organization ID'
);
select throws_ok(
  $$insert into public.authentication_events (
    actor_subject_id, event_name, outcome, correlation_id, reason_code
  ) values (
    '10000000-0000-4000-8000-000000000001',
    'authentication.access_context_loaded', 'denied',
    '80000000-0000-4000-8000-000000000003', 'permission_denied'
  )$$,
  '23514',
  null,
  'Invalid event-name and outcome combinations are rejected'
);

set local role service_role;
select public.record_authentication_access_decision(
  '10000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000007',
  'authentication.access_denied', 'denied',
  '80000000-0000-4000-8000-000000000002', null, '{}',
  'no_active_membership', '{}'
);
reset role;
delete from auth.users where id = '10000000-0000-4000-8000-000000000007';
select is(
  (
    select actor_subject_id::text
    from public.authentication_events
    where correlation_id = '80000000-0000-4000-8000-000000000002'
  ),
  '10000000-0000-4000-8000-000000000007',
  'Pseudonymous actor attribution survives Auth user removal'
);
select is(
  (
    select actor_user_id
    from public.authentication_events
    where correlation_id = '80000000-0000-4000-8000-000000000002'
  ),
  null,
  'Deleted Auth user foreign key is safely nulled without erasing attribution'
);

select * from finish();
rollback;
