begin;

-- Dormant until the separately approved staging Auth configuration selects it.
-- Never inspect, store, log or return the secret-bearing Auth event.
create schema if not exists staging_private;
revoke all on schema staging_private from public, anon, authenticated, service_role;
grant usage on schema staging_private to supabase_auth_admin;

create function staging_private.reject_email(event jsonb)
returns jsonb
language sql
security invoker
set search_path = pg_catalog
as $$
  select '{"error":{"http_code":403,"message":"Email delivery is disabled in synthetic staging."}}'::jsonb;
$$;

revoke all on function staging_private.reject_email(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function staging_private.reject_email(jsonb) to supabase_auth_admin;

commit;
