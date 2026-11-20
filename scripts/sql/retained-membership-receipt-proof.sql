-- Disposable PostgreSQL only. The caller attests the empty database and the pinned DDL.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

do $proof$
declare
  relation constant regclass := 'staging_private.retained_membership_receipts'::regclass;
  school uuid;
  ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  members uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  profiles uuid[];
  first_row staging_private.retained_membership_receipts;
  second_row staging_private.retained_membership_receipts;
  probe staging_private.retained_membership_receipts;
  field text;
  principal text;
  command text;
  violated text;
  expected_columns text[];
begin
  if exists (table staging_private.retained_membership_receipts)
     or exists (table public.organizations) or exists (table auth.users)
     or inet_server_addr() is not null or current_setting('listen_addresses') <> '' then
    raise exception 'receipt proof requires an empty socket-only fixture';
  end if;
  insert into public.organizations (name) values ('Synthetic receipt proof') returning id into school;
  for i in 1..3 loop
    insert into auth.users (id, email) values (ids[i], 'receipt-' || i || '@school.invalid');
    insert into public.organization_memberships (id, organization_id, user_id)
      values (members[i], school, ids[i]);
    insert into public.membership_roles (organization_id, membership_id, role_id)
      values (school, members[i], (select id from public.roles where code = 'student_pilot'));
    profiles[i] := (select id from public.organization_member_profiles where membership_id = members[i]);
  end loop;
  insert into staging_private.retained_membership_receipts
    (operation_id, attempt_id, run_id, project_ref, package_sha256, database_system_id,
     organization_id, slot_code, initial_role_code, event_name, user_id, membership_id, profile_id)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'ubzihnhmskkdinydlzlb',
      repeat('a', 64), (select system_identifier::text from pg_control_system()), school,
      'student_pilot', 'student_pilot', 'fixture.retained_membership_established', ids[1], members[1], profiles[1])
    returning * into first_row;
  second_row := first_row;
  second_row.operation_id := gen_random_uuid();
  second_row.attempt_id := gen_random_uuid();
  second_row.slot_code := 'instructor_pilot';
  second_row.user_id := ids[2];
  second_row.membership_id := members[2];
  second_row.profile_id := profiles[2];

  foreach field in array array['operation_id','attempt_id','slot_code','user_id','membership_id','profile_id',
                               'cross_school','cross_user','cross_membership','cross_profile'] loop
    probe := second_row;
    case field
      when 'operation_id' then probe.operation_id := first_row.operation_id;
      when 'attempt_id' then probe.attempt_id := first_row.attempt_id;
      when 'slot_code' then probe.slot_code := first_row.slot_code;
      when 'user_id' then probe.user_id := first_row.user_id;
      when 'membership_id' then probe.membership_id := first_row.membership_id;
      when 'profile_id' then probe.profile_id := first_row.profile_id;
      when 'cross_school' then probe.organization_id := gen_random_uuid();
      when 'cross_user' then probe.user_id := ids[3];
      when 'cross_membership' then probe.membership_id := members[3];
      when 'cross_profile' then probe.profile_id := profiles[3];
    end case;
    begin
      insert into staging_private.retained_membership_receipts select (probe).*;
    exception when unique_violation or foreign_key_violation then
      get stacked diagnostics violated = constraint_name;
      select array_agg(a.attname::text order by k.ord) into expected_columns
        from pg_constraint c, unnest(c.conkey) with ordinality k(num, ord), pg_attribute a
        where c.conrelid = relation and c.conname = violated
          and a.attrelid = relation and a.attnum = k.num;
      if field like 'cross_%' and sqlstate = '23503' and expected_columns[1:2] = array['organization_id','membership_id']
         or field = 'slot_code' and sqlstate = '23505' and expected_columns = array['organization_id','slot_code']
         or sqlstate = '23505' and expected_columns = array[field] then continue;
      end if;
      raise;
    end;
    raise exception 'expected constraint rejection for %', field;
  end loop;
  insert into staging_private.retained_membership_receipts select (second_row).*;
  if (select count(*) from staging_private.retained_membership_receipts
      where run_id = first_row.run_id and organization_id = school and initial_role_code = 'student_pilot') <> 2 then
    raise exception 'both retained slots required';
  end if;

  if not (select relrowsecurity from pg_class where oid = relation) then raise exception 'RLS missing'; end if;
  foreach principal in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
    if has_table_privilege(principal, relation, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       or has_any_column_privilege(principal, relation, 'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception 'unexpected retained receipt privilege for %', principal;
    end if;
  end loop;
  foreach command in array array[
    'update staging_private.retained_membership_receipts set run_id = run_id',
    'delete from staging_private.retained_membership_receipts',
    'truncate only staging_private.retained_membership_receipts'
  ] loop
    begin
      execute command;
    exception when raise_exception then
      if sqlerrm = 'Student fixture receipts are append-only.' then continue; end if;
      raise;
    end;
    raise exception 'missing append-only guard';
  end loop;
end;
$proof$;
rollback;

do $$ begin
  if exists (table auth.users) or exists (table public.organizations)
    or exists (table public.organization_memberships) or exists (table public.organization_member_profiles)
    or exists (table public.membership_roles) or exists (table staging_private.retained_membership_receipts)
    then raise exception 'receipt proof residue'; end if;
end $$;
select 'retained-receipt-proof-passed';
