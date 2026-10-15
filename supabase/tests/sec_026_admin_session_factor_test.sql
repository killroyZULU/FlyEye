begin;
select no_plan();

create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('a2600000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.valid(s integer, f integer, aal2 boolean, u integer default 1)
returns boolean language sql as $$
  select public.validate_admin_session_factor(pg_temp.fixture_id(u),pg_temp.fixture_id(s),pg_temp.fixture_id(f),aal2);
$$;

select ok((select relrowsecurity from pg_class where oid='public.admin_session_factor_bindings'::regclass), 'binding RLS enabled');
select is((select count(*)::int from pg_policies where schemaname='public' and tablename='admin_session_factor_bindings'),0,'no browser binding policy');
select ok(not has_table_privilege('anon','public.admin_session_factor_bindings','select,insert,update,delete'), 'anonymous has no binding access');
select ok(not has_table_privilege('authenticated','public.admin_session_factor_bindings','select,insert,update,delete'), 'authenticated has no binding access');
select ok(not has_table_privilege('service_role','public.admin_session_factor_bindings','insert,update,delete'), 'service role cannot directly rewrite provenance');
select ok(not has_function_privilege('anon','public.validate_admin_session_factor(uuid,uuid,uuid,boolean)','execute'), 'anonymous cannot validate');
select ok(not has_function_privilege('authenticated','public.validate_admin_session_factor(uuid,uuid,uuid,boolean)','execute'), 'authenticated cannot validate');
select ok(has_function_privilege('service_role','public.validate_admin_session_factor(uuid,uuid,uuid,boolean)','execute'), 'service validator available');
select ok(not has_function_privilege('authenticated','public.capture_admin_session_factor()','execute'), 'browser cannot call capture trigger');

insert into auth.users(id) values(pg_temp.fixture_id(1)),(pg_temp.fixture_id(2));
insert into auth.sessions(id,user_id,aal,created_at,updated_at)
values(pg_temp.fixture_id(201),pg_temp.fixture_id(1),'aal1',now(),now());
select is((select count(*)::int from public.admin_session_factor_bindings where session_id=pg_temp.fixture_id(201)),1,'new session gets known empty provenance');
select ok(not pg_temp.valid(201,null,false),'missing password AMR denied');
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
values(pg_temp.fixture_id(301),pg_temp.fixture_id(201),'password',now(),now());
select ok(pg_temp.valid(201,null,false),'new password session can start enrollment');
select ok(not pg_temp.valid(201,null,true),'AAL1 cannot complete');
select ok(not pg_temp.valid(201,null,false,2),'foreign subject cannot validate session');

insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
values(pg_temp.fixture_id(101),pg_temp.fixture_id(1),'totp','verified',now(),now());
select ok(pg_temp.valid(201,101,false),'AAL1 START binds current sole verified factor');
select is((select factor_id from public.admin_session_factor_bindings where session_id=pg_temp.fixture_id(201)),pg_temp.fixture_id(101),'START captured original factor');
select ok(not pg_temp.valid(201,101,true),'database AAL1 remains insufficient');
update auth.sessions set aal='aal2',factor_id=pg_temp.fixture_id(101) where id=pg_temp.fixture_id(201);
select ok(not pg_temp.valid(201,101,true),'missing TOTP AMR denied');
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
values(pg_temp.fixture_id(302),pg_temp.fixture_id(201),'totp',now(),now());
select ok(pg_temp.valid(201,101,true),'original verified session accepted');

insert into auth.sessions(id,user_id,aal,created_at,updated_at)
values(pg_temp.fixture_id(202),pg_temp.fixture_id(1),'aal1',now(),now());
select is((select factor_id from public.admin_session_factor_bindings where session_id=pg_temp.fixture_id(202)),pg_temp.fixture_id(101),'password session captures original factor before START');
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
values(pg_temp.fixture_id(303),pg_temp.fixture_id(202),'password',now(),now());

delete from auth.mfa_factors where id=pg_temp.fixture_id(101);
select is((select factor_id from public.admin_session_factor_bindings where session_id=pg_temp.fixture_id(201)),pg_temp.fixture_id(101),'factor deletion preserves original identity');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
values(pg_temp.fixture_id(102),pg_temp.fixture_id(1),'totp','verified',now(),now());
select ok(not pg_temp.valid(201,102,false),'old verified session cannot START with replacement');
select ok(not pg_temp.valid(202,102,false),'older AAL1 password cannot bind replacement');
update auth.sessions set aal='aal1',factor_id=null where id=pg_temp.fixture_id(201);
update auth.sessions set aal='aal2',factor_id=pg_temp.fixture_id(102) where id=pg_temp.fixture_id(201);
select ok(not pg_temp.valid(201,102,true),'unenroll then replacement re-challenge cannot rehabilitate old session');
select is((select factor_id from public.admin_session_factor_bindings where session_id=pg_temp.fixture_id(201)),pg_temp.fixture_id(101),'reassociation never overwrites binding');

insert into auth.sessions(id,user_id,aal,created_at,updated_at)
values(pg_temp.fixture_id(203),pg_temp.fixture_id(1),'aal1',now(),now());
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
values(pg_temp.fixture_id(304),pg_temp.fixture_id(203),'password',now(),now()),
      (pg_temp.fixture_id(305),pg_temp.fixture_id(203),'totp',now(),now());
update auth.sessions set aal='aal2',factor_id=pg_temp.fixture_id(102) where id=pg_temp.fixture_id(203);
select ok(pg_temp.valid(203,102,true),'fresh password/current factor accepted');
update auth.sessions set not_after=now()-interval '1 second' where id=pg_temp.fixture_id(203);
select ok(not pg_temp.valid(203,102,true),'existing provider expiry honored');
update auth.sessions set not_after=null where id=pg_temp.fixture_id(203);

-- Absence models both pre-migration and lost provenance, irrespective of current factor.
delete from public.admin_session_factor_bindings where session_id in(pg_temp.fixture_id(202),pg_temp.fixture_id(203));
select ok(not pg_temp.valid(202,102,false),'unknown AAL1 history denied');
select ok(not pg_temp.valid(203,102,true),'unknown non-null factor history denied');
update auth.sessions set factor_id=pg_temp.fixture_id(102) where id in(pg_temp.fixture_id(202),pg_temp.fixture_id(203));
select is((select count(*)::int from public.admin_session_factor_bindings where session_id in(pg_temp.fixture_id(202),pg_temp.fixture_id(203))),0,'UPDATE never recreates unknown history');

insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
values(pg_temp.fixture_id(103),pg_temp.fixture_id(1),'totp','unverified',now(),now());
insert into auth.sessions(id,user_id,aal,created_at,updated_at)
values(pg_temp.fixture_id(204),pg_temp.fixture_id(1),'aal1',now(),now());
select is((select count(*)::int from public.admin_session_factor_bindings where session_id=pg_temp.fixture_id(204)),0,'ambiguous initial inventory stays unknown');

delete from auth.sessions where id=pg_temp.fixture_id(201);
select is((select count(*)::int from public.admin_session_factor_bindings where session_id=pg_temp.fixture_id(201)),0,'session deletion cascades binding');
select ok(not pg_temp.valid(201,102,true),'deleted session denied');
insert into auth.sessions(id,user_id,aal,created_at,updated_at)
values(pg_temp.fixture_id(205),pg_temp.fixture_id(2),'aal1',now(),now());
delete from auth.users where id=pg_temp.fixture_id(2);
select is((select count(*)::int from public.admin_session_factor_bindings where actor_user_id=pg_temp.fixture_id(2)),0,'user deletion cascades binding');

create function pg_temp.reject_binding() returns trigger language plpgsql as $$
begin raise exception using errcode='P2601', message='Synthetic binding rollback'; end;
$$;
create trigger sec026_reject_binding before insert on public.admin_session_factor_bindings
for each row execute function pg_temp.reject_binding();
delete from auth.mfa_factors where id=pg_temp.fixture_id(103);
select throws_ok(
  $$insert into auth.sessions(id,user_id,aal,created_at,updated_at)
    values(pg_temp.fixture_id(206),pg_temp.fixture_id(1),'aal1',now(),now())$$,
  'P2601','Synthetic binding rollback','binding failure rejects the enclosing Auth transaction');
select is((select count(*)::int from auth.sessions where id=pg_temp.fixture_id(206)),0,'failed capture leaves no Auth session');
select is((select count(*)::int from public.admin_session_factor_bindings where session_id=pg_temp.fixture_id(206)),0,'failed capture leaves no binding');

select * from finish();
rollback;
