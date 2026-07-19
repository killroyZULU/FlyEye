begin;

alter table public.organization_memberships
  drop constraint organization_memberships_status_check;
alter table public.organization_memberships
  add constraint organization_memberships_status_check
    check (status in ('active', 'suspended', 'revoked')) not valid;
alter table public.organization_memberships
  validate constraint organization_memberships_status_check;

alter table public.authentication_events
  add column actor_subject_id uuid,
  add column organization_ids uuid[] not null default '{}'::uuid[],
  add column reason_code text;

update public.authentication_events
set actor_subject_id = actor_user_id,
    organization_ids = case
      when organization_id is null then '{}'::uuid[]
      else array[organization_id]
    end,
    reason_code = case
      when outcome = 'success' then 'access_context_granted'
      else 'access_context_denied'
    end;

alter table public.authentication_events
  alter column reason_code set not null,
  add constraint authentication_events_event_outcome_match_check
    check (
      (event_name = 'authentication.access_context_loaded' and outcome = 'success')
      or (event_name = 'authentication.access_denied' and outcome = 'denied')
    ) not valid,
  add constraint authentication_events_reason_code_check
    check (reason_code ~ '^[a-z][a-z0-9_]{2,63}$') not valid,
  add constraint authentication_events_organization_ids_check
    check (array_position(organization_ids, null) is null) not valid;

alter table public.authentication_events
  validate constraint authentication_events_event_outcome_match_check;
alter table public.authentication_events
  validate constraint authentication_events_reason_code_check;
alter table public.authentication_events
  validate constraint authentication_events_organization_ids_check;

create index authentication_events_subject_time_idx
  on public.authentication_events (actor_subject_id, occurred_at desc);

revoke all on function public.get_my_access_context() from public, anon, authenticated;

create or replace function public.get_my_access_context()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'Use the authenticated auth-bootstrap Edge Function.';
end;
$$;

comment on function public.get_my_access_context() is
  'Deprecated FEAT-001 bootstrap entry point. Browser execution is revoked; use auth-bootstrap.';

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
      membership.version as membership_version,
      coalesce(
        (
          select jsonb_agg(permission.code order by permission.code)
          from public.role_permissions role_permission
          join public.permissions permission
            on permission.id = role_permission.permission_id
          where role_permission.role_id = role.id
        ),
        '[]'::jsonb
      ) as permissions,
      case
        when role.code in ('instructor_pilot', 'admin') then 'aal2'
        else 'aal1'
      end as required_assurance_level,
      case
        when not exists (
          select 1
          from public.role_permissions role_permission
          join public.permissions permission
            on permission.id = role_permission.permission_id
          where role_permission.role_id = role.id
            and permission.code = case role.code
              when 'student_pilot' then 'portal.student.access'
              when 'instructor_pilot' then 'portal.instructor.access'
              when 'admin' then 'portal.admin.access'
              else '__unapproved_role__'
            end
        ) then 'denied'
        when role.code in ('instructor_pilot', 'admin')
             and p_assurance_level <> 'aal2' then 'mfa_required'
        when role.code in ('student_pilot', 'instructor_pilot', 'admin') then 'granted'
        else 'denied'
      end as access_status
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
grant execute on function public.resolve_auth_access_context(uuid, text, uuid)
  to service_role;

comment on function public.resolve_auth_access_context(uuid, text, uuid) is
  'Server-only FEAT-001 resolver. Applies active tenant membership, portal permission, and JWT AAL checks.';

create or replace function public.record_authentication_access_decision(
  p_actor_user_id uuid,
  p_actor_subject_id uuid,
  p_event_name text,
  p_outcome text,
  p_correlation_id uuid,
  p_organization_id uuid,
  p_organization_ids uuid[],
  p_reason_code text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  stored_actor_user_id uuid;
  inserted_event_id uuid;
begin
  if p_actor_subject_id is null then
    raise exception using errcode = '23502', message = 'Actor subject is required.';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'Audit metadata must be an object.';
  end if;

  select id into stored_actor_user_id
  from auth.users
  where id = p_actor_user_id;

  insert into public.authentication_events (
    organization_id,
    organization_ids,
    actor_user_id,
    actor_subject_id,
    event_name,
    outcome,
    correlation_id,
    reason_code,
    metadata
  ) values (
    p_organization_id,
    coalesce(p_organization_ids, '{}'::uuid[]),
    stored_actor_user_id,
    p_actor_subject_id,
    p_event_name,
    p_outcome,
    p_correlation_id,
    p_reason_code,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into inserted_event_id;

  return inserted_event_id;
end;
$$;

revoke all on function public.record_authentication_access_decision(
  uuid, uuid, text, text, uuid, uuid, uuid[], text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_authentication_access_decision(
  uuid, uuid, text, text, uuid, uuid, uuid[], text, jsonb
) to service_role;

comment on function public.record_authentication_access_decision(
  uuid, uuid, text, text, uuid, uuid, uuid[], text, jsonb
) is
  'Server-only FEAT-001 audit writer called after Edge runtime contract validation.';

commit;
