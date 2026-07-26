begin;

select plan(2);

-- Keep these schemas aligned with [api].schemas in supabase/config.toml.
-- Ordinary and partitioned tables are the PostgreSQL relation types that
-- support ENABLE ROW LEVEL SECURITY.
select is_empty(
  $$
    select format('%I.%I', namespace.nspname, relation.relname) as table_name
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'graphql_public')
      and relation.relkind in ('r', 'p')
      and not relation.relrowsecurity
    order by table_name
  $$,
  'Every table in an exposed application schema has RLS enabled'
);

create table public.schema_wide_rls_negative_fixture (
  id bigint generated always as identity primary key
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'graphql_public')
      and relation.relkind in ('r', 'p')
      and not relation.relrowsecurity
      and namespace.nspname = 'public'
      and relation.relname = 'schema_wide_rls_negative_fixture'
  ),
  1,
  'The schema-wide discovery detects a newly added table without RLS'
);

select * from finish();
rollback;
