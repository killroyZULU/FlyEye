-- Rollback-only document/category scope and mandatory-audit tests.
begin;
set constraints organizations_single_school_deployment_key deferred;
set constraints organization_memberships_single_school_user_key deferred;
select plan(15);

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
  values('e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000009','e0300000-0000-4000-8000-000000000003','e0300000-0000-4000-8000-000000000003');
insert into public.stored_files(
  id,organization_id,aircraft_record_id,object_key,display_name,generated_name,media_type,size_bytes,sha256_hash,scan_state,uploader_user_id)
  values('e0300000-0000-4000-8000-000000000012','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000001/e0300000-0000-4000-8000-000000000008/e0300000-0000-4000-8000-000000000012/e0300000-0000-4000-8000-000000000012.pdf',
  'Synthetic.pdf','e0300000-0000-4000-8000-000000000012.pdf','application/pdf',10,repeat('a',64),'clean','e0300000-0000-4000-8000-000000000002');
insert into auth.users(id,email) values('e0320000-0000-4000-8000-000000000082','sec032-other@example.test');
insert into public.organizations(id,name,status) values('e0320000-0000-4000-8000-000000000081','Synthetic other school','active');
insert into public.organization_memberships(id,organization_id,user_id,status,created_by,updated_by)
values('e0320000-0000-4000-8000-000000000083','e0320000-0000-4000-8000-000000000081','e0320000-0000-4000-8000-000000000082','active','e0320000-0000-4000-8000-000000000082','e0320000-0000-4000-8000-000000000082');
insert into public.membership_roles(organization_id,membership_id,role_id,assigned_by)
select 'e0320000-0000-4000-8000-000000000081','e0320000-0000-4000-8000-000000000083',id,'e0320000-0000-4000-8000-000000000082' from public.roles where code='admin';
create function pg_temp.sec032_snapshot() returns jsonb language sql as $snapshot$
select jsonb_build_object('aircraft_records',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_records t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0320000-0000-4000-8000-000000000081')),'aircraft_registry_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0320000-0000-4000-8000-000000000081')),'aircraft_registry_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0320000-0000-4000-8000-000000000081')),'aircraft_documents',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_documents t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0320000-0000-4000-8000-000000000081')),'aircraft_document_versions',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_versions t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0320000-0000-4000-8000-000000000081')),'aircraft_document_requirements',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_requirements t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0320000-0000-4000-8000-000000000081')),'aircraft_document_categories',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_categories t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0320000-0000-4000-8000-000000000081')),'aircraft_document_notifications',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_notifications t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0320000-0000-4000-8000-000000000081')),'aircraft_document_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0320000-0000-4000-8000-000000000081')),'stored_files',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.stored_files t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0320000-0000-4000-8000-000000000081')),'aircraft_document_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0320000-0000-4000-8000-000000000081')));
$snapshot$;
create temp table sec032_before as select pg_temp.sec032_snapshot() as value;
select ok(not has_function_privilege('anon','public.mutate_aircraft_document(uuid,uuid,text,uuid,uuid,uuid,bigint,text,text,text,date,date,text,uuid,text,text,text,date,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.mutate_aircraft_document(uuid,uuid,text,uuid,uuid,uuid,bigint,text,text,text,date,date,text,uuid,text,text,text,date,uuid)','EXECUTE') and has_function_privilege('service_role','public.mutate_aircraft_document(uuid,uuid,text,uuid,uuid,uuid,bigint,text,text,text,date,date,text,uuid,text,text,text,date,uuid)','EXECUTE'),'public.mutate_aircraft_document remains service-only');
select ok(not has_function_privilege('anon','public.mutate_aircraft_document_category(uuid,uuid,text,uuid,uuid,bigint,text,text,text,date,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.mutate_aircraft_document_category(uuid,uuid,text,uuid,uuid,bigint,text,text,text,date,uuid)','EXECUTE') and has_function_privilege('service_role','public.mutate_aircraft_document_category(uuid,uuid,text,uuid,uuid,bigint,text,text,text,date,uuid)','EXECUTE'),'public.mutate_aircraft_document_category remains service-only');
select is((public.mutate_aircraft_document('e0320000-0000-4000-8000-000000000082','e0300000-0000-4000-8000-000000000001','create','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000009',
    null,null,'Synthetic next document','Synthetic next source','SYN-REF','2026-09-01','2026-12-31','Synthetic note','e0300000-0000-4000-8000-000000000012',
    null,repeat('a',64),repeat('b',64),'2026-10-01','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','unauthorized','correlationId','e0300000-0000-4000-8000-000000000016'),'document: foreign actor');
select is((public.mutate_aircraft_document('e0300000-0000-4000-8000-000000000002','e0320000-0000-4000-8000-000000000081','create','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000009',
    null,null,'Synthetic next document','Synthetic next source','SYN-REF','2026-09-01','2026-12-31','Synthetic note','e0300000-0000-4000-8000-000000000012',
    null,repeat('a',64),repeat('b',64),'2026-10-01','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','unauthorized','correlationId','e0300000-0000-4000-8000-000000000016'),'document: forged scope');
select is((public.mutate_aircraft_document('e0320000-0000-4000-8000-000000000082','e0320000-0000-4000-8000-000000000081','create','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000009',
    null,null,'Synthetic next document','Synthetic next source','SYN-REF','2026-09-01','2026-12-31','Synthetic note','e0300000-0000-4000-8000-000000000012',
    null,repeat('a',64),repeat('b',64),'2026-10-01','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','not_found','correlationId','e0300000-0000-4000-8000-000000000016'),'document: foreign target');
select is((public.mutate_aircraft_document('e0300000-0000-4000-8000-000000000006','e0300000-0000-4000-8000-000000000001','create','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000009',
    null,null,'Synthetic next document','Synthetic next source','SYN-REF','2026-09-01','2026-12-31','Synthetic note','e0300000-0000-4000-8000-000000000012',
    null,repeat('a',64),repeat('b',64),'2026-10-01','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','unauthorized','correlationId','e0300000-0000-4000-8000-000000000016'),'document: instructor');
select is((public.mutate_aircraft_document_category('e0320000-0000-4000-8000-000000000082','e0300000-0000-4000-8000-000000000001','rename_category',
    'e0300000-0000-4000-8000-000000000009',
    null,
    1,
    'Synthetic next category',
    repeat('a',64),repeat('b',64),'2026-10-01','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','unauthorized','correlationId','e0300000-0000-4000-8000-000000000016'),'category: foreign actor');
select is((public.mutate_aircraft_document_category('e0300000-0000-4000-8000-000000000002','e0320000-0000-4000-8000-000000000081','rename_category',
    'e0300000-0000-4000-8000-000000000009',
    null,
    1,
    'Synthetic next category',
    repeat('a',64),repeat('b',64),'2026-10-01','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','unauthorized','correlationId','e0300000-0000-4000-8000-000000000016'),'category: forged scope');
select is((public.mutate_aircraft_document_category('e0320000-0000-4000-8000-000000000082','e0320000-0000-4000-8000-000000000081','rename_category',
    'e0300000-0000-4000-8000-000000000009',
    null,
    1,
    'Synthetic next category',
    repeat('a',64),repeat('b',64),'2026-10-01','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','not_found','correlationId','e0300000-0000-4000-8000-000000000016'),'category: foreign target');
select is((public.mutate_aircraft_document_category('e0300000-0000-4000-8000-000000000006','e0300000-0000-4000-8000-000000000001','rename_category',
    'e0300000-0000-4000-8000-000000000009',
    null,
    1,
    'Synthetic next category',
    repeat('a',64),repeat('b',64),'2026-10-01','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','unauthorized','correlationId','e0300000-0000-4000-8000-000000000016'),'category: instructor');
select is(pg_temp.sec032_snapshot(),(select value from sec032_before),'Denied calls preserve both schools');
create function pg_temp.sec032_fail_audit() returns trigger language plpgsql as $fault$
begin
  if new.organization_id='e0300000-0000-4000-8000-000000000001' then raise exception 'Synthetic audit fault'; end if;
  return new;
end;
$fault$;
create trigger sec032_fail_audit before insert on public.aircraft_document_events for each row execute function pg_temp.sec032_fail_audit();
select throws_ok($call$select public.mutate_aircraft_document('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','create','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000009',
    null,null,'Synthetic next document','Synthetic next source','SYN-REF','2026-09-01','2026-12-31','Synthetic note','e0300000-0000-4000-8000-000000000012',
    null,repeat('a',64),repeat('b',64),'2026-10-01','e0300000-0000-4000-8000-000000000016');$call$,'P7101','Aircraft document audit write failed.','document: mandatory audit failure propagates');
select is(pg_temp.sec032_snapshot(),(select value from sec032_before),'document: audit failure rolls back all effects');
select throws_ok($call$select public.mutate_aircraft_document_category('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','rename_category',
    'e0300000-0000-4000-8000-000000000009',
    null,
    1,
    'Synthetic next category',
    repeat('a',64),repeat('b',64),'2026-10-01','e0300000-0000-4000-8000-000000000016');$call$,'P7101','Aircraft document audit write failed.','category: mandatory audit failure propagates');
select is(pg_temp.sec032_snapshot(),(select value from sec032_before),'category: audit failure rolls back all effects');
select * from finish();
rollback;
