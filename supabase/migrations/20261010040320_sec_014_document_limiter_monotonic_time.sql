create or replace function public.consume_aircraft_document_rate_limit(
  p_limiter_key_hash text,
  p_bucket text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_capacity numeric;
  v_refill numeric;
  v_now timestamptz := clock_timestamp();
  v_tokens numeric;
  v_updated_at timestamptz;
  v_allowed boolean;
  v_retry integer;
begin
  if p_limiter_key_hash !~ '^[0-9a-f]{64}$' or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Aircraft document limiter input is invalid.';
  end if;
  case p_bucket
    when 'general' then v_capacity := 60; v_refill := 2;
    when 'read' then v_capacity := 30; v_refill := 1;
    when 'mutation' then v_capacity := 6; v_refill := 0.1;
    when 'lifecycle' then v_capacity := 3; v_refill := 1.0 / 30.0;
    when 'upload' then v_capacity := 3; v_refill := 1.0 / 30.0;
    when 'download' then v_capacity := 10; v_refill := 1.0 / 6.0;
    else raise exception using errcode = '22023', message = 'Aircraft document limiter bucket is invalid.';
  end case;

  insert into public.aircraft_document_rate_limit_state (
    limiter_key_hash, bucket, tokens, updated_at
  ) values (p_limiter_key_hash, p_bucket, v_capacity, v_now)
  on conflict do nothing;

  select state.tokens, state.updated_at into v_tokens, v_updated_at
  from public.aircraft_document_rate_limit_state state
  where state.limiter_key_hash = p_limiter_key_hash and state.bucket = p_bucket
  for update;

  -- An older waiter must not rewind the refill timestamp committed by its lock owner.
  -- Preserve invocation-time sampling when it is later than the stored timestamp.
  v_now := greatest(v_now, v_updated_at);

  v_tokens := least(
    v_capacity,
    v_tokens + greatest(0, extract(epoch from (v_now - v_updated_at))) * v_refill
  );
  v_allowed := v_tokens >= 1;
  if v_allowed then
    v_tokens := v_tokens - 1;
    v_retry := null;
  else
    v_retry := least(3600, greatest(1, ceil((1 - v_tokens) / v_refill)::integer));
  end if;

  update public.aircraft_document_rate_limit_state
  set tokens = v_tokens, updated_at = v_now
  where limiter_key_hash = p_limiter_key_hash and bucket = p_bucket;

  insert into public.aircraft_document_rate_limit_events (
    limiter_key_hash, bucket, outcome, retry_after_seconds, correlation_id
  ) values (
    p_limiter_key_hash, p_bucket,
    case when v_allowed then 'allowed' else 'rate_limited' end,
    v_retry, p_correlation_id
  );

  return jsonb_build_object(
    'allowed', v_allowed,
    'retryAfterSeconds', v_retry,
    'correlationId', p_correlation_id,
    'policyVersion', 'aircraft-documents-v1'
  );
end;
$$;

revoke all on function public.consume_aircraft_document_rate_limit(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_aircraft_document_rate_limit(text, text, uuid)
  to service_role;
