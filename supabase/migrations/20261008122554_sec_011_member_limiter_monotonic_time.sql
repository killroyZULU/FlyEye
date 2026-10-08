create or replace function public.consume_member_administration_rate_limit(
  p_limiter_key_hash text,
  p_action text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_group text;
  v_capacity numeric;
  v_refill_per_second numeric;
  v_tokens numeric;
  v_updated_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_allowed boolean;
  v_retry integer;
begin
  if p_limiter_key_hash is null
     or p_limiter_key_hash !~ '^[0-9a-f]{64}$'
     or p_action is null
     or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Limiter input is invalid.';
  end if;

  if p_action in ('list', 'detail') then
    v_group := 'directory'; v_capacity := 10; v_refill_per_second := 0.5;
  elsif p_action in ('get_profile', 'update_profile') then
    v_group := 'profile'; v_capacity := 4; v_refill_per_second := 0.2;
  elsif p_action in ('suspend', 'reactivate', 'revoke', 'assign_role') then
    v_group := 'status'; v_capacity := 2; v_refill_per_second := 0.1;
  else
    raise exception using errcode = '22023', message = 'Limiter action is invalid.';
  end if;

  insert into public.member_administration_rate_limit_state (
    limiter_key_hash, action_group, tokens, updated_at
  ) values (
    p_limiter_key_hash, v_group, v_capacity, v_now
  ) on conflict do nothing;

  select state.tokens, state.updated_at
  into v_tokens, v_updated_at
  from public.member_administration_rate_limit_state state
  where state.limiter_key_hash = p_limiter_key_hash
    and state.action_group = v_group
  for update;

  -- A request can sample its clock before waiting on a newer bucket owner.
  -- Preserve elapsed-refill accounting without moving effective time backward.
  v_now := greatest(v_now, v_updated_at);

  v_tokens := least(
    v_capacity,
    v_tokens + greatest(0, extract(epoch from (v_now - v_updated_at))) * v_refill_per_second
  );
  v_allowed := v_tokens >= 1;
  if v_allowed then
    v_tokens := v_tokens - 1;
    v_retry := null;
  else
    v_retry := least(3600, greatest(1, ceil((1 - v_tokens) / v_refill_per_second)::integer));
  end if;

  update public.member_administration_rate_limit_state
  set tokens = v_tokens,
      updated_at = v_now
  where limiter_key_hash = p_limiter_key_hash
    and action_group = v_group;

  insert into public.member_administration_rate_limit_events (
    limiter_key_hash, action_group, outcome, retry_after_seconds, correlation_id, metadata
  ) values (
    p_limiter_key_hash,
    v_group,
    case when v_allowed then 'allowed' else 'rate_limited' end,
    v_retry,
    p_correlation_id,
    jsonb_build_object('policyVersion', 'member-administration-subject-scope-v1')
  );

  return jsonb_build_object(
    'allowed', v_allowed,
    'retryAfterSeconds', v_retry,
    'correlationId', p_correlation_id,
    'networkSourceUsed', false,
    'policyVersion', 'member-administration-subject-scope-v1'
  );
end;
$$;

revoke all on function public.consume_member_administration_rate_limit(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_member_administration_rate_limit(text, text, uuid)
  to service_role;
