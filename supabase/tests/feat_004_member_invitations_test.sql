begin;

select plan(57);

select has_table('public', 'organization_invitations', 'FEAT-004 invitation table exists');
select has_table('public', 'member_invitation_events', 'FEAT-004 audit table exists');
select has_table('public', 'member_invitation_rate_limit_state', 'FEAT-004 limiter state exists');
select has_table('public', 'member_invitation_rate_limit_events', 'FEAT-004 limiter evidence exists');
select is(
  (
    select count(*)::integer from pg_class
    where oid in (
      'public.organization_invitations'::regclass,
      'public.member_invitation_events'::regclass,
      'public.member_invitation_rate_limit_state'::regclass,
      'public.member_invitation_rate_limit_events'::regclass
    ) and relrowsecurity
  ), 4, 'RLS is enabled on every FEAT-004 table'
);
select is(
  (
    select count(*)::integer from information_schema.role_table_grants
    where grantee in ('PUBLIC', 'anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'organization_invitations', 'member_invitation_events',
        'member_invitation_rate_limit_state', 'member_invitation_rate_limit_events'
      )
  ), 0, 'Browser roles have no FEAT-004 table privileges'
);
select is(
  (select count(*)::integer from public.roles where is_invitation_assignable),
  3, 'Exactly the three approved initial roles are invitation assignable'
);
select ok(
  exists (
    select 1 from public.roles role
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.code = 'admin' and permission.code = 'membership.invitation.manage'
  ), 'The built-in admin role receives invitation management permission'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.accept_member_invitation(uuid,text,bigint,uuid,bigint,text,uuid)',
    'execute'
  ), 'Authenticated browser callers cannot execute acceptance directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.accept_member_invitation(uuid,text,bigint,uuid,bigint,text,uuid)',
    'execute'
  ), 'The service role can execute protected acceptance'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.prepare_member_invitation_acceptance(uuid,text,uuid,bigint,uuid)',
    'execute'
  ), 'Authenticated browser callers cannot inspect credential preparation directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.prepare_member_invitation_acceptance(uuid,text,uuid,bigint,uuid)',
    'execute'
  ), 'The service role can inspect the protected credential preparation path'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_member_invitation_limiter_scope(uuid,text,uuid,uuid,text)',
    'execute'
  ), 'Authenticated browser callers cannot resolve limiter scope directly'
);
select is(
  public.canonicalize_member_invitation_email('  STUDENT@EXAMPLE.TEST  '),
  'student@example.test', 'Email canonicalization is trim plus lowercase'
);
select throws_ok(
  $$select public.canonicalize_member_invitation_email('student+ñ@example.test')$$,
  '22023', 'Invitation email is invalid.', 'Non-ASCII invitation email is rejected'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select user_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', email, crypt('Synthetic-password-004!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (
  values
    ('91000000-0000-4000-8000-000000000001'::uuid, 'admin-a@example.test'),
    ('91000000-0000-4000-8000-000000000002'::uuid, 'student@example.test'),
    ('91000000-0000-4000-8000-000000000003'::uuid, 'attacker@example.test'),
    ('91000000-0000-4000-8000-000000000004'::uuid, 'rollback@example.test')
) as users(user_id, email);

insert into public.organizations (id, name, status)
values
  ('92000000-0000-4000-8000-000000000001', 'Synthetic Invitation School A', 'active'),
  ('92000000-0000-4000-8000-000000000002', 'Synthetic Invitation School B', 'active');
insert into public.organization_memberships (
  id, organization_id, user_id, status, created_by, updated_by
) values (
  '93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001', 'active',
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001'
);
insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
select '92000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001', id,
  '91000000-0000-4000-8000-000000000001'
from public.roles where code = 'admin';

select is(
  public.resolve_member_invitation_limiter_scope(
    '91000000-0000-4000-8000-000000000001', 'list',
    '92000000-0000-4000-8000-000000000001', null, 'admin-a@example.test'
  ), '92000000-0000-4000-8000-000000000001'::uuid,
  'Authorized organization scope is resolved server-side'
);
select is(
  public.resolve_member_invitation_limiter_scope(
    '91000000-0000-4000-8000-000000000003', 'list',
    '92000000-0000-4000-8000-000000000002', null, 'attacker@example.test'
  ), '00000000-0000-0000-0000-000000000000'::uuid,
  'Unauthorized scope hints collapse to one server-controlled denial bucket'
);

select is(
  (public.begin_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    ' Student@Example.Test ', 'student_pilot', repeat('a', 64),
    '94000000-0000-4000-8000-000000000001'
  )->>'decision'), 'issuing', 'Authorized creation records issuing state before delivery'
);
select is(
  (select status from public.organization_invitations where email_canonical = 'student@example.test'),
  'issuing', 'Issuing state is non-accepting before provider finalization'
);
select is(
  (select count(*)::integer from public.member_invitation_events
   where event_name = 'member_invitation.created'),
  1, 'Issuance intent audit is recorded atomically'
);
select is(
  (public.finalize_member_invitation_delivery(
    '91000000-0000-4000-8000-000000000001',
    (select id from public.organization_invitations where email_canonical = 'student@example.test'),
    '94000000-0000-4000-8000-000000000002', 'accepted', 'new_identity_invite',
    '94000000-0000-4000-8000-000000000003'
  )->>'decision'), 'pending', 'Provider-accepted send moves the invitation to pending'
);
select is(
  (select status || ':' || version::text || ':' || delivery_outcome
   from public.organization_invitations where email_canonical = 'student@example.test'),
  'pending:2:accepted', 'Delivery state, version, and safe provider outcome commit together'
);
select is(
  (public.begin_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'student@example.test', 'student_pilot', repeat('a', 64),
    '94000000-0000-4000-8000-000000000018'
  )->>'decision'), 'pending', 'A completed issuance retry reads back stable pending state'
);
select is(
  (public.begin_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'student@example.test', 'instructor_pilot', repeat('a', 64),
    '94000000-0000-4000-8000-000000000044'
  )->>'decision'), 'conflict', 'Create replay rejects a different requested role'
);
select is(
  (select expires_at - issued_at from public.organization_invitations
   where email_canonical = 'student@example.test'),
  interval '1 hour', 'Database invitation validity is exactly one hour'
);
select is(
  (public.prepare_member_invitation_acceptance(
    '91000000-0000-4000-8000-000000000002', 'student@example.test',
    (select id from public.organization_invitations where email_canonical = 'student@example.test'),
    2, '94000000-0000-4000-8000-000000000041'
  )->>'credentialMode'), 'new', 'Credential preparation uses the protected provider operation class'
);
select is(
  (public.prepare_member_invitation_acceptance(
    '91000000-0000-4000-8000-000000000003', 'attacker@example.test',
    (select id from public.organization_invitations where email_canonical = 'student@example.test'),
    2, '94000000-0000-4000-8000-000000000042'
  )->>'decision'), 'not_available', 'Credential preparation rejects a different confirmed email'
);
select is(
  jsonb_array_length((public.list_member_invitations(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000004'
  )->'invitations')), 1, 'Authorized listing returns only the selected organization'
);
select is(
  jsonb_array_length((public.list_member_invitations(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000005'
  )->'roles')), 3, 'Listing returns the server-approved invitation roles'
);
insert into public.organization_invitations (
  organization_id, email_original, email_canonical, role_id, status,
  invited_by, revoked_at, issuance_idempotency_key_hash, correlation_id
)
select
  '92000000-0000-4000-8000-000000000001',
  'history-' || series || '@example.test', 'history-' || series || '@example.test',
  (select id from public.roles where code = 'student_pilot'), 'revoked',
  '91000000-0000-4000-8000-000000000001', transaction_timestamp(),
  md5(series::text) || md5(series::text), gen_random_uuid()
from generate_series(1, 101) series;
select is(
  jsonb_array_length((public.list_member_invitations(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000043'
  )->'invitations')), 100, 'Invitation history is bounded to the newest 100 records'
);
select is(
  (public.list_member_invitations(
    '91000000-0000-4000-8000-000000000003',
    '92000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000006'
  )->>'decision'), 'not_available', 'A cross-tenant actor receives a non-enumerating denial'
);
select is(
  (public.begin_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'student@example.test', 'student_pilot', repeat('b', 64),
    '94000000-0000-4000-8000-000000000007'
  )->>'decision'), 'conflict', 'Case and whitespace variants cannot bypass active uniqueness'
);
select is(
  (public.accept_member_invitation(
    '91000000-0000-4000-8000-000000000002', ' STUDENT@example.test ',
    floor(extract(epoch from transaction_timestamp()))::bigint,
    (select id from public.organization_invitations where email_canonical = 'student@example.test'),
    2, repeat('c', 64), '94000000-0000-4000-8000-000000000008'
  )->>'decision'), 'accepted', 'Matching verified recipient explicitly accepts with fresh password evidence'
);
select is(
  (select count(*)::integer from public.organization_memberships
   where organization_id = '92000000-0000-4000-8000-000000000001'
     and user_id = '91000000-0000-4000-8000-000000000002'),
  1, 'Acceptance creates exactly one organization membership'
);
select is(
  (select role.code from public.organization_memberships membership
   join public.membership_roles membership_role
     on membership_role.organization_id = membership.organization_id
    and membership_role.membership_id = membership.id
   join public.roles role on role.id = membership_role.role_id
   where membership.user_id = '91000000-0000-4000-8000-000000000002'),
  'student_pilot', 'Acceptance assigns exactly the locked initial role'
);
select is(
  (select count(*)::integer from public.member_invitation_events
   where event_name = 'member_invitation.accepted'),
  1, 'Acceptance audit commits with membership authority'
);
select is(
  (public.accept_member_invitation(
    '91000000-0000-4000-8000-000000000002', 'student@example.test',
    floor(extract(epoch from transaction_timestamp()))::bigint,
    (select id from public.organization_invitations where email_canonical = 'student@example.test'),
    2, repeat('c', 64), '94000000-0000-4000-8000-000000000009'
  )->>'decision'), 'accepted', 'Same-scope acceptance retry returns the stable result'
);
select throws_ok(
  $$set local role authenticated; select * from public.organization_invitations;$$,
  '42501', null, 'Authenticated browser role cannot read invitation rows directly'
);
reset role;

insert into public.organization_invitations (
  id, organization_id, email_original, email_canonical, role_id, status,
  invited_by, issuance_idempotency_key_hash, correlation_id,
  delivery_operation_id, delivery_outcome, delivery_attempt_count,
  last_delivery_attempt_at, provider_operation_class
)
select '95000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000001', 'failed@example.test',
  'failed@example.test', role.id, 'delivery_failed',
  '91000000-0000-4000-8000-000000000001', repeat('5', 64),
  '94000000-0000-4000-8000-000000000045',
  '94000000-0000-4000-8000-000000000046', 'failed', 1,
  transaction_timestamp(), 'new_identity_invite'
from public.roles role where role.code = 'student_pilot';
select is(
  (public.begin_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'failed@example.test', 'student_pilot', repeat('6', 64),
    '94000000-0000-4000-8000-000000000047'
  )->>'decision'), 'conflict', 'Delivery-failed email remains active until resend or revoke'
);

insert into public.organization_invitations (
  id, organization_id, email_original, email_canonical, role_id, status,
  invited_by, issued_at, expires_at, issuance_idempotency_key_hash, correlation_id
)
select '95000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001', 'expired@example.test',
  'expired@example.test', role.id, 'pending',
  '91000000-0000-4000-8000-000000000001',
  transaction_timestamp() - interval '2 hours',
  transaction_timestamp() - interval '1 hour', repeat('d', 64),
  '94000000-0000-4000-8000-000000000010'
from public.roles role where role.code = 'instructor_pilot';
select is(
  public.materialize_member_invitation_expiry(
    '92000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000011'
  ), 1, 'Elapsed pending invitation is materialized at the equality boundary'
);
select is(
  (select status from public.organization_invitations
   where id = '95000000-0000-4000-8000-000000000001'),
  'expired', 'Materialized expiry no longer remains pending'
);
select is(
  (select count(*)::integer from public.member_invitation_events
   where invitation_id = '95000000-0000-4000-8000-000000000001'
     and event_name = 'member_invitation.expired'),
  1, 'Expiry is audited in the same command'
);

insert into public.organization_invitations (
  id, organization_id, email_original, email_canonical, role_id, status,
  invited_by, issuance_idempotency_key_hash, correlation_id
)
select '95000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000001', 'rollback@example.test',
  'rollback@example.test', role.id, 'pending',
  '91000000-0000-4000-8000-000000000001', repeat('3', 64),
  '94000000-0000-4000-8000-000000000020'
from public.roles role where role.code = 'instructor_pilot';
create function pg_temp.reject_invitation_acceptance_audit()
returns trigger language plpgsql as $$
begin
  if new.event_name = 'member_invitation.accepted' then
    raise exception using errcode = 'P0001', message = 'Synthetic audit failure.';
  end if;
  return new;
end;
$$;
create trigger reject_invitation_acceptance_audit
before insert on public.member_invitation_events
for each row execute function pg_temp.reject_invitation_acceptance_audit();
select throws_ok(
  $$select public.accept_member_invitation(
    '91000000-0000-4000-8000-000000000004', 'rollback@example.test',
    floor(extract(epoch from transaction_timestamp()))::bigint,
    '95000000-0000-4000-8000-000000000002', 1, repeat('4', 64),
    '94000000-0000-4000-8000-000000000021'
  )$$,
  'P0001', 'Synthetic audit failure.', 'Audit failure aborts invitation acceptance'
);
select is(
  (select count(*)::integer from public.organization_memberships
   where organization_id = '92000000-0000-4000-8000-000000000001'
     and user_id = '91000000-0000-4000-8000-000000000004'),
  0, 'Audit failure rolls back membership authority'
);
select is(
  (select status from public.organization_invitations
   where id = '95000000-0000-4000-8000-000000000002'),
  'pending', 'Audit failure preserves pending invitation state'
);
drop trigger reject_invitation_acceptance_audit on public.member_invitation_events;

insert into public.organization_invitations (
  id, organization_id, email_original, email_canonical, role_id, status,
  invited_by, issued_at, expires_at, expired_at,
  issuance_idempotency_key_hash, correlation_id
)
select '95000000-0000-4000-8000-000000000004',
  '92000000-0000-4000-8000-000000000001', 'stale@example.test',
  'stale@example.test', role.id, 'expired',
  '91000000-0000-4000-8000-000000000001',
  transaction_timestamp() - interval '2 hours',
  transaction_timestamp() - interval '1 hour', transaction_timestamp(),
  repeat('7', 64), '94000000-0000-4000-8000-000000000051'
from public.roles role where role.code = 'student_pilot';
insert into public.organization_invitations (
  id, organization_id, email_original, email_canonical, role_id, status,
  invited_by, issuance_idempotency_key_hash, correlation_id
)
select '95000000-0000-4000-8000-000000000005',
  '92000000-0000-4000-8000-000000000001', 'stale@example.test',
  'stale@example.test', role.id, 'pending',
  '91000000-0000-4000-8000-000000000001', repeat('8', 64),
  '94000000-0000-4000-8000-000000000052'
from public.roles role where role.code = 'student_pilot';
select is(
  (public.begin_resend_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000004', 1, repeat('9', 64),
    '94000000-0000-4000-8000-000000000053'
  )->>'decision'), 'conflict', 'Expired resend conflicts when a newer active invitation exists'
);
select is(
  (select count(*)::integer from public.member_invitation_events
   where invitation_id = '95000000-0000-4000-8000-000000000004'
     and event_name = 'member_invitation.conflicted'
     and reason_code = 'newer_invitation_active'),
  1, 'Competing active invitation conflict is audited atomically'
);

select is(
  (public.begin_resend_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001', 2, repeat('e', 64),
    '94000000-0000-4000-8000-000000000012'
  )->>'decision'), 'issuing', 'An expired invitation can be replaced by a new issuing invitation'
);
select is(
  (select status from public.organization_invitations
   where id = '95000000-0000-4000-8000-000000000001'),
  'superseded', 'Resend makes the previous FlyEye invitation unusable'
);
select is(
  (public.begin_resend_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000002', 1, repeat('e', 64),
    '94000000-0000-4000-8000-000000000048'
  )->>'decision'), 'conflict', 'Resend replay rejects a different source invitation'
);
select is(
  (public.begin_resend_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001', 1, repeat('e', 64),
    '94000000-0000-4000-8000-000000000049'
  )->>'decision'), 'conflict', 'Resend replay rejects a different source version'
);
select is(
  (public.begin_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'expired@example.test', 'instructor_pilot', repeat('e', 64),
    '94000000-0000-4000-8000-000000000050'
  )->>'decision'), 'conflict', 'Create replay rejects a key already bound to resend'
);
select is(
  (public.finalize_member_invitation_delivery(
    '91000000-0000-4000-8000-000000000001',
    (select id from public.organization_invitations where supersedes_invitation_id = '95000000-0000-4000-8000-000000000001'),
    '94000000-0000-4000-8000-000000000013', 'accepted', 'existing_identity_sign_in',
    '94000000-0000-4000-8000-000000000014'
  )->>'decision'), 'pending', 'Replacement delivery can become pending independently'
);
select is(
  (public.revoke_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    (select id from public.organization_invitations where supersedes_invitation_id = '95000000-0000-4000-8000-000000000001'),
    2, repeat('f', 64), '94000000-0000-4000-8000-000000000015'
  )->>'decision'), 'revoked', 'Authorized administrator can revoke a pending invitation'
);
select is(
  (public.revoke_member_invitation(
    '91000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    (select id from public.organization_invitations where supersedes_invitation_id = '95000000-0000-4000-8000-000000000001'),
    2, repeat('f', 64), '94000000-0000-4000-8000-000000000019'
  )->>'decision'), 'revoked', 'Same-scope revocation retry returns the stable result'
);
select is(
  (public.accept_member_invitation(
    '91000000-0000-4000-8000-000000000003', 'expired@example.test',
    floor(extract(epoch from transaction_timestamp()))::bigint,
    (select id from public.organization_invitations where supersedes_invitation_id = '95000000-0000-4000-8000-000000000001'),
    3, repeat('1', 64), '94000000-0000-4000-8000-000000000016'
  )->>'decision'), 'not_available', 'Revocation blocks later acceptance without revealing state'
);
select ok(
  (public.consume_member_invitation_rate_limit(
    repeat('2', 64), 'accept', '94000000-0000-4000-8000-000000000017'
  )->>'allowed')::boolean,
  'The local atomic limiter records an initial allowed decision'
);

select * from finish();
rollback;
