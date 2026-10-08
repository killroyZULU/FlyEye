create or replace function public.consume_member_mfa_rate_limit(
  p_limiter_key_hash text, p_action text, p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_capacity bigint;
  v_refill_seconds integer;
  v_now timestamptz := transaction_timestamp();
  v_tokens bigint;
  v_last timestamptz;
  v_available bigint;
  v_allowed boolean;
  v_retry integer;
begin
  if p_limiter_key_hash !~ '^[0-9a-f]{64}$'
     or p_action not in ('status', 'start', 'bind_factor', 'complete', 'cancel')
     or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Member MFA limiter input is invalid.';
  end if;
  v_capacity := case p_action when 'status' then 6000 when 'complete' then 1000 else 2000 end;
  v_refill_seconds := case p_action when 'status' then 5 when 'complete' then 30 else 15 end;
  insert into public.member_mfa_rate_limit_state
    (limiter_key_hash, action, tokens_milli, last_refill_at, last_decision_at)
  values (p_limiter_key_hash, p_action, v_capacity, v_now, v_now)
  on conflict do nothing;
  select tokens_milli, last_refill_at into v_tokens, v_last
  from public.member_mfa_rate_limit_state
  where limiter_key_hash = p_limiter_key_hash and action = p_action for update;
  -- An older transaction can wait behind a newer bucket owner.
  -- Keep refill time monotonic while retaining transaction-time events.
  v_now := greatest(v_now, v_last);

  v_available := least(v_capacity, v_tokens + floor(extract(epoch from (v_now - v_last)) * 1000 / v_refill_seconds)::bigint);
  v_allowed := v_available >= 1000;
  if v_allowed then
    v_available := v_available - 1000;
    v_retry := null;
  else
    v_retry := greatest(1, ceil(((1000 - v_available)::numeric * v_refill_seconds) / 1000)::integer);
  end if;
  update public.member_mfa_rate_limit_state
  set tokens_milli = v_available, last_refill_at = v_now, last_decision_at = v_now
  where limiter_key_hash = p_limiter_key_hash and action = p_action;
  insert into public.member_mfa_rate_limit_events
    (correlation_id, limiter_key_hash, action, outcome, retry_after_seconds)
  values (p_correlation_id, p_limiter_key_hash, p_action,
    case when v_allowed then 'allowed' else 'rate_limited' end, v_retry);
  return jsonb_build_object(
    'allowed', v_allowed, 'retryAfterSeconds', v_retry,
    'correlationId', p_correlation_id, 'networkSourceUsed', false,
    'policyVersion', 'member-mfa-subject-action-v1'
  );
end;
$$;

revoke all on function public.consume_member_mfa_rate_limit(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_member_mfa_rate_limit(text, text, uuid) to service_role;
