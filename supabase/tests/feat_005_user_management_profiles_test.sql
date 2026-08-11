begin;

select plan(72);

select has_table('public', 'organization_member_profiles', 'FEAT-005 profile table exists');
select has_table('public', 'member_administration_events', 'FEAT-005 audit table exists');
select has_table('public', 'member_administration_rate_limit_state', 'FEAT-005 limiter state exists');
select has_table('public', 'member_administration_rate_limit_events', 'FEAT-005 limiter evidence exists');
select has_trigger(
  'public',
  'organization_memberships',
  'organization_membership_create_profile',
  'Membership inserts are protected by the profile-creation trigger before backfill reconciliation'
);
select is(
  public.member_status_reason_options('suspend'),
  '[{"action":"suspend","code":"temporary_access_hold","label":"Temporary access hold"},{"action":"suspend","code":"administrative_review","label":"Administrative review"}]'::jsonb,
  'Suspend UI options and command validation share one server mapping'
);
select is(
  public.member_status_reason_options('reactivate'),
  '[{"action":"reactivate","code":"hold_resolved","label":"Hold resolved"},{"action":"reactivate","code":"suspension_corrected","label":"Suspension corrected"}]'::jsonb,
  'Reactivate UI options and command validation share one server mapping'
);
select is(
  public.member_status_reason_options('revoke'),
  '[{"action":"revoke","code":"membership_ended","label":"Membership ended"},{"action":"revoke","code":"membership_created_in_error","label":"Membership created in error"}]'::jsonb,
  'Revoke UI options and command validation share one server mapping'
);
select is(
  (
    select count(*)::integer from pg_class
    where oid in (
      'public.organization_member_profiles'::regclass,
      'public.member_administration_events'::regclass,
      'public.member_administration_rate_limit_state'::regclass,
      'public.member_administration_rate_limit_events'::regclass
    ) and relrowsecurity
  ), 4, 'RLS is enabled on every FEAT-005 table'
);
select is(
  (
    select count(*)::integer from information_schema.role_table_grants
    where grantee in ('PUBLIC', 'anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'organization_member_profiles', 'member_administration_events',
        'member_administration_rate_limit_state', 'member_administration_rate_limit_events'
      )
  ), 0, 'Browser roles have no FEAT-005 table privileges'
);
select ok(
  exists (
    select 1 from public.roles role
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.code = 'admin' and permission.code = 'membership.member.review'
  ), 'Admin receives member review permission'
);
select ok(
  exists (
    select 1 from public.roles role
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.code = 'admin' and permission.code = 'membership.member.manage_status'
  ), 'Admin receives member status permission'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.list_organization_members(uuid,uuid,uuid,text,text,timestamptz,uuid,integer)',
    'execute'
  ), 'Authenticated callers cannot execute directory list RPC directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.list_organization_members(uuid,uuid,uuid,text,text,timestamptz,uuid,integer)',
    'execute'
  ), 'Service role can execute directory list RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.change_organization_member_status(uuid,uuid,uuid,text,text,bigint,text,uuid)',
    'execute'
  ), 'Authenticated callers cannot execute status commands directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.change_organization_member_status(uuid,uuid,uuid,text,text,bigint,text,uuid)',
    'execute'
  ), 'Service role can execute protected status commands'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.update_my_member_profile(uuid,uuid,text,text,bigint,uuid)',
    'execute'
  ), 'Authenticated callers cannot bypass the profile Edge boundary'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.update_my_member_profile(uuid,uuid,text,text,bigint,uuid)',
    'execute'
  ), 'Service role can execute protected profile updates'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.required_member_profile_assurance(uuid,uuid)',
    'execute'
  ), 'Authenticated callers cannot derive profile assurance directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.required_member_profile_assurance(uuid,uuid)',
    'execute'
  ), 'Service role can derive the server-controlled profile assurance requirement'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select user_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', email, crypt('Synthetic-password-005!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (
  values
    ('a1000000-0000-4000-8000-000000000001'::uuid, 'admin-a@example.test'),
    ('a1000000-0000-4000-8000-000000000002'::uuid, 'admin-two@example.test'),
    ('a1000000-0000-4000-8000-000000000003'::uuid, 'student@example.test'),
    ('a1000000-0000-4000-8000-000000000004'::uuid, 'admin-b@example.test'),
    ('a1000000-0000-4000-8000-000000000005'::uuid, 'attacker@example.test')
) as users(user_id, email);

insert into public.organizations (id, name, status)
values
  ('a2000000-0000-4000-8000-000000000001', 'Synthetic Member School A', 'active'),
  ('a2000000-0000-4000-8000-000000000002', 'Synthetic Member School B', 'active');

insert into public.organization_memberships (
  id, organization_id, user_id, status, created_by, updated_by
) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'active', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'active', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'active', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('a3000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000004', 'active', 'a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004'),
  ('a3000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'active', 'a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004');

insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
select membership.organization_id, membership.id, role.id, membership.created_by
from public.organization_memberships membership
join public.roles role on role.code = case
  when membership.id in (
    'a3000000-0000-4000-8000-000000000001'::uuid,
    'a3000000-0000-4000-8000-000000000002'::uuid,
    'a3000000-0000-4000-8000-000000000004'::uuid
  ) then 'admin'
  else 'student_pilot'
end
where membership.id::text like 'a3000000-%';

select is(
  (select count(*)::integer from public.organization_member_profiles
   where membership_id::text like 'a3000000-%'),
  5, 'Every new membership receives exactly one organization-scoped profile'
);
select is(
  public.required_member_profile_assurance(
    'a1000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001'
  ), 'aal2', 'Organization Admin profile access requires portal MFA'
);
select is(
  public.required_member_profile_assurance(
    'a1000000-0000-4000-8000-000000000003',
    'a3000000-0000-4000-8000-000000000003'
  ), 'aal1', 'Student profile access retains the approved AAL1 boundary'
);
update public.roles set is_active = false where code = 'admin';
select is(
  public.required_member_profile_assurance(
    'a1000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001'
  ), 'denied', 'Inactive privileged roles fail the profile assurance boundary closed'
);
select is(
  public.update_my_member_profile(
    'a1000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    'Inactive Admin',
    '',
    1,
    'a8000000-0000-4000-8000-000000000099'
  )->>'decision',
  'not_found',
  'Inactive privileged roles cannot mutate profiles through the authority-bearing RPC'
);
update public.roles set is_active = true where code = 'admin';
select is(
  (public.list_organization_members(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000030', null, null, null, null, null
  )->>'decision'), 'validation_failed', 'A null directory limit fails closed'
);
select is(
  (public.update_my_member_profile(
    'a1000000-0000-4000-8000-000000000003',
    'a3000000-0000-4000-8000-000000000003',
    null, '', 1, 'a4000000-0000-4000-8000-000000000031'
  )->>'decision'), 'validation_failed', 'A null profile display name fails closed'
);
select is(
  (public.update_my_member_profile(
    'a1000000-0000-4000-8000-000000000003',
    'a3000000-0000-4000-8000-000000000003',
    'Synthetic Student', '', null, 'a4000000-0000-4000-8000-000000000032'
  )->>'decision'), 'validation_failed', 'A null profile version fails closed'
);
select is(
  (public.change_organization_member_status(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    'suspend', 'temporary_access_hold', null, repeat('9', 64),
    'a4000000-0000-4000-8000-000000000033'
  )->>'decision'), 'validation_failed', 'A null status version fails closed'
);
select is(
  (public.change_organization_member_status(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    'suspend', 'temporary_access_hold', 1, null,
    'a4000000-0000-4000-8000-000000000034'
  )->>'decision'), 'validation_failed', 'A null status idempotency hash fails closed'
);
select is(
  (public.get_my_member_profile(
    'a1000000-0000-4000-8000-000000000003',
    'a3000000-0000-4000-8000-000000000003',
    'a4000000-0000-4000-8000-000000000001'
  )->>'decision'), 'found', 'An active member can read only the own selected profile'
);
select is(
  (public.get_my_member_profile(
    'a1000000-0000-4000-8000-000000000003',
    'a3000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000002'
  )->>'decision'), 'not_found', 'Another member profile is non-enumerating to the subject'
);
select is(
  (public.update_my_member_profile(
    'a1000000-0000-4000-8000-000000000003',
    'a3000000-0000-4000-8000-000000000003',
    'Synthetic Student', '+63 (2) 555-0100', 1,
    'a4000000-0000-4000-8000-000000000003'
  )->>'decision'), 'updated', 'Own profile update commits through the protected RPC'
);
select is(
  (select display_name || ':' || contact_number || ':' || version::text
   from public.organization_member_profiles
   where membership_id = 'a3000000-0000-4000-8000-000000000003'),
  'Synthetic Student:+63 (2) 555-0100:2', 'Profile values and version update together'
);
select ok(
  exists (
    select 1 from public.member_administration_events
    where event_name = 'member_profile.updated'
      and metadata -> 'changedFields' ?& array['displayName', 'contactNumber']
      and metadata::text not like '%Synthetic Student%'
      and metadata::text not like '%555-0100%'
  ), 'Profile audit records field names without profile values'
);
select is(
  (public.list_organization_members(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000004'
  )->>'decision'), 'listed', 'Authorized admin can list the active organization directory'
);
select is(
  jsonb_array_length(public.list_organization_members(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000005'
  )->'members'), 3, 'Directory results are limited to the selected organization'
);
select is(
  jsonb_array_length(public.list_organization_members(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000006', null, 'synthetic student'
  )->'members'), 1, 'Bounded display-name search returns the matching organization member'
);
select is(
  (public.list_organization_members(
    'a1000000-0000-4000-8000-000000000005',
    'a2000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000007'
  )->>'decision'), 'not_found', 'Cross-tenant directory attempts return a safe denial'
);
select is(
  (select count(*)::integer from public.member_administration_events
   where event_name = 'member_directory.listed' and organization_id = 'a2000000-0000-4000-8000-000000000001'),
  3, 'Every successful directory response has atomic minimized access evidence'
);
select is(
  (public.get_organization_member(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    'a4000000-0000-4000-8000-000000000008'
  )->>'decision'), 'found', 'Authorized admin can review a same-organization member'
);

create temp table feat005_page_evidence (
  first_page jsonb,
  expected_remaining uuid,
  second_page jsonb,
  status_first_page jsonb,
  status_removed uuid,
  status_second_page jsonb
) on commit drop;

insert into feat005_page_evidence (first_page, expected_remaining)
select
  public.list_organization_members(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000035', null, null, null, null, 2
  ),
  (
    select id from public.organization_memberships
    where organization_id = 'a2000000-0000-4000-8000-000000000001'
    order by created_at desc, id desc offset 2 limit 1
  );

select ok(
  (select (first_page->>'hasMore')::boolean from feat005_page_evidence),
  'The immutable tuple cursor is emitted when another member remains'
);

update public.organization_member_profiles
set display_name = 'Mutable Pagination Name'
where membership_id = (select expected_remaining from feat005_page_evidence);
update auth.users auth_user
set email = 'changed-pagination@example.test'
from public.organization_memberships membership
where membership.id = (select expected_remaining from feat005_page_evidence)
  and auth_user.id = membership.user_id;
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'a1000000-0000-4000-8000-000000000006',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'newer-page@example.test', crypt('Synthetic-password-005!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.organization_memberships (
  id, organization_id, user_id, status, created_at, created_by, updated_by
) values (
  'a3000000-0000-4000-8000-000000000006',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000006', 'active', now() + interval '1 day',
  'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'
);
insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
select
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000006', id,
  'a1000000-0000-4000-8000-000000000001'
from public.roles where code = 'student_pilot';

update feat005_page_evidence
set second_page = public.list_organization_members(
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000036', null, null,
  (first_page->>'nextCreatedAt')::timestamptz,
  (first_page->>'nextMembershipId')::uuid, 2
);

select is(
  (select jsonb_array_length(second_page->'members') from feat005_page_evidence),
  1, 'Mutable profile/email changes and a newer row do not duplicate or skip the remaining tuple'
);
select is(
  (select second_page->'members'->0->>'membershipId' from feat005_page_evidence),
  (select expected_remaining::text from feat005_page_evidence),
  'The second page resumes from the immutable created-at and membership-id boundary'
);
select ok(
  not exists (
    select 1 from feat005_page_evidence evidence,
      jsonb_array_elements(evidence.second_page->'members') member
    where member->>'membershipId' = 'a3000000-0000-4000-8000-000000000006'
       or exists (
         select 1 from jsonb_array_elements(evidence.first_page->'members') first_member
         where first_member->>'membershipId' = member->>'membershipId'
       )
  ), 'A newer member and prior-page members are excluded from the resumed page'
);

update feat005_page_evidence
set status_first_page = public.list_organization_members(
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000037', 'active', null, null, null, 2
);
update feat005_page_evidence evidence
set status_removed = (
  select membership.id from public.organization_memberships membership
  where membership.organization_id = 'a2000000-0000-4000-8000-000000000001'
    and membership.status = 'active'
    and (membership.created_at, membership.id) < (
      (evidence.status_first_page->>'nextCreatedAt')::timestamptz,
      (evidence.status_first_page->>'nextMembershipId')::uuid
    )
  order by membership.created_at desc, membership.id desc limit 1
);
update public.organization_memberships
set status = 'suspended'
where id = (select status_removed from feat005_page_evidence);
update feat005_page_evidence
set status_second_page = public.list_organization_members(
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000038', 'active', null,
  (status_first_page->>'nextCreatedAt')::timestamptz,
  (status_first_page->>'nextMembershipId')::uuid, 2
);
select ok(
  not exists (
    select 1 from feat005_page_evidence evidence,
      jsonb_array_elements(evidence.status_second_page->'members') member
    where member->>'membershipId' = evidence.status_removed::text
  ), 'A member removed from the active filter is absent from the resumed active page'
);
update public.organization_memberships
set status = 'active'
where id = (select status_removed from feat005_page_evidence);
update public.organization_member_profiles
set display_name = null
where membership_id = (select expected_remaining from feat005_page_evidence);
select is(
  (public.change_organization_member_status(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    'suspend', 'temporary_access_hold', 1, repeat('1', 64),
    'a4000000-0000-4000-8000-000000000009'
  )->>'decision'), 'self_action', 'Self-suspension is denied server-side'
);
select is(
  (public.change_organization_member_status(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    'suspend', 'hold_resolved', 1, repeat('2', 64),
    'a4000000-0000-4000-8000-000000000010'
  )->>'decision'), 'validation_failed', 'Cross-action reason codes are rejected'
);
select is(
  (public.change_organization_member_status(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    'suspend', 'temporary_access_hold', 1, repeat('3', 64),
    'a4000000-0000-4000-8000-000000000011'
  )->>'decision'), 'suspended', 'Authorized suspension succeeds atomically'
);
select is(
  (select status || ':' || version::text from public.organization_memberships
   where id = 'a3000000-0000-4000-8000-000000000003'),
  'suspended:2', 'Suspension changes only status and version'
);
select ok(
  exists (
    select 1 from public.member_administration_events
    where event_name = 'member_status.suspended'
      and target_membership_id = 'a3000000-0000-4000-8000-000000000003'
      and reason_code = 'temporary_access_hold'
      and metadata ->> 'roleCode' = 'student_pilot'
  ), 'Suspension records role-preserving minimized audit evidence'
);
select is(
  (public.change_organization_member_status(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    'suspend', 'temporary_access_hold', 1, repeat('3', 64),
    'a4000000-0000-4000-8000-000000000012'
  )->>'decision'), 'suspended', 'Same-scope retry returns the stable status result'
);
select is(
  (public.change_organization_member_status(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    'suspend', 'administrative_review', 1, repeat('3', 64),
    'a4000000-0000-4000-8000-000000000013'
  )->>'decision'), 'state_conflict', 'Changed input cannot reuse a status idempotency key'
);
select is(
  jsonb_array_length(public.resolve_auth_access_context(
    'a1000000-0000-4000-8000-000000000003', 'aal1',
    'a2000000-0000-4000-8000-000000000001'
  )->'memberships'), 0, 'Suspension immediately removes organization authority from access context'
);
select is(
  (select status from public.organization_memberships
   where id = 'a3000000-0000-4000-8000-000000000005'),
  'active', 'The same subject remains active in another organization'
);
select is(
  (public.change_organization_member_status(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    'reactivate', 'hold_resolved', 2, repeat('4', 64),
    'a4000000-0000-4000-8000-000000000014'
  )->>'decision'), 'active', 'Authorized reactivation restores the suspended membership only'
);
select is(
  (select role.code from public.membership_roles membership_role
   join public.roles role on role.id = membership_role.role_id
   where membership_role.membership_id = 'a3000000-0000-4000-8000-000000000003'),
  'student_pilot', 'Reactivation preserves the existing role'
);
select is(
  (public.change_organization_member_status(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    'revoke', 'membership_ended', 3, repeat('5', 64),
    'a4000000-0000-4000-8000-000000000015'
  )->>'decision'), 'revoked', 'Authorized revocation is terminal in FEAT-005'
);
select is(
  (select membership.status || ':' || (profile.display_name is not null)::text
   from public.organization_memberships membership
   join public.organization_member_profiles profile on profile.membership_id = membership.id
   where membership.id = 'a3000000-0000-4000-8000-000000000003'),
  'revoked:true', 'Revocation preserves the member profile and records'
);
select is(
  (public.change_organization_member_status(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    'reactivate', 'hold_resolved', 4, repeat('6', 64),
    'a4000000-0000-4000-8000-000000000016'
  )->>'decision'), 'state_conflict', 'Revoked membership cannot be reactivated'
);
select ok(
  (public.consume_member_administration_rate_limit(
    repeat('a', 64), 'suspend', 'a4000000-0000-4000-8000-000000000017'
  )->>'allowed')::boolean, 'Status limiter allows the first burst request'
);
select ok(
  (public.consume_member_administration_rate_limit(
    repeat('a', 64), 'revoke', 'a4000000-0000-4000-8000-000000000018'
  )->>'allowed')::boolean, 'Status limiter shares and allows the second burst request'
);
select ok(
  not (public.consume_member_administration_rate_limit(
    repeat('a', 64), 'reactivate', 'a4000000-0000-4000-8000-000000000019'
  )->>'allowed')::boolean, 'Status limiter atomically rejects burst exhaustion'
);

create function pg_temp.reject_feat005_status_audit()
returns trigger language plpgsql as $$
begin
  raise exception 'synthetic FEAT-005 audit failure';
end;
$$;
create trigger reject_feat005_status_audit
before insert on public.member_administration_events
for each row when (new.event_name = 'member_status.suspended')
execute function pg_temp.reject_feat005_status_audit();

select throws_ok(
  $$select public.change_organization_member_status(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000002',
    'suspend', 'administrative_review', 1, repeat('7', 64),
    'a4000000-0000-4000-8000-000000000020'
  )$$,
  'P5005', 'Member administration audit write failed.',
  'Mandatory status audit failure aborts the protected command'
);
select is(
  (select status || ':' || version::text from public.organization_memberships
   where id = 'a3000000-0000-4000-8000-000000000002'),
  'active:1', 'Audit failure rolls back the membership status and version'
);
drop trigger reject_feat005_status_audit on public.member_administration_events;

select ok(
  public.record_member_administration_denial(
    'a1000000-0000-4000-8000-000000000005',
    'member_administration.denied', 'cross_tenant_denied',
    'a4000000-0000-4000-8000-000000000021',
    'a2000000-0000-4000-8000-000000000001', null
  ) is not null, 'Safe denial evidence can be recorded without returning tenant data'
);
select ok(
  not exists (
    select 1 from public.member_administration_events
    where metadata::text like '%student@example.test%'
       or metadata::text like '%Synthetic Student%'
       or metadata::text like '%555-0100%'
  ), 'Audit metadata contains no email, display name, or contact number values'
);
select is(
  (select count(*)::integer from public.organization_member_profiles
   where membership_id::text like 'a3000000-%' and display_name is null),
  5, 'Profile creation never invents identity data for existing memberships'
);

create function pg_temp.reject_feat005_read_or_profile_audit()
returns trigger language plpgsql as $$
begin
  raise exception 'synthetic FEAT-005 read/profile audit failure';
end;
$$;
create trigger reject_feat005_read_or_profile_audit
before insert on public.member_administration_events
for each row when (new.event_name in ('member_directory.listed', 'member_profile.updated'))
execute function pg_temp.reject_feat005_read_or_profile_audit();

select throws_ok(
  $$select public.list_organization_members(
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000022'
  )$$,
  'P5005', 'Member administration audit write failed.',
  'Directory data is not returned when its mandatory access audit fails'
);
select is(
  (select count(*)::integer from public.member_administration_events
   where event_name = 'member_directory.listed'
     and organization_id = 'a2000000-0000-4000-8000-000000000001'),
  7, 'Failed directory audit creates no false-success evidence'
);
select throws_ok(
  $$select public.update_my_member_profile(
    'a1000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    'Synthetic Admin', '', 1,
    'a4000000-0000-4000-8000-000000000023'
  )$$,
  'P5005', 'Member administration audit write failed.',
  'Profile audit failure aborts the profile update'
);
select is(
  (select coalesce(display_name, 'null') || ':' || version::text
   from public.organization_member_profiles
   where membership_id = 'a3000000-0000-4000-8000-000000000001'),
  'null:1', 'Profile audit failure preserves the prior profile and version'
);

select * from finish();
rollback;
