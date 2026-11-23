-- Rollback-only assertions on the runner's isolated, populated school.
begin;
do $proof$
declare
  mother credential_private.versions%rowtype;
  sample_id uuid := gen_random_uuid();
  bad numeric;
  level_number integer;
begin
  select * into strict mother from credential_private.versions where category='mother_license' and state='pending';
  if mother.license_type is null or mother.license_number is null or mother.elp_level is not null then
    raise exception 'invalid mother license shape';
  end if;
  insert into credential_private.versions(id,organization_id,membership_id,category,state,issued_on,expires_on,
    no_expiry,elp_level,object_key,submitted_by,operation_id,evidence_sha256)
    values(sample_id,mother.organization_id,mother.membership_id,'elp','pending','2020-01-01',null,true,6,
      sample_id::text,mother.submitted_by,gen_random_uuid(),mother.evidence_sha256);
  for level_number in 1..6 loop
    update credential_private.versions set elp_level=level_number where id=sample_id;
  end loop;
  foreach bad in array array[null,0,2.5,7]::numeric[] loop
    begin
      update credential_private.versions set elp_level=bad where id=sample_id;
      raise exception 'invalid ELP level accepted';
    exception when check_violation then null;
    end;
  end loop;
  begin
    update credential_private.versions set license_type='SPL' where id=sample_id;
    raise exception 'mixed fields accepted';
  exception when check_violation then null;
  end;
  begin
    update credential_private.versions set no_expiry=false where id=sample_id;
    raise exception 'implicit no expiry accepted';
  exception when check_violation then null;
  end;
  begin
    update credential_private.versions set license_number=null where id=mother.id;
    raise exception 'mother license number became optional';
  exception when check_violation then null;
  end;
  if has_table_privilege('authenticated','credential_private.versions','INSERT') or
    has_table_privilege('anon','credential_private.versions','SELECT') then raise exception 'unexpected grant'; end if;
end; $proof$;
rollback;
