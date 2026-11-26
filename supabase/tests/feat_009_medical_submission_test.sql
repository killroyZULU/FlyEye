-- Run on a fresh synthetic database with the reviewed migrations. Nothing is retained.
begin;
set constraints organizations_single_school_deployment_key deferred;
select plan(1);
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
select * from finish();
rollback;
