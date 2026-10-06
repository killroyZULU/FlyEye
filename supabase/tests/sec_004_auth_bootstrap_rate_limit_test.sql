begin;
select no_plan();

insert into auth.users(id) values
  ('a0100000-0000-4000-8000-000000000001'),
  ('a0100000-0000-4000-8000-000000000002');

select ok((select relrowsecurity from pg_class where oid =
  'public.auth_bootstrap_rate_limit_state'::regclass), 'A010 state has RLS');
select is((select count(*)::integer from pg_policies where schemaname = 'public'
  and tablename = 'auth_bootstrap_rate_limit_state'), 0, 'A010 has no browser policies');
select ok(not has_table_privilege(r, 'public.auth_bootstrap_rate_limit_state', 'select,insert,update,delete'),
  r || ' cannot access bucket state') from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r, 'public.consume_auth_bootstrap_rate_limit(uuid,uuid)', 'execute'),
  r || ' cannot choose a limiter subject') from unnest(array['anon','authenticated']) r;
select ok(has_function_privilege('service_role', 'public.consume_auth_bootstrap_rate_limit(uuid,uuid)', 'execute'),
  'service role can consume verified subject');

select throws_ok($$select public.consume_auth_bootstrap_rate_limit(null, gen_random_uuid())$$,
  '22023', 'Invalid bootstrap limiter input.', 'null subject fails closed');
select throws_ok($$select public.consume_auth_bootstrap_rate_limit('a0100000-0000-4000-8000-000000000001', null)$$,
  '22023', 'Invalid bootstrap limiter input.', 'null correlation fails closed');
select throws_ok($$select public.consume_auth_bootstrap_rate_limit('a0100000-0000-4000-8000-000000000099', gen_random_uuid())$$,
  '23503', null, 'unknown user cannot allocate a bucket');

-- Freeze time beyond the test duration to assert an exact burst without timing flakiness.
insert into public.auth_bootstrap_rate_limit_state values
  ('a0100000-0000-4000-8000-000000000001',30,clock_timestamp() + interval '1 hour');
create temporary table decisions as select public.consume_auth_bootstrap_rate_limit(
  'a0100000-0000-4000-8000-000000000001', gen_random_uuid()) result from generate_series(1,31);
select is((select count(*)::integer from decisions where (result->>'allowed')::boolean),30,
  'exactly thirty requests fit the burst');
select is((select count(*)::integer from decisions where result->>'retryAfterSeconds' = '2'),1,
  'exhaustion gives bounded retry');
select is((select count(*)::integer from public.authentication_events where
  actor_subject_id = 'a0100000-0000-4000-8000-000000000001' and reason_code = 'bootstrap_rate_limited'),1,
  'one exhaustion produces one denial audit; allowed limiter checks create no final access event');
select ok((select organization_id is null and organization_ids = '{}'::uuid[] and
  metadata = '{"policyVersion":"auth-bootstrap-subject-v1"}'::jsonb from public.authentication_events
  where actor_subject_id = 'a0100000-0000-4000-8000-000000000001'),
  'pre-membership denial reveals no school, tokens, IP or budget');
select ok((public.consume_auth_bootstrap_rate_limit('a0100000-0000-4000-8000-000000000002',
  gen_random_uuid())->>'allowed')::boolean, 'another user remains independent of exhausted subject');

update public.auth_bootstrap_rate_limit_state set tokens = 0.25, last_refill_at = clock_timestamp() - interval '2 seconds'
where actor_user_id = 'a0100000-0000-4000-8000-000000000001';
select ok((public.consume_auth_bootstrap_rate_limit('a0100000-0000-4000-8000-000000000001',
  gen_random_uuid())->>'allowed')::boolean, 'refill recovers without reset');
select ok((select tokens >= 0.25 and tokens < 1 from public.auth_bootstrap_rate_limit_state
  where actor_user_id = 'a0100000-0000-4000-8000-000000000001'), 'fractional refill is preserved');
update public.auth_bootstrap_rate_limit_state set last_refill_at = clock_timestamp() - interval '1 day'
where actor_user_id = 'a0100000-0000-4000-8000-000000000001';
do $$ begin
  perform public.consume_auth_bootstrap_rate_limit('a0100000-0000-4000-8000-000000000001', gen_random_uuid());
end $$;
select is((select tokens from public.auth_bootstrap_rate_limit_state
  where actor_user_id = 'a0100000-0000-4000-8000-000000000001'),29::numeric, 'idle credit caps at thirty');

update public.auth_bootstrap_rate_limit_state set tokens = 0, last_refill_at = clock_timestamp() + interval '1 hour'
where actor_user_id = 'a0100000-0000-4000-8000-000000000001';
create temporary table before_failure as select * from public.auth_bootstrap_rate_limit_state;
create function pg_temp.reject_limiter_audit() returns trigger language plpgsql as $$
begin
  if new.reason_code = 'bootstrap_rate_limited' then raise exception 'Synthetic audit failure'; end if;
  return new;
end;
$$;
create trigger sec004_reject_audit before insert on public.authentication_events
for each row execute function pg_temp.reject_limiter_audit();
select throws_ok($$select public.consume_auth_bootstrap_rate_limit('a0100000-0000-4000-8000-000000000001', gen_random_uuid())$$,
  'P0001', 'Synthetic audit failure', 'audit failure aborts exhaustion decision');
select results_eq('select * from public.auth_bootstrap_rate_limit_state order by actor_user_id',
  'select * from before_failure order by actor_user_id', 'failed audit leaves limiter unchanged');
drop trigger sec004_reject_audit on public.authentication_events;
select is(public.consume_auth_bootstrap_rate_limit('a0100000-0000-4000-8000-000000000001',
  gen_random_uuid())->>'allowed','false', 'audit recovery keeps exhausted budget');
delete from auth.users where id = 'a0100000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.auth_bootstrap_rate_limit_state
  where actor_user_id = 'a0100000-0000-4000-8000-000000000002'),0, 'Auth deletion removes bucket');

select * from finish();
rollback;
