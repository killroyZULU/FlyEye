begin;

alter table public.authentication_events
  drop constraint authentication_events_check,
  drop constraint authentication_events_event_name_check,
  drop constraint authentication_events_outcome_check,
  drop constraint authentication_events_event_outcome_match_check;

alter table public.authentication_events
  add column actor_kind text not null default 'authenticated_subject',
  add column source_code text,
  add column source_instance_id uuid,
  add column target_kind text,
  add column target_id uuid,
  add column idempotency_key_hash text;

alter table public.authentication_events
  add constraint authentication_events_event_name_check
    check (
      event_name in (
        'authentication.access_context_loaded',
        'authentication.access_denied',
        'admin_bootstrap.grant_issued',
        'admin_onboarding.eligibility_granted',
        'admin_onboarding.eligibility_denied',
        'admin_onboarding.started',
        'admin_onboarding.cancelled',
        'admin_onboarding.completed',
        'admin_onboarding.denied',
        'admin_onboarding.conflict',
        'admin_onboarding.grant_expired'
      )
    ),
  add constraint authentication_events_outcome_check
    check (outcome in ('success', 'denied')),
  add constraint authentication_events_event_outcome_match_check
    check (
      (event_name in (
        'authentication.access_context_loaded',
        'admin_bootstrap.grant_issued',
        'admin_onboarding.eligibility_granted',
        'admin_onboarding.started',
        'admin_onboarding.cancelled',
        'admin_onboarding.completed'
      ) and outcome = 'success')
      or
      (event_name in (
        'authentication.access_denied',
        'admin_onboarding.eligibility_denied',
        'admin_onboarding.denied',
        'admin_onboarding.conflict',
        'admin_onboarding.grant_expired'
      ) and outcome = 'denied')
    ),
  add constraint authentication_events_organization_scope_check
    check (
      organization_id is not null
      or event_name in (
        'authentication.access_context_loaded',
        'authentication.access_denied',
        'admin_bootstrap.grant_issued',
        'admin_onboarding.eligibility_granted',
        'admin_onboarding.eligibility_denied',
        'admin_onboarding.started',
        'admin_onboarding.cancelled',
        'admin_onboarding.completed',
        'admin_onboarding.denied',
        'admin_onboarding.conflict',
        'admin_onboarding.grant_expired'
      )
    ),
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
    ),
  add constraint authentication_events_target_check
    check (
      (target_kind is null and target_id is null)
      or
      (target_kind = 'organization_admin_bootstrap_grant' and target_id is not null)
    ),
  add constraint authentication_events_idempotency_hash_check
    check (
      idempotency_key_hash is null
      or idempotency_key_hash ~ '^[0-9a-f]{64}$'
    );

create unique index authentication_events_admin_action_idempotency_idx
  on public.authentication_events (
    actor_subject_id,
    event_name,
    target_id,
    idempotency_key_hash
  )
  where event_name in ('admin_onboarding.started', 'admin_onboarding.cancelled')
    and idempotency_key_hash is not null;

create table public.organization_admin_bootstrap_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  eligible_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'revoked', 'expired')),
  version bigint not null default 1 check (version > 0),
  issued_at timestamptz not null default transaction_timestamp(),
  expires_at timestamptz not null default (transaction_timestamp() + interval '30 minutes'),
  authorization_source_kind text not null default 'local_fixture',
  authorization_source_code text not null default 'feat-003-local-cli-fixture',
  authorization_source_instance_id uuid not null,
  authorized_by_subject_id uuid,
  issuance_correlation_id uuid not null unique,
  created_at timestamptz not null default transaction_timestamp(),
  completed_at timestamptz,
  completed_membership_id uuid,
  revoked_at timestamptz,
  completion_idempotency_key_hash text,
  unique (organization_id, id),
  foreign key (organization_id, completed_membership_id)
    references public.organization_memberships(organization_id, id)
    on delete restrict,
  check (expires_at = issued_at + interval '30 minutes'),
  check (
    authorization_source_kind = 'local_fixture'
    and authorization_source_code = 'feat-003-local-cli-fixture'
    and authorized_by_subject_id is null
  ),
  check (
    completion_idempotency_key_hash is null
    or completion_idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  check (
    (status = 'pending'
      and completed_at is null
      and completed_membership_id is null
      and revoked_at is null
      and completion_idempotency_key_hash is null)
    or
    (status = 'completed'
      and completed_at is not null
      and completed_membership_id is not null
      and revoked_at is null
      and completion_idempotency_key_hash is not null)
    or
    (status = 'revoked'
      and completed_at is null
      and completed_membership_id is null
      and revoked_at is not null
      and completion_idempotency_key_hash is null)
    or
    (status = 'expired'
      and completed_at is null
      and completed_membership_id is null
      and revoked_at is null
      and completion_idempotency_key_hash is null)
  )
);

create index organization_admin_bootstrap_grants_subject_status_idx
  on public.organization_admin_bootstrap_grants (
    eligible_user_id,
    status,
    expires_at,
    organization_id
  );
create index organization_admin_bootstrap_grants_org_status_idx
  on public.organization_admin_bootstrap_grants (
    organization_id,
    status,
    expires_at,
    eligible_user_id
  );

create table public.admin_onboarding_rate_limit_state (
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('status', 'start', 'complete', 'cancel')),
  tokens_milli bigint not null check (tokens_milli >= 0),
  last_refill_at timestamptz not null,
  last_decision_at timestamptz not null,
  primary key (limiter_key_hash, action)
);

create index admin_onboarding_rate_limit_state_inactive_idx
  on public.admin_onboarding_rate_limit_state (last_decision_at);

create table public.admin_onboarding_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null unique,
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('status', 'start', 'complete', 'cancel')),
  outcome text not null check (outcome in ('allowed', 'rate_limited')),
  status_code integer not null check (status_code in (200, 429)),
  retry_after_seconds integer
    check (retry_after_seconds is null or retry_after_seconds between 1 and 60),
  network_source_used boolean not null default false check (not network_source_used),
  occurred_at timestamptz not null default transaction_timestamp(),
  check (
    (outcome = 'allowed' and status_code = 200 and retry_after_seconds is null)
    or
    (outcome = 'rate_limited' and status_code = 429 and retry_after_seconds is not null)
  )
);

create index admin_onboarding_rate_limit_events_time_idx
  on public.admin_onboarding_rate_limit_events (occurred_at desc);
create index admin_onboarding_rate_limit_events_action_time_idx
  on public.admin_onboarding_rate_limit_events (action, occurred_at desc);

alter table public.organization_admin_bootstrap_grants enable row level security;
alter table public.admin_onboarding_rate_limit_state enable row level security;
alter table public.admin_onboarding_rate_limit_events enable row level security;

revoke all on table public.organization_admin_bootstrap_grants
  from public, anon, authenticated;
revoke all on table public.admin_onboarding_rate_limit_state
  from public, anon, authenticated;
revoke all on table public.admin_onboarding_rate_limit_events
  from public, anon, authenticated;

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
    network_source_used
  )
  values (
    p_correlation_id,
    p_limiter_key_hash,
    p_action,
    case when v_allowed then 'allowed' else 'rate_limited' end,
    case when v_allowed then 200 else 429 end,
    v_retry_after_seconds,
    false
  );

  return jsonb_build_object(
    'allowed', v_allowed,
    'retryAfterSeconds', v_retry_after_seconds,
    'correlationId', p_correlation_id,
    'networkSourceUsed', false
  );
end;
$$;

revoke all on function public.consume_admin_onboarding_rate_limit(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_admin_onboarding_rate_limit(text, text, uuid)
  to service_role;

create or replace function public.write_admin_onboarding_event(
  p_actor_user_id uuid,
  p_actor_subject_id uuid,
  p_event_name text,
  p_outcome text,
  p_correlation_id uuid,
  p_organization_id uuid,
  p_organization_ids uuid[],
  p_reason_code text,
  p_target_id uuid,
  p_idempotency_key_hash text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_user_id uuid;
  v_event_id uuid;
begin
  if p_actor_subject_id is null
     or p_event_name not in (
       'admin_onboarding.eligibility_granted',
       'admin_onboarding.eligibility_denied',
       'admin_onboarding.started',
       'admin_onboarding.cancelled',
       'admin_onboarding.completed',
       'admin_onboarding.denied',
       'admin_onboarding.conflict',
       'admin_onboarding.grant_expired'
     )
     or p_outcome not in ('success', 'denied')
     or p_correlation_id is null
     or p_reason_code is null
     or p_reason_code !~ '^[a-z][a-z0-9_]{2,63}$'
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
     or (
       p_idempotency_key_hash is not null
       and p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     ) then
    raise exception using errcode = '22023', message = 'Onboarding audit input is invalid.';
  end if;

  select id into v_actor_user_id
  from auth.users
  where id = p_actor_user_id
    and id = p_actor_subject_id;

  if v_actor_user_id is null then
    raise exception using errcode = '28000', message = 'Authenticated actor is invalid.';
  end if;

  insert into public.authentication_events (
    organization_id,
    organization_ids,
    actor_user_id,
    actor_subject_id,
    actor_kind,
    event_name,
    outcome,
    correlation_id,
    reason_code,
    target_kind,
    target_id,
    idempotency_key_hash,
    metadata
  )
  values (
    p_organization_id,
    coalesce(p_organization_ids, '{}'::uuid[]),
    v_actor_user_id,
    p_actor_subject_id,
    'authenticated_subject',
    p_event_name,
    p_outcome,
    p_correlation_id,
    p_reason_code,
    case when p_target_id is null then null else 'organization_admin_bootstrap_grant' end,
    p_target_id,
    p_idempotency_key_hash,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.write_admin_onboarding_event(
  uuid, uuid, text, text, uuid, uuid, uuid[], text, uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.write_admin_onboarding_event(
  uuid, uuid, text, text, uuid, uuid, uuid[], text, uuid, text, jsonb
) to service_role;

create or replace function public.get_organization_admin_onboarding_status(
  p_actor_user_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_grants jsonb;
  v_organization_ids uuid[];
  v_grant_count integer;
  v_expired record;
begin
  if p_actor_user_id is null
     or p_correlation_id is null
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  for v_expired in
    update public.organization_admin_bootstrap_grants grant_row
    set status = 'expired',
        version = version + 1
    where grant_row.eligible_user_id = p_actor_user_id
      and grant_row.status = 'pending'
      and transaction_timestamp() >= grant_row.expires_at
    returning grant_row.id, grant_row.organization_id, grant_row.version
  loop
    perform public.write_admin_onboarding_event(
      p_actor_user_id,
      p_actor_user_id,
      'admin_onboarding.grant_expired',
      'denied',
      gen_random_uuid(),
      v_expired.organization_id,
      array[v_expired.organization_id],
      'grant_expired',
      v_expired.id,
      null,
      jsonb_build_object('grantVersion', v_expired.version)
    );
  end loop;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bootstrapGrantId', grant_row.id,
          'organizationId', organization.id,
          'organizationName', organization.name,
          'grantVersion', grant_row.version,
          'expiresAt', grant_row.expires_at
        )
        order by organization.name, organization.id, grant_row.id
      ),
      '[]'::jsonb
    ),
    coalesce(array_agg(organization.id order by organization.id), '{}'::uuid[]),
    count(*)::integer
  into v_grants, v_organization_ids, v_grant_count
  from public.organization_admin_bootstrap_grants grant_row
  join public.organizations organization
    on organization.id = grant_row.organization_id
   and organization.status = 'active'
  where grant_row.eligible_user_id = p_actor_user_id
    and grant_row.status = 'pending'
    and transaction_timestamp() < grant_row.expires_at
    and not exists (
      select 1
      from public.organization_memberships membership
      join public.membership_roles membership_role
        on membership_role.organization_id = membership.organization_id
       and membership_role.membership_id = membership.id
      join public.roles role
        on role.id = membership_role.role_id
       and role.code = 'admin'
       and role.is_active
      where membership.organization_id = grant_row.organization_id
        and membership.status = 'active'
    );

  perform public.write_admin_onboarding_event(
    p_actor_user_id,
    p_actor_user_id,
    case
      when v_grant_count > 0 then 'admin_onboarding.eligibility_granted'
      else 'admin_onboarding.eligibility_denied'
    end,
    case when v_grant_count > 0 then 'success' else 'denied' end,
    p_correlation_id,
    case when cardinality(v_organization_ids) = 1 then v_organization_ids[1] else null end,
    v_organization_ids,
    case when v_grant_count > 0 then 'eligible_grant_available' else 'no_eligible_grant' end,
    null,
    null,
    jsonb_build_object('grantCount', v_grant_count)
  );

  return jsonb_build_object(
    'grants', v_grants,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.get_organization_admin_onboarding_status(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_organization_admin_onboarding_status(uuid, uuid)
  to service_role;

create or replace function public.start_organization_admin_onboarding(
  p_actor_user_id uuid,
  p_bootstrap_grant_id uuid,
  p_expected_version bigint,
  p_idempotency_key_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_organization_id uuid;
  v_organization_name text;
  v_organization_status text;
  v_grant public.organization_admin_bootstrap_grants%rowtype;
  v_replay boolean;
begin
  if p_actor_user_id is null
     or p_bootstrap_grant_id is null
     or p_expected_version is null
     or p_expected_version < 1
     or p_idempotency_key_hash is null
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception using errcode = '22023', message = 'Onboarding start input is invalid.';
  end if;

  select organization_id into v_organization_id
  from public.organization_admin_bootstrap_grants
  where id = p_bootstrap_grant_id;

  if v_organization_id is null then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_user_id, 'admin_onboarding.denied', 'denied',
      p_correlation_id, null, '{}'::uuid[], 'grant_not_available', null, null, '{}'::jsonb
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  select name, status into v_organization_name, v_organization_status
  from public.organizations
  where id = v_organization_id
  for update;

  select * into v_grant
  from public.organization_admin_bootstrap_grants
  where id = p_bootstrap_grant_id
  for update;

  if v_grant.eligible_user_id <> p_actor_user_id then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_user_id, 'admin_onboarding.denied', 'denied',
      p_correlation_id, null, '{}'::uuid[], 'grant_not_available', null, null, '{}'::jsonb
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  if v_grant.organization_id <> v_organization_id
     or v_organization_name is null
     or v_organization_status <> 'active'
     or v_grant.status <> 'pending'
     or v_grant.version <> p_expected_version
     or transaction_timestamp() >= v_grant.expires_at then
    if v_grant.status = 'pending' and transaction_timestamp() >= v_grant.expires_at then
      update public.organization_admin_bootstrap_grants
      set status = 'expired', version = version + 1
      where id = v_grant.id;
      perform public.write_admin_onboarding_event(
        p_actor_user_id, p_actor_user_id, 'admin_onboarding.grant_expired', 'denied',
        p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
        'grant_expired', v_grant.id, null,
        jsonb_build_object('grantVersion', v_grant.version + 1)
      );
      return jsonb_build_object('decision', 'expired', 'correlationId', p_correlation_id);
    end if;

    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_user_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'grant_state_conflict', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  select exists (
    select 1
    from public.authentication_events
    where actor_subject_id = p_actor_user_id
      and event_name = 'admin_onboarding.started'
      and target_id = p_bootstrap_grant_id
      and idempotency_key_hash = p_idempotency_key_hash
  ) into v_replay;

  if v_replay then
    return jsonb_build_object(
      'decision', 'ready',
      'bootstrapGrantId', v_grant.id,
      'organizationId', v_grant.organization_id,
      'organizationName', v_organization_name,
      'grantVersion', v_grant.version,
      'replayed', true,
      'correlationId', p_correlation_id
    );
  end if;

  if exists (
    select 1
    from public.organization_memberships membership
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role
      on role.id = membership_role.role_id
     and role.code = 'admin'
     and role.is_active
    where membership.organization_id = v_grant.organization_id
      and membership.status = 'active'
  ) then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_user_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'active_admin_exists', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  perform public.write_admin_onboarding_event(
    p_actor_user_id,
    p_actor_user_id,
    'admin_onboarding.started',
    'success',
    p_correlation_id,
    v_grant.organization_id,
    array[v_grant.organization_id],
    'onboarding_started',
    v_grant.id,
    p_idempotency_key_hash,
    jsonb_build_object('grantVersion', v_grant.version)
  );

  return jsonb_build_object(
    'decision', 'ready',
    'bootstrapGrantId', v_grant.id,
    'organizationId', v_grant.organization_id,
    'organizationName', v_organization_name,
    'grantVersion', v_grant.version,
    'replayed', false,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.start_organization_admin_onboarding(
  uuid, uuid, bigint, text, uuid
) from public, anon, authenticated;
grant execute on function public.start_organization_admin_onboarding(
  uuid, uuid, bigint, text, uuid
) to service_role;

create or replace function public.cancel_organization_admin_onboarding(
  p_actor_user_id uuid,
  p_bootstrap_grant_id uuid,
  p_idempotency_key_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_grant public.organization_admin_bootstrap_grants%rowtype;
begin
  if p_actor_user_id is null
     or p_bootstrap_grant_id is null
     or p_idempotency_key_hash is null
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception using errcode = '22023', message = 'Onboarding cancel input is invalid.';
  end if;

  select * into v_grant
  from public.organization_admin_bootstrap_grants
  where id = p_bootstrap_grant_id
    and eligible_user_id = p_actor_user_id;

  if v_grant.id is null then
    return jsonb_build_object(
      'decision', 'not_available',
      'cleanupOutcome', 'not_attempted',
      'correlationId', p_correlation_id
    );
  end if;

  if exists (
    select 1
    from public.authentication_events
    where actor_subject_id = p_actor_user_id
      and event_name = 'admin_onboarding.cancelled'
      and target_id = p_bootstrap_grant_id
      and idempotency_key_hash = p_idempotency_key_hash
  ) then
    return jsonb_build_object(
      'decision', 'cancelled',
      'cleanupOutcome', 'not_attempted',
      'replayed', true,
      'correlationId', p_correlation_id
    );
  end if;

  perform public.write_admin_onboarding_event(
    p_actor_user_id,
    p_actor_user_id,
    'admin_onboarding.cancelled',
    'success',
    p_correlation_id,
    v_grant.organization_id,
    array[v_grant.organization_id],
    'onboarding_cancelled',
    v_grant.id,
    p_idempotency_key_hash,
    jsonb_build_object(
      'grantVersion', v_grant.version,
      'cleanupOutcome', 'not_attempted'
    )
  );

  return jsonb_build_object(
    'decision', 'cancelled',
    'cleanupOutcome', 'not_attempted',
    'replayed', false,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.cancel_organization_admin_onboarding(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.cancel_organization_admin_onboarding(
  uuid, uuid, text, uuid
) to service_role;

create or replace function public.complete_first_organization_admin_bootstrap(
  p_actor_user_id uuid,
  p_actor_subject_id uuid,
  p_session_id uuid,
  p_password_authenticated_at bigint,
  p_assurance_level text,
  p_authentication_methods text[],
  p_verified_totp_factor_id uuid,
  p_total_factor_count integer,
  p_bootstrap_grant_id uuid,
  p_expected_version bigint,
  p_idempotency_key_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_organization_id uuid;
  v_organization_name text;
  v_organization_status text;
  v_grant public.organization_admin_bootstrap_grants%rowtype;
  v_admin_role_id uuid;
  v_membership_id uuid;
  v_password_time timestamptz;
begin
  if p_actor_user_id is null
     or p_actor_subject_id is null
     or p_actor_user_id <> p_actor_subject_id
     or p_session_id is null
     or p_password_authenticated_at is null
     or p_assurance_level <> 'aal2'
     or p_authentication_methods is null
     or cardinality(p_authentication_methods) not between 1 and 16
     or array_position(p_authentication_methods, null) is not null
     or not ('password' = any(p_authentication_methods))
     or not ('totp' = any(p_authentication_methods))
     or p_verified_totp_factor_id is null
     or p_total_factor_count <> 1
     or p_bootstrap_grant_id is null
     or p_expected_version is null
     or p_expected_version < 1
     or p_idempotency_key_hash is null
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception using errcode = '22023', message = 'Onboarding completion input is invalid.';
  end if;

  v_password_time := to_timestamp(p_password_authenticated_at);
  if v_password_time > transaction_timestamp()
     or transaction_timestamp() - v_password_time > interval '600 seconds' then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.denied', 'denied',
      p_correlation_id, null, '{}'::uuid[], 'recent_authentication_required',
      p_bootstrap_grant_id, null, '{}'::jsonb
    );
    return jsonb_build_object(
      'decision', 'recent_authentication_required',
      'correlationId', p_correlation_id
    );
  end if;

  select organization_id into v_organization_id
  from public.organization_admin_bootstrap_grants
  where id = p_bootstrap_grant_id;

  if v_organization_id is null then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.denied', 'denied',
      p_correlation_id, null, '{}'::uuid[], 'grant_not_available',
      null, null, '{}'::jsonb
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  select name, status into v_organization_name, v_organization_status
  from public.organizations
  where id = v_organization_id
  for update;

  select * into v_grant
  from public.organization_admin_bootstrap_grants
  where id = p_bootstrap_grant_id
  for update;

  if v_grant.eligible_user_id <> p_actor_user_id then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.denied', 'denied',
      p_correlation_id, null, '{}'::uuid[], 'grant_not_available',
      null, null, '{}'::jsonb
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  if v_organization_name is null
     or v_organization_status <> 'active'
     or v_grant.organization_id <> v_organization_id then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'organization_state_conflict', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  if v_grant.status = 'completed' then
    if v_grant.completion_idempotency_key_hash = p_idempotency_key_hash then
      return jsonb_build_object(
        'decision', 'already_completed',
        'bootstrapGrantId', v_grant.id,
        'organizationId', v_grant.organization_id,
        'organizationName', v_organization_name,
        'membershipId', v_grant.completed_membership_id,
        'grantVersion', v_grant.version,
        'correlationId', p_correlation_id
      );
    end if;

    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'completed_grant_conflict', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  if v_grant.status <> 'pending'
     or v_grant.version <> p_expected_version
     or transaction_timestamp() >= v_grant.expires_at then
    if v_grant.status = 'pending' and transaction_timestamp() >= v_grant.expires_at then
      update public.organization_admin_bootstrap_grants
      set status = 'expired', version = version + 1
      where id = v_grant.id;
      perform public.write_admin_onboarding_event(
        p_actor_user_id, p_actor_subject_id, 'admin_onboarding.grant_expired', 'denied',
        p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
        'grant_expired', v_grant.id, null,
        jsonb_build_object('grantVersion', v_grant.version + 1)
      );
      return jsonb_build_object('decision', 'expired', 'correlationId', p_correlation_id);
    end if;

    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'grant_state_conflict', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  if exists (
    select 1
    from public.organization_memberships membership
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role
      on role.id = membership_role.role_id
     and role.code = 'admin'
     and role.is_active
    where membership.organization_id = v_grant.organization_id
      and membership.status = 'active'
  ) then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'active_admin_exists', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  if exists (
    select 1
    from public.organization_memberships
    where organization_id = v_grant.organization_id
      and user_id = p_actor_user_id
  ) then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'membership_state_conflict', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  select id into v_admin_role_id
  from public.roles
  where code = 'admin'
    and is_active;

  if v_admin_role_id is null then
    raise exception using errcode = '23514', message = 'The admin role is unavailable.';
  end if;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    status,
    created_by,
    updated_by
  )
  values (
    v_grant.organization_id,
    p_actor_user_id,
    'active',
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_membership_id;

  insert into public.membership_roles (
    organization_id,
    membership_id,
    role_id,
    assigned_by
  )
  values (
    v_grant.organization_id,
    v_membership_id,
    v_admin_role_id,
    p_actor_user_id
  );

  update public.organization_admin_bootstrap_grants
  set status = 'completed',
      version = version + 1,
      completed_at = transaction_timestamp(),
      completed_membership_id = v_membership_id,
      completion_idempotency_key_hash = p_idempotency_key_hash
  where id = v_grant.id;

  perform public.write_admin_onboarding_event(
    p_actor_user_id,
    p_actor_subject_id,
    'admin_onboarding.completed',
    'success',
    p_correlation_id,
    v_grant.organization_id,
    array[v_grant.organization_id],
    'first_admin_created',
    v_grant.id,
    null,
    jsonb_build_object(
      'grantVersion', v_grant.version + 1,
      'membershipId', v_membership_id,
      'assuranceLevel', p_assurance_level,
      'authenticationMethods', to_jsonb(p_authentication_methods),
      'factorCount', p_total_factor_count
    )
  );

  return jsonb_build_object(
    'decision', 'completed',
    'bootstrapGrantId', v_grant.id,
    'organizationId', v_grant.organization_id,
    'organizationName', v_organization_name,
    'membershipId', v_membership_id,
    'grantVersion', v_grant.version + 1,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.complete_first_organization_admin_bootstrap(
  uuid, uuid, uuid, bigint, text, text[], uuid, integer, uuid, bigint, text, uuid
) from public, anon, authenticated;
grant execute on function public.complete_first_organization_admin_bootstrap(
  uuid, uuid, uuid, bigint, text, text[], uuid, integer, uuid, bigint, text, uuid
) to service_role;

comment on table public.organization_admin_bootstrap_grants is
  'FEAT-003 server-only, tenant-owned, expiring first-Organization-Admin bootstrap grants.';
comment on table public.admin_onboarding_rate_limit_state is
  'FEAT-003 privacy-minimized local token-bucket state keyed by HMAC subject plus action.';
comment on table public.admin_onboarding_rate_limit_events is
  'FEAT-003 privacy-minimized local limiter decisions for synthetic evidence.';
comment on function public.consume_admin_onboarding_rate_limit(text, text, uuid) is
  'Server-only FEAT-003 atomic local token-bucket decision and monitoring evidence.';
comment on function public.get_organization_admin_onboarding_status(uuid, uuid) is
  'Server-only FEAT-003 eligibility/status command with mandatory audit.';
comment on function public.start_organization_admin_onboarding(uuid, uuid, bigint, text, uuid) is
  'Server-only FEAT-003 start command with scoped idempotency and mandatory audit.';
comment on function public.cancel_organization_admin_onboarding(uuid, uuid, text, uuid) is
  'Server-only FEAT-003 cancellation audit; performs no Auth factor deletion or grant consumption.';
comment on function public.complete_first_organization_admin_bootstrap(
  uuid, uuid, uuid, bigint, text, text[], uuid, integer, uuid, bigint, text, uuid
) is
  'Server-only FEAT-003 organization-serialized atomic first-admin completion.';

commit;
