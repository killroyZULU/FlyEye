begin;

alter table public.authentication_events
  drop constraint authentication_events_event_name_check,
  drop constraint authentication_events_event_outcome_match_check,
  drop constraint authentication_events_organization_scope_check,
  drop constraint authentication_events_target_check;

alter table public.authentication_events
  add constraint authentication_events_event_name_check check (
    event_name in (
      'authentication.access_context_loaded', 'authentication.access_denied',
      'admin_bootstrap.grant_issued', 'admin_onboarding.eligibility_granted',
      'admin_onboarding.eligibility_denied', 'admin_onboarding.started',
      'admin_onboarding.cancelled', 'admin_onboarding.completed',
      'admin_onboarding.denied', 'admin_onboarding.conflict',
      'admin_onboarding.grant_expired', 'member_mfa.enrollment_started',
      'member_mfa.factor_bound', 'member_mfa.enrollment_completed',
      'member_mfa.enrollment_cancelled', 'member_mfa.denied',
      'member_mfa.conflict'
    )
  ),
  add constraint authentication_events_event_outcome_match_check check (
    (event_name in (
      'authentication.access_context_loaded', 'admin_bootstrap.grant_issued',
      'admin_onboarding.eligibility_granted', 'admin_onboarding.started',
      'admin_onboarding.cancelled', 'admin_onboarding.completed',
      'member_mfa.enrollment_started', 'member_mfa.factor_bound',
      'member_mfa.enrollment_completed', 'member_mfa.enrollment_cancelled'
    ) and outcome = 'success')
    or
    (event_name in (
      'authentication.access_denied', 'admin_onboarding.eligibility_denied',
      'admin_onboarding.denied', 'admin_onboarding.conflict',
      'admin_onboarding.grant_expired', 'member_mfa.denied', 'member_mfa.conflict'
    ) and outcome = 'denied')
  ),
  add constraint authentication_events_organization_scope_check check (
    organization_id is not null
    or event_name in (
      'authentication.access_context_loaded', 'authentication.access_denied',
      'admin_bootstrap.grant_issued', 'admin_onboarding.eligibility_granted',
      'admin_onboarding.eligibility_denied', 'admin_onboarding.started',
      'admin_onboarding.cancelled', 'admin_onboarding.completed',
      'admin_onboarding.denied', 'admin_onboarding.conflict',
      'admin_onboarding.grant_expired', 'member_mfa.denied', 'member_mfa.conflict'
    )
  ),
  add constraint authentication_events_target_check check (
    (target_kind is null and target_id is null)
    or (target_kind = 'organization_admin_bootstrap_grant' and target_id is not null)
    or (target_kind = 'member_mfa_enrollment_operation' and target_id is not null)
  );

create table public.member_mfa_enrollment_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  membership_id uuid not null,
  subject_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null check (status in ('started', 'bound', 'completed', 'cancelled')),
  factor_reference_hash text check (
    factor_reference_hash is null or factor_reference_hash ~ '^[0-9a-f]{64}$'
  ),
  version bigint not null default 1 check (version > 0),
  start_idempotency_key_hash text not null check (start_idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  bind_idempotency_key_hash text check (
    bind_idempotency_key_hash is null or bind_idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  complete_idempotency_key_hash text check (
    complete_idempotency_key_hash is null or complete_idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  cancel_idempotency_key_hash text check (
    cancel_idempotency_key_hash is null or cancel_idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz not null default transaction_timestamp(),
  expires_at timestamptz not null default (transaction_timestamp() + interval '15 minutes'),
  completed_at timestamptz,
  cancelled_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, membership_id)
    references public.organization_memberships(organization_id, id) on delete restrict,
  check (expires_at = created_at + interval '15 minutes'),
  check (
    (status = 'started' and factor_reference_hash is null and completed_at is null and cancelled_at is null)
    or (status = 'bound' and factor_reference_hash is not null and completed_at is null and cancelled_at is null)
    or (status = 'completed' and factor_reference_hash is not null and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and completed_at is null and cancelled_at is not null)
  )
);

create unique index member_mfa_one_active_operation_idx
  on public.member_mfa_enrollment_operations (membership_id)
  where status in ('started', 'bound');
create unique index member_mfa_start_idempotency_idx
  on public.member_mfa_enrollment_operations (subject_user_id, start_idempotency_key_hash);
create index member_mfa_operations_org_time_idx
  on public.member_mfa_enrollment_operations (organization_id, created_at desc);

create table public.member_mfa_readiness (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  membership_id uuid not null,
  subject_user_id uuid not null references auth.users(id) on delete restrict,
  factor_reference_hash text not null check (factor_reference_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz not null,
  updated_at timestamptz not null default transaction_timestamp(),
  version bigint not null default 1 check (version > 0),
  primary key (organization_id, membership_id),
  unique (subject_user_id),
  foreign key (organization_id, membership_id)
    references public.organization_memberships(organization_id, id) on delete restrict
);

create table public.member_mfa_rate_limit_state (
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('status', 'start', 'bind_factor', 'complete', 'cancel')),
  tokens_milli bigint not null check (tokens_milli >= 0),
  last_refill_at timestamptz not null,
  last_decision_at timestamptz not null,
  primary key (limiter_key_hash, action)
);

create table public.member_mfa_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null unique,
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('status', 'start', 'bind_factor', 'complete', 'cancel')),
  outcome text not null check (outcome in ('allowed', 'rate_limited')),
  retry_after_seconds integer check (retry_after_seconds between 1 and 60),
  occurred_at timestamptz not null default transaction_timestamp(),
  check (
    (outcome = 'allowed' and retry_after_seconds is null)
    or (outcome = 'rate_limited' and retry_after_seconds is not null)
  )
);

alter table public.member_mfa_enrollment_operations enable row level security;
alter table public.member_mfa_readiness enable row level security;
alter table public.member_mfa_rate_limit_state enable row level security;
alter table public.member_mfa_rate_limit_events enable row level security;

revoke all on table public.member_mfa_enrollment_operations from public, anon, authenticated;
revoke all on table public.member_mfa_readiness from public, anon, authenticated;
revoke all on table public.member_mfa_rate_limit_state from public, anon, authenticated;
revoke all on table public.member_mfa_rate_limit_events from public, anon, authenticated;

create or replace function public.member_mfa_active_context(p_actor_user_id uuid)
returns table (organization_id uuid, membership_id uuid, organization_name text)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select membership.organization_id, membership.id, organization.name
  from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and organization.status = 'active'
  order by membership.organization_id, membership.id
$$;

revoke all on function public.member_mfa_active_context(uuid) from public, anon, authenticated;

create or replace function public.write_member_mfa_event(
  p_actor_user_id uuid,
  p_event_name text,
  p_outcome text,
  p_correlation_id uuid,
  p_reason_code text,
  p_organization_id uuid default null,
  p_membership_id uuid default null,
  p_operation_id uuid default null,
  p_idempotency_key_hash text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_event_id uuid;
begin
  if p_actor_user_id is null
     or not exists (select 1 from auth.users where id = p_actor_user_id)
     or p_event_name not in (
       'member_mfa.enrollment_started', 'member_mfa.factor_bound',
       'member_mfa.enrollment_completed', 'member_mfa.enrollment_cancelled',
       'member_mfa.denied', 'member_mfa.conflict'
     )
     or p_outcome not in ('success', 'denied')
     or p_correlation_id is null
     or p_reason_code !~ '^[a-z][a-z0-9_]{2,63}$'
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
     or (p_idempotency_key_hash is not null and p_idempotency_key_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'Member MFA audit input is invalid.';
  end if;

  insert into public.authentication_events (
    organization_id, organization_ids, actor_user_id, actor_subject_id,
    actor_kind, event_name, outcome, correlation_id, reason_code,
    target_kind, target_id, idempotency_key_hash, metadata
  ) values (
    p_organization_id,
    case when p_organization_id is null then '{}'::uuid[] else array[p_organization_id] end,
    p_actor_user_id, p_actor_user_id, 'authenticated_subject', p_event_name,
    p_outcome, p_correlation_id, p_reason_code,
    case when p_operation_id is null then null else 'member_mfa_enrollment_operation' end,
    p_operation_id, p_idempotency_key_hash,
    coalesce(p_metadata, '{}'::jsonb) ||
      case when p_membership_id is null then '{}'::jsonb
           else jsonb_build_object('membershipId', p_membership_id) end
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;

revoke all on function public.write_member_mfa_event(uuid, text, text, uuid, text, uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.write_member_mfa_event(uuid, text, text, uuid, text, uuid, uuid, uuid, text, jsonb)
  to service_role;

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

create or replace function public.get_member_mfa_status(
  p_actor_user_id uuid, p_factor_reference_hash text, p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_context_count integer;
  v_context record;
  v_ready public.member_mfa_readiness%rowtype;
  v_operation public.member_mfa_enrollment_operations%rowtype;
begin
  if p_actor_user_id is null or p_correlation_id is null
     or (p_factor_reference_hash is not null and p_factor_reference_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'Member MFA status input is invalid.';
  end if;
  select count(*) into v_context_count from public.member_mfa_active_context(p_actor_user_id);
  if v_context_count <> 1 then
    return jsonb_build_object('decision', case when v_context_count = 0 then 'not_available' else 'conflict' end, 'correlationId', p_correlation_id);
  end if;
  select * into v_context from public.member_mfa_active_context(p_actor_user_id);
  select * into v_ready from public.member_mfa_readiness
  where organization_id = v_context.organization_id
    and membership_id = v_context.membership_id
    and subject_user_id = p_actor_user_id;
  select * into v_operation from public.member_mfa_enrollment_operations
  where organization_id = v_context.organization_id
    and membership_id = v_context.membership_id
    and subject_user_id = p_actor_user_id
    and status in ('started', 'bound')
    and transaction_timestamp() < expires_at;

  if v_operation.id is not null then
    if (v_operation.status = 'started' and p_factor_reference_hash is null)
       or (v_operation.status = 'bound' and v_operation.factor_reference_hash = p_factor_reference_hash) then
      return jsonb_build_object(
        'decision', 'available', 'organizationId', v_context.organization_id,
        'organizationName', v_context.organization_name, 'membershipId', v_context.membership_id,
        'ready', false, 'operationState', v_operation.status, 'operationId', v_operation.id,
        'operationVersion', v_operation.version, 'correlationId', p_correlation_id
      );
    end if;
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;
  return jsonb_build_object(
    'decision', 'available', 'organizationId', v_context.organization_id,
    'organizationName', v_context.organization_name, 'membershipId', v_context.membership_id,
    'ready', v_ready.membership_id is not null and p_factor_reference_hash is not null
      and v_ready.factor_reference_hash = p_factor_reference_hash,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.get_member_mfa_status(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.get_member_mfa_status(uuid, text, uuid) to service_role;

create or replace function public.start_member_mfa_enrollment(
  p_actor_user_id uuid, p_factor_reference_hash text, p_idempotency_key_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_context_count integer;
  v_context record;
  v_operation public.member_mfa_enrollment_operations%rowtype;
begin
  if p_actor_user_id is null or p_correlation_id is null
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or (p_factor_reference_hash is not null and p_factor_reference_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'Member MFA start input is invalid.';
  end if;
  select count(*) into v_context_count from public.member_mfa_active_context(p_actor_user_id);
  if v_context_count <> 1 then
    perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.denied', 'denied', p_correlation_id,
      case when v_context_count = 0 then 'membership_not_available' else 'membership_conflict' end);
    return jsonb_build_object('decision', case when v_context_count = 0 then 'not_available' else 'conflict' end, 'correlationId', p_correlation_id);
  end if;
  select * into v_context from public.member_mfa_active_context(p_actor_user_id);

  perform 1 from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
  where membership.id = v_context.membership_id
    and membership.organization_id = v_context.organization_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and organization.status = 'active'
  for update of membership, organization;
  if not found then
    perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.denied', 'denied', p_correlation_id,
      'membership_not_available');
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  select * into v_operation from public.member_mfa_enrollment_operations
  where organization_id = v_context.organization_id
    and membership_id = v_context.membership_id
    and subject_user_id = p_actor_user_id
    and start_idempotency_key_hash = p_idempotency_key_hash;
  if v_operation.id is not null then
    if v_operation.status not in ('started', 'bound')
       or transaction_timestamp() >= v_operation.expires_at then
      return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
    end if;
    return jsonb_build_object('decision', 'ready', 'operationId', v_operation.id,
      'organizationId', v_operation.organization_id, 'organizationName', v_context.organization_name,
      'membershipId', v_operation.membership_id, 'operationVersion', v_operation.version,
      'replayed', true, 'correlationId', p_correlation_id);
  end if;

  update public.member_mfa_enrollment_operations
  set status = 'cancelled', cancelled_at = transaction_timestamp(), version = version + 1
  where membership_id = v_context.membership_id and status in ('started', 'bound')
    and transaction_timestamp() >= expires_at;

  if exists (select 1 from public.member_mfa_enrollment_operations
             where membership_id = v_context.membership_id and status in ('started', 'bound')) then
    perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.conflict', 'denied', p_correlation_id,
      'active_operation_exists', v_context.organization_id, v_context.membership_id);
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  insert into public.member_mfa_enrollment_operations (
    organization_id, membership_id, subject_user_id, status,
    factor_reference_hash, start_idempotency_key_hash
  ) values (
    v_context.organization_id, v_context.membership_id, p_actor_user_id,
    case when p_factor_reference_hash is null then 'started' else 'bound' end,
    p_factor_reference_hash, p_idempotency_key_hash
  ) returning * into v_operation;
  perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.enrollment_started', 'success',
    p_correlation_id, 'enrollment_started', v_context.organization_id, v_context.membership_id,
    v_operation.id, p_idempotency_key_hash, jsonb_build_object('operationVersion', v_operation.version));
  return jsonb_build_object('decision', 'ready', 'operationId', v_operation.id,
    'organizationId', v_context.organization_id, 'organizationName', v_context.organization_name,
    'membershipId', v_context.membership_id, 'operationVersion', v_operation.version,
    'replayed', false, 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.start_member_mfa_enrollment(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.start_member_mfa_enrollment(uuid, text, text, uuid) to service_role;

create or replace function public.bind_member_mfa_factor(
  p_actor_user_id uuid, p_operation_id uuid, p_expected_version bigint,
  p_factor_reference_hash text, p_idempotency_key_hash text, p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_operation public.member_mfa_enrollment_operations%rowtype;
  v_context_count integer;
  v_context record;
begin
  if p_actor_user_id is null or p_operation_id is null or p_expected_version < 1
     or p_factor_reference_hash !~ '^[0-9a-f]{64}$'
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$' or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Member MFA factor binding input is invalid.';
  end if;
  select * into v_operation from public.member_mfa_enrollment_operations
  where id = p_operation_id and subject_user_id = p_actor_user_id for update;
  if v_operation.id is null then return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id); end if;
  perform 1 from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active' and organization.status = 'active'
  order by membership.organization_id, membership.id
  for update of membership, organization;
  select count(*) into v_context_count from public.member_mfa_active_context(p_actor_user_id);
  if v_context_count <> 1 then
    perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.conflict', 'denied', p_correlation_id,
      'binding_membership_conflict', v_operation.organization_id, v_operation.membership_id, v_operation.id);
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;
  select * into v_context from public.member_mfa_active_context(p_actor_user_id);
  if v_context.organization_id <> v_operation.organization_id
     or v_context.membership_id <> v_operation.membership_id then
    perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.conflict', 'denied', p_correlation_id,
      'binding_membership_conflict', v_operation.organization_id, v_operation.membership_id, v_operation.id);
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;
  if v_operation.status = 'bound' and v_operation.bind_idempotency_key_hash = p_idempotency_key_hash
     and v_operation.factor_reference_hash = p_factor_reference_hash then
    return jsonb_build_object('decision', 'bound', 'operationId', v_operation.id,
      'operationVersion', v_operation.version, 'replayed', true, 'correlationId', p_correlation_id);
  end if;
  if v_operation.status <> 'started' or v_operation.version <> p_expected_version
     or transaction_timestamp() >= v_operation.expires_at then
    perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.conflict', 'denied', p_correlation_id,
      'operation_state_conflict', v_operation.organization_id, v_operation.membership_id, v_operation.id);
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;
  update public.member_mfa_enrollment_operations set status = 'bound',
    factor_reference_hash = p_factor_reference_hash, bind_idempotency_key_hash = p_idempotency_key_hash,
    version = version + 1 where id = v_operation.id returning * into v_operation;
  perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.factor_bound', 'success', p_correlation_id,
    'factor_bound', v_operation.organization_id, v_operation.membership_id, v_operation.id,
    p_idempotency_key_hash, jsonb_build_object('factorReferenceHash', p_factor_reference_hash,
    'operationVersion', v_operation.version));
  return jsonb_build_object('decision', 'bound', 'operationId', v_operation.id,
    'operationVersion', v_operation.version, 'replayed', false, 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.bind_member_mfa_factor(uuid, uuid, bigint, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.bind_member_mfa_factor(uuid, uuid, bigint, text, text, uuid) to service_role;

create or replace function public.complete_member_mfa_enrollment(
  p_actor_user_id uuid, p_session_id uuid, p_password_authenticated_at bigint,
  p_assurance_level text, p_authentication_methods text[], p_operation_id uuid,
  p_expected_version bigint, p_factor_reference_hash text, p_idempotency_key_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_operation public.member_mfa_enrollment_operations%rowtype;
  v_context_count integer;
  v_context record;
  v_password_time timestamptz;
  v_readiness_version bigint;
begin
  if p_actor_user_id is null or p_session_id is null or p_password_authenticated_at is null
     or p_assurance_level <> 'aal2' or not ('password' = any(p_authentication_methods))
     or not ('totp' = any(p_authentication_methods)) or p_operation_id is null
     or p_expected_version < 1 or p_factor_reference_hash !~ '^[0-9a-f]{64}$'
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$' or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Member MFA completion input is invalid.';
  end if;
  v_password_time := to_timestamp(p_password_authenticated_at);
  if v_password_time > transaction_timestamp()
     or transaction_timestamp() - v_password_time > interval '600 seconds' then
    return jsonb_build_object('decision', 'recent_authentication_required', 'correlationId', p_correlation_id);
  end if;
  select * into v_operation from public.member_mfa_enrollment_operations
  where id = p_operation_id and subject_user_id = p_actor_user_id for update;
  if v_operation.id is null then return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id); end if;
  perform 1 from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active' and organization.status = 'active'
  order by membership.organization_id, membership.id
  for update of membership, organization;
  select count(*) into v_context_count from public.member_mfa_active_context(p_actor_user_id);
  if v_context_count <> 1 then
    perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.conflict', 'denied', p_correlation_id,
      'completion_membership_conflict', v_operation.organization_id, v_operation.membership_id, v_operation.id);
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;
  select * into v_context from public.member_mfa_active_context(p_actor_user_id);
  if v_context.organization_id <> v_operation.organization_id
     or v_context.membership_id <> v_operation.membership_id then
    perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.conflict', 'denied', p_correlation_id,
      'completion_membership_conflict', v_operation.organization_id, v_operation.membership_id, v_operation.id);
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;
  if v_operation.status = 'completed' and v_operation.complete_idempotency_key_hash = p_idempotency_key_hash then
    select version into v_readiness_version from public.member_mfa_readiness
    where organization_id = v_operation.organization_id and membership_id = v_operation.membership_id;
    return jsonb_build_object('decision', 'completed', 'organizationId', v_operation.organization_id,
      'membershipId', v_operation.membership_id, 'readinessVersion', v_readiness_version,
      'replayed', true, 'correlationId', p_correlation_id);
  end if;
  if v_operation.status <> 'bound' or v_operation.version <> p_expected_version
     or v_operation.factor_reference_hash <> p_factor_reference_hash
     or transaction_timestamp() >= v_operation.expires_at
     then
    perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.conflict', 'denied', p_correlation_id,
      'completion_state_conflict', v_operation.organization_id, v_operation.membership_id, v_operation.id);
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;
  insert into public.member_mfa_readiness (
    organization_id, membership_id, subject_user_id, factor_reference_hash, verified_at
  ) values (
    v_operation.organization_id, v_operation.membership_id, p_actor_user_id,
    p_factor_reference_hash, transaction_timestamp()
  ) on conflict (organization_id, membership_id) do update set
    subject_user_id = excluded.subject_user_id,
    factor_reference_hash = excluded.factor_reference_hash,
    verified_at = excluded.verified_at, updated_at = transaction_timestamp(),
    version = public.member_mfa_readiness.version + 1
  returning version into v_readiness_version;
  update public.member_mfa_enrollment_operations set status = 'completed',
    complete_idempotency_key_hash = p_idempotency_key_hash,
    completed_at = transaction_timestamp(), version = version + 1
  where id = v_operation.id;
  perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.enrollment_completed', 'success',
    p_correlation_id, 'enrollment_completed', v_operation.organization_id, v_operation.membership_id,
    v_operation.id, p_idempotency_key_hash, jsonb_build_object(
      'factorReferenceHash', p_factor_reference_hash, 'readinessVersion', v_readiness_version));
  return jsonb_build_object('decision', 'completed', 'organizationId', v_operation.organization_id,
    'membershipId', v_operation.membership_id, 'readinessVersion', v_readiness_version,
    'replayed', false, 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.complete_member_mfa_enrollment(uuid, uuid, bigint, text, text[], uuid, bigint, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_member_mfa_enrollment(uuid, uuid, bigint, text, text[], uuid, bigint, text, text, uuid)
  to service_role;

create or replace function public.cancel_member_mfa_enrollment(
  p_actor_user_id uuid, p_operation_id uuid, p_expected_version bigint,
  p_factor_reference_hash text, p_cleanup_outcome text, p_idempotency_key_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_operation public.member_mfa_enrollment_operations%rowtype;
begin
  if p_actor_user_id is null or p_operation_id is null or p_expected_version < 1
     or p_cleanup_outcome <> 'not_required'
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$' or p_correlation_id is null
     or (p_factor_reference_hash is not null and p_factor_reference_hash !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'Member MFA cancellation input is invalid.';
  end if;
  select * into v_operation from public.member_mfa_enrollment_operations
  where id = p_operation_id and subject_user_id = p_actor_user_id for update;
  if v_operation.id is null then return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id); end if;
  if v_operation.status = 'cancelled' and v_operation.cancel_idempotency_key_hash = p_idempotency_key_hash then
    return jsonb_build_object('decision', 'cancelled', 'cleanupOutcome', 'not_required',
      'replayed', true, 'correlationId', p_correlation_id);
  end if;
  if v_operation.status <> 'started' or v_operation.version <> p_expected_version
     or v_operation.factor_reference_hash is not null or p_factor_reference_hash is not null then
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;
  update public.member_mfa_enrollment_operations set status = 'cancelled',
    cancel_idempotency_key_hash = p_idempotency_key_hash,
    cancelled_at = transaction_timestamp(), version = version + 1
  where id = v_operation.id;
  perform public.write_member_mfa_event(p_actor_user_id, 'member_mfa.enrollment_cancelled', 'success',
    p_correlation_id, 'enrollment_cancelled', v_operation.organization_id, v_operation.membership_id,
    v_operation.id, p_idempotency_key_hash, jsonb_build_object('cleanupOutcome', p_cleanup_outcome));
  return jsonb_build_object('decision', 'cancelled', 'cleanupOutcome', 'not_required',
    'replayed', false, 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.cancel_member_mfa_enrollment(uuid, uuid, bigint, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_member_mfa_enrollment(uuid, uuid, bigint, text, text, text, uuid)
  to service_role;

commit;
