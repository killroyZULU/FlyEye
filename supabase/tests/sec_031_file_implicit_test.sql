-- Rollback-only School A/School B boundary and mandatory file-audit evidence.
begin;
set constraints organizations_single_school_deployment_key deferred;
set constraints organization_memberships_single_school_user_key deferred;
select no_plan();

  insert into auth.users(id,email) values
    ('e0300000-0000-4000-8000-000000000002','h002-review-actor@example.test'),
    ('e0300000-0000-4000-8000-000000000003','h002-review-admin@example.test'),
    ('e0300000-0000-4000-8000-000000000006','h002-review-target@example.test');
  insert into public.organizations(id,name,status) values('e0300000-0000-4000-8000-000000000001','Synthetic H002 review','active');
  insert into public.organization_memberships(id,organization_id,user_id,status,created_by,updated_by)
  values ('e0300000-0000-4000-8000-000000000004','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000002','active','e0300000-0000-4000-8000-000000000003','e0300000-0000-4000-8000-000000000003'),
    ('e0300000-0000-4000-8000-000000000005','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000003','active','e0300000-0000-4000-8000-000000000003','e0300000-0000-4000-8000-000000000003'),
    ('e0300000-0000-4000-8000-000000000007','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000006','active','e0300000-0000-4000-8000-000000000003','e0300000-0000-4000-8000-000000000003');
  insert into public.membership_roles(organization_id,membership_id,role_id,assigned_by)
  select 'e0300000-0000-4000-8000-000000000001',m.id,r.id,'e0300000-0000-4000-8000-000000000003' from public.organization_memberships m
  join public.roles r on r.code=case when m.id='e0300000-0000-4000-8000-000000000007' then 'instructor_pilot' else 'admin' end
  where m.organization_id='e0300000-0000-4000-8000-000000000001';
  insert into public.aircraft_document_categories(id,organization_id,category_code,category_label,category_kind,created_by,updated_by)
  values('e0300000-0000-4000-8000-000000000009','e0300000-0000-4000-8000-000000000001','custom_h002','Synthetic review','custom','e0300000-0000-4000-8000-000000000003','e0300000-0000-4000-8000-000000000003');
insert into public.aircraft_records(
  id,organization_id,registration_mark,registration_key,manufacturer,model,created_by,updated_by)
  values('e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000001','SYN-H003','synh003','Synthetic','Model','e0300000-0000-4000-8000-000000000003','e0300000-0000-4000-8000-000000000003');
  insert into public.aircraft_document_requirements(organization_id,aircraft_record_id,category_id,created_by,updated_by)
  values('e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000009','e0300000-0000-4000-8000-000000000003','e0300000-0000-4000-8000-000000000003');insert into public.stored_files(
  id,organization_id,aircraft_record_id,object_key,display_name,generated_name,media_type,size_bytes,sha256_hash,scan_state,uploader_user_id)
  values('e0300000-0000-4000-8000-000000000012','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000001/e0300000-0000-4000-8000-000000000008/e0300000-0000-4000-8000-000000000012/e0300000-0000-4000-8000-000000000012.pdf',
  'Synthetic.pdf','e0300000-0000-4000-8000-000000000012.pdf','application/pdf',10,repeat('a',64),'clean','e0300000-0000-4000-8000-000000000002');
    insert into public.aircraft_documents(id,organization_id,aircraft_record_id,category_id,
      current_version_id,created_by,updated_by)
    values('e0300000-0000-4000-8000-000000000010','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000009','e0300000-0000-4000-8000-000000000011','e0300000-0000-4000-8000-000000000003','e0300000-0000-4000-8000-000000000003');
    insert into public.aircraft_document_versions(id,organization_id,aircraft_document_id,version_number,
      version_kind,category_code,category_label,document_title,document_source,expiration_date,stored_file_id,created_by)
    values('e0300000-0000-4000-8000-000000000011','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000010',1,'create','custom_h002','Synthetic review',
      'Synthetic document','Synthetic source',current_date+3,'e0300000-0000-4000-8000-000000000012','e0300000-0000-4000-8000-000000000003');
insert into public.stored_files(
  id,organization_id,aircraft_record_id,object_key,display_name,generated_name,media_type,size_bytes,sha256_hash,scan_state,uploader_user_id)
  values('e0300000-0000-4000-8000-000000000092','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000001/e0300000-0000-4000-8000-000000000008/e0300000-0000-4000-8000-000000000092/e0300000-0000-4000-8000-000000000092.pdf',
  'Synthetic.pdf','e0300000-0000-4000-8000-000000000092.pdf','application/pdf',10,repeat('a',64),'staged','e0300000-0000-4000-8000-000000000002');
insert into auth.users(id,email) values('e0310000-0000-4000-8000-000000000002','sec031-other@example.test');
insert into public.organizations(id,name,status) values('e0310000-0000-4000-8000-000000000001','Synthetic other school','active');
insert into public.organization_memberships(id,organization_id,user_id,status,created_by,updated_by)
values('e0310000-0000-4000-8000-000000000003','e0310000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000002','active','e0310000-0000-4000-8000-000000000002','e0310000-0000-4000-8000-000000000002');
insert into public.membership_roles(organization_id,membership_id,role_id,assigned_by)
select 'e0310000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000003',id,'e0310000-0000-4000-8000-000000000002' from public.roles where code='admin';
create temp table sec031_before as select jsonb_build_object('aircraft_records',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_records t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_documents',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_documents t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_versions',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_versions t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_requirements',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_requirements t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_categories',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_categories t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_notifications',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_notifications t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'stored_files',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.stored_files t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001'))) as value;

select ok(not has_function_privilege('anon','public.stage_aircraft_document_file(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.stage_aircraft_document_file(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text,uuid)','EXECUTE')
 and has_function_privilege('service_role','public.stage_aircraft_document_file(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text,uuid)','EXECUTE'),
 'public.stage_aircraft_document_file retains service-only execution');

select ok(not has_function_privilege('anon','public.complete_aircraft_document_file(uuid,uuid,uuid,text,bigint,text,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.complete_aircraft_document_file(uuid,uuid,uuid,text,bigint,text,uuid)','EXECUTE')
 and has_function_privilege('service_role','public.complete_aircraft_document_file(uuid,uuid,uuid,text,bigint,text,uuid)','EXECUTE'),
 'public.complete_aircraft_document_file retains service-only execution');

select ok(not has_function_privilege('anon','public.confirm_aircraft_document_download_issued(uuid,uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.confirm_aircraft_document_download_issued(uuid,uuid,uuid,uuid)','EXECUTE')
 and has_function_privilege('service_role','public.confirm_aircraft_document_download_issued(uuid,uuid,uuid,uuid)','EXECUTE'),
 'public.confirm_aircraft_document_download_issued retains service-only execution');

select is((public.stage_aircraft_document_file('e0310000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000012',
    'e0300000-0000-4000-8000-000000000001/e0300000-0000-4000-8000-000000000008/e0300000-0000-4000-8000-000000000012/e0300000-0000-4000-8000-000000000012.pdf','Synthetic.pdf','e0300000-0000-4000-8000-000000000012.pdf','application/pdf',10,repeat('a',64),'e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'unauthorized', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'stage: foreign actor with School A scope');

select is((public.stage_aircraft_document_file('e0300000-0000-4000-8000-000000000002','e0310000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000012',
    'e0300000-0000-4000-8000-000000000001/e0300000-0000-4000-8000-000000000008/e0300000-0000-4000-8000-000000000012/e0300000-0000-4000-8000-000000000012.pdf','Synthetic.pdf','e0300000-0000-4000-8000-000000000012.pdf','application/pdf',10,repeat('a',64),'e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'unauthorized', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'stage: School A actor with forged School B scope');

select is((public.stage_aircraft_document_file('e0310000-0000-4000-8000-000000000002','e0310000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000012',
    'e0300000-0000-4000-8000-000000000001/e0300000-0000-4000-8000-000000000008/e0300000-0000-4000-8000-000000000012/e0300000-0000-4000-8000-000000000012.pdf','Synthetic.pdf','e0300000-0000-4000-8000-000000000012.pdf','application/pdf',10,repeat('a',64),'e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'not_found', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'stage: School B Admin cannot discover a School A target');

select is((public.stage_aircraft_document_file('e0300000-0000-4000-8000-000000000006','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000012',
    'e0300000-0000-4000-8000-000000000001/e0300000-0000-4000-8000-000000000008/e0300000-0000-4000-8000-000000000012/e0300000-0000-4000-8000-000000000012.pdf','Synthetic.pdf','e0300000-0000-4000-8000-000000000012.pdf','application/pdf',10,repeat('a',64),'e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'unauthorized', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'stage: Instructor cannot operate on private files');

select is((public.complete_aircraft_document_file('e0310000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000012',
    'clean',10,
    repeat('a',64),'e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'unauthorized', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'complete: foreign actor with School A scope');

select is((public.complete_aircraft_document_file('e0300000-0000-4000-8000-000000000002','e0310000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000012',
    'clean',10,
    repeat('a',64),'e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'unauthorized', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'complete: School A actor with forged School B scope');

select is((public.complete_aircraft_document_file('e0310000-0000-4000-8000-000000000002','e0310000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000012',
    'clean',10,
    repeat('a',64),'e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'not_found', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'complete: School B Admin cannot discover a School A target');

select is((public.complete_aircraft_document_file('e0300000-0000-4000-8000-000000000006','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000012',
    'clean',10,
    repeat('a',64),'e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'unauthorized', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'complete: Instructor cannot operate on private files');

select is((public.confirm_aircraft_document_download_issued('e0310000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000012','e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'unauthorized', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'download: foreign actor with School A scope');

select is((public.confirm_aircraft_document_download_issued('e0300000-0000-4000-8000-000000000002','e0310000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000012','e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'unauthorized', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'download: School A actor with forged School B scope');

select is((public.confirm_aircraft_document_download_issued('e0310000-0000-4000-8000-000000000002','e0310000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000012','e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'not_found', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'download: School B Admin cannot discover a School A target');

select is((public.confirm_aircraft_document_download_issued('e0300000-0000-4000-8000-000000000006','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000012','e0300000-0000-4000-8000-000000000016')), jsonb_build_object('decision', 'unauthorized', 'correlationId', 'e0300000-0000-4000-8000-000000000016'), 'download: Instructor cannot operate on private files');

select is(jsonb_build_object('aircraft_records',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_records t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_documents',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_documents t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_versions',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_versions t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_requirements',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_requirements t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_categories',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_categories t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_notifications',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_notifications t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'stored_files',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.stored_files t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001'))),(select value from sec031_before),'All denied calls preserve both schools domain and audit state');

select is((public.stage_aircraft_document_file('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000012',
    'e0300000-0000-4000-8000-000000000001/e0300000-0000-4000-8000-000000000008/e0300000-0000-4000-8000-000000000012/e0300000-0000-4000-8000-000000000012.pdf','Synthetic.pdf','e0300000-0000-4000-8000-000000000012.pdf','application/pdf',10,repeat('a',64),'e0300000-0000-4000-8000-000000000016'))->>'decision','staged','stage: existing clean file replay remains valid');

select is((public.complete_aircraft_document_file('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000012',
    'clean',10,
    repeat('a',64),'e0300000-0000-4000-8000-000000000016'))->>'decision','completed','complete: existing clean file replay remains valid');
select is(jsonb_build_object('aircraft_records',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_records t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_documents',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_documents t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_versions',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_versions t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_requirements',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_requirements t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_categories',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_categories t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_notifications',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_notifications t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'stored_files',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.stored_files t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001'))),(select value from sec031_before),'Clean replays add no file or audit writes');

create function public.sec031_reject_file_audit() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if new.target_type = 'file' then
    raise exception using errcode = 'P0001', message = 'synthetic file audit failure';
  end if;
  return new;
end;
$$;
create trigger sec031_reject_file_audit before insert on public.aircraft_document_events
for each row execute function public.sec031_reject_file_audit();

select throws_ok('select public.stage_aircraft_document_file(''e0300000-0000-4000-8000-000000000002'',''e0300000-0000-4000-8000-000000000001'',''e0300000-0000-4000-8000-000000000008'',''e0300000-0000-4000-8000-000000000093'',
    ''e0300000-0000-4000-8000-000000000001/e0300000-0000-4000-8000-000000000008/e0300000-0000-4000-8000-000000000093/e0300000-0000-4000-8000-000000000093.pdf'',''Synthetic.pdf'',''e0300000-0000-4000-8000-000000000093.pdf'',''application/pdf'',10,repeat(''a'',64),''e0300000-0000-4000-8000-000000000016'');','P7101','Aircraft document audit write failed.','stage: mandatory audit failure propagates');
select is(jsonb_build_object('aircraft_records',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_records t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_documents',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_documents t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_versions',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_versions t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_requirements',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_requirements t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_categories',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_categories t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_notifications',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_notifications t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'stored_files',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.stored_files t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001'))),(select value from sec031_before),'stage: audit failure leaves complete file/document/audit state unchanged');

select throws_ok('select public.complete_aircraft_document_file(''e0300000-0000-4000-8000-000000000002'',''e0300000-0000-4000-8000-000000000001'',''e0300000-0000-4000-8000-000000000092'',
    ''clean'',10,
    repeat(''a'',64),''e0300000-0000-4000-8000-000000000016'');','P7101','Aircraft document audit write failed.','complete: mandatory audit failure propagates');
select is(jsonb_build_object('aircraft_records',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_records t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_documents',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_documents t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_versions',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_versions t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_requirements',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_requirements t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_categories',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_categories t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_notifications',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_notifications t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'stored_files',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.stored_files t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001'))),(select value from sec031_before),'complete: audit failure leaves complete file/document/audit state unchanged');

select throws_ok('select public.confirm_aircraft_document_download_issued(''e0300000-0000-4000-8000-000000000002'',''e0300000-0000-4000-8000-000000000001'',''e0300000-0000-4000-8000-000000000012'',''e0300000-0000-4000-8000-000000000016'');','P7101','Aircraft document audit write failed.','download: mandatory audit failure propagates');
select is(jsonb_build_object('aircraft_records',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_records t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_registry_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_documents',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_documents t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_versions',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_versions t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_requirements',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_requirements t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_categories',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_categories t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_notifications',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_notifications t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'aircraft_document_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001')),'stored_files',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.stored_files t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0310000-0000-4000-8000-000000000001'))),(select value from sec031_before),'download: audit failure leaves complete file/document/audit state unchanged');

select * from finish();
rollback;
