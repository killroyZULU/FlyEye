begin;

create or replace function public.consume_member_invitation_rate_limit(
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
  v_capacity_milli bigint;
  v_refill_seconds integer;
  v_now timestamptz := transaction_timestamp();
  v_tokens_milli bigint;
  v_last_refill_at timestamptz;
  v_available_milli bigint;
  v_allowed boolean;
  v_retry_after_seconds integer;
begin
  if p_limiter_key_hash is null
     or p_limiter_key_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Limiter input is invalid.';
  end if;

  select
    case p_action
      when 'list' then 4000 when 'create' then 2000 when 'resend' then 1000
      when 'revoke' then 2000 when 'prepare' then 2000 when 'accept' then 2000
    end,
    case p_action
      when 'list' then 5 when 'create' then 600 when 'resend' then 1200
      when 'revoke' then 10 when 'prepare' then 10 when 'accept' then 10
    end
  into v_capacity_milli, v_refill_seconds;

  if v_capacity_milli is null then
    raise exception using errcode = '22023', message = 'Limiter action is invalid.';
  end if;

  delete from public.member_invitation_rate_limit_state
  where last_decision_at < v_now - interval '2 hours';

  insert into public.member_invitation_rate_limit_state (
    limiter_key_hash, action, tokens_milli, last_refill_at, last_decision_at
  ) values (
    p_limiter_key_hash, p_action, v_capacity_milli, v_now, v_now
  ) on conflict (limiter_key_hash, action) do nothing;

  select tokens_milli, last_refill_at
  into v_tokens_milli, v_last_refill_at
  from public.member_invitation_rate_limit_state
  where limiter_key_hash = p_limiter_key_hash and action = p_action
  for update;

  -- A waiter may have started before the transaction that last filled this bucket.
  -- Keep refill nonnegative and never move the effective bucket clock backward.
  v_now := greatest(v_now, v_last_refill_at);

  v_available_milli := least(
    v_capacity_milli,
    v_tokens_milli + floor(extract(epoch from (v_now - v_last_refill_at)) * 1000 / v_refill_seconds)::bigint
  );
  v_allowed := v_available_milli >= 1000;
  if v_allowed then
    v_available_milli := v_available_milli - 1000;
    v_retry_after_seconds := null;
  else
    v_retry_after_seconds := greatest(1, ceil((1000 - v_available_milli) * v_refill_seconds / 1000.0)::integer);
  end if;

  update public.member_invitation_rate_limit_state
  set tokens_milli = v_available_milli,
      last_refill_at = v_now,
      last_decision_at = v_now
  where limiter_key_hash = p_limiter_key_hash and action = p_action;

  insert into public.member_invitation_rate_limit_events (
    correlation_id, limiter_key_hash, action, outcome, status_code, retry_after_seconds
  ) values (
    p_correlation_id,
    p_limiter_key_hash,
    p_action,
    case when v_allowed then 'allowed' else 'rate_limited' end,
    case when v_allowed then 200 else 429 end,
    v_retry_after_seconds
  );

  return jsonb_build_object(
    'allowed', v_allowed,
    'retryAfterSeconds', v_retry_after_seconds,
    'correlationId', p_correlation_id,
    'networkSourceUsed', false,
    'policyVersion', 'invitation-subject-scope-v1'
  );
end;
$$;

revoke all on function public.consume_member_invitation_rate_limit(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_member_invitation_rate_limit(text, text, uuid)
  to service_role;

commit;
