-- Run on a fresh synthetic database with the reviewed migrations. Nothing is retained.
begin;
set constraints organizations_single_school_deployment_key deferred;
select plan(2);
create function pg_temp.medical_id(n int) returns uuid language sql immutable as $$
  select ('90991000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into public.organizations(id,name) values(pg_temp.medical_id(1),'Synthetic medical proof');
insert into auth.users(id) values(pg_temp.medical_id(2));
insert into public.organization_memberships(id,organization_id,user_id)
  values(pg_temp.medical_id(3),pg_temp.medical_id(1),pg_temp.medical_id(2));
insert into public.membership_roles(organization_id,membership_id,role_id)
  select pg_temp.medical_id(1),pg_temp.medical_id(3),id from public.roles where code='student_pilot';
update public.organization_member_profiles set credential_applicability='trainee' where membership_id=pg_temp.medical_id(3);
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
  values(pg_temp.medical_id(4),pg_temp.medical_id(2),'Synthetic','totp','verified','fixture',now(),now());
insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at)
  values(pg_temp.medical_id(5),pg_temp.medical_id(2),'aal2',pg_temp.medical_id(4),now(),now());
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
  select gen_random_uuid(),pg_temp.medical_id(5),method,now(),now() from (values('password'),('totp')) as m(method);
insert into storage.objects(bucket_id,name,metadata)
  select 'credential-synthetic', pg_temp.medical_id(1)||'/'||pg_temp.medical_id(3)||'/'||pg_temp.medical_id(i)||'.png',
    '{"mimetype":"image/png","size":69}'::jsonb from generate_series(10,12) i;

create function pg_temp.medical_command(cmd text, version int, details jsonb) returns jsonb language sql as $$
  select public.credential_owner_submission(pg_temp.medical_id(2),pg_temp.medical_id(5),true,pg_temp.medical_id(1),
    extract(epoch from now())::bigint+600,pg_temp.medical_id(3),cmd,pg_temp.medical_id(version),details)
$$;
do $proof$
declare
  cmd jsonb := jsonb_build_object('category','medical','operationId',pg_temp.medical_id(20),
    'issueDate','2020-02-01','expiryDate','2022-02-01','noExpiry',false,
    'digest','b75368e414a64c223ffb18fef090a45ff203704613e11bdb922757ac5b00ee06');
  change jsonb; reply jsonb; prior_approval jsonb; kind text; versions jsonb;
begin
  foreach change in array array['{"diagnosis":"synthetic"}'::jsonb,'{"notes":"synthetic"}','{"licenseNumber":"synthetic"}','{"elpLevel":4}',
    '{"issueDate":"2099-01-01"}','{"expiryDate":"2019-01-01"}','{"expiryDate":null}','{"noExpiry":true}',
    jsonb_build_object('expectedPendingId',pg_temp.medical_id(12))] loop
    if pg_temp.medical_command('prepare',10,cmd||change) is not null then raise exception 'Unexpected acceptance of invalid medical fields'; end if;
  end loop;
  foreach kind in array array['trainee','instructor','both'] loop
    update public.organization_member_profiles set credential_applicability=kind where membership_id=pg_temp.medical_id(3);
    if (pg_temp.medical_command('prepare',10,cmd) ? 'key') is not true
      or (pg_temp.medical_command('prepare',10,cmd||'{"noExpiry":true,"expiryDate":null}') ? 'key') is not true
      then raise exception 'Expected medical submission for active applicability'; end if;
  end loop;
  if public.credential_owner_submission(pg_temp.medical_id(2),pg_temp.medical_id(5),false,pg_temp.medical_id(1),
    extract(epoch from now())::bigint+60,pg_temp.medical_id(3),'commit',pg_temp.medical_id(10),cmd) is not null
    or public.credential_owner_submission(pg_temp.medical_id(2),pg_temp.medical_id(5),true,pg_temp.medical_id(99),
    extract(epoch from now())::bigint+60,pg_temp.medical_id(3),'commit',pg_temp.medical_id(10),cmd) is not null
    or public.credential_owner_submission(pg_temp.medical_id(2),pg_temp.medical_id(5),true,pg_temp.medical_id(1),
    extract(epoch from now())::bigint+60,pg_temp.medical_id(99),'commit',pg_temp.medical_id(10),cmd) is not null
    or pg_temp.medical_command('commit',99,cmd) is not null
    then raise exception 'Denied medical write mutated or exposed a result'; end if;
  insert into credential_private.versions(id,organization_id,membership_id,category,state,issued_on,expires_on,no_expiry,
    object_key,submitted_by,operation_id,evidence_sha256)
    values(pg_temp.medical_id(12),pg_temp.medical_id(1),pg_temp.medical_id(3),'medical','approved','2019-01-01','2021-01-01',false,
    pg_temp.medical_id(1)||'/'||pg_temp.medical_id(3)||'/'||pg_temp.medical_id(12)||'.png',pg_temp.medical_id(2),pg_temp.medical_id(27),cmd->>'digest');
  select to_jsonb(v) into strict prior_approval from credential_private.versions v where id=pg_temp.medical_id(12);
  reply:=pg_temp.medical_command('commit',10,cmd);
  if reply->>'state' is distinct from 'pending' or reply->>'id' is distinct from pg_temp.medical_id(10)::text
    then raise exception 'Missing medical submission'; end if;
  if pg_temp.medical_command('prepare',11,cmd)->>'replayed' is distinct from 'true'
    or pg_temp.medical_command('prepare',11,cmd||'{"expiryDate":"2024-02-01"}')->>'conflict' is distinct from 'true'
    or pg_temp.medical_command('prepare',11,cmd||jsonb_build_object('operationId',pg_temp.medical_id(21)))->>'conflict' is distinct from 'true'
    or pg_temp.medical_command('reconcile',null,jsonb_build_object('operationId',pg_temp.medical_id(20),'category','medical'))->>'id' is distinct from pg_temp.medical_id(10)::text
    then raise exception 'Incorrect medical operation reconciliation'; end if;
  versions := pg_temp.medical_command('status',null,'{}')->'versions';
  if jsonb_array_length(versions) is distinct from 2 or not exists (select from jsonb_array_elements(versions) row(value)
    where value=jsonb_build_object('id',pg_temp.medical_id(10),'category','medical','state','pending','issueDate','2020-02-01','expiryDate','2022-02-01','noExpiry',false))
    or (select to_jsonb(v) from credential_private.versions v where id=pg_temp.medical_id(12)) is distinct from prior_approval
    or (select count(*) from credential_private.events where version_id=pg_temp.medical_id(10) and event='submitted' and actor_id=pg_temp.medical_id(2) and organization_id=pg_temp.medical_id(1))<>1
    or pg_temp.medical_command('locate',10,'{}')->>'digest' is distinct from cmd->>'digest'
    then raise exception 'Medical readback, evidence binding, audit or approval preservation failed'; end if;
end; $proof$;
select pass('Scoped medical submission accepts only credential dates, preserves the approval and binds one pending row to private evidence');

create function pg_temp.check_medical(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'Medical lifecycle failed: %', label; end if;
end; $$;
create function pg_temp.reject_medical_event() returns trigger language plpgsql as $$
begin
  if new.event=current_setting('fixture.medical_reject_event',true) then
    raise exception using errcode='P9010', message='synthetic medical audit rejection';
  end if;
  return new;
end; $$;
create trigger medical_reject_event before insert on credential_private.events
  for each row execute function pg_temp.reject_medical_event();

do $lifecycle$
declare
  replacement jsonb := jsonb_build_object('category','medical','operationId',pg_temp.medical_id(30),
    'expectedPendingId',pg_temp.medical_id(10),'issueDate','2023-05-01','expiryDate','2025-05-01','noExpiry',false,
    'digest','b75368e414a64c223ffb18fef090a45ff203704613e11bdb922757ac5b00ee06');
  withdrawal jsonb := jsonb_build_object('category','medical','operationId',pg_temp.medical_id(31));
  approval jsonb; original jsonb; visible jsonb;
begin
  select to_jsonb(v) into strict approval from credential_private.versions v where id=pg_temp.medical_id(12);
  select to_jsonb(v) into strict original from credential_private.versions v where id=pg_temp.medical_id(10);
  perform pg_temp.check_medical(pg_temp.medical_command('withdraw',12,withdrawal)->>'conflict'='true','approved withdrawal denied');
  perform pg_temp.check_medical(pg_temp.medical_command('prepare',11,replacement||jsonb_build_object('expectedPendingId',pg_temp.medical_id(12)))->>'conflict'='true','approved replacement denied');
  perform pg_temp.check_medical(pg_temp.medical_command('withdraw',10,withdrawal||'{"category":"ntc"}') is null,'wrong category withdrawal');
  perform pg_temp.check_medical(pg_temp.medical_command('prepare',11,replacement||'{"category":"ntc"}') is null,'wrong category replacement');
  perform set_config('fixture.medical_reject_event','withdrawn',true);
  begin
    perform pg_temp.medical_command('withdraw',10,withdrawal);
    raise exception 'Withdrawal accepted a failed audit';
  exception when sqlstate 'P9010' then null;
  end;
  perform set_config('fixture.medical_reject_event','submitted',true);
  perform pg_temp.check_medical(pg_temp.medical_command('commit',11,replacement)->>'rolledBack'='true','atomic replacement rejected on successor audit');
  perform pg_temp.check_medical((select to_jsonb(v)=original from credential_private.versions v where id=pg_temp.medical_id(10))
    and pg_temp.medical_command('locate',11,'{}') is null
    and (select count(*)=1 from credential_private.events where organization_id=pg_temp.medical_id(1)),'no partial change, visible successor evidence or extra audit');
  perform set_config('fixture.medical_reject_event','',true);
  perform pg_temp.check_medical(pg_temp.medical_command('commit',11,replacement)->>'id'=pg_temp.medical_id(11)::text,'replacement');
  perform pg_temp.check_medical(pg_temp.medical_command('reconcile',null,replacement)->>'id'=pg_temp.medical_id(11)::text,'lost acknowledgement');
  perform pg_temp.check_medical(pg_temp.medical_command('commit',11,replacement)->>'replayed'='true','same replacement acknowledged');
  perform pg_temp.check_medical(pg_temp.medical_command('prepare',11,replacement||'{"expiryDate":"2026-01-01"}')->>'conflict'='true','changed payload');
  perform pg_temp.check_medical(pg_temp.medical_command('reconcile',null,replacement||jsonb_build_object('expectedPendingId',pg_temp.medical_id(12)))->>'conflict'='true','changed target');
  perform pg_temp.check_medical(pg_temp.medical_command('commit',11,replacement||jsonb_build_object('operationId',pg_temp.medical_id(32)))->>'conflict'='true','stale replacement');
  perform pg_temp.check_medical(pg_temp.medical_command('withdraw',10,withdrawal)->>'conflict'='true','stale withdrawal');
  perform pg_temp.check_medical((select count(*)=1 and bool_and(id=pg_temp.medical_id(11) and replaces_version_id=pg_temp.medical_id(10)
    and expires_on='2025-05-01') from credential_private.versions where membership_id=pg_temp.medical_id(3) and state='pending'),'one exact successor');
  perform pg_temp.check_medical(pg_temp.medical_command('withdraw',11,withdrawal)->>'state'='withdrawn','exact successor withdrawn');
  perform pg_temp.check_medical(pg_temp.medical_command('withdraw_outcome',11,withdrawal)->>'replayed'='true'
    and pg_temp.medical_command('withdraw',11,withdrawal)->>'replayed'='true','withdrawal readback and replay');
  perform pg_temp.check_medical(pg_temp.medical_command('withdraw',11,withdrawal||jsonb_build_object('operationId',pg_temp.medical_id(33)))->>'conflict'='true','new key cannot repeat withdrawal');
  select pg_temp.medical_command('status',null,'{}')->'versions' into visible;
  perform pg_temp.check_medical(jsonb_array_length(visible)=1 and visible->0->>'id'=approval->>'id'
    and visible->0->>'expiryDate'=approval->>'expires_on' and (select to_jsonb(v)=approval from credential_private.versions v where id=pg_temp.medical_id(12)),'unchanged current approval and expiry');
  perform pg_temp.check_medical(pg_temp.medical_command('locate',10,'{}')->>'key'=original->>'object_key'
    and pg_temp.medical_command('locate',11,'{}')->>'digest'=replacement->>'digest','retained evidence');
  perform pg_temp.check_medical((select count(*)=4 and count(distinct (version_id,event))=4
    and bool_and(version_id in (pg_temp.medical_id(10),pg_temp.medical_id(11)) and event in ('withdrawn','submitted')
      and organization_id=pg_temp.medical_id(1) and actor_id=pg_temp.medical_id(2))
    from credential_private.events where organization_id=pg_temp.medical_id(1)),'attributable events exactly once');
end; $lifecycle$;
select pass('Exact medical withdrawal and replacement preserve approval, evidence, atomic audit and idempotent replay');
select * from finish();
rollback;
