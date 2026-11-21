begin;
set constraints organizations_single_school_deployment_key deferred;
set constraints organization_memberships_single_school_user_key deferred;
select no_plan();

create function pg_temp.id(n int) returns uuid language sql immutable as $$
select ('90090000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into public.organizations(id,name) values(pg_temp.id(1),'Synthetic North'),(pg_temp.id(2),'Synthetic South');
insert into auth.users(id) select pg_temp.id(10+i) from generate_series(1,7) i;
insert into public.organization_memberships(id,organization_id,user_id)
select pg_temp.id(20+i),pg_temp.id(case when i=7 then 2 else 1 end),pg_temp.id(10+i) from generate_series(1,7) i;
insert into public.membership_roles(organization_id,membership_id,role_id)
select m.organization_id,m.id,r.id from (values(1,'student_pilot'),(2,'instructor_pilot'),(3,'admin'),
 (4,'head_of_training'),(5,'chief_flight_instructor'),(6,'student_pilot'),(7,'admin')) x(i,code)
join public.roles r on r.code=x.code join public.organization_memberships m on m.id=pg_temp.id(20+i);
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
select pg_temp.id(30+i),pg_temp.id(10+i),'Synthetic','totp','verified','fixture',now(),now()
from generate_series(2,7) i where i<>6;
insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at)
select pg_temp.id(40+i),pg_temp.id(10+i),case when i in (1,6) then 'aal1'::auth.aal_level else 'aal2'::auth.aal_level end,
case when i not in (1,6) then pg_temp.id(30+i) end,now(),now() from generate_series(1,7) i;
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
select gen_random_uuid(),pg_temp.id(40+i),method,now(),now() from generate_series(1,7)i cross join (values('password'),('totp')) x(method)
where method='password' or i not in(1,6);

create function pg_temp.call(i int, action text, target int default null, school int default 1, value text default null,
 revision int default null, totp boolean default true) returns jsonb language sql as $$
 select public.credential_workspace(pg_temp.id(10+i),pg_temp.id(40+i),totp,pg_temp.id(school),action,
 pg_temp.id(20+target),null,value,revision,gen_random_uuid()) $$;

select ok(not has_function_privilege('authenticated','public.credential_workspace(uuid,uuid,boolean,uuid,text,uuid,uuid,text,bigint,uuid)','execute')
 and not has_function_privilege('anon','public.credential_workspace(uuid,uuid,boolean,uuid,text,uuid,uuid,text,bigint,uuid)','execute'),
 'Ordinary clients cannot supply service identity arguments');
select is(pg_temp.call(1,'my_credentials',1,1,null,null,false)->>'decision','credential_workspace','Student password metadata');
select is(pg_temp.call(1,'my_credentials',6)->>'decision','not_found','Deny unrelated owner');
select is(pg_temp.call(2,'my_credentials',1)->>'decision','not_found','Instructor cannot open a student owner view');
select is(pg_temp.call(2,'my_credentials',2,1,null,null,false)->>'decision','not_found','Privileged owner requires MFA');
select is(pg_temp.call(2,'my_credentials',2)->>'decision','credential_workspace','Instructor MFA metadata');
select is(pg_temp.call(1,'personnel_credentials')->>'decision','not_found','Student cannot list personnel');
select is(pg_temp.call(2,'personnel_credentials')->>'decision','not_found','Instructor cannot list personnel');
select is(pg_temp.call(3,'personnel_credentials',null,1,null,null,false)->>'decision','not_found','Staff requires verified token MFA');
select is(pg_temp.call(7,'personnel_credentials')->>'decision','not_found','Other school Admin denied');
select is(pg_temp.call(1,'my_credentials',7,2)->>'decision','not_found','Forged school and owner denied');
select is(pg_temp.call(3,'my_credentials',1)->>'decision','not_found','Admin owner path cannot impersonate another member');
select is(pg_temp.call(3,'set_credential_applicability',7,1,'both',1)->>'decision','not_found','Cross-school target denied');
select ok((select bool_and(jsonb_array_length(pg_temp.call(i,'personnel_credentials')->'members')=6)
 from (values(3),(4),(5)) x(i)), 'Admin, HoT and CFI see only six active same-school profiles');
select ok((select bool_and(pg_temp.call(i,'set_credential_applicability',1,1,'both',1)->>'decision'='not_found')
 from (values(1),(2),(4),(5),(7)) x(i)), 'Only same-school Admin can write applicability');
select is(pg_temp.call(3,'set_credential_applicability',1,1,'trainee',1)#>>'{members,0,applicability}','trainee','Admin sets trainee');
select is(pg_temp.call(3,'set_credential_applicability',1,1,'instructor',2)#>>'{members,0,applicability}','instructor','Admin sets instructor');
select is(pg_temp.call(3,'set_credential_applicability',1,1,'both',3)#>>'{members,0,applicability}','both','Admin sets dual applicability');
select is(pg_temp.call(1,'my_credentials',1)#>>'{members,0,applicability}','both','One shared owner profile');
select is(pg_temp.call(1,'personnel_credentials')->>'decision','not_found','Dual applicability grants no staff permission');
select is(pg_temp.call(3,'set_credential_applicability',1,1,'trainee',3)->>'decision','state_conflict','Stale edit rejected');
select is((select count(*)::int from public.member_administration_events where reason_code='credential_applicability_changed'),3,'Exactly three audited changes');
select is((select count(*)::int from public.organization_member_profiles where membership_id=pg_temp.id(21)),1,'One profile across changes');
select ok(not exists (select 1 from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.code='instructor_pilot'
 and exists (select 1 from public.roles staff where staff.code in ('head_of_training','chief_flight_instructor')
 and not exists (select 1 from public.role_permissions p where p.role_id=staff.id and p.permission_id=rp.permission_id))),
 'Both staff bundles retain every Instructor permission');
delete from public.role_permissions where role_id=(select id from public.roles where code='student_pilot')
 and permission_id=(select id from public.permissions where code='portal.student.access');
select is(pg_temp.call(1,'my_credentials',1)->>'decision','not_found','Revoked workspace permission blocks direct owner access');
update public.organization_memberships set status='suspended' where id=pg_temp.id(24);
select is(pg_temp.call(4,'personnel_credentials')->>'decision','not_found','Suspended staff denied');
delete from auth.mfa_factors where id=pg_temp.id(35);
select is(pg_temp.call(5,'personnel_credentials')->>'decision','not_found','Removed factor blocks existing staff session');

-- A session invalidated during the audit must roll back both the update and its success event.
create function pg_temp.expire_actor() returns trigger language plpgsql as $$
begin
 if new.reason_code='credential_applicability_changed' then update auth.sessions set not_after=now()-interval '1 minute' where id=pg_temp.id(43); end if;
 return new;
end $$;
create trigger expire_during_audit after insert on public.member_administration_events for each row execute function pg_temp.expire_actor();
select is(pg_temp.call(3,'set_credential_applicability',1,1,'instructor',4)->>'decision','not_found','Authority rechecked after audit');
select is((select credential_applicability from public.organization_member_profiles where membership_id=pg_temp.id(21)),'both','Failed recheck rolls back applicability');
select is((select count(*)::int from public.member_administration_events where reason_code='credential_applicability_changed'),3,'Failed recheck rolls back success audit');
drop trigger expire_during_audit on public.member_administration_events;
create function pg_temp.reject_change_audit() returns trigger language plpgsql as $$
begin
 if new.reason_code='credential_applicability_changed' then raise exception 'synthetic audit outage'; end if;
 return new;
end $$;
create trigger fail_change_audit before insert on public.member_administration_events for each row execute function pg_temp.reject_change_audit();
select throws_ok($$select pg_temp.call(3,'set_credential_applicability',1,1,'trainee',4)$$,'P5005',null,
 'Audit failure blocks an Admin change');
select is((select version::int from public.organization_member_profiles where membership_id=pg_temp.id(21)),4,'Audit failure leaves the profile revision intact');
select * from finish();
rollback;
