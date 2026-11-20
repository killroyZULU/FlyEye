-- Disposable only. Each expected P0001 must come from the pinned receipt trigger.
-- A missing guard aborts the outer transaction, including an unexpected successful probe.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
do $checks$
declare
  receipt constant regclass := 'staging_private.student_fixture_receipts'::regclass;
  principal text;
  probe text;
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = receipt) then
    raise exception 'Local Student receipt RLS check failed.';
  end if;
  foreach principal in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
    if pg_catalog.has_table_privilege(principal, receipt,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       or pg_catalog.has_any_column_privilege(principal, receipt, 'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception 'Local Student receipt privilege check failed.';
    end if;
  end loop;
  foreach probe in array array[
    'update staging_private.student_fixture_receipts set role_code = role_code where false',
    'delete from staging_private.student_fixture_receipts where false',
    'truncate only staging_private.student_fixture_receipts'
  ] loop
    begin
      execute probe;
    exception when raise_exception then
      if sqlerrm <> 'Student fixture receipts are append-only.' then raise; end if;
      continue;
    end;
    raise exception 'Local Student receipt mutation guard missing.';
  end loop;
end;
$checks$;
rollback;
select 'receipt-verified';
