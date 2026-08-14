begin;

set constraints organizations_single_school_deployment_key deferred;
set constraints organization_memberships_single_school_user_key deferred;

select plan(40);

select is(
  public.member_role_reason_options(),
  '[{"code":"responsibility_changed","label":"Responsibility changed"},{"code":"assignment_corrected","label":"Assignment corrected"}]'::jsonb,
  'Role reasons share one server-controlled mapping'
);
select is(
  (select count(*)::integer from public.roles
   where is_active and is_membership_assignable and workspace_permission_code is not null),
  3,
  'The three approved roles are active assignable permission bundles'
);
select is(
  (select required_assurance_level from public.roles where code = 'admin'),
  'aal2',
  'Organization Admin requires AAL2'
);
select is(
  (select required_assurance_level from public.roles where code = 'instructor_pilot'),
  'aal2',
  'Instructor Pilot requires AAL2'
);
select is(
  (select required_assurance_level from public.roles where code = 'student_pilot'),
  'aal1',
  'Student Pilot retains the approved AAL1 portal boundary'
);
select ok(
  exists (
    select 1 from public.roles role
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.code = 'admin' and permission.code = 'membership.role.assign'
  ),
  'Organization Admin receives the role-assignment permission'
);
select ok(
  not exists (
    select 1 from public.roles role
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.code <> 'admin' and permission.code = 'membership.role.assign'
  ),
  'No other current role receives role-assignment authority'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_member_role_assignment_context(uuid,uuid,uuid,text,bigint,uuid)',
    'execute'
  ),
  'Browser callers cannot resolve assignment authority directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.resolve_member_role_assignment_context(uuid,uuid,uuid,text,bigint,uuid)',
    'execute'
  ),
  'Service role can resolve assignment authority'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.change_organization_member_role(uuid,uuid,uuid,text,text,bigint,text,text,uuid)',
    'execute'
  ),
  'Browser callers cannot execute role changes directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.change_organization_member_role(uuid,uuid,uuid,text,text,bigint,text,text,uuid)',
    'execute'
  ),
  'Service role can execute protected role changes'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select user_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', email, crypt('Synthetic-password-006B!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (
  values
    ('b1000000-0000-4000-8000-000000000001'::uuid, 'role-admin@example.test'),
    ('b1000000-0000-4000-8000-000000000002'::uuid, 'role-target@example.test'),
    ('b1000000-0000-4000-8000-000000000003'::uuid, 'role-admin-two@example.test'),
    ('b1000000-0000-4000-8000-000000000004'::uuid, 'role-foreign@example.test')
) as users(user_id, email);

insert into public.organizations (id, name, status) values
  ('b2000000-0000-4000-8000-000000000001', 'Synthetic Role School A', 'active'),
  ('b2000000-0000-4000-8000-000000000002', 'Synthetic Role School B', 'active');

insert into public.organization_memberships (
  id, organization_id, user_id, status, created_by, updated_by
) values
  ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'active', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'active', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b3000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', 'active', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b3000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000004', 'active', 'b1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000004');

insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
select membership.organization_id, membership.id, role.id, membership.created_by
from public.organization_memberships membership
join public.roles role on role.code = case
  when membership.id in (
    'b3000000-0000-4000-8000-000000000001'::uuid,
    'b3000000-0000-4000-8000-000000000003'::uuid,
    'b3000000-0000-4000-8000-000000000004'::uuid
  ) then 'admin' else 'student_pilot' end
where membership.id::text like 'b3000000-%';

select is(
  public.resolve_member_role_assignment_context(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'instructor_pilot', 1,
    'b4000000-0000-4000-8000-000000000001'
  )->>'decision',
  'authorized',
  'An authorized same-school admin can resolve an active target assignment'
);
select is(
  public.resolve_member_role_assignment_context(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'instructor_pilot', 1,
    'b4000000-0000-4000-8000-000000000002'
  )->>'requiresMfa',
  'true',
  'The server derives privileged target MFA from role metadata'
);
select is(
  public.resolve_member_role_assignment_context(
    'b1000000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000003',
    'student_pilot', 1,
    'b4000000-0000-4000-8000-000000000003'
  )->>'decision',
  'not_found',
  'A student cannot resolve role-assignment authority'
);
select is(
  public.resolve_member_role_assignment_context(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000004',
    'student_pilot', 1,
    'b4000000-0000-4000-8000-000000000004'
  )->>'decision',
  'not_found',
  'A cross-school target is not disclosed'
);
select is(
  public.resolve_member_role_assignment_context(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    'student_pilot', 1,
    'b4000000-0000-4000-8000-000000000005'
  )->>'decision',
  'self_action',
  'Self-assignment is denied'
);
select is(
  public.resolve_member_role_assignment_context(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'instructor_pilot', 9,
    'b4000000-0000-4000-8000-000000000006'
  )->>'decision',
  'state_conflict',
  'A stale membership version is denied before mutation'
);
select is(
  public.resolve_member_role_assignment_context(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'student_pilot', 1,
    'b4000000-0000-4000-8000-000000000007'
  )->>'decision',
  'state_conflict',
  'Assigning the current role is a conflict'
);
select is(
  public.resolve_member_role_assignment_context(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'invented_role', 1,
    'b4000000-0000-4000-8000-000000000008'
  )->>'decision',
  'validation_failed',
  'An unapproved role code is rejected'
);
select is(
  jsonb_array_length(
    public.get_organization_member(
      'b1000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000002',
      'b4000000-0000-4000-8000-000000000009'
    )->'member'->'roleOptions'
  ),
  2,
  'Member detail exposes only other active assignable roles'
);
select is(
  public.change_organization_member_role(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'instructor_pilot', 'responsibility_changed', 1,
    repeat('1', 64), repeat('2', 64),
    'b4000000-0000-4000-8000-000000000010'
  )->>'decision',
  'target_mfa_not_ready',
  'Privileged assignment fails when stored target readiness is absent'
);
select is(
  (select role.code from public.membership_roles membership_role
   join public.roles role on role.id = membership_role.role_id
   where membership_role.membership_id = 'b3000000-0000-4000-8000-000000000002'),
  'student_pilot',
  'A readiness denial preserves the target role'
);

insert into public.member_mfa_readiness (
  organization_id, membership_id, subject_user_id, factor_reference_hash, verified_at
) values (
  'b2000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000002', repeat('2', 64), now()
);

create temp table feat006b_change_result as
select public.change_organization_member_role(
  'b1000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000002',
  'instructor_pilot', 'responsibility_changed', 1,
  repeat('1', 64), repeat('2', 64),
  'b4000000-0000-4000-8000-000000000011'
) as result;

select is((select result->>'decision' from feat006b_change_result), 'changed', 'A ready privileged assignment succeeds');
select is((select result->>'roleCode' from feat006b_change_result), 'instructor_pilot', 'The result binds the requested role');
select is((select result->>'version' from feat006b_change_result), '2', 'A role change advances membership version');
select is(
  (select count(*)::integer from public.member_administration_events
   where event_name = 'member_role.changed'
     and target_membership_id = 'b3000000-0000-4000-8000-000000000002'),
  1,
  'A successful role change commits one audit event'
);
select is(
  (select metadata->>'priorRoleCode' from public.member_administration_events
   where event_name = 'member_role.changed'
     and target_membership_id = 'b3000000-0000-4000-8000-000000000002'),
  'student_pilot',
  'The audit event records the prior role without provider secrets'
);
select is(
  public.change_organization_member_role(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'instructor_pilot', 'responsibility_changed', 1,
    repeat('1', 64), repeat('2', 64),
    'b4000000-0000-4000-8000-000000000012'
  )->>'replayed',
  'true',
  'An exact idempotent replay returns the committed result'
);
select is(
  (select count(*)::integer from public.member_administration_events
   where event_name = 'member_role.changed'
     and target_membership_id = 'b3000000-0000-4000-8000-000000000002'),
  1,
  'An idempotent replay creates no duplicate audit event'
);
select is(
  public.change_organization_member_role(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'admin', 'responsibility_changed', 2,
    repeat('1', 64), repeat('2', 64),
    'b4000000-0000-4000-8000-000000000013'
  )->>'decision',
  'state_conflict',
  'Reusing an idempotency key for another command is denied'
);
select is(
  public.change_organization_member_role(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'admin', 'responsibility_changed', 1,
    repeat('3', 64), repeat('2', 64),
    'b4000000-0000-4000-8000-000000000014'
  )->>'decision',
  'state_conflict',
  'A stale mutation is denied after a successful change'
);
select is(
  public.change_organization_member_role(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'student_pilot', 'assignment_corrected', 2,
    repeat('4', 64), null,
    'b4000000-0000-4000-8000-000000000015'
  )->>'decision',
  'changed',
  'An AAL1 role accepts no factor reference and succeeds'
);
select is(
  public.change_organization_member_role(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'instructor_pilot', 'invalid_reason', 3,
    repeat('5', 64), repeat('2', 64),
    'b4000000-0000-4000-8000-000000000016'
  )->>'decision',
  'validation_failed',
  'An unapproved reason code is rejected'
);
select is(
  public.change_organization_member_role(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'student_pilot', 'assignment_corrected', 3,
    repeat('6', 64), repeat('2', 64),
    'b4000000-0000-4000-8000-000000000017'
  )->>'decision',
  'state_conflict',
  'Assigning the current role remains a conflict even with a supplied factor'
);
select is(
  public.resolve_auth_access_context(
    'b1000000-0000-4000-8000-000000000002', 'aal1'
  )->'memberships'->0->>'workspacePermission',
  'portal.student.access',
  'Access bootstrap derives the workspace permission from role metadata'
);
select is(
  public.resolve_auth_access_context(
    'b1000000-0000-4000-8000-000000000002', 'aal1'
  )->'memberships'->0->>'roleLabel',
  'Student Pilot',
  'Access bootstrap returns a centralized role label for permission-driven UI'
);

create function public.feat006b_reject_role_audit()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.event_name = 'member_role.changed' then
    raise exception using errcode = 'P0001', message = 'synthetic audit failure';
  end if;
  return new;
end;
$$;

create trigger feat006b_reject_role_audit
before insert on public.member_administration_events
for each row execute function public.feat006b_reject_role_audit();

select throws_ok(
  $$
    select public.change_organization_member_role(
      'b1000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000002',
      'instructor_pilot', 'responsibility_changed', 3,
      repeat('7', 64), repeat('2', 64),
      'b4000000-0000-4000-8000-000000000019'
    )
  $$,
  'P5005',
  'Member administration audit write failed.',
  'Audit failure aborts the authority-bearing role command'
);
select is(
  (select role.code from public.membership_roles membership_role
   join public.roles role on role.id = membership_role.role_id
   where membership_role.membership_id = 'b3000000-0000-4000-8000-000000000002'),
  'student_pilot',
  'Audit failure rolls back the role mutation'
);
select is(
  (select version::text from public.organization_memberships
   where id = 'b3000000-0000-4000-8000-000000000002'),
  '3',
  'Audit failure rolls back the membership version increment'
);

drop trigger feat006b_reject_role_audit on public.member_administration_events;
drop function public.feat006b_reject_role_audit();

update public.organization_memberships
set status = 'suspended'
where id = 'b3000000-0000-4000-8000-000000000002';

select is(
  public.resolve_member_role_assignment_context(
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    'instructor_pilot', 3,
    'b4000000-0000-4000-8000-000000000018'
  )->>'decision',
  'not_found',
  'Inactive targets cannot enter the role-assignment command path'
);

select * from finish();
rollback;
