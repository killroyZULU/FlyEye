begin;

alter table public.authentication_events
  drop constraint authentication_events_actor_source_check;

alter table public.authentication_events
  add constraint authentication_events_actor_source_check
    check (
      (
        actor_kind = 'authenticated_subject'
        and actor_subject_id is not null
        and source_code is null
        and source_instance_id is null
        and event_name <> 'admin_bootstrap.grant_issued'
      )
      or
      (
        actor_kind = 'local_fixture'
        and actor_user_id is null
        and actor_subject_id is null
        and source_code = 'feat-003-local-cli-fixture'
        and source_instance_id is not null
        and event_name = 'admin_bootstrap.grant_issued'
      )
      or
      (
        actor_kind = 'staging_fixture'
        and actor_user_id is null
        and actor_subject_id is null
        and source_code = 'feat-003-staging-synthetic-cli'
        and source_instance_id is not null
        and event_name = 'admin_bootstrap.grant_issued'
      )
    );

alter table public.organization_admin_bootstrap_grants
  alter column authorization_source_kind drop default,
  alter column authorization_source_code drop default;

do $$
declare
  v_constraint_name text;
  v_constraint_count integer;
begin
  select count(*), min(constraint_row.conname)
  into v_constraint_count, v_constraint_name
  from (
    select constraint_record.conname
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.organization_admin_bootstrap_grants'::regclass
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid) like '%authorization_source_kind%'
      and pg_get_constraintdef(constraint_record.oid) like '%authorization_source_code%'
  ) constraint_row;

  if v_constraint_count <> 1 or v_constraint_name is null then
    raise exception using
      errcode = '55000',
      message = 'Expected one FEAT-003 bootstrap authorization-source constraint.';
  end if;

  execute format(
    'alter table public.organization_admin_bootstrap_grants drop constraint %I',
    v_constraint_name
  );
end;
$$;

alter table public.organization_admin_bootstrap_grants
  add constraint organization_admin_bootstrap_grants_authorization_source_check
    check (
      authorized_by_subject_id is null
      and (
        (
          authorization_source_kind = 'local_fixture'
          and authorization_source_code = 'feat-003-local-cli-fixture'
        )
        or
        (
          authorization_source_kind = 'staging_fixture'
          and authorization_source_code = 'feat-003-staging-synthetic-cli'
        )
      )
    );

alter table public.admin_onboarding_rate_limit_events
  add column policy_version text not null default 'subject-action-v1'
    check (policy_version = 'subject-action-v1');

create or replace function public.consume_admin_onboarding_rate_limit(
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
  v_now timestamptz;
  v_tokens_milli bigint;
  v_last_refill_at timestamptz;
  v_refilled_milli bigint;
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
      when 'status' then 4000
      when 'start' then 2000
      when 'complete' then 1000
      when 'cancel' then 2000
    end,
    case p_action
      when 'status' then 5
      when 'start' then 15
      when 'complete' then 20
      when 'cancel' then 10
    end
  into v_capacity_milli, v_refill_seconds;

  if v_capacity_milli is null then
    raise exception using errcode = '22023', message = 'Limiter action is invalid.';
  end if;

  v_now := transaction_timestamp();

  delete from public.admin_onboarding_rate_limit_state
  where last_decision_at < v_now - interval '15 minutes';

  insert into public.admin_onboarding_rate_limit_state (
    limiter_key_hash,
    action,
    tokens_milli,
    last_refill_at,
    last_decision_at
  )
  values (
    p_limiter_key_hash,
    p_action,
    v_capacity_milli,
    v_now,
    v_now
  )
  on conflict (limiter_key_hash, action) do nothing;

  select tokens_milli, last_refill_at
  into v_tokens_milli, v_last_refill_at
  from public.admin_onboarding_rate_limit_state
  where limiter_key_hash = p_limiter_key_hash
    and action = p_action
  for update;

  v_now := greatest(v_now, v_last_refill_at);
  v_refilled_milli := floor(
    extract(epoch from (v_now - v_last_refill_at)) * 1000 / v_refill_seconds
  )::bigint;
  v_available_milli := least(v_capacity_milli, v_tokens_milli + v_refilled_milli);
  v_allowed := v_available_milli >= 1000;

  if v_allowed then
    v_available_milli := v_available_milli - 1000;
    v_retry_after_seconds := null;
  else
    v_retry_after_seconds := greatest(
      1,
      ceil(((1000 - v_available_milli)::numeric * v_refill_seconds) / 1000)::integer
    );
  end if;

  update public.admin_onboarding_rate_limit_state
  set tokens_milli = v_available_milli,
      last_refill_at = v_now,
      last_decision_at = v_now
  where limiter_key_hash = p_limiter_key_hash
    and action = p_action;

  insert into public.admin_onboarding_rate_limit_events (
    correlation_id,
    limiter_key_hash,
    action,
    outcome,
    status_code,
    retry_after_seconds,
    network_source_used,
    policy_version
  )
  values (
    p_correlation_id,
    p_limiter_key_hash,
    p_action,
    case when v_allowed then 'allowed' else 'rate_limited' end,
    case when v_allowed then 200 else 429 end,
    v_retry_after_seconds,
    false,
    'subject-action-v1'
  );

  return jsonb_build_object(
    'allowed', v_allowed,
    'retryAfterSeconds', v_retry_after_seconds,
    'correlationId', p_correlation_id,
    'networkSourceUsed', false,
    'policyVersion', 'subject-action-v1'
  );
end;
$$;

revoke all on function public.consume_admin_onboarding_rate_limit(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_admin_onboarding_rate_limit(text, text, uuid)
  to service_role;

comment on column public.admin_onboarding_rate_limit_events.policy_version is
  'Versioned FEAT-003 limiter contract; Edge execution fails closed on mismatch.';
comment on table public.organization_admin_bootstrap_grants is
  'FEAT-003 server-only grants; staging fixture provenance is dormant until a separate hosted activation.';
comment on function public.consume_admin_onboarding_rate_limit(text, text, uuid) is
  'Server-only FEAT-003 atomic subject-action-v1 token-bucket decision and minimized evidence.';

commit;
