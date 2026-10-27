-- Rollback-only audited read scope and mandatory-audit evidence.
begin;
set constraints organizations_single_school_deployment_key deferred;
set constraints organization_memberships_single_school_user_key deferred;
select plan(21);

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
insert into auth.users(id,email) values('e0340000-0000-4000-8000-000000000082','sec034-other@example.test');
insert into public.organizations(id,name,status) values('e0340000-0000-4000-8000-000000000081','Synthetic other school','active');
insert into public.organization_memberships(id,organization_id,user_id,status,created_by,updated_by) values('e0340000-0000-4000-8000-000000000083','e0340000-0000-4000-8000-000000000081','e0340000-0000-4000-8000-000000000082','active','e0340000-0000-4000-8000-000000000082','e0340000-0000-4000-8000-000000000082');
insert into public.membership_roles(organization_id,membership_id,role_id,assigned_by) select 'e0340000-0000-4000-8000-000000000081','e0340000-0000-4000-8000-000000000083',id,'e0340000-0000-4000-8000-000000000082' from public.roles where code='admin';
select is(has_function_privilege('anon','public.list_organization_members(uuid,uuid,uuid,text,text,timestamptz,uuid,integer)','EXECUTE'),false,'public.list_organization_members execute boundary: anon');
select is(has_function_privilege('authenticated','public.list_organization_members(uuid,uuid,uuid,text,text,timestamptz,uuid,integer)','EXECUTE'),false,'public.list_organization_members execute boundary: authenticated');
select is(has_function_privilege('service_role','public.list_organization_members(uuid,uuid,uuid,text,text,timestamptz,uuid,integer)','EXECUTE'),true,'public.list_organization_members execute boundary: service_role');
select is(has_function_privilege('anon','public.get_organization_member(uuid,uuid,uuid,uuid)','EXECUTE'),false,'public.get_organization_member execute boundary: anon');
select is(has_function_privilege('authenticated','public.get_organization_member(uuid,uuid,uuid,uuid)','EXECUTE'),false,'public.get_organization_member execute boundary: authenticated');
select is(has_function_privilege('service_role','public.get_organization_member(uuid,uuid,uuid,uuid)','EXECUTE'),true,'public.get_organization_member execute boundary: service_role');
select is(has_function_privilege('anon','public.get_my_member_profile(uuid,uuid,uuid)','EXECUTE'),false,'public.get_my_member_profile execute boundary: anon');
select is(has_function_privilege('authenticated','public.get_my_member_profile(uuid,uuid,uuid)','EXECUTE'),false,'public.get_my_member_profile execute boundary: authenticated');
select is(has_function_privilege('service_role','public.get_my_member_profile(uuid,uuid,uuid)','EXECUTE'),true,'public.get_my_member_profile execute boundary: service_role');
create function pg_temp.sec034_snapshot() returns jsonb language sql as $snapshot$
select jsonb_build_object('aircraft_records',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_records t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'aircraft_registry_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'aircraft_registry_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_registry_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'aircraft_documents',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_documents t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'aircraft_document_versions',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_versions t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'aircraft_document_requirements',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_requirements t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'aircraft_document_categories',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_categories t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'aircraft_document_notifications',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_notifications t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'aircraft_document_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'stored_files',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.stored_files t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'aircraft_document_idempotency',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.aircraft_document_idempotency t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'organization_member_profiles',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.organization_member_profiles t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'member_administration_events',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.member_administration_events t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'organization_memberships',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.organization_memberships t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')),'membership_roles',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.membership_roles t where organization_id in ('e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000081')));
$snapshot$;
create temporary table sec034_before as select pg_temp.sec034_snapshot() as state;
select is(public.list_organization_members('e0300000-0000-4000-8000-000000000002','e0340000-0000-4000-8000-000000000081','e0300000-0000-4000-8000-000000000016'),jsonb_build_object('decision','not_found','correlationId','e0300000-0000-4000-8000-000000000016'::uuid),'list conceals another school');
select is(public.get_organization_member('e0300000-0000-4000-8000-000000000002','e0340000-0000-4000-8000-000000000081','e0340000-0000-4000-8000-000000000083','e0300000-0000-4000-8000-000000000016'),jsonb_build_object('decision','not_found','correlationId','e0300000-0000-4000-8000-000000000016'::uuid),'detail conceals another school');
select is(public.get_my_member_profile('e0300000-0000-4000-8000-000000000002','e0340000-0000-4000-8000-000000000083','e0300000-0000-4000-8000-000000000016'),jsonb_build_object('decision','not_found','correlationId','e0300000-0000-4000-8000-000000000016'::uuid),'profile conceals another school');
select is(public.get_my_member_profile('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000007','e0300000-0000-4000-8000-000000000016'),jsonb_build_object('decision','not_found','correlationId','e0300000-0000-4000-8000-000000000016'::uuid),'Own-profile read rejects another member in the same school');
select is(public.get_organization_member('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0340000-0000-4000-8000-000000000083','e0300000-0000-4000-8000-000000000016'),jsonb_build_object('decision','not_found','correlationId','e0300000-0000-4000-8000-000000000016'::uuid),'Authorized School A context conceals School B detail target');
select is(pg_temp.sec034_snapshot(),(select state from sec034_before),'Negative reads preserve prior domain and access-audit state');
create function pg_temp.reject_sec034_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic read audit failure'; end;$$;
create trigger reject_sec034_audit before insert on public.member_administration_events for each row when(new.event_name in ('member_directory.listed','member_directory.viewed','member_profile.viewed')) execute function pg_temp.reject_sec034_audit();
select throws_ok($call$select public.list_organization_members('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000016');$call$,'P5005','Member administration audit write failed.','list propagates mandatory audit failure without returning data');
select is(pg_temp.sec034_snapshot(),(select state from sec034_before),'list audit failure preserves all prior state');
select throws_ok($call$select public.get_organization_member('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000007','e0300000-0000-4000-8000-000000000016');$call$,'P5005','Member administration audit write failed.','detail propagates mandatory audit failure without returning data');
select is(pg_temp.sec034_snapshot(),(select state from sec034_before),'detail audit failure preserves all prior state');
select throws_ok($call$select public.get_my_member_profile('e0300000-0000-4000-8000-000000000002','e0300000-0000-4000-8000-000000000004','e0300000-0000-4000-8000-000000000016');$call$,'P5005','Member administration audit write failed.','profile propagates mandatory audit failure without returning data');
select is(pg_temp.sec034_snapshot(),(select state from sec034_before),'profile audit failure preserves all prior state');
select * from finish();
rollback;
