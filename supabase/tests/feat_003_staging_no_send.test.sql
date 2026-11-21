begin;
select plan(9);
select has_function('staging_private', 'reject_email', array['jsonb']);
select is((select prosecdef from pg_proc where oid='staging_private.reject_email(jsonb)'::regprocedure), false, 'hook is invoker');
select is(staging_private.reject_email('{"token":"synthetic-private-canary"}'),
  '{"error":{"http_code":403,"message":"Email delivery is disabled in synthetic staging."}}'::jsonb, 'fixed rejection without payload');
select is(staging_private.reject_email(null), staging_private.reject_email('{}'), 'malformed events cannot enable delivery');
select ok(has_function_privilege('supabase_auth_admin','staging_private.reject_email(jsonb)','EXECUTE'), 'Auth may execute');
select ok(not has_function_privilege('anon','staging_private.reject_email(jsonb)','EXECUTE'), 'anonymous denied');
select ok(not has_function_privilege('authenticated','staging_private.reject_email(jsonb)','EXECUTE'), 'browser denied');
select ok(not has_function_privilege('service_role','staging_private.reject_email(jsonb)','EXECUTE'), 'application service denied');
select ok(not has_schema_privilege('authenticated','staging_private','USAGE'), 'private schema denied');
select * from finish();
rollback;
