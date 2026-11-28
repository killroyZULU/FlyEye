-- Run on a fresh synthetic database with the reviewed migrations. Nothing is retained.
begin;
set constraints organizations_single_school_deployment_key deferred;
select plan(1);
create function pg_temp.fixture_id(n int) returns uuid language sql immutable as $$
  select ('90992000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into public.organizations(id,name) values(pg_temp.fixture_id(1),'Synthetic owner evidence proof');
insert into auth.users(id) values(pg_temp.fixture_id(2));
insert into public.organization_memberships(id,organization_id,user_id)
  values(pg_temp.fixture_id(3),pg_temp.fixture_id(1),pg_temp.fixture_id(2));
insert into public.membership_roles(organization_id,membership_id,role_id)
  select pg_temp.fixture_id(1),pg_temp.fixture_id(3),id from public.roles where code='student_pilot';
update public.organization_member_profiles set credential_applicability='trainee' where membership_id=pg_temp.fixture_id(3);
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
  values(pg_temp.fixture_id(4),pg_temp.fixture_id(2),'Synthetic','totp','verified','fixture',now(),now());
insert into auth.sessions(id,user_id,aal,factor_id,created_at,updated_at)
  values(pg_temp.fixture_id(5),pg_temp.fixture_id(2),'aal2',pg_temp.fixture_id(4),now(),now());
insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at)
  select gen_random_uuid(),pg_temp.fixture_id(5),method,now(),now() from (values('password'),('totp')) as m(method);
create function pg_temp.owner_command(cmd text, version int, details jsonb) returns jsonb language sql as $$
  select public.credential_owner_submission(pg_temp.fixture_id(2),pg_temp.fixture_id(5),true,pg_temp.fixture_id(1),
    extract(epoch from now())::bigint+600,pg_temp.fixture_id(3),cmd,pg_temp.fixture_id(version),details)
$$;
create function pg_temp.ensure(ok boolean, checkpoint text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'Owner evidence check failed: %',checkpoint; end if; end; $$;

do $proof$
declare
  png jsonb := '{"mime":"image/png","size":69,"digest":"b75368e414a64c223ffb18fef090a45ff203704613e11bdb922757ac5b00ee06"}'; jpg jsonb := '{"mime":"image/jpeg","size":659,"digest":"e07c45fd369a2991a8b97428c12cef6966a92f3c101f1ed5d7efe58cb75559cb"}'; pdf jsonb := '{"mime":"application/pdf","size":601,"digest":"1dbe95fd6e5b3f6c29b07755b6a1ed2c4e250fba4ba39b36f67113e9d743de04"}';
  pair jsonb := jsonb_build_array(jpg,png);
  fixture jsonb := jsonb_build_object('issueDate','2023-01-01','expiryDate','2025-01-01','noExpiry',false);
  kind text; member_kind text; cmd jsonb; replace_cmd jsonb; withdrawal jsonb; base text; next_key text;
  v int:=40; op int:=100; receipt jsonb; saved jsonb; saved_approval jsonb; event_count bigint;
begin
  perform pg_temp.ensure((select not public and file_size_limit=10000000 and allowed_mime_types @> array['image/png','image/jpeg','application/pdf'] from storage.buckets where id='credential-synthetic'),'private synthetic bucket limits');
  foreach kind in array array['fi','gi'] loop
    base := pg_temp.fixture_id(1)||'/'||pg_temp.fixture_id(3)||'/'||pg_temp.fixture_id(v);
    cmd := fixture||jsonb_build_object('category',kind,'operationId',pg_temp.fixture_id(op),'digest',jpg->>'digest','evidenceManifest',pair);
    withdrawal := jsonb_build_object('category',kind,'operationId',pg_temp.fixture_id(op+2));
    perform pg_temp.ensure(pg_temp.owner_command('prepare',v,cmd) is null,'trainee cannot stage an optional license');
    member_kind := case kind when 'fi' then 'instructor' else 'both' end;
    update public.organization_member_profiles set credential_applicability=member_kind where membership_id=pg_temp.fixture_id(3);
    perform pg_temp.ensure(pg_temp.owner_command('status',null,'{}')->>'instructorApplicable'='true','school applicability enables optional licenses');
    receipt := pg_temp.owner_command('prepare',v,cmd);
    perform pg_temp.ensure(receipt->'keys'=jsonb_build_array(base||'.jpg',base||'-back.png'),'ordered private object keys');
    insert into storage.objects(bucket_id,name,metadata) values('credential-synthetic',base||'.jpg',jsonb_build_object('mimetype','image/jpeg','size',659));
    perform pg_temp.ensure(pg_temp.owner_command('commit',v,cmd) is null and pg_temp.owner_command('locate',v,'{}') is null,'missing back prevents a reviewable or accessible version');
    insert into storage.objects(bucket_id,name,metadata) values('credential-synthetic',base||'-back.png','{"mimetype":"image/jpeg","size":69}');
    perform pg_temp.ensure(pg_temp.owner_command('commit',v,cmd) is null,'wrong back metadata');
    update storage.objects set metadata='{"mimetype":"image/png","size":69}' where name=base||'-back.png';
    perform pg_temp.ensure(pg_temp.owner_command('commit',v,cmd)->>'id'=pg_temp.fixture_id(v)::text,'complete image pair committed');
    perform pg_temp.ensure(pg_temp.owner_command('prepare',v,cmd)->>'replayed'='true','idempotent pair');
    perform pg_temp.ensure(pg_temp.owner_command('prepare',v,cmd||jsonb_build_object('digest',png->>'digest','evidenceManifest',jsonb_build_array(png,jpg)))->>'conflict'='true','reordering conflicts');
    perform pg_temp.ensure(pg_temp.owner_command('serve',v,'{"slot":1}')->>'key'=base||'-back.png' and pg_temp.owner_command('locate',v,'{"slot":2}') is null,'slot bound to version');
    select count(*) into event_count from credential_private.events;
    perform pg_temp.ensure(public.credential_owner_submission(pg_temp.fixture_id(2),pg_temp.fixture_id(5),false,pg_temp.fixture_id(1),
      extract(epoch from now())::bigint+600,pg_temp.fixture_id(3),'serve',pg_temp.fixture_id(v),'{"slot":1}') is null
      and public.credential_owner_submission(pg_temp.fixture_id(2),pg_temp.fixture_id(5),true,pg_temp.fixture_id(1),
      extract(epoch from now())::bigint-1,pg_temp.fixture_id(3),'serve',pg_temp.fixture_id(v),'{"slot":1}') is null
      and public.credential_owner_submission(pg_temp.fixture_id(2),pg_temp.fixture_id(5),true,pg_temp.fixture_id(98),
      extract(epoch from now())::bigint+600,pg_temp.fixture_id(3),'serve',pg_temp.fixture_id(v),'{"slot":1}') is null
      and public.credential_owner_submission(pg_temp.fixture_id(2),pg_temp.fixture_id(5),true,pg_temp.fixture_id(1),
      extract(epoch from now())::bigint+600,pg_temp.fixture_id(98),'serve',pg_temp.fixture_id(v),'{"slot":1}') is null
      and (select count(*)=event_count from credential_private.events),'back image denied for wrong scope, expired session and missing MFA');
    insert into credential_private.versions(id,organization_id,membership_id,category,state,issued_on,expires_on,no_expiry,
      object_key,submitted_by,operation_id,evidence_sha256) values(pg_temp.fixture_id(v+100),pg_temp.fixture_id(1),pg_temp.fixture_id(3),kind,
      'approved','2017-01-01','2019-01-01',false,pg_temp.fixture_id(1)||'/'||pg_temp.fixture_id(3)||'/'||pg_temp.fixture_id(v+100)||'.png',
      pg_temp.fixture_id(2),pg_temp.fixture_id(op+100),png->>'digest');
    select to_jsonb(t) into strict saved_approval from credential_private.versions t where id=pg_temp.fixture_id(v+100);
    select to_jsonb(t) into strict saved from credential_private.versions t where id=pg_temp.fixture_id(v);
    select count(*) into event_count from credential_private.events;
    update public.organization_member_profiles set credential_applicability='trainee' where membership_id=pg_temp.fixture_id(3);
    receipt := pg_temp.owner_command('status',null,'{}');
    perform pg_temp.ensure(receipt->>'instructorApplicable'='false' and (receipt->'instructorHistory') ? kind and
      exists(select from jsonb_array_elements(receipt->'versions') x where x->>'id'=pg_temp.fixture_id(v)::text and x->>'state'='pending' and x->'evidenceTypes'='["image/jpeg","image/png"]'),'retained pending and evidence readback');
    replace_cmd:=fixture||jsonb_build_object('category',kind,'operationId',pg_temp.fixture_id(op+1),'expectedPendingId',pg_temp.fixture_id(v),'digest',pdf->>'digest','evidenceManifest',jsonb_build_array(pdf));
    perform pg_temp.ensure(pg_temp.owner_command('prepare',v+1,replace_cmd) ? 'key'
      and (select to_jsonb(t)=saved from credential_private.versions t where id=pg_temp.fixture_id(v))
      and (select count(*)=event_count from credential_private.events),'applicability removal preserves pending, audit and exact target management');
    perform pg_temp.ensure(pg_temp.owner_command('commit',v+1,replace_cmd||jsonb_build_object('evidenceManifest',pair,'digest',jpg->>'digest')) is null
      and pg_temp.owner_command('locate',v+1,'{}') is null
      and (select to_jsonb(t)=saved from credential_private.versions t where id=pg_temp.fixture_id(v))
      and (select count(*)=event_count from credential_private.events),'incomplete replacement cannot withdraw original or create reviewable evidence');
    next_key:=pg_temp.owner_command('prepare',v+1,replace_cmd)->>'key';
    insert into storage.objects(bucket_id,name,metadata) values('credential-synthetic',next_key,jsonb_build_object('mimetype','application/pdf','size',601));
    perform pg_temp.ensure(pg_temp.owner_command('commit',v+1,replace_cmd)->>'state'='pending','PDF replacement');
    perform pg_temp.ensure(pg_temp.owner_command('serve',v+1,'{}')->>'mime'='application/pdf' and pg_temp.owner_command('locate',v,'{"slot":1}')->>'digest'=png->>'digest','PDF download and prior evidence binding');
    perform pg_temp.ensure(pg_temp.owner_command('withdraw',v+1,withdrawal)->>'state'='withdrawn','exact optional withdrawal');
    update public.organization_member_profiles set credential_applicability='trainee' where membership_id=pg_temp.fixture_id(3);
    perform pg_temp.ensure((pg_temp.owner_command('status',null,'{}')->'instructorHistory') ? kind,'withdrawn history retained');
    perform pg_temp.ensure((select to_jsonb(t)=saved_approval from credential_private.versions t where id=pg_temp.fixture_id(v+100))
      and (pg_temp.owner_command('status',null,'{}')->'versions') @> jsonb_build_array(jsonb_build_object('id',pg_temp.fixture_id(v+100),'state','approved','expiryDate','2019-01-01')),
      'approval and expiry remain visible after removal and owner transitions');
    op:=op+10; v:=v+2;
  end loop;
  perform pg_temp.ensure(not credential_private.valid_evidence_manifest(jsonb_build_array(pdf,png)) and
    not credential_private.valid_evidence_manifest(jsonb_build_array(png,jpg,png)) and
    not credential_private.valid_evidence_manifest('[]') and not credential_private.valid_evidence_manifest(jsonb_build_array(jpg||'{"size":10000001}')),'invalid combinations and metadata');
end; $proof$;
select pass('Optional FI/GI transitions, applicability changes and complete version-bound multi-file evidence');
select * from finish();
rollback;
