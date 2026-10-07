begin;

-- Pre-membership Auth infrastructure, not tenant-owned application data.
-- A user has one bucket across tokens/tabs/AAL levels; deletion removes only its state.
create table public.auth_bootstrap_rate_limit_state (
  actor_user_id uuid primary key references auth.users(id) on delete cascade,
  tokens numeric not null check (tokens >= 0 and tokens <= 30),
  last_refill_at timestamptz not null
);
alter table public.auth_bootstrap_rate_limit_state enable row level security;
revoke all on public.auth_bootstrap_rate_limit_state from public, anon, authenticated, service_role;

create function public.consume_auth_bootstrap_rate_limit(
  p_actor_user_id uuid, p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '1s'
as $$
declare
  v_now timestamptz;
  v_last timestamptz;
  v_tokens numeric;
  v_allowed boolean;
  v_retry integer;
begin
  if p_actor_user_id is null or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Invalid bootstrap limiter input.';
  end if;

  insert into public.auth_bootstrap_rate_limit_state(actor_user_id, tokens, last_refill_at)
  values (p_actor_user_id, 30, clock_timestamp())
  on conflict (actor_user_id) do nothing;

  select tokens, last_refill_at into strict v_tokens, v_last
  from public.auth_bootstrap_rate_limit_state
  where actor_user_id = p_actor_user_id for update;
  -- Transaction start time may precede a concurrent decision. Sample after the lock.
  v_now := greatest(clock_timestamp(), v_last);
  v_tokens := least(30, v_tokens + extract(epoch from (v_now - v_last)) / 2);
  v_allowed := v_tokens >= 1;
  if v_allowed then
    v_tokens := v_tokens - 1;
  else
    v_retry := greatest(1, least(2, ceil((1 - v_tokens) * 2)::integer));
    perform public.record_authentication_access_decision(
      p_actor_user_id, p_actor_user_id, 'authentication.access_denied', 'denied',
      p_correlation_id, null, '{}'::uuid[], 'bootstrap_rate_limited',
      jsonb_build_object('policyVersion', 'auth-bootstrap-subject-v1')
    );
  end if;
  update public.auth_bootstrap_rate_limit_state
  set tokens = v_tokens, last_refill_at = v_now
  where actor_user_id = p_actor_user_id;

  return jsonb_build_object('allowed', v_allowed, 'retryAfterSeconds', v_retry,
    'correlationId', p_correlation_id, 'policyVersion', 'auth-bootstrap-subject-v1');
end;
$$;
revoke all on function public.consume_auth_bootstrap_rate_limit(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_auth_bootstrap_rate_limit(uuid, uuid) to service_role;

commit;
