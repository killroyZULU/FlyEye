-- Run on a fresh synthetic database with the reviewed migrations. Nothing is retained.
begin;
set constraints organizations_single_school_deployment_key deferred;
select plan(1);
create function pg_temp.ntc_id(n int) returns uuid language sql immutable as $$
  select ('90990000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into public.organizations(id,name) values(pg_temp.ntc_id(1),'Synthetic NTC proof');
insert into auth.users(id) values(pg_temp.ntc_id(2));
insert into public.organization_memberships(id,organization_id,user_id)
  values(pg_temp.ntc_id(3),pg_temp.ntc_id(1),pg_temp.ntc_id(2));
insert into public.membership_roles(organization_id,membership_id,role_id)
  select pg_temp.ntc_id(1),pg_temp.ntc_id(3),id from public.roles where code='student_pilot';
update public.organization_member_profiles set credential_applicability='trainee' where membership_id=pg_temp.ntc_id(3);
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
  values(pg_temp.ntc_id(4),pg_temp.ntc_id(2),'Synthetic','totp','verified','fixture',now(),now());
insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at)
  values(pg_temp.ntc_id(5),pg_temp.ntc_id(2),'aal2',pg_temp.ntc_id(4),now(),now());
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
  select gen_random_uuid(),pg_temp.ntc_id(5),method,now(),now() from (values('password'),('totp')) as m(method);
insert into storage.objects(bucket_id,name,metadata)
  select 'credential-synthetic', pg_temp.ntc_id(1)||'/'||pg_temp.ntc_id(3)||'/'||pg_temp.ntc_id(i)||'.png',
    '{"mimetype":"image/png","size":69}'::jsonb from generate_series(10,14) i;

create function pg_temp.ntc_command(cmd text, version int, details jsonb) returns jsonb language sql as $$
  select public.credential_owner_submission(pg_temp.ntc_id(2),pg_temp.ntc_id(5),true,pg_temp.ntc_id(1),
    extract(epoch from now())::bigint+600,pg_temp.ntc_id(3),cmd,pg_temp.ntc_id(version),details)
$$;
create function pg_temp.check_ntc(ok boolean, checkpoint text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'NTC lifecycle assertion failed: %',checkpoint; end if;
end; $$;
create function pg_temp.fail_ntc_audit() returns trigger language plpgsql as $$
begin
  if current_setting('fixture.ntc_fail_audit',true)='on' and new.event='submitted' then
    raise exception 'synthetic audit failure';
  end if;
  return new;
end; $$;
create trigger ntc_audit_failure before insert on credential_private.events
  for each row execute function pg_temp.fail_ntc_audit();

do $proof$
declare
  declaration jsonb := jsonb_build_object('operationId',pg_temp.ntc_id(20));
  original jsonb := jsonb_build_object('category','ntc','operationId',pg_temp.ntc_id(21),
    'issueDate','2020-01-01','expiryDate','2022-01-01','noExpiry',false,
    'digest','b75368e414a64c223ffb18fef090a45ff203704613e11bdb922757ac5b00ee06');
  replacement jsonb := original||jsonb_build_object('expectedPendingId',pg_temp.ntc_id(10),
    'operationId',pg_temp.ntc_id(22),'expiryDate',null,'noExpiry',true);
  withdrawal jsonb := jsonb_build_object('category','ntc','operationId',pg_temp.ntc_id(23));
  prior_approval jsonb;
  applicability text;
begin
  perform pg_temp.check_ntc(pg_temp.ntc_command('declare_ntc',null,declaration)->>'ntcCompleteness'='not_yet_obtained','saved declaration');
  perform pg_temp.check_ntc(pg_temp.ntc_command('commit',10,original)->>'id'=pg_temp.ntc_id(10)::text,'initial pending');

  perform set_config('fixture.ntc_fail_audit','on',true);
  perform pg_temp.check_ntc(pg_temp.ntc_command('commit',11,replacement)->>'rolledBack'='true','atomic rejection');
  perform pg_temp.check_ntc((select count(*)=1 and bool_and(state='pending' and withdrawal_operation_id is null)
    from credential_private.versions where membership_id=pg_temp.ntc_id(3)),'original survived failed audit');
  perform pg_temp.check_ntc((select count(*)=1 from credential_private.events where organization_id=pg_temp.ntc_id(1)),'no partial event');
  perform set_config('fixture.ntc_fail_audit','off',true);

  perform pg_temp.check_ntc(pg_temp.ntc_command('withdraw',10,withdrawal||'{"category":"elp"}') is null,'cross-category withdrawal');
  perform pg_temp.check_ntc(pg_temp.ntc_command('commit',11,replacement)->>'id'=pg_temp.ntc_id(11)::text,'atomic replacement');
  perform pg_temp.check_ntc(pg_temp.ntc_command('commit',11,replacement)->>'replayed'='true','identical replacement replay');
  perform pg_temp.check_ntc(pg_temp.ntc_command('commit',12,replacement||jsonb_build_object('operationId',pg_temp.ntc_id(24)))->>'conflict'='true','stale replacement');
  perform pg_temp.check_ntc(pg_temp.ntc_command('prepare',12,replacement||'{"expiryDate":"2024-01-01","noExpiry":false}')->>'conflict'='true','changed payload conflict');
  perform pg_temp.check_ntc((select count(*)=1 from credential_private.versions where membership_id=pg_temp.ntc_id(3) and state='pending' and replaces_version_id=pg_temp.ntc_id(10)),'one successor');
  perform pg_temp.check_ntc(pg_temp.ntc_command('locate',10,'{}')->>'digest'=original->>'digest','historical evidence still bound');
  perform pg_temp.check_ntc(pg_temp.ntc_command('withdraw',11,withdrawal)->>'state'='withdrawn','withdraw successor');
  perform pg_temp.check_ntc(pg_temp.ntc_command('withdraw_outcome',11,withdrawal)->>'replayed'='true','withdrawal readback');
  perform pg_temp.check_ntc(pg_temp.ntc_command('withdraw',11,withdrawal)->>'replayed'='true','withdrawal replay');
  perform pg_temp.check_ntc((select count(*)=4 and count(*) filter(where event='withdrawn')=2 and
    bool_and(actor_id=pg_temp.ntc_id(2) and organization_id=pg_temp.ntc_id(1)) from credential_private.events where organization_id=pg_temp.ntc_id(1)),'exact attributable history');
  perform pg_temp.check_ntc(pg_temp.ntc_command('status',null,'{}')->>'ntcCompleteness'='not_yet_obtained','trainee declaration restored');
  foreach applicability in array array['instructor','both'] loop
    update public.organization_member_profiles set credential_applicability=applicability where membership_id=pg_temp.ntc_id(3);
    perform pg_temp.check_ntc(pg_temp.ntc_command('status',null,'{}')->>'ntcCompleteness'='required','required without approval');
  end loop;
  update public.organization_member_profiles set credential_applicability='trainee' where membership_id=pg_temp.ntc_id(3);
  perform pg_temp.check_ntc(pg_temp.ntc_command('commit',12,original||jsonb_build_object('operationId',pg_temp.ntc_id(25)))->>'state'='pending','new pending');
  -- Seed an existing approval, then exercise withdrawal through the production command again.
  insert into credential_private.versions(id,organization_id,membership_id,category,state,issued_on,expires_on,no_expiry,
    object_key,submitted_by,operation_id,evidence_sha256)
    values(pg_temp.ntc_id(13),pg_temp.ntc_id(1),pg_temp.ntc_id(3),'ntc','approved','2019-01-01','2021-01-01',false,
      pg_temp.ntc_id(1)||'/'||pg_temp.ntc_id(3)||'/'||pg_temp.ntc_id(13)||'.png',pg_temp.ntc_id(2),pg_temp.ntc_id(26),original->>'digest');
  select to_jsonb(v) into strict prior_approval from credential_private.versions v where id=pg_temp.ntc_id(13);
  perform pg_temp.check_ntc(pg_temp.ntc_command('commit',14,replacement||jsonb_build_object('operationId',pg_temp.ntc_id(28),'expectedPendingId',pg_temp.ntc_id(12)))->>'id'=pg_temp.ntc_id(14)::text,'replace alongside approval');
  perform pg_temp.check_ntc(pg_temp.ntc_command('withdraw',14,withdrawal||jsonb_build_object('operationId',pg_temp.ntc_id(27)))->>'state'='withdrawn','withdraw alongside approval');
  perform pg_temp.check_ntc(pg_temp.ntc_command('status',null,'{}')->>'ntcCompleteness'='approved','approval takes precedence');
  perform pg_temp.check_ntc((select to_jsonb(v)=prior_approval from credential_private.versions v where id=pg_temp.ntc_id(13)),'approval and expiry unchanged');
end; $proof$;
select pass('NTC owner transitions preserve the approval, declaration, audit and pending-version invariants');
select * from finish();
rollback;
