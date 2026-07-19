begin;

create extension if not exists pgcrypto with schema extensions;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index organizations_status_idx on public.organizations (status, id);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'suspended')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (organization_id, user_id),
  unique (organization_id, id)
);

create index organization_memberships_user_access_idx
  on public.organization_memberships (user_id, status, organization_id);
create index organization_memberships_org_status_idx
  on public.organization_memberships (organization_id, status, user_id);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 80),
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_.]{2,127}$'),
  description text not null default '',
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete restrict,
  permission_id uuid not null references public.permissions(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create index role_permissions_permission_idx
  on public.role_permissions (permission_id, role_id);

create table public.membership_roles (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  membership_id uuid not null,
  role_id uuid not null references public.roles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key (organization_id, membership_id, role_id),
  unique (organization_id, membership_id),
  foreign key (organization_id, membership_id)
    references public.organization_memberships(organization_id, id)
    on delete restrict
);

create index membership_roles_role_idx on public.membership_roles (role_id, organization_id);

create table public.authentication_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_name text not null check (
    event_name in (
      'authentication.access_context_loaded',
      'authentication.access_denied'
    )
  ),
  outcome text not null check (outcome in ('success', 'denied')),
  correlation_id uuid not null default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  check (
    organization_id is not null
    or event_name in (
      'authentication.access_context_loaded',
      'authentication.access_denied'
    )
  )
);

create index authentication_events_org_time_idx
  on public.authentication_events (organization_id, occurred_at desc);
create index authentication_events_actor_time_idx
  on public.authentication_events (actor_user_id, occurred_at desc);

insert into public.roles (code, display_name, description)
values
  ('student_pilot', 'Student Pilot', 'Student-facing FlyEye access.'),
  ('instructor_pilot', 'Instructor Pilot', 'Instructor-facing FlyEye access.'),
  ('admin', 'Admin', 'Administrative FlyEye access; aviation authority remains permission-scoped.')
on conflict (code) do update
set display_name = excluded.display_name,
    description = excluded.description,
    is_active = true;

insert into public.permissions (code, description)
values
  ('portal.student.access', 'Access the Student Pilot application area.'),
  ('portal.instructor.access', 'Access the Instructor Pilot application area.'),
  ('portal.admin.access', 'Access the administrative application area.')
on conflict (code) do update
set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from (
  values
    ('student_pilot', 'portal.student.access'),
    ('instructor_pilot', 'portal.instructor.access'),
    ('admin', 'portal.admin.access')
) as mapping(role_code, permission_code)
join public.roles role on role.code = mapping.role_code
join public.permissions permission on permission.code = mapping.permission_code
on conflict do nothing;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.membership_roles enable row level security;
alter table public.authentication_events enable row level security;

revoke all on table public.organizations from anon, authenticated;
revoke all on table public.organization_memberships from anon, authenticated;
revoke all on table public.roles from anon, authenticated;
revoke all on table public.permissions from anon, authenticated;
revoke all on table public.role_permissions from anon, authenticated;
revoke all on table public.membership_roles from anon, authenticated;
revoke all on table public.authentication_events from anon, authenticated;

create or replace function public.get_my_access_context()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  contexts jsonb := '[]'::jsonb;
  context_count integer := 0;
  audit_organization_id uuid;
  event_correlation_id uuid := gen_random_uuid();
begin
  if current_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'Authentication is required.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'membershipId', membership.id,
        'organizationId', organization.id,
        'organizationName', organization.name,
        'role', role.code,
        'permissions', coalesce(
          (
            select jsonb_agg(permission.code order by permission.code)
            from public.role_permissions role_permission
            join public.permissions permission
              on permission.id = role_permission.permission_id
            where role_permission.role_id = role.id
          ),
          '[]'::jsonb
        ),
        'membershipVersion', membership.version
      )
      order by organization.name, organization.id
    ),
    '[]'::jsonb
  )
  into contexts
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
  where membership.user_id = current_user_id
    and membership.status = 'active';

  context_count := jsonb_array_length(contexts);

  if context_count = 1 then
    audit_organization_id := (contexts -> 0 ->> 'organizationId')::uuid;
  end if;

  insert into public.authentication_events (
    organization_id,
    actor_user_id,
    event_name,
    outcome,
    correlation_id,
    metadata
  )
  values (
    audit_organization_id,
    current_user_id,
    case
      when context_count = 0 then 'authentication.access_denied'
      else 'authentication.access_context_loaded'
    end,
    case when context_count = 0 then 'denied' else 'success' end,
    event_correlation_id,
    jsonb_build_object('membershipCount', context_count)
  );

  return jsonb_build_object(
    'memberships', contexts,
    'correlationId', event_correlation_id
  );
end;
$$;

revoke all on function public.get_my_access_context() from public, anon;
grant execute on function public.get_my_access_context() to authenticated;

comment on function public.get_my_access_context() is
  'Returns the authenticated user''s active FlyEye access contexts and atomically records the access decision.';

commit;
