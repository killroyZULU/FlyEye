begin;

insert into public.permissions (code, description)
values
  ('aircraft.record.read', 'Read the organization aircraft registry through its protected audited boundary.'),
  ('aircraft.record.manage', 'Create, edit, archive, and reactivate organization aircraft registry records.')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.code = 'admin'
  and permission.code in ('aircraft.record.read', 'aircraft.record.manage')
on conflict do nothing;

create table public.aircraft_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  registration_mark text not null,
  registration_key text not null,
  manufacturer text not null,
  model text not null,
  registry_state text not null default 'tracked' check (registry_state in ('tracked', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete restrict,
  archive_reason text,
  unique (organization_id, id),
  check (registration_mark = btrim(registration_mark) and char_length(registration_mark) between 1 and 32),
  check (registration_mark !~ '[a-z]'),
  check (char_length(registration_key) between 1 and 96),
  check (manufacturer = btrim(manufacturer) and char_length(manufacturer) between 1 and 100),
  check (model = btrim(model) and char_length(model) between 1 and 100),
  check (
    (registry_state = 'tracked' and archived_at is null and archived_by is null and archive_reason is null)
    or
    (registry_state = 'archived' and archived_at is not null and archived_by is not null
      and archive_reason in ('no_longer_tracked', 'duplicate_record', 'created_in_error'))
  )
);

create unique index aircraft_records_tracked_registration_idx
  on public.aircraft_records (organization_id, registration_key)
  where registry_state = 'tracked';
create index aircraft_records_registry_order_idx
  on public.aircraft_records (organization_id, registry_state, registration_key, id);
create index aircraft_records_stable_order_idx
  on public.aircraft_records (organization_id, registration_key, id);

create table public.aircraft_registry_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_record_id uuid,
  event_name text not null check (event_name in (
    'aircraft_registry.listed',
    'aircraft_record.viewed',
    'aircraft_record.created',
    'aircraft_record.updated',
    'aircraft_record.archived',
    'aircraft_record.reactivated',
    'aircraft_registry.denied',
    'aircraft_registry.conflicted'
  )),
  outcome text not null check (outcome in ('success', 'denied', 'conflict')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  correlation_id uuid not null,
  idempotency_key_hash text check (
    idempotency_key_hash is null or idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, target_record_id)
    references public.aircraft_records(organization_id, id)
    on delete restrict
);

create index aircraft_registry_events_org_time_idx
  on public.aircraft_registry_events (organization_id, occurred_at desc);
create index aircraft_registry_events_actor_time_idx
  on public.aircraft_registry_events (actor_user_id, occurred_at desc);

create table public.aircraft_registry_idempotency (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('create', 'update', 'archive', 'reactivate')),
  target_record_id uuid,
  expected_version bigint,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (organization_id, actor_user_id, idempotency_key_hash),
  foreign key (organization_id, target_record_id)
    references public.aircraft_records(organization_id, id)
    on delete restrict,
  check (
    (action = 'create' and expected_version is null)
    or (action <> 'create' and expected_version > 0)
  )
);

create index aircraft_registry_idempotency_target_idx
  on public.aircraft_registry_idempotency (organization_id, target_record_id, created_at desc);

create table public.aircraft_registry_rate_limit_state (
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  bucket text not null check (bucket in ('general', 'read', 'mutation', 'lifecycle')),
  tokens numeric not null check (tokens >= 0),
  updated_at timestamptz not null,
  primary key (limiter_key_hash, bucket)
);

create table public.aircraft_registry_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  bucket text not null check (bucket in ('general', 'read', 'mutation', 'lifecycle')),
  outcome text not null check (outcome in ('allowed', 'rate_limited')),
  retry_after_seconds integer check (retry_after_seconds between 1 and 3600),
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  check (
    (outcome = 'allowed' and retry_after_seconds is null)
    or (outcome = 'rate_limited' and retry_after_seconds is not null)
  )
);

create index aircraft_registry_rate_events_time_idx
  on public.aircraft_registry_rate_limit_events (occurred_at desc);

alter table public.aircraft_records enable row level security;
alter table public.aircraft_registry_events enable row level security;
alter table public.aircraft_registry_idempotency enable row level security;
alter table public.aircraft_registry_rate_limit_state enable row level security;
alter table public.aircraft_registry_rate_limit_events enable row level security;

revoke all on table public.aircraft_records from public, anon, authenticated;
revoke all on table public.aircraft_registry_events from public, anon, authenticated;
revoke all on table public.aircraft_registry_idempotency from public, anon, authenticated;
revoke all on table public.aircraft_registry_rate_limit_state from public, anon, authenticated;
revoke all on table public.aircraft_registry_rate_limit_events from public, anon, authenticated;

create or replace function public.aircraft_registry_actor_is_authorized(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_permission_code text
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    join public.organizations organization on organization.id = membership.organization_id
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.role_permissions role_permission on role_permission.role_id = membership_role.role_id
    join public.permissions permission on permission.id = role_permission.permission_id
    where membership.user_id = p_actor_user_id
      and membership.organization_id = p_organization_id
      and membership.status = 'active'
      and organization.status = 'active'
      and permission.code = p_permission_code
  );
$$;

revoke all on function public.aircraft_registry_actor_is_authorized(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.aircraft_registry_actor_is_authorized(uuid, uuid, text)
  to service_role;

create or replace function public.resolve_aircraft_registry_context(p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_organization_id uuid;
begin
  select membership.organization_id into v_organization_id
  from public.organization_memberships membership
  where membership.user_id = p_actor_user_id
  order by (membership.status = 'active') desc, membership.organization_id
  limit 1;

  if v_organization_id is null then
    select organization.id into v_organization_id
    from public.organizations organization
    order by organization.id
    limit 1;
  end if;

  if v_organization_id is null then
    raise exception using errcode = 'P7002', message = 'Aircraft registry context is unavailable.';
  end if;

  return jsonb_build_object(
    'organizationId', v_organization_id,
    'canRead', public.aircraft_registry_actor_is_authorized(
      p_actor_user_id, v_organization_id, 'aircraft.record.read'
    ),
    'canManage', public.aircraft_registry_actor_is_authorized(
      p_actor_user_id, v_organization_id, 'aircraft.record.manage'
    )
  );
end;
$$;

revoke all on function public.resolve_aircraft_registry_context(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_aircraft_registry_context(uuid) to service_role;

create or replace function public.consume_aircraft_registry_rate_limit(
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
    raise exception using errcode = '22023', message = 'Aircraft limiter input is invalid.';
  end if;

  case p_bucket
    when 'general' then v_capacity := 60; v_refill := 2;
    when 'read' then v_capacity := 30; v_refill := 1;
    when 'mutation' then v_capacity := 6; v_refill := 0.1;
    when 'lifecycle' then v_capacity := 3; v_refill := 1.0 / 30.0;
    else raise exception using errcode = '22023', message = 'Aircraft limiter bucket is invalid.';
  end case;

  insert into public.aircraft_registry_rate_limit_state (
    limiter_key_hash, bucket, tokens, updated_at
  ) values (p_limiter_key_hash, p_bucket, v_capacity, v_now)
  on conflict do nothing;

  select state.tokens, state.updated_at into v_tokens, v_updated_at
  from public.aircraft_registry_rate_limit_state state
  where state.limiter_key_hash = p_limiter_key_hash and state.bucket = p_bucket
  for update;

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

  update public.aircraft_registry_rate_limit_state
  set tokens = v_tokens, updated_at = v_now
  where limiter_key_hash = p_limiter_key_hash and bucket = p_bucket;

  insert into public.aircraft_registry_rate_limit_events (
    limiter_key_hash, bucket, outcome, retry_after_seconds, correlation_id
  ) values (
    p_limiter_key_hash,
    p_bucket,
    case when v_allowed then 'allowed' else 'rate_limited' end,
    v_retry,
    p_correlation_id
  );

  return jsonb_build_object(
    'allowed', v_allowed,
    'retryAfterSeconds', v_retry,
    'correlationId', p_correlation_id,
    'policyVersion', 'aircraft-registry-v1'
  );
end;
$$;

revoke all on function public.consume_aircraft_registry_rate_limit(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_aircraft_registry_rate_limit(text, text, uuid)
  to service_role;

create or replace function public.aircraft_record_summary(p_record public.aircraft_records)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', p_record.id,
    'registrationMark', p_record.registration_mark,
    'manufacturer', p_record.manufacturer,
    'model', p_record.model,
    'registryState', p_record.registry_state,
    'version', p_record.version,
    'updatedAt', p_record.updated_at
  );
$$;

revoke all on function public.aircraft_record_summary(public.aircraft_records)
  from public, anon, authenticated;

create or replace function public.write_aircraft_registry_event(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_target_record_id uuid,
  p_event_name text,
  p_outcome text,
  p_reason_code text,
  p_correlation_id uuid,
  p_idempotency_key_hash text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.aircraft_registry_events (
    organization_id, actor_user_id, target_record_id, event_name, outcome,
    reason_code, correlation_id, idempotency_key_hash, metadata
  ) values (
    p_organization_id, p_actor_user_id, p_target_record_id, p_event_name, p_outcome,
    p_reason_code, p_correlation_id, p_idempotency_key_hash, coalesce(p_metadata, '{}'::jsonb)
  );
exception when others then
  raise exception using errcode = 'P7001', message = 'Aircraft registry audit write failed.';
end;
$$;

revoke all on function public.write_aircraft_registry_event(uuid, uuid, uuid, text, text, text, uuid, text, jsonb)
  from public, anon, authenticated;

create or replace function public.record_aircraft_registry_security_event(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_action text,
  p_outcome text,
  p_reason text,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_action not in ('list', 'get', 'create', 'update', 'archive', 'reactivate')
     or p_outcome not in ('denied', 'conflict')
     or p_reason !~ '^[a-z][a-z0-9_]{2,63}$' then
    raise exception using errcode = '22023', message = 'Aircraft security event is invalid.';
  end if;
  perform public.write_aircraft_registry_event(
    p_organization_id,
    p_actor_user_id,
    null,
    case when p_outcome = 'denied' then 'aircraft_registry.denied' else 'aircraft_registry.conflicted' end,
    p_outcome,
    p_reason,
    p_correlation_id,
    null,
    jsonb_build_object('action', p_action)
  );
end;
$$;

revoke all on function public.record_aircraft_registry_security_event(uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_aircraft_registry_security_event(uuid, uuid, text, text, text, uuid)
  to service_role;

create or replace function public.list_aircraft_records(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_search text,
  p_include_archived boolean,
  p_page integer,
  p_page_size integer,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_records jsonb;
  v_has_next boolean;
  v_returned_count integer;
  v_search_hash text;
begin
  if p_actor_user_id is null or p_organization_id is null or p_include_archived is null
     or p_page not between 1 and 100 or p_page_size not between 1 and 50
     or p_correlation_id is null or char_length(coalesce(p_search, '')) > 100 then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not public.aircraft_registry_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.record.read'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;

  with selected as (
    select
      candidate.record_value,
      row_number() over (order by candidate.registration_key, candidate.record_id)
        as result_position
    from (
      select
        record as record_value,
        record.registration_key,
        record.id as record_id
      from public.aircraft_records record
      where record.organization_id = p_organization_id
        and (p_include_archived or record.registry_state = 'tracked')
        and (
          p_search is null
          or position(lower(p_search) in lower(record.registration_mark)) > 0
          or position(lower(p_search) in lower(record.manufacturer)) > 0
          or position(lower(p_search) in lower(record.model)) > 0
        )
      order by record.registration_key, record.id
      offset ((p_page - 1) * p_page_size)
      limit (p_page_size + 1)
    ) candidate
  )
  select
    coalesce(
      jsonb_agg(public.aircraft_record_summary(selected.record_value) order by selected.result_position)
        filter (where selected.result_position <= p_page_size),
      '[]'::jsonb
    ),
    count(*) > p_page_size,
    least(count(*), p_page_size)::integer
  into v_records, v_has_next, v_returned_count
  from selected;

  v_search_hash := encode(digest(convert_to(coalesce(p_search, ''), 'UTF8'), 'sha256'), 'hex');
  perform public.write_aircraft_registry_event(
    p_organization_id, p_actor_user_id, null, 'aircraft_registry.listed', 'success',
    'registry_listed', p_correlation_id, null,
    jsonb_build_object(
      'searchHash', v_search_hash,
      'includeArchived', p_include_archived,
      'page', p_page,
      'pageSize', p_page_size,
      'orderingVersion', 'registration-key-id-v1',
      'returnedCount', v_returned_count
    )
  );

  return jsonb_build_object(
    'decision', 'listed',
    'records', v_records,
    'page', p_page,
    'pageSize', p_page_size,
    'hasNext', v_has_next,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.list_aircraft_records(uuid, uuid, text, boolean, integer, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.list_aircraft_records(uuid, uuid, text, boolean, integer, integer, uuid)
  to service_role;

create or replace function public.get_aircraft_record(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_record_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_record public.aircraft_records%rowtype;
begin
  if p_actor_user_id is null or p_organization_id is null or p_record_id is null
     or p_correlation_id is null then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not public.aircraft_registry_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.record.read'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  select * into v_record
  from public.aircraft_records record
  where record.organization_id = p_organization_id and record.id = p_record_id;
  if not found then
    perform public.write_aircraft_registry_event(
      p_organization_id, p_actor_user_id, null, 'aircraft_registry.denied', 'denied',
      'not_found', p_correlation_id, null, jsonb_build_object('action', 'get')
    );
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  perform public.write_aircraft_registry_event(
    p_organization_id, p_actor_user_id, v_record.id, 'aircraft_record.viewed', 'success',
    'record_viewed', p_correlation_id
  );
  return jsonb_build_object(
    'decision', 'found',
    'record', public.aircraft_record_summary(v_record),
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.get_aircraft_record(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_aircraft_record(uuid, uuid, uuid, uuid) to service_role;

create or replace function public.lookup_aircraft_registry_idempotency(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_action text,
  p_record_id uuid,
  p_expected_version bigint,
  p_idempotency_key_hash text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_existing public.aircraft_registry_idempotency%rowtype;
begin
  if not public.aircraft_registry_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.record.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'result', null);
  end if;
  select * into v_existing
  from public.aircraft_registry_idempotency item
  where item.organization_id = p_organization_id
    and item.actor_user_id = p_actor_user_id
    and item.idempotency_key_hash = p_idempotency_key_hash;
  if not found then return jsonb_build_object('decision', 'missing', 'result', null); end if;
  if v_existing.action = p_action
     and (p_action = 'create' or v_existing.target_record_id is not distinct from p_record_id)
     and v_existing.expected_version is not distinct from p_expected_version
     and v_existing.request_hash = p_request_hash then
    return jsonb_build_object('decision', 'replay', 'result', v_existing.result);
  end if;
  return jsonb_build_object('decision', 'conflict', 'result', null);
end;
$$;

revoke all on function public.lookup_aircraft_registry_idempotency(uuid, uuid, text, uuid, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.lookup_aircraft_registry_idempotency(uuid, uuid, text, uuid, bigint, text, text)
  to service_role;

create or replace function public.mutate_aircraft_record(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_action text,
  p_record_id uuid,
  p_registration_mark text,
  p_registration_key text,
  p_manufacturer text,
  p_model text,
  p_reason text,
  p_expected_version bigint,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_record public.aircraft_records%rowtype;
  v_prior public.aircraft_records%rowtype;
  v_existing public.aircraft_registry_idempotency%rowtype;
  v_result jsonb;
  v_event_name text;
  v_decision text;
  v_metadata jsonb;
begin
  if p_action not in ('create', 'update', 'archive', 'reactivate')
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null
     or (p_action = 'create' and (p_record_id is not null or p_expected_version is not null))
     or (p_action <> 'create' and (p_record_id is null or p_expected_version is null or p_expected_version < 1)) then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not public.aircraft_registry_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.record.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key_hash, 0
  ));
  select * into v_existing
  from public.aircraft_registry_idempotency item
  where item.organization_id = p_organization_id
    and item.actor_user_id = p_actor_user_id
    and item.idempotency_key_hash = p_idempotency_key_hash;
  if found then
    if v_existing.action = p_action
       and (p_action = 'create' or v_existing.target_record_id is not distinct from p_record_id)
       and v_existing.expected_version is not distinct from p_expected_version
       and v_existing.request_hash = p_request_hash then
      return v_existing.result || jsonb_build_object('replayed', true, 'correlationId', p_correlation_id);
    end if;
    return jsonb_build_object('decision', 'idempotency_conflict', 'correlationId', p_correlation_id);
  end if;

  begin
    if p_action in ('create', 'update') then
      if p_registration_mark is null or p_registration_key is null
         or p_manufacturer is null or p_model is null or p_reason is not null
         or p_registration_mark <> btrim(p_registration_mark)
         or p_registration_mark ~ '[a-z]'
         or char_length(p_registration_mark) not between 1 and 32
         or char_length(p_registration_key) not between 1 and 96
         or p_manufacturer <> btrim(p_manufacturer)
         or char_length(p_manufacturer) not between 1 and 100
         or p_model <> btrim(p_model)
         or char_length(p_model) not between 1 and 100 then
        return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
      end if;
    elsif p_registration_mark is not null or p_registration_key is not null
       or p_manufacturer is not null or p_model is not null then
      return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
    end if;

    if p_action = 'create' then
      insert into public.aircraft_records (
        organization_id, registration_mark, registration_key, manufacturer, model,
        created_by, updated_by
      ) values (
        p_organization_id, p_registration_mark, p_registration_key, p_manufacturer, p_model,
        p_actor_user_id, p_actor_user_id
      ) returning * into v_record;
      v_event_name := 'aircraft_record.created';
      v_decision := 'created';
      v_metadata := jsonb_build_object(
        'priorVersion', null, 'newVersion', 1, 'registryState', 'tracked',
        'registrationMark', v_record.registration_mark,
        'manufacturer', v_record.manufacturer,
        'model', v_record.model
      );
    else
      select * into v_record
      from public.aircraft_records record
      where record.organization_id = p_organization_id and record.id = p_record_id
      for update;
      if not found then
        perform public.write_aircraft_registry_event(
          p_organization_id, p_actor_user_id, null, 'aircraft_registry.denied', 'denied',
          'not_found', p_correlation_id, null, jsonb_build_object('action', p_action)
        );
        return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
      end if;
      if v_record.version <> p_expected_version then
        return jsonb_build_object('decision', 'version_conflict', 'correlationId', p_correlation_id);
      end if;
      v_prior := v_record;

      if p_action = 'update' then
        if v_record.registry_state <> 'tracked' then
          return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
        end if;
        update public.aircraft_records
        set registration_mark = p_registration_mark,
            registration_key = p_registration_key,
            manufacturer = p_manufacturer,
            model = p_model,
            version = version + 1,
            updated_at = now(),
            updated_by = p_actor_user_id
        where id = v_record.id
        returning * into v_record;
        v_event_name := 'aircraft_record.updated';
        v_decision := 'updated';
        v_metadata := jsonb_build_object(
          'priorVersion', v_prior.version, 'newVersion', v_record.version,
          'registryState', v_record.registry_state,
          'before', jsonb_build_object(
            'registrationMark', v_prior.registration_mark,
            'manufacturer', v_prior.manufacturer,
            'model', v_prior.model
          ),
          'after', jsonb_build_object(
            'registrationMark', v_record.registration_mark,
            'manufacturer', v_record.manufacturer,
            'model', v_record.model
          )
        );
      elsif p_action = 'archive' then
        if v_record.registry_state <> 'tracked' then
          return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
        end if;
        if p_reason is null
           or p_reason not in ('no_longer_tracked', 'duplicate_record', 'created_in_error') then
          return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
        end if;
        update public.aircraft_records
        set registry_state = 'archived',
            archive_reason = p_reason,
            archived_at = now(),
            archived_by = p_actor_user_id,
            version = version + 1,
            updated_at = now(),
            updated_by = p_actor_user_id
        where id = v_record.id
        returning * into v_record;
        v_event_name := 'aircraft_record.archived';
        v_decision := 'archived';
        v_metadata := jsonb_build_object(
          'priorVersion', v_prior.version, 'newVersion', v_record.version,
          'priorState', 'tracked', 'newState', 'archived', 'reason', p_reason
        );
      else
        if v_record.registry_state <> 'archived' then
          return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
        end if;
        if p_reason is null or p_reason not in ('tracking_resumed', 'archive_incorrect') then
          return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
        end if;
        update public.aircraft_records
        set registry_state = 'tracked',
            archive_reason = null,
            archived_at = null,
            archived_by = null,
            version = version + 1,
            updated_at = now(),
            updated_by = p_actor_user_id
        where id = v_record.id
        returning * into v_record;
        v_event_name := 'aircraft_record.reactivated';
        v_decision := 'reactivated';
        v_metadata := jsonb_build_object(
          'priorVersion', v_prior.version, 'newVersion', v_record.version,
          'priorState', 'archived', 'newState', 'tracked', 'reason', p_reason
        );
      end if;
    end if;

    perform public.write_aircraft_registry_event(
      p_organization_id, p_actor_user_id, v_record.id, v_event_name, 'success',
      coalesce(p_reason, v_decision), p_correlation_id, p_idempotency_key_hash, v_metadata
    );
    v_result := jsonb_build_object(
      'decision', v_decision,
      'record', public.aircraft_record_summary(v_record),
      'replayed', false
    );
    insert into public.aircraft_registry_idempotency (
      organization_id, actor_user_id, idempotency_key_hash, action,
      target_record_id, expected_version, request_hash, result
    ) values (
      p_organization_id, p_actor_user_id, p_idempotency_key_hash, p_action,
      v_record.id, p_expected_version, p_request_hash, v_result
    );
  exception when unique_violation then
    perform public.write_aircraft_registry_event(
      p_organization_id, p_actor_user_id, null, 'aircraft_registry.conflicted', 'conflict',
      'duplicate_registration', p_correlation_id, null, jsonb_build_object('action', p_action)
    );
    return jsonb_build_object('decision', 'duplicate_registration', 'correlationId', p_correlation_id);
  end;

  return v_result || jsonb_build_object('correlationId', p_correlation_id);
end;
$$;

revoke all on function public.mutate_aircraft_record(uuid, uuid, text, uuid, text, text, text, text, text, bigint, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mutate_aircraft_record(uuid, uuid, text, uuid, text, text, text, text, text, bigint, text, text, uuid)
  to service_role;

comment on table public.aircraft_records is
  'FEAT-007A administrative aircraft identity registry. Registry state is not an operational or airworthiness status.';
comment on column public.aircraft_records.registration_key is
  'Server-derived Unicode 15.1 default-case-folded duplicate key with ASCII space and hyphen removed.';
comment on function public.mutate_aircraft_record(uuid, uuid, text, uuid, text, text, text, text, text, bigint, text, text, uuid) is
  'Server-only FEAT-007A mutation boundary with organization permission, lifecycle, version, idempotency, duplicate, and atomic audit controls.';

commit;
