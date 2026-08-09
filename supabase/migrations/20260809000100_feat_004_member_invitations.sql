begin;

alter table public.roles
  add column is_invitation_assignable boolean not null default false;

update public.roles
set is_invitation_assignable = true,
    display_name = case when code = 'admin' then 'Organization Admin' else display_name end
where code in ('student_pilot', 'instructor_pilot', 'admin');

insert into public.permissions (code, description)
values (
  'membership.invitation.manage',
  'List, create, resend, and revoke member invitations for an authorized organization.'
)
on conflict (code) do update
set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission
  on permission.code = 'membership.invitation.manage'
where role.code = 'admin'
on conflict do nothing;

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  email_original text not null,
  email_canonical text not null,
  role_id uuid not null references public.roles(id) on delete restrict,
  status text not null default 'issuing'
    check (status in (
      'issuing', 'pending', 'delivery_failed', 'delivery_uncertain',
      'accepted', 'expired', 'superseded', 'revoked'
    )),
  version bigint not null default 1 check (version > 0),
  invited_by uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default transaction_timestamp(),
  expires_at timestamptz not null default (transaction_timestamp() + interval '1 hour'),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete restrict,
  accepted_membership_id uuid,
  expired_at timestamptz,
  revoked_at timestamptz,
  superseded_at timestamptz,
  supersedes_invitation_id uuid,
  issuance_action text not null default 'create'
    check (issuance_action in ('create', 'resend')),
  issuance_source_version bigint check (issuance_source_version > 0),
  issuance_idempotency_key_hash text not null
    check (issuance_idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  acceptance_idempotency_key_hash text
    check (
      acceptance_idempotency_key_hash is null
      or acceptance_idempotency_key_hash ~ '^[0-9a-f]{64}$'
    ),
  delivery_operation_id uuid,
  delivery_outcome text check (delivery_outcome in ('accepted', 'failed', 'uncertain')),
  delivery_attempt_count integer not null default 0 check (delivery_attempt_count >= 0),
  last_delivery_attempt_at timestamptz,
  provider_operation_class text
    check (provider_operation_class in ('new_identity_invite', 'existing_identity_sign_in')),
  correlation_id uuid not null,
  unique (organization_id, id),
  unique (organization_id, invited_by, issuance_idempotency_key_hash),
  foreign key (organization_id, accepted_membership_id)
    references public.organization_memberships(organization_id, id)
    on delete restrict,
  foreign key (organization_id, supersedes_invitation_id)
    references public.organization_invitations(organization_id, id)
    on delete restrict,
  check (expires_at = issued_at + interval '1 hour'),
  check (char_length(email_original) between 3 and 254),
  check (char_length(email_canonical) between 3 and 254),
  check (email_canonical = lower(btrim(email_original))),
  check (email_original !~ '[[:cntrl:]]'),
  check (email_original !~ '[^\x20-\x7E]'),
  check (
    (status = 'accepted'
      and accepted_at is not null
      and accepted_by is not null
      and accepted_membership_id is not null
      and acceptance_idempotency_key_hash is not null)
    or
    (status <> 'accepted'
      and accepted_at is null
      and accepted_by is null
      and accepted_membership_id is null
      and acceptance_idempotency_key_hash is null)
  ),
  check ((status = 'expired') = (expired_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null)),
  check ((status = 'superseded') = (superseded_at is not null)),
  check (
    (issuance_action = 'create'
      and supersedes_invitation_id is null
      and issuance_source_version is null)
    or
    (issuance_action = 'resend'
      and supersedes_invitation_id is not null
      and issuance_source_version is not null)
  ),
  check (
    (delivery_operation_id is null
      and delivery_outcome is null
      and delivery_attempt_count = 0
      and last_delivery_attempt_at is null
      and provider_operation_class is null)
    or
    (delivery_operation_id is not null
      and delivery_outcome is not null
      and delivery_attempt_count = 1
      and last_delivery_attempt_at is not null
      and provider_operation_class is not null)
  )
);

create unique index organization_invitations_active_email_idx
  on public.organization_invitations (organization_id, email_canonical)
  where status in ('issuing', 'pending', 'delivery_failed', 'delivery_uncertain');
create index organization_invitations_org_time_idx
  on public.organization_invitations (organization_id, created_at desc, id);
create index organization_invitations_recipient_idx
  on public.organization_invitations (email_canonical, status, expires_at, id);

create table public.member_invitation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  invitation_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_name text not null check (event_name in (
    'member_invitation.created',
    'member_invitation.delivery_recorded',
    'member_invitation.expired',
    'member_invitation.superseded',
    'member_invitation.revoked',
    'member_invitation.accepted',
    'member_invitation.denied',
    'member_invitation.conflicted'
  )),
  outcome text not null check (outcome in ('success', 'denied', 'failed', 'uncertain')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  correlation_id uuid not null,
  idempotency_key_hash text check (
    idempotency_key_hash is null or idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default transaction_timestamp(),
  foreign key (organization_id, invitation_id)
    references public.organization_invitations(organization_id, id)
    on delete restrict,
  check (
    (invitation_id is null and organization_id is null)
    or (invitation_id is not null and organization_id is not null)
  )
);

create index member_invitation_events_org_time_idx
  on public.member_invitation_events (organization_id, occurred_at desc, id);
create index member_invitation_events_invitation_time_idx
  on public.member_invitation_events (invitation_id, occurred_at, id);

create table public.member_invitation_rate_limit_state (
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('list', 'create', 'resend', 'revoke', 'prepare', 'accept')),
  tokens_milli bigint not null check (tokens_milli >= 0),
  last_refill_at timestamptz not null,
  last_decision_at timestamptz not null,
  primary key (limiter_key_hash, action)
);

create table public.member_invitation_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null unique,
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('list', 'create', 'resend', 'revoke', 'prepare', 'accept')),
  outcome text not null check (outcome in ('allowed', 'rate_limited')),
  status_code integer not null check (status_code in (200, 429)),
  retry_after_seconds integer check (
    retry_after_seconds is null or retry_after_seconds between 1 and 3600
  ),
  network_source_used boolean not null default false check (not network_source_used),
  occurred_at timestamptz not null default transaction_timestamp(),
  check (
    (outcome = 'allowed' and status_code = 200 and retry_after_seconds is null)
    or
    (outcome = 'rate_limited' and status_code = 429 and retry_after_seconds is not null)
  )
);

alter table public.organization_invitations enable row level security;
alter table public.member_invitation_events enable row level security;
alter table public.member_invitation_rate_limit_state enable row level security;
alter table public.member_invitation_rate_limit_events enable row level security;

revoke all on table public.organization_invitations from public, anon, authenticated;
revoke all on table public.member_invitation_events from public, anon, authenticated;
revoke all on table public.member_invitation_rate_limit_state from public, anon, authenticated;
revoke all on table public.member_invitation_rate_limit_events from public, anon, authenticated;

create or replace function public.canonicalize_member_invitation_email(p_email text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_email text;
begin
  if p_email is null
     or char_length(p_email) > 254
     or p_email ~ '[[:cntrl:]]'
     or p_email ~ '[^\x20-\x7E]' then
    raise exception using errcode = '22023', message = 'Invitation email is invalid.';
  end if;

  v_email := lower(btrim(p_email));
  if v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
     or char_length(v_email) > 254 then
    raise exception using errcode = '22023', message = 'Invitation email is invalid.';
  end if;
  return v_email;
end;
$$;

revoke all on function public.canonicalize_member_invitation_email(text)
  from public, anon, authenticated;
grant execute on function public.canonicalize_member_invitation_email(text) to service_role;

create or replace function public.member_invitation_actor_is_authorized(
  p_actor_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
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
     and role.is_active
    join public.role_permissions role_permission
      on role_permission.role_id = role.id
    join public.permissions permission
      on permission.id = role_permission.permission_id
     and permission.code = 'membership.invitation.manage'
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_user_id
      and membership.status = 'active'
  );
$$;

revoke all on function public.member_invitation_actor_is_authorized(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.member_invitation_actor_is_authorized(uuid, uuid) to service_role;

create or replace function public.resolve_member_invitation_limiter_scope(
  p_actor_user_id uuid,
  p_action text,
  p_organization_id uuid,
  p_invitation_id uuid,
  p_confirmed_email text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_denied_scope constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_email text;
begin
  if p_actor_user_id is null
     or p_action not in ('list', 'create', 'resend', 'revoke', 'prepare', 'accept') then
    raise exception using errcode = '22023', message = 'Limiter scope input is invalid.';
  end if;

  if p_action in ('list', 'create') then
    if p_organization_id is not null
       and public.member_invitation_actor_is_authorized(p_actor_user_id, p_organization_id) then
      return p_organization_id;
    end if;
    return v_denied_scope;
  end if;

  if p_action in ('resend', 'revoke') then
    if p_organization_id is not null and p_invitation_id is not null
       and public.member_invitation_actor_is_authorized(p_actor_user_id, p_organization_id)
       and exists (
         select 1 from public.organization_invitations
         where organization_id = p_organization_id and id = p_invitation_id
       ) then
      return case when p_action = 'resend' then p_invitation_id else p_organization_id end;
    end if;
    return v_denied_scope;
  end if;

  begin
    v_email := public.canonicalize_member_invitation_email(p_confirmed_email);
  exception when sqlstate '22023' then
    return v_denied_scope;
  end;
  if p_invitation_id is not null and exists (
    select 1 from public.organization_invitations
    where id = p_invitation_id and email_canonical = v_email
  ) then
    return p_invitation_id;
  end if;
  return v_denied_scope;
end;
$$;

revoke all on function public.resolve_member_invitation_limiter_scope(uuid, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_member_invitation_limiter_scope(uuid, text, uuid, uuid, text)
  to service_role;

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

create or replace function public.materialize_member_invitation_expiry(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_expired record;
  v_count integer := 0;
begin
  for v_expired in
    update public.organization_invitations invitation
    set status = 'expired',
        version = version + 1,
        expired_at = transaction_timestamp(),
        updated_at = transaction_timestamp()
    where invitation.organization_id = p_organization_id
      and (p_invitation_id is null or invitation.id = p_invitation_id)
      and invitation.status = 'pending'
      and transaction_timestamp() >= invitation.expires_at
    returning invitation.id, invitation.organization_id, invitation.version
  loop
    insert into public.member_invitation_events (
      organization_id, invitation_id, actor_user_id, event_name, outcome,
      reason_code, correlation_id, metadata
    ) values (
      v_expired.organization_id, v_expired.id, p_actor_user_id,
      'member_invitation.expired', 'denied', 'invitation_expired',
      coalesce(p_correlation_id, gen_random_uuid()),
      jsonb_build_object('invitationVersion', v_expired.version)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.materialize_member_invitation_expiry(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.materialize_member_invitation_expiry(uuid, uuid, uuid, uuid)
  to service_role;

create or replace function public.record_member_invitation_denial(
  p_actor_user_id uuid,
  p_event_name text,
  p_reason_code text,
  p_correlation_id uuid,
  p_organization_id uuid default null,
  p_invitation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_id uuid;
begin
  if p_actor_user_id is null
     or not exists (select 1 from auth.users where id = p_actor_user_id)
     or p_event_name not in ('member_invitation.denied', 'member_invitation.conflicted')
     or p_reason_code !~ '^[a-z][a-z0-9_]{2,63}$'
     or p_correlation_id is null
     or ((p_organization_id is null) <> (p_invitation_id is null))
     or (
       p_invitation_id is not null
       and not exists (
         select 1 from public.organization_invitations
         where organization_id = p_organization_id and id = p_invitation_id
       )
     ) then
    raise exception using errcode = '22023', message = 'Invitation denial audit input is invalid.';
  end if;

  insert into public.member_invitation_events (
    organization_id, invitation_id, actor_user_id, event_name, outcome,
    reason_code, correlation_id
  ) values (
    p_organization_id, p_invitation_id, p_actor_user_id, p_event_name,
    'denied', p_reason_code, p_correlation_id
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;

revoke all on function public.record_member_invitation_denial(uuid, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_member_invitation_denial(uuid, text, text, uuid, uuid, uuid)
  to service_role;

create or replace function public.list_member_invitations(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invitations jsonb;
  v_roles jsonb;
begin
  if p_actor_user_id is null or p_organization_id is null or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Invitation list input is invalid.';
  end if;

  perform 1 from public.organizations where id = p_organization_id for update;
  if not public.member_invitation_actor_is_authorized(p_actor_user_id, p_organization_id) then
    perform public.record_member_invitation_denial(
      p_actor_user_id, 'member_invitation.denied', 'invitation_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  perform public.materialize_member_invitation_expiry(
    p_organization_id, null, p_actor_user_id, p_correlation_id
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'invitationId', invitation.id,
    'email', invitation.email_original,
    'roleCode', role.code,
    'roleLabel', role.display_name,
    'status', invitation.status,
    'version', invitation.version,
    'issuedAt', invitation.issued_at,
    'expiresAt', invitation.expires_at
  ) order by invitation.created_at desc, invitation.id), '[]'::jsonb)
  into v_invitations
  from (
    select invitation.*
    from public.organization_invitations invitation
    where invitation.organization_id = p_organization_id
    order by invitation.created_at desc, invitation.id
    limit 100
  ) invitation
  join public.roles role on role.id = invitation.role_id
  ;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', role.code, 'label', role.display_name
  ) order by role.display_name, role.code), '[]'::jsonb)
  into v_roles
  from public.roles role
  where role.is_active and role.is_invitation_assignable;

  return jsonb_build_object(
    'decision', 'listed',
    'organizationId', p_organization_id,
    'invitations', v_invitations,
    'roles', v_roles,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.list_member_invitations(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_member_invitations(uuid, uuid, uuid) to service_role;

create or replace function public.begin_member_invitation(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_email text,
  p_role_code text,
  p_idempotency_key_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text;
  v_role_id uuid;
  v_invitation public.organization_invitations%rowtype;
begin
  if p_actor_user_id is null or p_organization_id is null
     or p_role_code is null or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Invitation input is invalid.';
  end if;
  v_email := public.canonicalize_member_invitation_email(p_email);

  perform 1 from public.organizations where id = p_organization_id for update;
  if not public.member_invitation_actor_is_authorized(p_actor_user_id, p_organization_id) then
    perform public.record_member_invitation_denial(
      p_actor_user_id, 'member_invitation.denied', 'invitation_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  select id into v_role_id
  from public.roles
  where code = p_role_code;
  if v_role_id is null then
    insert into public.member_invitation_events (
      actor_user_id, event_name, outcome, reason_code, correlation_id
    ) values (
      p_actor_user_id, 'member_invitation.denied', 'denied',
      'role_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  select * into v_invitation
  from public.organization_invitations
  where organization_id = p_organization_id
    and invited_by = p_actor_user_id
    and issuance_idempotency_key_hash = p_idempotency_key_hash;
  if v_invitation.id is not null then
    if v_invitation.issuance_action <> 'create'
       or v_invitation.email_canonical <> v_email
       or v_invitation.role_id <> v_role_id then
      return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
    end if;
    return jsonb_build_object(
      'decision', v_invitation.status, 'invitationId', v_invitation.id,
      'email', v_invitation.email_original, 'version', v_invitation.version,
      'expiresAt', v_invitation.expires_at, 'replayed', true,
      'correlationId', p_correlation_id
    );
  end if;

  perform public.materialize_member_invitation_expiry(
    p_organization_id, null, p_actor_user_id, p_correlation_id
  );

  if not exists (
    select 1 from public.roles
    where id = v_role_id and is_active and is_invitation_assignable
    for share
  ) then
    insert into public.member_invitation_events (
      actor_user_id, event_name, outcome, reason_code, correlation_id
    ) values (
      p_actor_user_id, 'member_invitation.denied', 'denied',
      'role_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  if exists (
    select 1 from public.organization_invitations
    where organization_id = p_organization_id
      and email_canonical = v_email
       and status in ('issuing', 'pending', 'delivery_failed', 'delivery_uncertain')
  ) or exists (
    select 1
    from auth.users auth_user
    join public.organization_memberships membership
      on membership.user_id = auth_user.id
     and membership.organization_id = p_organization_id
    where lower(btrim(auth_user.email)) = v_email
  ) then
    insert into public.member_invitation_events (
      actor_user_id, event_name, outcome, reason_code, correlation_id
    ) values (
      p_actor_user_id, 'member_invitation.conflicted', 'denied',
      'invitation_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  insert into public.organization_invitations (
    organization_id, email_original, email_canonical, role_id, invited_by,
    issuance_idempotency_key_hash, correlation_id
  ) values (
    p_organization_id, btrim(p_email), v_email, v_role_id, p_actor_user_id,
    p_idempotency_key_hash, p_correlation_id
  ) returning * into v_invitation;

  insert into public.member_invitation_events (
    organization_id, invitation_id, actor_user_id, event_name, outcome,
    reason_code, correlation_id, idempotency_key_hash,
    metadata
  ) values (
    p_organization_id, v_invitation.id, p_actor_user_id,
    'member_invitation.created', 'success', 'invitation_issuing',
    p_correlation_id, p_idempotency_key_hash,
    jsonb_build_object('invitationVersion', v_invitation.version, 'roleId', v_role_id)
  );

  return jsonb_build_object(
    'decision', 'issuing', 'invitationId', v_invitation.id,
    'email', v_invitation.email_original, 'version', v_invitation.version,
    'expiresAt', v_invitation.expires_at, 'replayed', false,
    'correlationId', p_correlation_id
  );
exception
  when unique_violation then
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.begin_member_invitation(uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_member_invitation(uuid, uuid, text, text, text, uuid)
  to service_role;

create or replace function public.finalize_member_invitation_delivery(
  p_actor_user_id uuid,
  p_invitation_id uuid,
  p_delivery_operation_id uuid,
  p_delivery_outcome text,
  p_provider_operation_class text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_organization_id uuid;
  v_invitation public.organization_invitations%rowtype;
  v_status text;
begin
  if p_actor_user_id is null or p_invitation_id is null
     or p_delivery_operation_id is null
     or p_delivery_outcome not in ('accepted', 'failed', 'uncertain')
     or p_provider_operation_class not in ('new_identity_invite', 'existing_identity_sign_in')
     or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Delivery result is invalid.';
  end if;

  select organization_id into v_organization_id
  from public.organization_invitations where id = p_invitation_id;
  if v_organization_id is null then
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;
  perform 1 from public.organizations where id = v_organization_id for update;
  select * into v_invitation
  from public.organization_invitations where id = p_invitation_id for update;

  if not public.member_invitation_actor_is_authorized(p_actor_user_id, v_organization_id)
     or v_invitation.invited_by <> p_actor_user_id then
    perform public.record_member_invitation_denial(
      p_actor_user_id, 'member_invitation.denied', 'invitation_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;
  if v_invitation.delivery_operation_id = p_delivery_operation_id then
    return jsonb_build_object(
      'decision', v_invitation.status, 'invitationId', v_invitation.id,
      'version', v_invitation.version, 'replayed', true,
      'correlationId', p_correlation_id
    );
  end if;
  if v_invitation.status <> 'issuing' or v_invitation.delivery_operation_id is not null then
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  v_status := case p_delivery_outcome
    when 'accepted' then 'pending'
    when 'failed' then 'delivery_failed'
    else 'delivery_uncertain'
  end;
  update public.organization_invitations
  set status = v_status,
      version = version + 1,
      updated_at = transaction_timestamp(),
      delivery_operation_id = p_delivery_operation_id,
      delivery_outcome = p_delivery_outcome,
      delivery_attempt_count = 1,
      last_delivery_attempt_at = transaction_timestamp(),
      provider_operation_class = p_provider_operation_class
  where id = v_invitation.id
  returning * into v_invitation;

  insert into public.member_invitation_events (
    organization_id, invitation_id, actor_user_id, event_name, outcome,
    reason_code, correlation_id, metadata
  ) values (
    v_organization_id, v_invitation.id, p_actor_user_id,
    'member_invitation.delivery_recorded',
    case p_delivery_outcome when 'accepted' then 'success' when 'failed' then 'failed' else 'uncertain' end,
    'provider_result_recorded', p_correlation_id,
    jsonb_build_object(
      'deliveryOutcome', p_delivery_outcome,
      'providerOperationClass', p_provider_operation_class,
      'attemptNumber', 1,
      'invitationVersion', v_invitation.version
    )
  );

  return jsonb_build_object(
    'decision', v_invitation.status, 'invitationId', v_invitation.id,
    'version', v_invitation.version, 'replayed', false,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.finalize_member_invitation_delivery(uuid, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_member_invitation_delivery(uuid, uuid, uuid, text, text, uuid)
  to service_role;

create or replace function public.begin_resend_member_invitation(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_invitation_id uuid,
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
  v_source public.organization_invitations%rowtype;
  v_new public.organization_invitations%rowtype;
begin
  if p_actor_user_id is null or p_organization_id is null or p_invitation_id is null
     or p_expected_version < 1 or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Resend input is invalid.';
  end if;

  perform 1 from public.organizations where id = p_organization_id for update;
  if not public.member_invitation_actor_is_authorized(p_actor_user_id, p_organization_id) then
    perform public.record_member_invitation_denial(
      p_actor_user_id, 'member_invitation.denied', 'invitation_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  select * into v_new from public.organization_invitations
  where organization_id = p_organization_id and invited_by = p_actor_user_id
    and issuance_idempotency_key_hash = p_idempotency_key_hash;
  if v_new.id is not null then
    if v_new.issuance_action <> 'resend'
       or v_new.supersedes_invitation_id <> p_invitation_id
       or v_new.issuance_source_version <> p_expected_version then
      return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
    end if;
    return jsonb_build_object(
      'decision', v_new.status, 'invitationId', v_new.id, 'email', v_new.email_original,
      'version', v_new.version, 'expiresAt', v_new.expires_at, 'replayed', true,
      'correlationId', p_correlation_id
    );
  end if;

  perform public.materialize_member_invitation_expiry(
    p_organization_id, p_invitation_id, p_actor_user_id, p_correlation_id
  );
  select * into v_source from public.organization_invitations
  where organization_id = p_organization_id and id = p_invitation_id for update;

  if v_source.id is null or v_source.version <> p_expected_version
     or v_source.status not in ('pending', 'expired', 'delivery_failed', 'delivery_uncertain', 'issuing')
     or (v_source.status = 'issuing' and transaction_timestamp() < v_source.created_at + interval '60 seconds') then
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  perform 1 from public.organization_invitations
  where organization_id = p_organization_id
    and email_canonical = v_source.email_canonical
    and id <> v_source.id
    and status in ('issuing', 'pending', 'delivery_failed', 'delivery_uncertain')
  for update;
  if found then
    insert into public.member_invitation_events (
      organization_id, invitation_id, actor_user_id, event_name, outcome,
      reason_code, correlation_id, metadata
    ) values (
      p_organization_id, v_source.id, p_actor_user_id,
      'member_invitation.conflicted', 'denied', 'newer_invitation_active',
      p_correlation_id, jsonb_build_object('invitationVersion', v_source.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  update public.organization_invitations
  set status = 'superseded', version = version + 1,
      superseded_at = transaction_timestamp(), expired_at = null,
      updated_at = transaction_timestamp()
  where id = v_source.id;
  insert into public.member_invitation_events (
    organization_id, invitation_id, actor_user_id, event_name, outcome,
    reason_code, correlation_id, metadata
  ) values (
    p_organization_id, v_source.id, p_actor_user_id,
    'member_invitation.superseded', 'success', 'invitation_resent',
    p_correlation_id, jsonb_build_object('invitationVersion', v_source.version + 1)
  );

  insert into public.organization_invitations (
    organization_id, email_original, email_canonical, role_id, invited_by,
    supersedes_invitation_id, issuance_action, issuance_source_version,
    issuance_idempotency_key_hash, correlation_id
  ) values (
    p_organization_id, v_source.email_original, v_source.email_canonical,
    v_source.role_id, p_actor_user_id, v_source.id, 'resend', p_expected_version,
    p_idempotency_key_hash, p_correlation_id
  ) returning * into v_new;
  insert into public.member_invitation_events (
    organization_id, invitation_id, actor_user_id, event_name, outcome,
    reason_code, correlation_id, idempotency_key_hash, metadata
  ) values (
    p_organization_id, v_new.id, p_actor_user_id,
    'member_invitation.created', 'success', 'invitation_issuing',
    p_correlation_id, p_idempotency_key_hash,
    jsonb_build_object('invitationVersion', v_new.version, 'resendOf', v_source.id)
  );

  return jsonb_build_object(
    'decision', 'issuing', 'invitationId', v_new.id, 'email', v_new.email_original,
    'version', v_new.version, 'expiresAt', v_new.expires_at, 'replayed', false,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.begin_resend_member_invitation(uuid, uuid, uuid, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_resend_member_invitation(uuid, uuid, uuid, bigint, text, uuid)
  to service_role;

create or replace function public.revoke_member_invitation(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_invitation_id uuid,
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
  v_invitation public.organization_invitations%rowtype;
begin
  perform 1 from public.organizations where id = p_organization_id for update;
  if not public.member_invitation_actor_is_authorized(p_actor_user_id, p_organization_id) then
    perform public.record_member_invitation_denial(
      p_actor_user_id, 'member_invitation.denied', 'invitation_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;
  perform public.materialize_member_invitation_expiry(
    p_organization_id, p_invitation_id, p_actor_user_id, p_correlation_id
  );
  select * into v_invitation from public.organization_invitations
  where organization_id = p_organization_id and id = p_invitation_id for update;

  if v_invitation.status = 'revoked' and exists (
    select 1 from public.member_invitation_events event
    where event.organization_id = p_organization_id
      and event.invitation_id = p_invitation_id
      and event.actor_user_id = p_actor_user_id
      and event.event_name = 'member_invitation.revoked'
      and event.idempotency_key_hash = p_idempotency_key_hash
  ) then
    return jsonb_build_object(
      'decision', 'revoked', 'invitationId', v_invitation.id,
      'version', v_invitation.version, 'replayed', true,
      'correlationId', p_correlation_id
    );
  end if;

  if v_invitation.id is null or v_invitation.version <> p_expected_version
     or v_invitation.status not in ('pending', 'delivery_failed', 'delivery_uncertain', 'issuing')
     or (v_invitation.status = 'issuing' and transaction_timestamp() < v_invitation.created_at + interval '60 seconds') then
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  update public.organization_invitations
  set status = 'revoked', version = version + 1,
      revoked_at = transaction_timestamp(), updated_at = transaction_timestamp()
  where id = v_invitation.id returning * into v_invitation;
  insert into public.member_invitation_events (
    organization_id, invitation_id, actor_user_id, event_name, outcome,
    reason_code, correlation_id, idempotency_key_hash,
    metadata
  ) values (
    p_organization_id, v_invitation.id, p_actor_user_id,
    'member_invitation.revoked', 'success', 'invitation_revoked',
    p_correlation_id, p_idempotency_key_hash,
    jsonb_build_object('invitationVersion', v_invitation.version)
  );
  return jsonb_build_object(
    'decision', 'revoked', 'invitationId', v_invitation.id,
    'version', v_invitation.version, 'replayed', false,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.revoke_member_invitation(uuid, uuid, uuid, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_member_invitation(uuid, uuid, uuid, bigint, text, uuid)
  to service_role;

create or replace function public.prepare_member_invitation_acceptance(
  p_actor_user_id uuid,
  p_confirmed_email text,
  p_invitation_id uuid,
  p_expected_version bigint,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email_canonical text;
  v_invitation public.organization_invitations%rowtype;
  v_credential_mode text;
begin
  if p_actor_user_id is null
     or p_invitation_id is null
     or p_expected_version is null or p_expected_version < 1
     or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Invitation preparation input is invalid.';
  end if;

  begin
    v_email_canonical := public.canonicalize_member_invitation_email(p_confirmed_email);
  exception when sqlstate '22023' then
    perform public.record_member_invitation_denial(
      p_actor_user_id, 'member_invitation.denied', 'invitation_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end;

  select * into v_invitation
  from public.organization_invitations
  where id = p_invitation_id
  for update;

  if not found then
    perform public.record_member_invitation_denial(
      p_actor_user_id, 'member_invitation.denied', 'invitation_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  perform public.materialize_member_invitation_expiry(
    v_invitation.organization_id, v_invitation.id, p_actor_user_id, p_correlation_id
  );
  select * into v_invitation
  from public.organization_invitations
  where id = p_invitation_id;

  if v_invitation.email_canonical <> v_email_canonical
     or v_invitation.status <> 'pending'
     or v_invitation.version <> p_expected_version
     or v_invitation.provider_operation_class not in (
       'new_identity_invite', 'existing_identity_sign_in'
     ) then
    perform public.record_member_invitation_denial(
      p_actor_user_id, 'member_invitation.denied', 'invitation_not_available', p_correlation_id,
      v_invitation.organization_id, v_invitation.id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  v_credential_mode := case v_invitation.provider_operation_class
    when 'new_identity_invite' then 'new'
    else 'existing'
  end;
  return jsonb_build_object(
    'decision', 'prepared', 'invitationId', v_invitation.id,
    'credentialMode', v_credential_mode, 'version', v_invitation.version,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.prepare_member_invitation_acceptance(uuid, text, uuid, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_member_invitation_acceptance(uuid, text, uuid, bigint, uuid)
  to service_role;

create or replace function public.accept_member_invitation(
  p_actor_user_id uuid,
  p_confirmed_email text,
  p_password_authenticated_at bigint,
  p_invitation_id uuid,
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
  v_email text;
  v_organization_id uuid;
  v_organization_status text;
  v_invitation public.organization_invitations%rowtype;
  v_role public.roles%rowtype;
  v_membership_id uuid;
  v_password_time timestamptz;
begin
  if p_actor_user_id is null or p_confirmed_email is null
     or p_password_authenticated_at is null or p_invitation_id is null
     or p_expected_version < 1 or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception using errcode = '22023', message = 'Acceptance input is invalid.';
  end if;
  v_email := public.canonicalize_member_invitation_email(p_confirmed_email);
  v_password_time := to_timestamp(p_password_authenticated_at);
  if v_password_time > transaction_timestamp()
     or transaction_timestamp() - v_password_time > interval '600 seconds' then
    return jsonb_build_object(
      'decision', 'recent_authentication_required', 'correlationId', p_correlation_id
    );
  end if;

  select organization_id into v_organization_id
  from public.organization_invitations where id = p_invitation_id;
  if v_organization_id is null then
    perform public.record_member_invitation_denial(
      p_actor_user_id, 'member_invitation.denied', 'invitation_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;
  select status into v_organization_status
  from public.organizations where id = v_organization_id for update;
  perform public.materialize_member_invitation_expiry(
    v_organization_id, p_invitation_id, p_actor_user_id, p_correlation_id
  );
  select * into v_invitation from public.organization_invitations
  where id = p_invitation_id for update;

  if v_invitation.status = 'accepted'
     and v_invitation.accepted_by = p_actor_user_id
     and v_invitation.acceptance_idempotency_key_hash = p_idempotency_key_hash then
    return jsonb_build_object(
      'decision', 'accepted', 'organizationId', v_invitation.organization_id,
      'membershipId', v_invitation.accepted_membership_id,
      'invitationId', v_invitation.id, 'version', v_invitation.version,
      'replayed', true, 'correlationId', p_correlation_id
    );
  end if;

  if v_organization_status <> 'active' or v_invitation.status <> 'pending'
     or v_invitation.version <> p_expected_version
     or transaction_timestamp() >= v_invitation.expires_at
     or v_invitation.email_canonical <> v_email then
    insert into public.member_invitation_events (
      organization_id, invitation_id, actor_user_id, event_name, outcome,
      reason_code, correlation_id
    ) values (
      v_organization_id, v_invitation.id, p_actor_user_id,
      'member_invitation.denied', 'denied', 'invitation_not_available', p_correlation_id
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  select * into v_role from public.roles
  where id = v_invitation.role_id for share;
  if not v_role.is_active or not v_role.is_invitation_assignable
     or exists (
       select 1 from public.organization_memberships
       where organization_id = v_organization_id and user_id = p_actor_user_id
     ) then
    insert into public.member_invitation_events (
      organization_id, invitation_id, actor_user_id, event_name, outcome,
      reason_code, correlation_id
    ) values (
      v_organization_id, v_invitation.id, p_actor_user_id,
      'member_invitation.conflicted', 'denied', 'membership_state_conflict', p_correlation_id
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  insert into public.organization_memberships (
    organization_id, user_id, status, created_by, updated_by
  ) values (
    v_organization_id, p_actor_user_id, 'active', p_actor_user_id, p_actor_user_id
  ) returning id into v_membership_id;
  insert into public.membership_roles (
    organization_id, membership_id, role_id, assigned_by
  ) values (
    v_organization_id, v_membership_id, v_role.id, p_actor_user_id
  );
  update public.organization_invitations
  set status = 'accepted', version = version + 1,
      accepted_at = transaction_timestamp(), accepted_by = p_actor_user_id,
      accepted_membership_id = v_membership_id, updated_at = transaction_timestamp(),
      acceptance_idempotency_key_hash = p_idempotency_key_hash
  where id = v_invitation.id returning * into v_invitation;
  insert into public.member_invitation_events (
    organization_id, invitation_id, actor_user_id, event_name, outcome,
    reason_code, correlation_id, idempotency_key_hash, metadata
  ) values (
    v_organization_id, v_invitation.id, p_actor_user_id,
    'member_invitation.accepted', 'success', 'membership_created',
    p_correlation_id, p_idempotency_key_hash,
    jsonb_build_object(
      'invitationVersion', v_invitation.version,
      'membershipId', v_membership_id,
      'roleId', v_role.id
    )
  );

  return jsonb_build_object(
    'decision', 'accepted', 'organizationId', v_organization_id,
    'membershipId', v_membership_id, 'invitationId', v_invitation.id,
    'version', v_invitation.version, 'replayed', false,
    'correlationId', p_correlation_id
  );
exception
  when unique_violation then
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.accept_member_invitation(uuid, text, bigint, uuid, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.accept_member_invitation(uuid, text, bigint, uuid, bigint, text, uuid)
  to service_role;

comment on table public.organization_invitations is
  'FEAT-004 tenant-owned invitation lifecycle. Provider delivery never creates membership authority.';
comment on function public.accept_member_invitation(uuid, text, bigint, uuid, bigint, text, uuid) is
  'Server-only atomic invitation acceptance. Creates membership, one role, invitation state, and audit together.';

commit;
