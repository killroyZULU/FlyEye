-- Rollback-only profile/notification scope and mandatory-audit regressions.
begin;
set constraints organizations_single_school_deployment_key deferred;
set constraints organization_memberships_single_school_user_key deferred;
select plan(22);

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
  values('e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000009','e0300000-0000-4000-8000-000000000003','e0300000-0000-4000-8000-000000000003');insert into public.aircraft_documents(
  id,organization_id,aircraft_record_id,category_id,current_version_id,created_by,updated_by)
  values('e0300000-0000-4000-8000-000000000010','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000008','e0300000-0000-4000-8000-000000000009','e0300000-0000-4000-8000-000000000011','e0300000-0000-4000-8000-000000000003','e0300000-0000-4000-8000-000000000003');
  insert into public.aircraft_document_versions(id,organization_id,aircraft_document_id,version_number,version_kind,
    category_code,category_label,document_title,document_source,expiration_date,created_by)
  values('e0300000-0000-4000-8000-000000000011','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000010',1,'create','custom_h002','Synthetic review',
    'Synthetic document','Synthetic source','2026-10-04'::date,'e0300000-0000-4000-8000-000000000003');
  insert into public.aircraft_document_notifications(id,organization_id,recipient_membership_id,
    aircraft_document_id,document_version_id,event_kind,due_date)
  values('e0300000-0000-4000-8000-000000000013','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000004','e0300000-0000-4000-8000-000000000010','e0300000-0000-4000-8000-000000000011','warning','2026-09-27'::date);
insert into auth.users(id,email) values('e0330000-0000-4000-8000-000000000082','sec033-other@example.test');
insert into public.organizations(id,name,status) values('e0330000-0000-4000-8000-000000000081','Synthetic other school','active');
insert into public.organization_memberships(id,organization_id,user_id,status,created_by,updated_by) values('e0330000-0000-4000-8000-000000000083','e0330000-0000-4000-8000-000000000081','e0330000-0000-4000-8000-000000000082','active','e0330000-0000-4000-8000-000000000082','e0330000-0000-4000-8000-000000000082');
insert into public.membership_roles(organization_id,membership_id,role_id,assigned_by) select 'e0330000-0000-4000-8000-000000000081','e0330000-0000-4000-8000-000000000083',id,'e0330000-0000-4000-8000-000000000082' from public.roles where code='admin';
create function pg_temp.sec033_snapshot() returns jsonb language sql as $snapshot$
select jsonb_build_object('aircraft_records',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_records t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'aircraft_registry_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'aircraft_registry_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'aircraft_documents',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_documents t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'aircraft_document_versions',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_versions t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'aircraft_document_requirements',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_requirements t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'aircraft_document_categories',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_categories t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'aircraft_document_notifications',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_notifications t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'aircraft_document_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'stored_files',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.stored_files t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'aircraft_document_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'organization_member_profiles',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.organization_member_profiles t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'member_administration_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.member_administration_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'organization_memberships',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.organization_memberships t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')),'membership_roles',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.membership_roles t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0330000-0000-4000-8000-000000000081')));
$snapshot$;
create temp table sec033_before as select pg_temp.sec033_snapshot() as value;
select ok(not has_function_privilege('anon','public.update_my_member_profile(uuid,uuid,text,text,bigint,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.update_my_member_profile(uuid,uuid,text,text,bigint,uuid)','EXECUTE') and has_function_privilege('service_role','public.update_my_member_profile(uuid,uuid,text,text,bigint,uuid)','EXECUTE'),'public.update_my_member_profile remains service-only');
select ok(not has_function_privilege('anon','public.open_aircraft_document_notification(uuid,uuid,uuid,uuid,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.open_aircraft_document_notification(uuid,uuid,uuid,uuid,uuid)','EXECUTE') and has_function_privilege('service_role','public.open_aircraft_document_notification(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'public.open_aircraft_document_notification remains service-only');
select is((public.update_my_member_profile('e0330000-0000-4000-8000-000000000082','e0300000-0000-4000-8000-000000000004','  Synthetic updated  ',' +63 9000000000 ',1,'e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','not_found','correlationId','e0300000-0000-4000-8000-000000000016'),'profile: foreign actor');
select is((public.update_my_member_profile('e0300000-0000-4000-8000-000000000002','e0330000-0000-4000-8000-000000000083','  Synthetic updated  ',' +63 9000000000 ',1,'e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','not_found','correlationId','e0300000-0000-4000-8000-000000000016'),'profile: foreign membership');
select is((public.open_aircraft_document_notification('e0330000-0000-4000-8000-000000000082','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000004','e0300000-0000-4000-8000-000000000013','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','unauthorized','correlationId','e0300000-0000-4000-8000-000000000016'),'notification: foreign actor');
select is((public.open_aircraft_document_notification('e0300000-0000-4000-8000-000000000002','e0330000-0000-4000-8000-000000000081','e0300000-0000-4000-8000-000000000004','e0300000-0000-4000-8000-000000000013','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','unauthorized','correlationId','e0300000-0000-4000-8000-000000000016'),'notification: forged organization');
select is((public.open_aircraft_document_notification('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000005','e0300000-0000-4000-8000-000000000013','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','unauthorized','correlationId','e0300000-0000-4000-8000-000000000016'),'notification: foreign recipient');
select is((public.open_aircraft_document_notification('e0330000-0000-4000-8000-000000000082','e0330000-0000-4000-8000-000000000081','e0330000-0000-4000-8000-000000000083','e0300000-0000-4000-8000-000000000013','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','not_found','correlationId','e0300000-0000-4000-8000-000000000016'),'notification: foreign target');
select is((public.open_aircraft_document_notification('e0300000-0000-4000-8000-000000000006','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000007','e0300000-0000-4000-8000-000000000013','e0300000-0000-4000-8000-000000000016')),jsonb_build_object('decision','unauthorized','correlationId','e0300000-0000-4000-8000-000000000016'),'notification: insufficient role');
select is(pg_temp.sec033_snapshot(),(select value from sec033_before),'Denials preserve both schools');
create function pg_temp.sec033_fail_audit() returns trigger language plpgsql as $fault$
begin raise exception 'Synthetic audit fault'; end;
$fault$;
create trigger sec033_profile_audit before insert on public.member_administration_events for each row execute function pg_temp.sec033_fail_audit();
create trigger sec033_notification_audit before insert on public.aircraft_document_events for each row execute function pg_temp.sec033_fail_audit();
update public.organization_member_profiles set display_name=null,contact_number=null where membership_id='e0300000-0000-4000-8000-000000000004';
update sec033_before set value=pg_temp.sec033_snapshot();
select throws_ok($call$select public.update_my_member_profile('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000004','  Synthetic updated  ',' +63 9000000000 ',1,'e0300000-0000-4000-8000-000000000016');$call$,'P5005','Member administration audit write failed.','profile complete: audit failure propagates');
select is(pg_temp.sec033_snapshot(),(select value from sec033_before),'profile complete: audit failure rolls back all effects');
update public.organization_member_profiles set display_name='Synthetic updated',contact_number='+63 9000000000' where membership_id='e0300000-0000-4000-8000-000000000004';
update sec033_before set value=pg_temp.sec033_snapshot();
select throws_ok($call$select public.update_my_member_profile('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000004','  Synthetic updated  ','  ',1,'e0300000-0000-4000-8000-000000000016');$call$,'P5005','Member administration audit write failed.','profile clear: audit failure propagates');
select is(pg_temp.sec033_snapshot(),(select value from sec033_before),'profile clear: audit failure rolls back all effects');
update public.organization_member_profiles set display_name='Synthetic updated',contact_number='+63 9000000000' where membership_id='e0300000-0000-4000-8000-000000000004';
update sec033_before set value=pg_temp.sec033_snapshot();
select throws_ok($call$select public.update_my_member_profile('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000004','  Synthetic updated  ',' +63 9000000000 ',1,'e0300000-0000-4000-8000-000000000016');$call$,'P5005','Member administration audit write failed.','profile unchanged: audit failure propagates');
select is(pg_temp.sec033_snapshot(),(select value from sec033_before),'profile unchanged: audit failure rolls back all effects');
update public.aircraft_document_notifications set notification_state='open',read_at=null,resolved_at=null,resolution_reason=null where id='e0300000-0000-4000-8000-000000000013';
update sec033_before set value=pg_temp.sec033_snapshot();
select throws_ok($call$select public.open_aircraft_document_notification('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000004','e0300000-0000-4000-8000-000000000013','e0300000-0000-4000-8000-000000000016');$call$,'P7101','Aircraft document audit write failed.','notification open: audit failure propagates');
select is(pg_temp.sec033_snapshot(),(select value from sec033_before),'notification open: audit failure rolls back all effects');
update public.aircraft_document_notifications set notification_state='read',read_at='2026-10-01',resolved_at=null,resolution_reason=null where id='e0300000-0000-4000-8000-000000000013';
update sec033_before set value=pg_temp.sec033_snapshot();
select throws_ok($call$select public.open_aircraft_document_notification('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000004','e0300000-0000-4000-8000-000000000013','e0300000-0000-4000-8000-000000000016');$call$,'P7101','Aircraft document audit write failed.','notification read: audit failure propagates');
select is(pg_temp.sec033_snapshot(),(select value from sec033_before),'notification read: audit failure rolls back all effects');
update public.aircraft_document_notifications set notification_state='resolved',read_at=null,resolved_at='2026-10-01',resolution_reason='suspended' where id='e0300000-0000-4000-8000-000000000013';
update sec033_before set value=pg_temp.sec033_snapshot();
select throws_ok($call$select public.open_aircraft_document_notification('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000004','e0300000-0000-4000-8000-000000000013','e0300000-0000-4000-8000-000000000016');$call$,'P7101','Aircraft document audit write failed.','notification resolved: audit failure propagates');
select is(pg_temp.sec033_snapshot(),(select value from sec033_before),'notification resolved: audit failure rolls back all effects');
select * from finish();
rollback;
