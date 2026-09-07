begin;

set constraints organizations_single_school_deployment_key deferred;
set constraints organization_memberships_single_school_user_key deferred;

select no_plan();

select ok(
  exists (
    select 1 from public.roles role
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.code = 'admin' and permission.code = 'aircraft.document.manage'
  ),
  'Organization Admin receives aircraft document management authority'
);
select ok(
  exists (
    select 1 from public.roles role
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.code in ('student_pilot', 'instructor_pilot')
      and permission.code = 'aircraft.document.status.read'
  ),
  'Student and Instructor roles receive status-only authority'
);
select ok(
  not exists (
    select 1 from public.roles role
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.code <> 'admin' and permission.code like 'aircraft.document.%'
      and permission.code <> 'aircraft.document.status.read'
  ),
  'Non-Admin roles receive no document metadata or command authority'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'aircraft_document_categories', 'aircraft_document_requirements', 'stored_files',
        'aircraft_documents', 'aircraft_document_versions', 'aircraft_document_notifications',
        'aircraft_document_events', 'aircraft_document_idempotency',
        'aircraft_document_rate_limit_state', 'aircraft_document_rate_limit_events'
      ) and relation.relrowsecurity
  ),
  10,
  'Every FEAT-007B public table has RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.aircraft_documents', 'select')
  and not has_table_privilege('authenticated', 'public.aircraft_documents', 'insert')
  and not has_table_privilege('authenticated', 'public.stored_files', 'select'),
  'Browser roles cannot directly read or write document and file metadata'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.mutate_aircraft_document(uuid,uuid,text,uuid,uuid,uuid,bigint,text,text,text,date,date,text,uuid,text,text,text,date,uuid)',
    'execute'
  ),
  'Browser roles cannot execute document mutations directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.mutate_aircraft_document(uuid,uuid,text,uuid,uuid,uuid,bigint,text,text,text,date,date,text,uuid,text,text,text,date,uuid)',
    'execute'
  ),
  'The server role can execute the protected document mutation'
);
select ok(
  (select not public and file_size_limit = 20971520
   from storage.buckets where id = 'aircraft-documents'),
  'The aircraft document bucket is private and bounded to 20 MiB'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select user_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', email, crypt('Synthetic-password-007B!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from (
  values
    ('81000000-0000-4000-8000-000000000001'::uuid, 'document-admin-a@example.test'),
    ('81000000-0000-4000-8000-000000000002'::uuid, 'document-student-a@example.test'),
    ('81000000-0000-4000-8000-000000000003'::uuid, 'document-instructor-a@example.test'),
    ('81000000-0000-4000-8000-000000000004'::uuid, 'document-admin-b@example.test')
) as users(user_id, email);

insert into public.organizations (id, name, status) values
  ('82000000-0000-4000-8000-000000000001', 'Synthetic Document School A', 'active'),
  ('82000000-0000-4000-8000-000000000002', 'Synthetic Document School B', 'active');

insert into public.organization_memberships (
  id, organization_id, user_id, status, created_by, updated_by
) values
  ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'active', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001'),
  ('83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'active', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001'),
  ('83000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000003', 'active', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001'),
  ('83000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000004', 'active', '81000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000004');

insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
select membership.organization_id, membership.id, role.id, membership.created_by
from public.organization_memberships membership
join public.roles role on role.code = case membership.user_id
  when '81000000-0000-4000-8000-000000000002' then 'student_pilot'
  when '81000000-0000-4000-8000-000000000003' then 'instructor_pilot'
  else 'admin' end
where membership.id::text like '83000000-%';

insert into public.aircraft_records (
  id, organization_id, registration_mark, registration_key, manufacturer, model,
  created_by, updated_by
) values
  ('84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'RP-C701', 'rpc701', 'Synthetic Maker', 'Model A', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001'),
  ('84000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', 'RP-C703', 'rpc703', 'Synthetic Maker', 'Model C', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001'),
  ('84000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000002', 'RP-C702', 'rpc702', 'Synthetic Maker', 'Model B', '81000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000004');

select is(
  (select count(*)::integer from public.aircraft_document_categories
   where organization_id = '82000000-0000-4000-8000-000000000001'),
  6,
  'A new school receives exactly the six approved system categories'
);
select is(
  public.resolve_aircraft_document_context('81000000-0000-4000-8000-000000000001')->>'canManage',
  'true',
  'The server derives Admin document management authority'
);
select is(
  public.resolve_aircraft_document_context('81000000-0000-4000-8000-000000000002')->>'canReadStatus',
  'true',
  'The server derives Student status-only authority'
);
select is(
  public.resolve_aircraft_document_context('81000000-0000-4000-8000-000000000002')->>'canRead',
  'false',
  'A Student has no full metadata authority'
);
select is(public.calculate_aircraft_document_status('2026-09-01', 'active', false, '2026-09-02'), 'expired', 'A past expiration is Expired');
select is(public.calculate_aircraft_document_status('2026-09-02', 'active', false, '2026-09-02'), 'expiring_soon', 'Expiration day is Expiring Soon');
select is(public.calculate_aircraft_document_status('2026-09-09', 'active', false, '2026-09-02'), 'expiring_soon', 'The seven-day boundary is Expiring Soon');
select is(public.calculate_aircraft_document_status('2026-09-10', 'active', false, '2026-09-02'), 'valid', 'Eight days before expiration is Valid');
select is(public.calculate_aircraft_document_status('2026-09-10', 'suspended', false, '2026-09-02'), 'suspended', 'Suspension overrides date status');
select is(public.calculate_aircraft_document_status('2026-09-10', 'active', true, '2026-09-02'), 'archived', 'Archived history overrides date status');

select is(
  public.list_aircraft_document_status(
    '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', '2026-09-02', '85000000-0000-4000-8000-000000000001'
  )->>'decision',
  'listed',
  'A Student can read the bounded configured-status list'
);
select ok(
  not ((public.list_aircraft_document_status(
    '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', '2026-09-02', '85000000-0000-4000-8000-000000000023'
  )->'items'->0) ?| array['categoryVersion', 'requirementId', 'requirementVersion', 'documentId', 'aggregateVersion'])
  and jsonb_array_length(public.list_aircraft_document_status(
    '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', '2026-09-02', '85000000-0000-4000-8000-000000000024'
  )->'availableCustomCategories') = 0,
  'Status-only responses omit Admin identifiers, activity versions, and available-category configuration'
);
select is(
  jsonb_array_length(public.list_aircraft_document_status(
    '81000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', '2026-09-02', '85000000-0000-4000-8000-000000000002'
  )->'items'),
  6,
  'An Instructor sees the six required status rows'
);
select is(
  public.get_aircraft_document_detail(
    '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001',
    gen_random_uuid(), '2026-09-02', '85000000-0000-4000-8000-000000000003'
  )->>'decision',
  'unauthorized',
  'A Student cannot read full document metadata'
);
select is(
  public.list_aircraft_document_status(
    '81000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000002',
    '84000000-0000-4000-8000-000000000001', '2026-09-02', '85000000-0000-4000-8000-000000000004'
  )->>'decision',
  'not_found',
  'A cross-school direct aircraft ID does not disclose status'
);
select is(
  jsonb_array_length(public.list_aircraft_for_document_status(
    '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001',
    2, 1, '85000000-0000-4000-8000-000000000019'
  )->'aircraft'),
  1,
  'Aircraft pagination returns the second page instead of filtering it away'
);

create temp table feat007b_create as
select public.mutate_aircraft_document(
  '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  'create', '84000000-0000-4000-8000-000000000001',
  (select id from public.aircraft_document_categories where organization_id = '82000000-0000-4000-8000-000000000001' and category_code = 'registration_certificate'),
  null, null, 'Registration Certificate', 'Synthetic Authority', 'REF-701', '2026-09-01',
  '2026-09-09', 'Synthetic metadata only', null, null,
  repeat('1', 64), repeat('a', 64), '2026-09-02', '85000000-0000-4000-8000-000000000005'
) as result;

select is((select result->>'decision' from feat007b_create), 'created', 'Admin creates a versioned document record');
select is((select result->>'currentVersionNumber' from feat007b_create), '1', 'A new document starts at version one');
select is(
  (select count(*)::integer from public.aircraft_document_notifications where event_kind = 'warning'),
  1,
  'Creation at the seven-day boundary creates one Admin warning'
);
select is(
  public.mutate_aircraft_document(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    'suspend', '84000000-0000-4000-8000-000000000001',
    (select id from public.aircraft_document_categories where organization_id = '82000000-0000-4000-8000-000000000001' and category_code = 'registration_certificate'),
    (select (result->>'documentId')::uuid from feat007b_create), 1,
    null, null, null, null, null, null, null, 'Synthetic review pending',
    repeat('0', 64), repeat('9', 64), '2026-09-02', '85000000-0000-4000-8000-000000000023'
  )->>'decision',
  'suspended',
  'Suspension resolves the current warning through the audited resolver'
);
select is(
  public.mutate_aircraft_document(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    'restore', '84000000-0000-4000-8000-000000000001',
    (select id from public.aircraft_document_categories where organization_id = '82000000-0000-4000-8000-000000000001' and category_code = 'registration_certificate'),
    (select (result->>'documentId')::uuid from feat007b_create), 2,
    null, null, null, null, null, null, null, 'Synthetic review completed',
    repeat('f', 64), repeat('8', 64), '2026-09-02', '85000000-0000-4000-8000-000000000024'
  )->>'decision',
  'restored',
  'Restoration evaluates and reopens the notification applicable on that date'
);
select is(
  (select notification_state from public.aircraft_document_notifications where event_kind = 'warning'),
  'open',
  'Restoration reopens the previously resolved warning'
);
select ok(
  exists (
    select 1 from public.aircraft_document_events
    where event_name = 'aircraft_document.notification_reopened'
      and metadata->>'previousState' = 'resolved' and metadata->>'newState' = 'open'
  ),
  'Notification reopening creates explicit audit evidence'
);
select is(
  public.sync_aircraft_document_notifications(
    '82000000-0000-4000-8000-000000000001',
    (select (result->>'documentId')::uuid from feat007b_create),
    (select (result->>'currentVersionId')::uuid from feat007b_create),
    '2026-09-10', '81000000-0000-4000-8000-000000000001',
    '85000000-0000-4000-8000-000000000020'
  )->>'status',
  'expired',
  'The expiration transition creates a second notification for pagination coverage'
);
select is(
  public.lookup_aircraft_document_idempotency(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    'aircraft.document.manage', 'create', null, null, repeat('1', 64), repeat('a', 64)
  )->>'decision',
  'replay',
  'A create replay is found without a client-known target ID'
);
select is(
  public.mutate_aircraft_document(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    'create', '84000000-0000-4000-8000-000000000001',
    (select id from public.aircraft_document_categories where organization_id = '82000000-0000-4000-8000-000000000001' and category_code = 'registration_certificate'),
    null, null, 'Registration Certificate', 'Synthetic Authority', 'REF-701', '2026-09-01',
    '2026-09-09', 'Synthetic metadata only', null, null,
    repeat('1', 64), repeat('a', 64), '2026-09-02', '85000000-0000-4000-8000-000000000006'
  )->>'replayed',
  'true',
  'An exact create replay creates no second version'
);
select is(
  (select count(*)::integer from public.aircraft_document_versions
   where aircraft_document_id = (select (result->>'documentId')::uuid from feat007b_create)),
  1,
  'Create replay leaves one immutable version'
);

create temp table feat007b_renew as
select public.mutate_aircraft_document(
  '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  'renew', '84000000-0000-4000-8000-000000000001',
  (select id from public.aircraft_document_categories where organization_id = '82000000-0000-4000-8000-000000000001' and category_code = 'registration_certificate'),
  (select (result->>'documentId')::uuid from feat007b_create), 3,
  'Registration Certificate', 'Synthetic Authority', 'REF-702', '2026-09-02',
  '2027-09-02', null, null, 'Annual replacement recorded',
  repeat('2', 64), repeat('b', 64), '2026-09-02', '85000000-0000-4000-8000-000000000007'
) as result;

select is((select result->>'decision' from feat007b_renew), 'renewed', 'Renewal creates the next current version');
select is((select result->>'currentVersionNumber' from feat007b_renew), '2', 'Renewal advances the immutable version number');
select is(
  (select notification_state from public.aircraft_document_notifications where event_kind = 'warning'),
  'resolved',
  'Renewal resolves the superseded version warning'
);
select is(
  jsonb_array_length(public.list_aircraft_document_notifications(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001', 2, 1, true,
    '85000000-0000-4000-8000-000000000021'
  )->'items'),
  1,
  'Notification pagination returns the second page instead of filtering it away'
);
select is(
  public.mutate_aircraft_document(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    'suspend', '84000000-0000-4000-8000-000000000001',
    (select id from public.aircraft_document_categories where organization_id = '82000000-0000-4000-8000-000000000001' and category_code = 'registration_certificate'),
    (select (result->>'documentId')::uuid from feat007b_create), 4,
    null, null, null, null, null, null, null, 'Administrative review pending',
    repeat('3', 64), repeat('c', 64), '2026-09-02', '85000000-0000-4000-8000-000000000008'
  )->>'decision',
  'suspended',
  'A reasoned suspension succeeds'
);

create temp table feat007b_correct as
select public.mutate_aircraft_document(
  '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  'correct', '84000000-0000-4000-8000-000000000001',
  (select id from public.aircraft_document_categories where organization_id = '82000000-0000-4000-8000-000000000001' and category_code = 'registration_certificate'),
  (select (result->>'documentId')::uuid from feat007b_create), 5,
  'Corrected Registration', 'Synthetic Authority', null, null, '2027-09-02', null, null,
  'Corrected administrative metadata', repeat('4', 64), repeat('d', 64), '2026-09-02',
  '85000000-0000-4000-8000-000000000009'
) as result;

select is((select result->>'documentState' from feat007b_correct), 'suspended', 'Correction preserves suspended state');
select is((select result->>'currentVersionNumber' from feat007b_correct), '3', 'Correction appends an immutable version');
grant update, delete on public.aircraft_document_versions to service_role;
set local role service_role;
select throws_ok(
  'update public.aircraft_document_versions set document_title = ''Tampered title''',
  'P7201',
  'Aircraft document versions are immutable.',
  'The service role cannot update immutable document history'
);
select throws_ok(
  'delete from public.aircraft_document_versions',
  'P7201',
  'Aircraft document versions are immutable.',
  'The service role cannot delete immutable document history'
);
reset role;
revoke update, delete on public.aircraft_document_versions from service_role;
select ok(
  exists (
    select 1 from public.aircraft_document_events
    where event_name = 'aircraft_document.renewed'
      and metadata->>'priorAggregateVersion' = '3'
      and metadata->>'newAggregateVersion' = '4'
      and metadata->>'priorDocumentVersion' = '1'
      and metadata->>'newDocumentVersion' = '2'
  ),
  'Document mutation audit records prior and new aggregate and immutable version values'
);
select ok(
  exists (
    select 1 from public.aircraft_document_events
    where event_name = 'aircraft_document.notification_resolved'
      and metadata->>'resolutionReason' = 'version_superseded'
  ),
  'Notification resolution is explicit audit evidence'
);
select is(
  jsonb_array_length(public.list_aircraft_document_history(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    (select (result->>'documentId')::uuid from feat007b_create), 2, 1,
    '85000000-0000-4000-8000-000000000022'
  )->'items'),
  1,
  'Document history pagination returns the second page instead of filtering it away'
);
select is(
  public.mutate_aircraft_document(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    'restore', '84000000-0000-4000-8000-000000000001',
    (select id from public.aircraft_document_categories where organization_id = '82000000-0000-4000-8000-000000000001' and category_code = 'registration_certificate'),
    (select (result->>'documentId')::uuid from feat007b_create), 6,
    null, null, null, null, null, null, null, 'Administrative review completed',
    repeat('5', 64), repeat('e', 64), '2026-09-02', '85000000-0000-4000-8000-000000000010'
  )->>'decision',
  'restored',
  'A reasoned restoration succeeds'
);

create temp table feat007b_category as
select public.mutate_aircraft_document_category(
  '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  'create_category', null, null, null, 'Radio Permit', repeat('6', 64), repeat('f', 64),
  '2026-09-02', '85000000-0000-4000-8000-000000000011'
) as result;

select is((select result->>'decision' from feat007b_category), 'category_created', 'Admin creates a custom category');
select is(
  public.lookup_aircraft_document_idempotency(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    'aircraft.document.category.manage', 'create_category', null, null,
    repeat('6', 64), repeat('f', 64)
  )->>'decision',
  'replay',
  'A custom-category create replay is target-independent'
);
create temp table feat007b_assign as
select public.mutate_aircraft_document_category(
  '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  'assign_category', (select (result->>'categoryId')::uuid from feat007b_category),
  '84000000-0000-4000-8000-000000000001', 1, null,
  repeat('7', 64), repeat('1', 64), '2026-09-02', '85000000-0000-4000-8000-000000000012'
) as result;
select is((select result->>'decision' from feat007b_assign), 'category_assigned', 'Custom category assignment is versioned');
select is(
  jsonb_array_length(public.list_aircraft_document_status(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000003', '2026-09-02', '85000000-0000-4000-8000-000000000025'
  )->'availableCustomCategories'),
  1,
  'An Admin can discover an existing custom category that is unassigned to another aircraft'
);
select is(
  public.mutate_aircraft_document_category(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    'remove_category', (select (result->>'categoryId')::uuid from feat007b_category),
    '84000000-0000-4000-8000-000000000001',
    (select (result->>'requirementVersion')::bigint from feat007b_assign), null,
    repeat('8', 64), repeat('2', 64), '2026-09-02', '85000000-0000-4000-8000-000000000013'
  )->>'decision',
  'category_removed',
  'Removing a custom requirement archives rather than deletes it'
);
select is(
  (select requirement_state from public.aircraft_document_requirements
   where id = (select (result->>'requirementId')::uuid from feat007b_assign)),
  'archived',
  'Removed custom requirement evidence remains archived'
);

select is(
  public.stage_aircraft_document_file(
    '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001/84000000-0000-4000-8000-000000000001/86000000-0000-4000-8000-000000000001/86000000-0000-4000-8000-000000000001.pdf',
    'private.pdf', '86000000-0000-4000-8000-000000000001.pdf', 'application/pdf', 100,
    repeat('9', 64), '85000000-0000-4000-8000-000000000014'
  )->>'decision',
  'unauthorized',
  'A Student cannot stage a private attachment'
);
select is(
  public.stage_aircraft_document_file(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001/84000000-0000-4000-8000-000000000001/86000000-0000-4000-8000-000000000001/86000000-0000-4000-8000-000000000001.pdf',
    'private.pdf', '86000000-0000-4000-8000-000000000001.pdf', 'application/pdf', 100,
    repeat('9', 64), '85000000-0000-4000-8000-000000000015'
  )->>'decision',
  'staged',
  'An Admin stages private file metadata without a browser object path choice'
);
select is(
  public.complete_aircraft_document_file(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000001', 'clean', 100, repeat('9', 64),
    '85000000-0000-4000-8000-000000000016'
  )->>'decision',
  'completed',
  'A matching deterministic scan marks the staged file clean'
);
select is(
  public.get_aircraft_document_download_target(
    '81000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000002',
    '86000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000017'
  )->>'decision',
  'not_found',
  'A cross-school file ID does not disclose attachment existence'
);

create temp table feat007b_attach as
select public.mutate_aircraft_document(
  '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  'correct', '84000000-0000-4000-8000-000000000001',
  (select id from public.aircraft_document_categories where organization_id = '82000000-0000-4000-8000-000000000001' and category_code = 'registration_certificate'),
  (select (result->>'documentId')::uuid from feat007b_create), 7,
  'Registration Certificate', 'Synthetic Authority', 'REF-701', '2026-09-01',
  '2026-09-09', 'Synthetic metadata only', '86000000-0000-4000-8000-000000000001',
  'Synthetic attachment correction', repeat('b', 64), repeat('4', 64),
  '2026-09-02', '85000000-0000-4000-8000-000000000020'
) as result;
select is(
  (select result->>'decision' from feat007b_attach),
  'corrected',
  'A clean private file can be linked through a versioned correction'
);
select is(
  public.mutate_aircraft_record(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    'archive', '84000000-0000-4000-8000-000000000001',
    null, null, null, null, 'no_longer_tracked', 1,
    repeat('c', 64), repeat('5', 64), '85000000-0000-4000-8000-000000000021'
  )->>'decision',
  'archived',
  'The containing aircraft can be archived through its protected lifecycle command'
);
select is(
  public.get_aircraft_document_download_target(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000022'
  )->>'decision',
  'not_found',
  'Aircraft archival blocks new signed attachment issuance without disclosing history'
);

create function public.feat007b_reject_audit()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.event_name = 'aircraft_document.created' then
    raise exception using errcode = 'P0001', message = 'synthetic audit failure';
  end if;
  return new;
end;
$$;

create trigger feat007b_reject_audit
before insert on public.aircraft_document_events
for each row execute function public.feat007b_reject_audit();

select throws_ok(
  format(
    'select public.mutate_aircraft_document(%L::uuid,%L::uuid,%L,%L::uuid,%L::uuid,null,null,%L,%L,null,null,%L::date,null,null,null,%L,%L,%L::date,%L::uuid)',
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    'create', '84000000-0000-4000-8000-000000000003',
    (select id from public.aircraft_document_categories where organization_id = '82000000-0000-4000-8000-000000000001' and category_code = 'insurance'),
    'Insurance', 'Synthetic Authority', '2027-09-02', repeat('a', 64), repeat('3', 64),
    '2026-09-02', '85000000-0000-4000-8000-000000000018'
  ),
  'P7101',
  'Aircraft document audit write failed.',
  'Audit failure aborts an atomic document mutation'
);
select is(
  (select count(*)::integer from public.aircraft_documents document
   join public.aircraft_document_categories category on category.organization_id = document.organization_id and category.id = document.category_id
   where document.organization_id = '82000000-0000-4000-8000-000000000001' and category.category_code = 'insurance'),
  0,
  'Audit failure rolls back the document and version state'
);

drop trigger feat007b_reject_audit on public.aircraft_document_events;
drop function public.feat007b_reject_audit();

-- Model a job that selected the old version before a concurrent correction.
select public.mutate_aircraft_record(
  '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  'reactivate', '84000000-0000-4000-8000-000000000001',
  null, null, null, null, 'tracking_resumed', 2,
  repeat('d', 64), repeat('6', 64), '85000000-0000-4000-8000-000000000030'
);
select public.sync_aircraft_document_notifications(
  '82000000-0000-4000-8000-000000000001',
  (select (result->>'documentId')::uuid from feat007b_attach),
  (select (result->>'currentVersionId')::uuid from feat007b_attach),
  '2026-09-02', '81000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000031'
);
select is(
  public.sync_aircraft_document_notifications(
    '82000000-0000-4000-8000-000000000001',
    (select (result->>'documentId')::uuid from feat007b_create),
    (select (result->>'currentVersionId')::uuid from feat007b_create),
    '2026-09-02', '81000000-0000-4000-8000-000000000001',
    '85000000-0000-4000-8000-000000000032'
  )->>'decision',
  'skipped',
  'A stale job snapshot is skipped after a new version becomes current'
);
select is(
  (select count(*)::integer from public.aircraft_document_notifications
   where document_version_id = (select (result->>'currentVersionId')::uuid from feat007b_attach)
     and notification_state = 'open'),
  1,
  'A stale job snapshot preserves the replacement version alert'
);

select * from finish();
rollback;
