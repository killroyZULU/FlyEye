begin;

insert into public.permissions (code, description)
values
  ('membership.member.review', 'Review members and basic profiles in the active organization.'),
  ('membership.member.manage_status', 'Suspend, reactivate, or revoke organization memberships.')
on conflict (code) do update
set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.code = 'admin'
  and permission.code in ('membership.member.review', 'membership.member.manage_status')
on conflict do nothing;

create table public.organization_member_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  membership_id uuid not null,
  display_name text,
  contact_number text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (organization_id, membership_id),
  foreign key (organization_id, membership_id)
    references public.organization_memberships(organization_id, id)
    on delete restrict,
  check (display_name is null or char_length(display_name) between 2 and 80),
  check (
    contact_number is null
    or (
      char_length(contact_number) between 1 and 32
      and contact_number ~ '^[0-9 +().-]+$'
    )
  )
);

create index organization_member_profiles_membership_idx
  on public.organization_member_profiles (membership_id, organization_id);
create index organization_member_profiles_search_idx
  on public.organization_member_profiles (organization_id, lower(display_name) text_pattern_ops)
  where display_name is not null;

create table public.member_administration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_membership_id uuid,
  event_name text not null check (
    event_name in (
      'member_directory.listed',
      'member_directory.viewed',
      'member_profile.viewed',
      'member_profile.updated',
      'member_status.suspended',
      'member_status.reactivated',
      'member_status.revoked',
      'member_administration.denied',
      'member_administration.conflicted',
      'member_administration.rate_limited'
    )
  ),
  outcome text not null check (outcome in ('success', 'denied', 'conflict', 'rate_limited')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  correlation_id uuid not null,
  idempotency_key_hash text check (
    idempotency_key_hash is null or idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, target_membership_id)
    references public.organization_memberships(organization_id, id)
    on delete restrict
);

create index member_administration_events_org_time_idx
  on public.member_administration_events (organization_id, occurred_at desc);
create index member_administration_events_actor_time_idx
  on public.member_administration_events (actor_user_id, occurred_at desc);
create unique index member_administration_status_idempotency_idx
  on public.member_administration_events (
    organization_id,
    actor_user_id,
    event_name,
    idempotency_key_hash
  )
  where idempotency_key_hash is not null
    and event_name in (
      'member_status.suspended',
      'member_status.reactivated',
      'member_status.revoked'
    );

create table public.member_administration_rate_limit_state (
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  action_group text not null check (action_group in ('directory', 'profile', 'status')),
  tokens numeric not null check (tokens >= 0),
  updated_at timestamptz not null,
  primary key (limiter_key_hash, action_group)
);

create table public.member_administration_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  action_group text not null check (action_group in ('directory', 'profile', 'status')),
  outcome text not null check (outcome in ('allowed', 'rate_limited')),
  retry_after_seconds integer check (retry_after_seconds between 1 and 3600),
  correlation_id uuid not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  check (
    (outcome = 'allowed' and retry_after_seconds is null)
    or (outcome = 'rate_limited' and retry_after_seconds is not null)
  )
);

create index member_administration_rate_events_time_idx
  on public.member_administration_rate_limit_events (occurred_at desc);

alter table public.organization_member_profiles enable row level security;
alter table public.member_administration_events enable row level security;
alter table public.member_administration_rate_limit_state enable row level security;
alter table public.member_administration_rate_limit_events enable row level security;

revoke all on table public.organization_member_profiles from public, anon, authenticated;
revoke all on table public.member_administration_events from public, anon, authenticated;
revoke all on table public.member_administration_rate_limit_state from public, anon, authenticated;
revoke all on table public.member_administration_rate_limit_events from public, anon, authenticated;

insert into public.organization_member_profiles (
  organization_id,
  membership_id,
  display_name,
  contact_number,
  version,
  created_by,
  updated_by
)
select
  membership.organization_id,
  membership.id,
  null,
  null,
  1,
  membership.created_by,
  membership.created_by
from public.organization_memberships membership
on conflict (organization_id, membership_id) do nothing;

create or replace function public.create_organization_member_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.organization_member_profiles (
    organization_id,
    membership_id,
    created_by,
    updated_by
  ) values (
    new.organization_id,
    new.id,
    new.created_by,
    new.created_by
  )
  on conflict (organization_id, membership_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_organization_member_profile()
  from public, anon, authenticated;

create trigger organization_membership_create_profile
after insert on public.organization_memberships
for each row execute function public.create_organization_member_profile();

create or replace function public.member_administration_actor_is_authorized(
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
    join public.organizations organization
      on organization.id = membership.organization_id
     and organization.status = 'active'
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role
      on role.id = membership_role.role_id
     and role.is_active = true
    join public.role_permissions role_permission
      on role_permission.role_id = role.id
    join public.permissions permission
      on permission.id = role_permission.permission_id
     and permission.code = p_permission_code
    where membership.user_id = p_actor_user_id
      and membership.organization_id = p_organization_id
      and membership.status = 'active'
  );
$$;

revoke all on function public.member_administration_actor_is_authorized(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.member_administration_actor_is_authorized(uuid, uuid, text)
  to service_role;

create or replace function public.required_member_profile_assurance(
  p_actor_user_id uuid,
  p_membership_id uuid
)
returns text
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case
      when role.code in ('instructor_pilot', 'admin') then 'aal2'
      else 'aal1'
    end
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
     and organization.status = 'active'
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role
      on role.id = membership_role.role_id
     and role.is_active = true
    where membership.id = p_membership_id
      and membership.user_id = p_actor_user_id
      and membership.status = 'active'
  ), 'denied');
$$;

revoke all on function public.required_member_profile_assurance(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.required_member_profile_assurance(uuid, uuid)
  to service_role;

create or replace function public.resolve_member_administration_limiter_scope(
  p_actor_user_id uuid,
  p_action text,
  p_organization_id uuid default null,
  p_membership_id uuid default null
)
returns uuid
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_scope uuid := p_actor_user_id;
begin
  if p_actor_user_id is null
     or p_action is null
     or p_action not in (
       'list', 'detail', 'get_profile', 'update_profile', 'suspend', 'reactivate', 'revoke'
     ) then
    raise exception using errcode = '22023', message = 'Limiter scope input is invalid.';
  end if;

  if p_action in ('list', 'detail')
     and p_organization_id is not null
     and public.member_administration_actor_is_authorized(
       p_actor_user_id,
       p_organization_id,
       'membership.member.review'
     ) then
    v_scope := p_organization_id;
  elsif p_action in ('suspend', 'reactivate', 'revoke')
     and p_organization_id is not null
     and public.member_administration_actor_is_authorized(
       p_actor_user_id,
       p_organization_id,
       'membership.member.manage_status'
     ) then
    v_scope := p_organization_id;
  elsif p_action in ('get_profile', 'update_profile') and p_membership_id is not null then
    select membership.id
    into v_scope
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
     and organization.status = 'active'
    where membership.id = p_membership_id
      and membership.user_id = p_actor_user_id
      and membership.status = 'active';
    v_scope := coalesce(v_scope, p_actor_user_id);
  end if;

  return v_scope;
end;
$$;

revoke all on function public.resolve_member_administration_limiter_scope(uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_member_administration_limiter_scope(uuid, text, uuid, uuid)
  to service_role;

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
  elsif p_action in ('suspend', 'reactivate', 'revoke') then
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

create or replace function public.record_member_administration_denial(
  p_actor_user_id uuid,
  p_event_name text,
  p_reason_code text,
  p_correlation_id uuid,
  p_organization_id uuid default null,
  p_target_membership_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_user_id uuid;
  v_organization_id uuid;
  v_target_membership_id uuid;
  v_event_id uuid;
begin
  if p_actor_user_id is null
     or p_event_name is null
     or p_event_name not in ('member_administration.denied', 'member_administration.conflicted')
     or p_reason_code is null
     or p_reason_code !~ '^[a-z][a-z0-9_]{2,63}$'
     or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Denial audit input is invalid.';
  end if;

  select id into v_actor_user_id from auth.users where id = p_actor_user_id;
  select id into v_organization_id from public.organizations where id = p_organization_id;
  if v_organization_id is not null then
    select id into v_target_membership_id
    from public.organization_memberships
    where organization_id = v_organization_id and id = p_target_membership_id;
  end if;

  insert into public.member_administration_events (
    organization_id, actor_user_id, target_membership_id,
    event_name, outcome, reason_code, correlation_id
  ) values (
    v_organization_id, v_actor_user_id, v_target_membership_id,
    p_event_name,
    case when p_event_name = 'member_administration.conflicted' then 'conflict' else 'denied' end,
    p_reason_code,
    p_correlation_id
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;

revoke all on function public.record_member_administration_denial(uuid, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_member_administration_denial(uuid, text, text, uuid, uuid, uuid)
  to service_role;

create or replace function public.list_organization_members(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_correlation_id uuid,
  p_status text default null,
  p_search text default null,
  p_before_created_at timestamptz default null,
  p_before_membership_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_search text := nullif(lower(btrim(p_search)), '');
  v_members jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_has_more boolean := false;
  v_next_created_at timestamptz;
  v_next_membership_id uuid;
begin
  if p_actor_user_id is null
     or p_organization_id is null
     or p_correlation_id is null
     or p_limit is null
     or p_limit not between 1 and 50
     or (p_status is not null and p_status not in ('active', 'suspended', 'revoked'))
     or ((p_before_created_at is null) <> (p_before_membership_id is null))
     or (v_search is not null and char_length(v_search) not between 2 and 80) then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  if not public.member_administration_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'membership.member.review'
  ) then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;

  with candidates as (
    select
      membership.id as membership_id,
      membership.status,
      membership.version,
      membership.created_at,
      role.code as role_code,
      role.display_name as role_label,
      profile.display_name,
      profile.contact_number,
      profile.version as profile_version,
      auth_user.email,
      row_number() over (order by membership.created_at desc, membership.id desc) as row_number
    from public.organization_memberships membership
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id
    join auth.users auth_user on auth_user.id = membership.user_id
    left join public.organization_member_profiles profile
      on profile.organization_id = membership.organization_id
     and profile.membership_id = membership.id
    where membership.organization_id = p_organization_id
      and (p_status is null or membership.status = p_status)
      and (
        v_search is null
        or lower(btrim(coalesce(profile.display_name, ''))) like '%' || v_search || '%'
        or lower(btrim(coalesce(auth_user.email, ''))) like '%' || v_search || '%'
      )
      and (
        p_before_created_at is null
        or (membership.created_at, membership.id) < (p_before_created_at, p_before_membership_id)
      )
    order by membership.created_at desc, membership.id desc
    limit p_limit + 1
  ), page as (
    select * from candidates where row_number <= p_limit
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'membershipId', membership_id,
        'displayName', display_name,
        'email', email,
        'roleCode', role_code,
        'roleLabel', role_label,
        'status', status,
        'membershipVersion', version,
        'profileVersion', profile_version,
        'profileComplete', display_name is not null,
        'createdAt', created_at
      ) order by created_at desc, membership_id desc
    ), '[]'::jsonb),
    count(*)::integer,
    (select count(*) > p_limit from candidates),
    (array_agg(created_at order by created_at desc, membership_id desc))[count(*)],
    (array_agg(membership_id order by created_at desc, membership_id desc))[count(*)]
  into v_members, v_count, v_has_more, v_next_created_at, v_next_membership_id
  from page;

  insert into public.member_administration_events (
    organization_id, actor_user_id, event_name, outcome,
    reason_code, correlation_id, metadata
  ) values (
    p_organization_id, p_actor_user_id, 'member_directory.listed', 'success',
    'member_directory_listed', p_correlation_id,
    jsonb_build_object('resultCount', v_count, 'statusFiltered', p_status is not null, 'searchApplied', v_search is not null)
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'decision', 'listed',
    'organizationId', p_organization_id,
    'members', v_members,
    'hasMore', v_has_more,
    'nextCreatedAt', case when v_has_more then v_next_created_at else null end,
    'nextMembershipId', case when v_has_more then v_next_membership_id else null end,
    'correlationId', p_correlation_id
  ));
end;
$$;

revoke all on function public.list_organization_members(uuid, uuid, uuid, text, text, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_organization_members(uuid, uuid, uuid, text, text, timestamptz, uuid, integer)
  to service_role;

create or replace function public.get_organization_member(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_target_membership_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member jsonb;
begin
  if p_actor_user_id is null
     or p_organization_id is null
     or p_target_membership_id is null
     or p_correlation_id is null then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  if not public.member_administration_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'membership.member.review'
  ) then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;

  select jsonb_build_object(
    'membershipId', membership.id,
    'displayName', profile.display_name,
    'contactNumber', profile.contact_number,
    'email', auth_user.email,
    'roleCode', role.code,
    'roleLabel', role.display_name,
    'status', membership.status,
    'membershipVersion', membership.version,
    'profileVersion', profile.version,
    'profileComplete', profile.display_name is not null,
    'createdAt', membership.created_at,
    'updatedAt', membership.updated_at
  ) into v_member
  from public.organization_memberships membership
  join public.membership_roles membership_role
    on membership_role.organization_id = membership.organization_id
   and membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id
  join auth.users auth_user on auth_user.id = membership.user_id
  left join public.organization_member_profiles profile
    on profile.organization_id = membership.organization_id
   and profile.membership_id = membership.id
  where membership.organization_id = p_organization_id
    and membership.id = p_target_membership_id;

  if v_member is null then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;

  insert into public.member_administration_events (
    organization_id, actor_user_id, target_membership_id,
    event_name, outcome, reason_code, correlation_id, metadata
  ) values (
    p_organization_id, p_actor_user_id, p_target_membership_id,
    'member_directory.viewed', 'success', 'member_directory_viewed', p_correlation_id, '{}'::jsonb
  );

  return jsonb_build_object(
    'decision', 'found',
    'organizationId', p_organization_id,
    'member', v_member,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.get_organization_member(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_organization_member(uuid, uuid, uuid, uuid)
  to service_role;

create or replace function public.get_my_member_profile(
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile jsonb;
  v_organization_id uuid;
begin
  if p_actor_user_id is null or p_membership_id is null or p_correlation_id is null then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  select
    membership.organization_id,
    jsonb_build_object(
      'organizationId', organization.id,
      'organizationName', organization.name,
      'membershipId', membership.id,
      'displayName', profile.display_name,
      'contactNumber', profile.contact_number,
      'email', auth_user.email,
      'roleCode', role.code,
      'roleLabel', role.display_name,
      'status', membership.status,
      'version', profile.version,
      'complete', profile.display_name is not null
    )
  into v_organization_id, v_profile
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
   and organization.status = 'active'
  join public.membership_roles membership_role
    on membership_role.organization_id = membership.organization_id
   and membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id and role.is_active = true
  join auth.users auth_user on auth_user.id = membership.user_id
  join public.organization_member_profiles profile
    on profile.organization_id = membership.organization_id
   and profile.membership_id = membership.id
  where membership.id = p_membership_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active';

  if v_profile is null then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;

  insert into public.member_administration_events (
    organization_id, actor_user_id, target_membership_id,
    event_name, outcome, reason_code, correlation_id
  ) values (
    v_organization_id, p_actor_user_id, p_membership_id,
    'member_profile.viewed', 'success', 'member_profile_viewed', p_correlation_id
  );

  return jsonb_build_object(
    'decision', 'found', 'profile', v_profile, 'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.get_my_member_profile(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_my_member_profile(uuid, uuid, uuid)
  to service_role;

create or replace function public.update_my_member_profile(
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_display_name text,
  p_contact_number text,
  p_expected_version bigint,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_display_name text := btrim(p_display_name);
  v_contact_number text := nullif(btrim(p_contact_number), '');
  v_profile public.organization_member_profiles%rowtype;
  v_organization_name text;
  v_email text;
  v_role_code text;
  v_role_label text;
  v_changed_fields jsonb := '[]'::jsonb;
begin
  if p_actor_user_id is null
     or p_membership_id is null
     or p_display_name is null
     or p_expected_version is null
     or p_correlation_id is null
     or char_length(v_display_name) not between 2 and 80
     or (v_contact_number is not null and (
       char_length(v_contact_number) > 32 or v_contact_number !~ '^[0-9 +().-]+$'
     ))
     or p_expected_version < 1 then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  select profile.*
  into v_profile
  from public.organization_member_profiles profile
  join public.organization_memberships membership
    on membership.organization_id = profile.organization_id
   and membership.id = profile.membership_id
   and membership.status = 'active'
   and membership.user_id = p_actor_user_id
  join public.membership_roles membership_role
    on membership_role.organization_id = membership.organization_id
   and membership_role.membership_id = membership.id
  join public.roles role
    on role.id = membership_role.role_id
   and role.is_active = true
  join public.organizations organization
    on organization.id = membership.organization_id
   and organization.status = 'active'
  where profile.membership_id = p_membership_id
  for update of profile;

  if not found then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  if v_profile.version <> p_expected_version then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;

  if v_profile.display_name is distinct from v_display_name then
    v_changed_fields := v_changed_fields || '"displayName"'::jsonb;
  end if;
  if v_profile.contact_number is distinct from v_contact_number then
    v_changed_fields := v_changed_fields || '"contactNumber"'::jsonb;
  end if;

  update public.organization_member_profiles
  set display_name = v_display_name,
      contact_number = v_contact_number,
      version = version + 1,
      updated_at = now(),
      updated_by = p_actor_user_id
  where id = v_profile.id
  returning * into v_profile;

  select organization.name, auth_user.email, role.code, role.display_name
  into v_organization_name, v_email, v_role_code, v_role_label
  from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
  join auth.users auth_user on auth_user.id = membership.user_id
  join public.membership_roles membership_role
    on membership_role.organization_id = membership.organization_id
   and membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id
  where membership.id = p_membership_id;

  insert into public.member_administration_events (
    organization_id, actor_user_id, target_membership_id,
    event_name, outcome, reason_code, correlation_id, metadata
  ) values (
    v_profile.organization_id, p_actor_user_id, p_membership_id,
    'member_profile.updated', 'success', 'member_profile_updated', p_correlation_id,
    jsonb_build_object('changedFields', v_changed_fields, 'priorVersion', p_expected_version, 'newVersion', v_profile.version)
  );

  return jsonb_build_object(
    'decision', 'updated',
    'profile', jsonb_build_object(
      'organizationId', v_profile.organization_id,
      'organizationName', v_organization_name,
      'membershipId', v_profile.membership_id,
      'displayName', v_profile.display_name,
      'contactNumber', v_profile.contact_number,
      'email', v_email,
      'roleCode', v_role_code,
      'roleLabel', v_role_label,
      'status', 'active',
      'version', v_profile.version,
      'complete', true
    ),
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.update_my_member_profile(uuid, uuid, text, text, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.update_my_member_profile(uuid, uuid, text, text, bigint, uuid)
  to service_role;

create or replace function public.change_organization_member_status(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_target_membership_id uuid,
  p_action text,
  p_reason_code text,
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
  v_target public.organization_memberships%rowtype;
  v_actor_membership_id uuid;
  v_target_role_code text;
  v_target_role_label text;
  v_event_name text;
  v_new_status text;
  v_prior_status text;
  v_existing public.member_administration_events%rowtype;
  v_active_admin_count integer;
begin
  if p_actor_user_id is null
     or p_organization_id is null
     or p_target_membership_id is null
     or p_action is null
     or p_reason_code is null
     or p_expected_version is null
     or p_idempotency_key_hash is null
     or p_correlation_id is null then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  if p_action = 'suspend' and p_reason_code in ('temporary_access_hold', 'administrative_review') then
    v_event_name := 'member_status.suspended'; v_new_status := 'suspended';
  elsif p_action = 'reactivate' and p_reason_code in ('hold_resolved', 'suspension_corrected') then
    v_event_name := 'member_status.reactivated'; v_new_status := 'active';
  elsif p_action = 'revoke' and p_reason_code in ('membership_ended', 'membership_created_in_error') then
    v_event_name := 'member_status.revoked'; v_new_status := 'revoked';
  else
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  if p_expected_version < 1 or p_idempotency_key_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  select membership.id into v_actor_membership_id
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active';

  if v_actor_membership_id is null
     or not public.member_administration_actor_is_authorized(
       p_actor_user_id, p_organization_id, 'membership.member.manage_status'
     ) then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;

  perform membership.id
  from public.organization_memberships membership
  join public.membership_roles membership_role
    on membership_role.organization_id = membership.organization_id
   and membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id and role.code = 'admin'
  where membership.organization_id = p_organization_id
    and membership.status = 'active'
  order by membership.id
  for update of membership;

  select membership.id into v_actor_membership_id
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active';

  if v_actor_membership_id is null
     or not public.member_administration_actor_is_authorized(
       p_actor_user_id, p_organization_id, 'membership.member.manage_status'
     ) then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;

  select membership.*
  into v_target
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.id = p_target_membership_id
  for update;

  if not found then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;

  select * into v_existing
  from public.member_administration_events event
  where event.organization_id = p_organization_id
    and event.actor_user_id = p_actor_user_id
    and event.event_name = v_event_name
    and event.idempotency_key_hash = p_idempotency_key_hash;

  if found then
    if v_existing.target_membership_id = p_target_membership_id
       and v_existing.reason_code = p_reason_code
       and (v_existing.metadata ->> 'priorVersion')::bigint = p_expected_version then
      return jsonb_build_object(
        'decision', v_new_status,
        'membershipId', p_target_membership_id,
        'organizationId', p_organization_id,
        'status', v_new_status,
        'version', (v_existing.metadata ->> 'newVersion')::bigint,
        'replayed', true,
        'correlationId', p_correlation_id
      );
    end if;
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;

  if v_target.id = v_actor_membership_id then
    return jsonb_build_object('decision', 'self_action', 'correlationId', p_correlation_id);
  end if;
  if v_target.version <> p_expected_version then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;
  v_prior_status := v_target.status;
  if (p_action = 'suspend' and v_target.status <> 'active')
     or (p_action = 'reactivate' and v_target.status <> 'suspended')
     or (p_action = 'revoke' and v_target.status not in ('active', 'suspended')) then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;

  select role.code, role.display_name
  into v_target_role_code, v_target_role_label
  from public.membership_roles membership_role
  join public.roles role on role.id = membership_role.role_id
  where membership_role.organization_id = p_organization_id
    and membership_role.membership_id = p_target_membership_id;

  if v_target_role_code is null
     or (p_action = 'reactivate' and not exists (
       select 1 from public.roles where code = v_target_role_code and is_active = true
     )) then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;

  if v_target_role_code = 'admin' and v_target.status = 'active' and p_action in ('suspend', 'revoke') then
    select count(*) into v_active_admin_count
    from public.organization_memberships membership
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.code = 'admin'
    where membership.organization_id = p_organization_id
      and membership.status = 'active';
    if v_active_admin_count <= 1 then
      return jsonb_build_object('decision', 'last_administrator', 'correlationId', p_correlation_id);
    end if;
  end if;

  update public.organization_memberships
  set status = v_new_status,
      version = version + 1,
      updated_at = now(),
      updated_by = p_actor_user_id
  where id = v_target.id
  returning * into v_target;

  insert into public.member_administration_events (
    organization_id, actor_user_id, target_membership_id,
    event_name, outcome, reason_code, correlation_id, idempotency_key_hash, metadata
  ) values (
    p_organization_id, p_actor_user_id, p_target_membership_id,
    v_event_name, 'success', p_reason_code, p_correlation_id, p_idempotency_key_hash,
    jsonb_build_object(
      'priorStatus', v_prior_status,
      'newStatus', v_new_status,
      'priorVersion', p_expected_version,
      'newVersion', v_target.version,
      'roleCode', v_target_role_code
    )
  );

  return jsonb_build_object(
    'decision', v_new_status,
    'membershipId', p_target_membership_id,
    'organizationId', p_organization_id,
    'status', v_new_status,
    'roleCode', v_target_role_code,
    'roleLabel', v_target_role_label,
    'version', v_target.version,
    'replayed', false,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.change_organization_member_status(uuid, uuid, uuid, text, text, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.change_organization_member_status(uuid, uuid, uuid, text, text, bigint, text, uuid)
  to service_role;

comment on table public.organization_member_profiles is
  'FEAT-005 organization-scoped basic profile. Values never grant identity or authority.';
comment on table public.member_administration_events is
  'Append-only minimized FEAT-005 directory, profile, denial, conflict, and membership-status evidence.';
comment on function public.change_organization_member_status(uuid, uuid, uuid, text, text, bigint, text, uuid) is
  'Server-only atomic FEAT-005 membership status command with tenant, self-action, last-admin, version, idempotency, and audit controls.';

commit;
