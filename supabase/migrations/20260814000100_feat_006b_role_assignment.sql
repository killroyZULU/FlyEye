begin;

alter table public.roles
  add column is_membership_assignable boolean not null default false,
  add column required_assurance_level text not null default 'aal2'
    check (required_assurance_level in ('aal1', 'aal2')),
  add column workspace_permission_code text;

update public.roles
set is_membership_assignable = true,
    required_assurance_level = case when code = 'student_pilot' then 'aal1' else 'aal2' end,
    workspace_permission_code = case code
      when 'student_pilot' then 'portal.student.access'
      when 'instructor_pilot' then 'portal.instructor.access'
      when 'admin' then 'portal.admin.access'
    end
where code in ('student_pilot', 'instructor_pilot', 'admin');

alter table public.roles
  alter column workspace_permission_code set not null,
  add constraint roles_workspace_permission_code_fkey
    foreign key (workspace_permission_code) references public.permissions(code) on delete restrict;

insert into public.permissions (code, description)
values ('membership.role.assign', 'Replace another active member''s approved FlyEye portal role.')
on conflict (code) do update
set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.code = 'membership.role.assign'
where role.code = 'admin'
on conflict do nothing;

alter table public.member_administration_events
  drop constraint if exists member_administration_events_event_name_check;
alter table public.member_administration_events
  add constraint member_administration_events_event_name_check check (
    event_name in (
      'member_directory.listed',
      'member_directory.viewed',
      'member_profile.viewed',
      'member_profile.updated',
      'member_status.suspended',
      'member_status.reactivated',
      'member_status.revoked',
      'member_role.changed',
      'member_administration.denied',
      'member_administration.conflicted',
      'member_administration.rate_limited'
    )
  );

drop index public.member_administration_status_idempotency_idx;
create unique index member_administration_mutation_idempotency_idx
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
      'member_status.revoked',
      'member_role.changed'
    );

create or replace function public.member_role_reason_options()
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select jsonb_build_array(
    jsonb_build_object('code', 'responsibility_changed', 'label', 'Responsibility changed'),
    jsonb_build_object('code', 'assignment_corrected', 'label', 'Assignment corrected')
  );
$$;

revoke all on function public.member_role_reason_options() from public, anon, authenticated;

create or replace function public.resolve_auth_access_context(
  p_actor_user_id uuid,
  p_assurance_level text,
  p_selected_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  contexts jsonb := '[]'::jsonb;
  organization_context_ids uuid[] := '{}'::uuid[];
  access_decision text := 'denied';
  event_correlation_id uuid := gen_random_uuid();
  resolved_selected_organization_id uuid;
begin
  if p_actor_user_id is null
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  if p_assurance_level not in ('aal1', 'aal2') then
    raise exception using errcode = '28000', message = 'Authentication assurance is invalid.';
  end if;

  with membership_contexts as (
    select
      membership.id as membership_id,
      organization.id as organization_id,
      organization.name as organization_name,
      role.code as role_code,
      role.display_name as role_label,
      role.workspace_permission_code,
      membership.version as membership_version,
      coalesce(
        (
          select jsonb_agg(permission.code order by permission.code)
          from public.role_permissions role_permission
          join public.permissions permission on permission.id = role_permission.permission_id
          where role_permission.role_id = role.id
        ),
        '[]'::jsonb
      ) as permissions,
      role.required_assurance_level,
      case
        when not exists (
          select 1
          from public.role_permissions role_permission
          join public.permissions permission on permission.id = role_permission.permission_id
          where role_permission.role_id = role.id
            and permission.code = role.workspace_permission_code
        ) then 'denied'
        when role.required_assurance_level = 'aal2' and p_assurance_level <> 'aal2'
          then 'mfa_required'
        else 'granted'
      end as access_status
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
     and organization.status = 'active'
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.is_active = true
    where membership.user_id = p_actor_user_id
      and membership.status = 'active'
      and (
        p_selected_organization_id is null
        or membership.organization_id = p_selected_organization_id
      )
  ), aggregated as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'membershipId', membership_id,
            'organizationId', organization_id,
            'organizationName', organization_name,
            'role', role_code,
            'roleLabel', role_label,
            'workspacePermission', workspace_permission_code,
            'permissions', permissions,
            'membershipVersion', membership_version,
            'requiredAssuranceLevel', required_assurance_level,
            'accessStatus', access_status
          ) order by organization_name, organization_id
        ),
        '[]'::jsonb
      ) as contexts,
      coalesce(array_agg(organization_id order by organization_id), '{}'::uuid[]) as organization_ids,
      bool_or(access_status = 'granted') as has_granted,
      bool_or(access_status = 'mfa_required') as has_mfa_required,
      count(*) as context_count
    from membership_contexts
  )
  select
    aggregated.contexts,
    aggregated.organization_ids,
    case
      when aggregated.has_granted then 'granted'
      when aggregated.has_mfa_required then 'mfa_required'
      else 'denied'
    end,
    case
      when p_selected_organization_id is not null and aggregated.context_count = 1
        then p_selected_organization_id
      else null
    end
  into contexts, organization_context_ids, access_decision, resolved_selected_organization_id
  from aggregated;

  return jsonb_build_object(
    'memberships', contexts,
    'correlationId', event_correlation_id,
    'decision', access_decision,
    'currentAssuranceLevel', p_assurance_level,
    'selectedOrganizationId', resolved_selected_organization_id,
    'organizationIds', to_jsonb(organization_context_ids)
  );
end;
$$;

revoke all on function public.resolve_auth_access_context(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_auth_access_context(uuid, text, uuid) to service_role;

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
    select role.required_assurance_level
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
     and organization.status = 'active'
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.is_active = true
    where membership.id = p_membership_id
      and membership.user_id = p_actor_user_id
      and membership.status = 'active'
  ), 'denied');
$$;

revoke all on function public.required_member_profile_assurance(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.required_member_profile_assurance(uuid, uuid) to service_role;

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
       'list', 'detail', 'get_profile', 'update_profile',
       'suspend', 'reactivate', 'revoke', 'assign_role'
     ) then
    raise exception using errcode = '22023', message = 'Limiter scope input is invalid.';
  end if;

  if p_action in ('list', 'detail')
     and p_organization_id is not null
     and public.member_administration_actor_is_authorized(
       p_actor_user_id, p_organization_id, 'membership.member.review'
     ) then
    v_scope := p_organization_id;
  elsif p_action in ('suspend', 'reactivate', 'revoke')
     and p_organization_id is not null
     and public.member_administration_actor_is_authorized(
       p_actor_user_id, p_organization_id, 'membership.member.manage_status'
     ) then
    v_scope := p_organization_id;
  elsif p_action = 'assign_role'
     and p_organization_id is not null
     and public.member_administration_actor_is_authorized(
       p_actor_user_id, p_organization_id, 'membership.role.assign'
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
    'statusReasonOptions', case
      when membership.user_id = p_actor_user_id
        or not public.member_administration_actor_is_authorized(
          p_actor_user_id, p_organization_id, 'membership.member.manage_status'
        ) then '[]'::jsonb
      when membership.status = 'active' then
        public.member_status_reason_options('suspend') || public.member_status_reason_options('revoke')
      when membership.status = 'suspended' then
        public.member_status_reason_options('reactivate') || public.member_status_reason_options('revoke')
      else '[]'::jsonb
    end,
    'roleOptions', case
      when membership.user_id = p_actor_user_id
        or membership.status <> 'active'
        or not public.member_administration_actor_is_authorized(
          p_actor_user_id, p_organization_id, 'membership.role.assign'
        ) then '[]'::jsonb
      else coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'code', assignable.code,
            'label', assignable.display_name,
            'requiresMfa', assignable.required_assurance_level = 'aal2'
          ) order by assignable.display_name, assignable.code
        )
        from public.roles assignable
        where assignable.is_active = true
          and assignable.is_membership_assignable = true
          and assignable.id <> role.id
      ), '[]'::jsonb)
    end,
    'roleReasonOptions', case
      when membership.user_id = p_actor_user_id
        or membership.status <> 'active'
        or not public.member_administration_actor_is_authorized(
          p_actor_user_id, p_organization_id, 'membership.role.assign'
        ) then '[]'::jsonb
      else public.member_role_reason_options()
    end,
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

  perform public.write_member_administration_event(
    p_organization_id, p_actor_user_id, p_target_membership_id,
    'member_directory.viewed', 'success', 'member_directory_viewed', p_correlation_id
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
grant execute on function public.get_organization_member(uuid, uuid, uuid, uuid) to service_role;

create or replace function public.resolve_member_role_assignment_context(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_target_membership_id uuid,
  p_new_role_code text,
  p_expected_version bigint,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_target public.organization_memberships%rowtype;
  v_current_role_code text;
  v_new_role public.roles%rowtype;
begin
  if p_actor_user_id is null
     or p_organization_id is null
     or p_target_membership_id is null
     or p_new_role_code is null
     or p_expected_version is null
     or p_expected_version < 1
     or p_correlation_id is null then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  if not public.member_administration_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'membership.role.assign'
  ) then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;

  select * into v_target
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.id = p_target_membership_id;

  if not found or v_target.status <> 'active' then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  if v_target.user_id = p_actor_user_id then
    return jsonb_build_object('decision', 'self_action', 'correlationId', p_correlation_id);
  end if;
  if v_target.version <> p_expected_version then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;

  select role.code into v_current_role_code
  from public.membership_roles membership_role
  join public.roles role on role.id = membership_role.role_id
  where membership_role.organization_id = p_organization_id
    and membership_role.membership_id = p_target_membership_id;

  select * into v_new_role
  from public.roles role
  where role.code = p_new_role_code
    and role.is_active = true
    and role.is_membership_assignable = true;

  if v_current_role_code is null or not found then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if v_current_role_code = v_new_role.code then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;

  return jsonb_build_object(
    'decision', 'authorized',
    'organizationId', p_organization_id,
    'membershipId', p_target_membership_id,
    'targetUserId', v_target.user_id,
    'newRoleCode', v_new_role.code,
    'requiresMfa', v_new_role.required_assurance_level = 'aal2',
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.resolve_member_role_assignment_context(uuid, uuid, uuid, text, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_member_role_assignment_context(uuid, uuid, uuid, text, bigint, uuid)
  to service_role;

create or replace function public.change_organization_member_role(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_target_membership_id uuid,
  p_new_role_code text,
  p_reason_code text,
  p_expected_version bigint,
  p_idempotency_key_hash text,
  p_factor_reference_hash text,
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
  v_current_role_id uuid;
  v_current_role_code text;
  v_new_role public.roles%rowtype;
  v_existing public.member_administration_events%rowtype;
  v_active_admin_count integer;
begin
  if p_actor_user_id is null
     or p_organization_id is null
     or p_target_membership_id is null
     or p_new_role_code is null
     or p_reason_code is null
     or p_expected_version is null
     or p_idempotency_key_hash is null
     or p_correlation_id is null
     or p_expected_version < 1
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or not exists (
       select 1
       from jsonb_array_elements(public.member_role_reason_options()) option
       where option ->> 'code' = p_reason_code
     ) then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  select membership.id into v_actor_membership_id
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active';

  if v_actor_membership_id is null
     or not public.member_administration_actor_is_authorized(
       p_actor_user_id, p_organization_id, 'membership.role.assign'
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
       p_actor_user_id, p_organization_id, 'membership.role.assign'
     ) then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;

  select membership.* into v_target
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
    and event.event_name = 'member_role.changed'
    and event.idempotency_key_hash = p_idempotency_key_hash;

  if found then
    if v_existing.target_membership_id = p_target_membership_id
       and v_existing.reason_code = p_reason_code
       and v_existing.metadata ->> 'newRoleCode' = p_new_role_code
       and (v_existing.metadata ->> 'priorVersion')::bigint = p_expected_version then
      return jsonb_build_object(
        'decision', 'changed',
        'membershipId', p_target_membership_id,
        'organizationId', p_organization_id,
        'roleCode', p_new_role_code,
        'roleLabel', v_existing.metadata ->> 'newRoleLabel',
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
  if v_target.status <> 'active' then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  if v_target.version <> p_expected_version then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;

  select role.id, role.code
  into v_current_role_id, v_current_role_code
  from public.membership_roles membership_role
  join public.roles role on role.id = membership_role.role_id
  where membership_role.organization_id = p_organization_id
    and membership_role.membership_id = p_target_membership_id;

  select * into v_new_role
  from public.roles role
  where role.code = p_new_role_code
    and role.is_active = true
    and role.is_membership_assignable = true;

  if v_current_role_id is null or not found then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if v_current_role_id = v_new_role.id then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;

  if v_new_role.required_assurance_level = 'aal2' then
    if p_factor_reference_hash is null
       or p_factor_reference_hash !~ '^[0-9a-f]{64}$'
       or not exists (
         select 1
         from public.member_mfa_readiness readiness
         where readiness.organization_id = p_organization_id
           and readiness.membership_id = p_target_membership_id
           and readiness.subject_user_id = v_target.user_id
           and readiness.factor_reference_hash = p_factor_reference_hash
       ) then
      return jsonb_build_object('decision', 'target_mfa_not_ready', 'correlationId', p_correlation_id);
    end if;
  elsif p_factor_reference_hash is not null then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  if v_current_role_code = 'admin' and v_new_role.code <> 'admin' then
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

  begin
    update public.membership_roles
    set role_id = v_new_role.id,
        assigned_at = now(),
        assigned_by = p_actor_user_id
    where organization_id = p_organization_id
      and membership_id = p_target_membership_id
      and role_id = v_current_role_id;

    if not found then
      return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
    end if;

    update public.organization_memberships
    set version = version + 1,
        updated_at = now(),
        updated_by = p_actor_user_id
    where id = v_target.id
    returning * into v_target;

    perform public.write_member_administration_event(
      p_organization_id, p_actor_user_id, p_target_membership_id,
      'member_role.changed', 'success', p_reason_code, p_correlation_id,
      p_idempotency_key_hash,
      jsonb_build_object(
        'priorRoleCode', v_current_role_code,
        'newRoleCode', v_new_role.code,
        'newRoleLabel', v_new_role.display_name,
        'priorVersion', p_expected_version,
        'newVersion', v_target.version,
        'mfaReadinessVerified', v_new_role.required_assurance_level = 'aal2'
      )
    );
  exception
    when unique_violation then
      select * into v_existing
      from public.member_administration_events event
      where event.organization_id = p_organization_id
        and event.actor_user_id = p_actor_user_id
        and event.event_name = 'member_role.changed'
        and event.idempotency_key_hash = p_idempotency_key_hash;

      if found
         and v_existing.target_membership_id = p_target_membership_id
         and v_existing.reason_code = p_reason_code
         and v_existing.metadata ->> 'newRoleCode' = p_new_role_code
         and (v_existing.metadata ->> 'priorVersion')::bigint = p_expected_version then
        return jsonb_build_object(
          'decision', 'changed',
          'membershipId', p_target_membership_id,
          'organizationId', p_organization_id,
          'roleCode', p_new_role_code,
          'roleLabel', v_existing.metadata ->> 'newRoleLabel',
          'version', (v_existing.metadata ->> 'newVersion')::bigint,
          'replayed', true,
          'correlationId', p_correlation_id
        );
      end if;
      return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end;

  return jsonb_build_object(
    'decision', 'changed',
    'membershipId', p_target_membership_id,
    'organizationId', p_organization_id,
    'roleCode', v_new_role.code,
    'roleLabel', v_new_role.display_name,
    'version', v_target.version,
    'replayed', false,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.change_organization_member_role(uuid, uuid, uuid, text, text, bigint, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.change_organization_member_role(uuid, uuid, uuid, text, text, bigint, text, text, uuid)
  to service_role;

comment on column public.roles.is_membership_assignable is
  'Server-controlled FEAT-006B allowlist. This flag does not grant authority by itself.';
comment on column public.roles.required_assurance_level is
  'Minimum authentication assurance for the role workspace and protected role promotion.';
comment on column public.roles.workspace_permission_code is
  'Permission required to enter the role workspace; the role must also map to it.';
comment on function public.change_organization_member_role(uuid, uuid, uuid, text, text, bigint, text, text, uuid) is
  'Server-only atomic FEAT-006B role replacement with tenant, readiness, self-action, last-admin, version, idempotency, and audit controls.';

commit;
