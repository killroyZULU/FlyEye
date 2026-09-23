begin;

insert into public.permissions (code, description)
values
  ('aircraft.document.status.read', 'Read current configured aircraft document status through the protected audited boundary.'),
  ('aircraft.document.read', 'Read full aircraft document metadata and immutable version history.'),
  ('aircraft.document.notification.read', 'Read aircraft document expiry notifications assigned to the member.'),
  ('aircraft.document.manage', 'Create and manage aircraft document versions and administrative suspension state.'),
  ('aircraft.document.category.manage', 'Configure and assign custom aircraft document categories.'),
  ('aircraft.document.attachment.read', 'Request protected access to clean aircraft document attachments.')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where (role.code = 'admin' and permission.code like 'aircraft.document.%')
   or (role.code in ('student_pilot', 'instructor_pilot')
       and permission.code = 'aircraft.document.status.read')
on conflict do nothing;

create table public.aircraft_document_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  category_code text not null check (category_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  category_label text not null,
  category_kind text not null check (category_kind in ('system', 'custom')),
  category_state text not null default 'active' check (category_state in ('active', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, category_code),
  check (category_label = btrim(category_label) and char_length(category_label) between 1 and 120),
  check ((category_kind = 'system' and created_by is null) or category_kind = 'custom'),
  check (
    (category_state = 'active' and archived_at is null and archived_by is null)
    or (category_state = 'archived' and category_kind = 'custom'
        and archived_at is not null and archived_by is not null)
  )
);

create unique index aircraft_document_categories_active_custom_label_idx
  on public.aircraft_document_categories (organization_id, lower(category_label))
  where category_kind = 'custom' and category_state = 'active';
create index aircraft_document_categories_order_idx
  on public.aircraft_document_categories (organization_id, category_kind, category_label, id);

create or replace function public.seed_aircraft_document_categories(p_organization_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.aircraft_document_categories (
    organization_id, category_code, category_label, category_kind
  )
  values
    (p_organization_id, 'airworthiness_certificate', 'Airworthiness Certificate', 'system'),
    (p_organization_id, 'registration_certificate', 'Registration Certificate', 'system'),
    (p_organization_id, 'radio_station_license', 'Radio Station License', 'system'),
    (p_organization_id, 'weight_and_balance_data', 'Weight and Balance Data', 'system'),
    (p_organization_id, 'operating_handbook', 'Operating Handbook', 'system'),
    (p_organization_id, 'insurance', 'Insurance', 'system')
  on conflict (organization_id, category_code) do nothing;
$$;

revoke all on function public.seed_aircraft_document_categories(uuid)
  from public, anon, authenticated;
grant execute on function public.seed_aircraft_document_categories(uuid) to service_role;

create or replace function public.seed_aircraft_document_categories_after_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.seed_aircraft_document_categories(new.id);
  return new;
end;
$$;

revoke all on function public.seed_aircraft_document_categories_after_organization()
  from public, anon, authenticated;

create trigger seed_aircraft_document_categories_after_organization
after insert on public.organizations
for each row execute function public.seed_aircraft_document_categories_after_organization();

select public.seed_aircraft_document_categories(organization.id)
from public.organizations organization;

create table public.aircraft_document_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  aircraft_record_id uuid not null,
  category_id uuid not null,
  requirement_state text not null default 'active' check (requirement_state in ('active', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete restrict,
  unique (organization_id, id),
  foreign key (organization_id, aircraft_record_id)
    references public.aircraft_records(organization_id, id) on delete restrict,
  foreign key (organization_id, category_id)
    references public.aircraft_document_categories(organization_id, id) on delete restrict,
  check (
    (requirement_state = 'active' and archived_at is null and archived_by is null)
    or (requirement_state = 'archived' and archived_at is not null and archived_by is not null)
  )
);

create unique index aircraft_document_requirements_active_idx
  on public.aircraft_document_requirements (organization_id, aircraft_record_id, category_id)
  where requirement_state = 'active';
create index aircraft_document_requirements_category_idx
  on public.aircraft_document_requirements (organization_id, category_id, requirement_state);

create table public.stored_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  aircraft_record_id uuid not null,
  bucket_id text not null default 'aircraft-documents' check (bucket_id = 'aircraft-documents'),
  object_key text not null,
  display_name text not null,
  generated_name text not null,
  media_type text not null check (media_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  sha256_hash text not null check (sha256_hash ~ '^[0-9a-f]{64}$'),
  scan_state text not null check (scan_state in ('staged', 'quarantined', 'clean', 'rejected', 'scan_failed')),
  classification text not null default 'restricted_aircraft_document'
    check (classification = 'restricted_aircraft_document'),
  uploader_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (bucket_id, object_key),
  check (display_name = btrim(display_name) and char_length(display_name) between 1 and 160),
  check (generated_name ~ '^[0-9a-f-]{36}\.(pdf|jpg|png)$'),
  check (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$'),
  foreign key (organization_id, aircraft_record_id)
    references public.aircraft_records(organization_id, id) on delete restrict
);

create index stored_files_aircraft_state_idx
  on public.stored_files (organization_id, aircraft_record_id, scan_state, created_at desc);

create table public.aircraft_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  aircraft_record_id uuid not null,
  category_id uuid not null,
  document_state text not null default 'active' check (document_state in ('active', 'suspended', 'archived')),
  current_version_id uuid,
  version bigint not null default 1 check (version > 0),
  suspension_reason text,
  suspended_at timestamptz,
  suspended_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete restrict,
  unique (organization_id, id),
  foreign key (organization_id, aircraft_record_id)
    references public.aircraft_records(organization_id, id) on delete restrict,
  foreign key (organization_id, category_id)
    references public.aircraft_document_categories(organization_id, id) on delete restrict,
  check (
    (document_state = 'active' and suspension_reason is null and suspended_at is null
      and suspended_by is null and archived_at is null and archived_by is null)
    or (document_state = 'suspended' and suspension_reason is not null
      and char_length(suspension_reason) between 10 and 300 and suspended_at is not null
      and suspended_by is not null and archived_at is null and archived_by is null)
    or (document_state = 'archived' and archived_at is not null and archived_by is not null)
  )
);

create unique index aircraft_documents_logical_idx
  on public.aircraft_documents (organization_id, aircraft_record_id, category_id);
create index aircraft_documents_aircraft_state_idx
  on public.aircraft_documents (organization_id, aircraft_record_id, document_state, category_id);

create table public.aircraft_document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  aircraft_document_id uuid not null,
  version_number bigint not null check (version_number > 0),
  version_kind text not null check (version_kind in ('create', 'renewal', 'correction')),
  category_code text not null check (category_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  category_label text not null,
  document_title text not null,
  document_source text not null,
  reference_number text,
  issue_date date,
  expiration_date date not null,
  notes text,
  stored_file_id uuid,
  version_reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, aircraft_document_id, version_number),
  foreign key (organization_id, aircraft_document_id)
    references public.aircraft_documents(organization_id, id) on delete restrict,
  foreign key (organization_id, stored_file_id)
    references public.stored_files(organization_id, id) on delete restrict,
  check (category_label = btrim(category_label) and char_length(category_label) between 1 and 120),
  check (document_title = btrim(document_title) and char_length(document_title) between 1 and 160),
  check (document_source = btrim(document_source) and char_length(document_source) between 1 and 160),
  check (reference_number is null or (reference_number = btrim(reference_number)
    and char_length(reference_number) between 1 and 160)),
  check (notes is null or (notes = btrim(notes) and char_length(notes) between 1 and 500)),
  check (version_reason is null or (version_reason = btrim(version_reason)
    and char_length(version_reason) between 10 and 300))
);

alter table public.aircraft_documents
  add constraint aircraft_documents_current_version_fk
  foreign key (organization_id, current_version_id)
  references public.aircraft_document_versions(organization_id, id)
  deferrable initially deferred;

create unique index aircraft_document_versions_one_file_idx
  on public.aircraft_document_versions (organization_id, stored_file_id)
  where stored_file_id is not null;
create index aircraft_document_versions_history_idx
  on public.aircraft_document_versions (organization_id, aircraft_document_id, version_number desc);
create index aircraft_document_versions_expiration_idx
  on public.aircraft_document_versions (organization_id, expiration_date, aircraft_document_id);

create or replace function public.prevent_aircraft_document_version_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = 'P7201',
      message = 'Aircraft document versions are immutable.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.prevent_aircraft_document_version_mutation()
  from public, anon, authenticated, service_role;

create trigger prevent_aircraft_document_version_mutation
before update or delete on public.aircraft_document_versions
for each row execute function public.prevent_aircraft_document_version_mutation();

create table public.aircraft_document_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  recipient_membership_id uuid not null,
  aircraft_document_id uuid not null,
  document_version_id uuid not null,
  event_kind text not null check (event_kind in ('warning', 'expiration')),
  notification_state text not null default 'open' check (notification_state in ('open', 'read', 'resolved')),
  due_date date not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  resolved_at timestamptz,
  resolution_reason text,
  unique (organization_id, recipient_membership_id, document_version_id, event_kind),
  foreign key (organization_id, recipient_membership_id)
    references public.organization_memberships(organization_id, id) on delete restrict,
  foreign key (organization_id, aircraft_document_id)
    references public.aircraft_documents(organization_id, id) on delete restrict,
  foreign key (organization_id, document_version_id)
    references public.aircraft_document_versions(organization_id, id) on delete restrict,
  check (
    (notification_state = 'open' and read_at is null and resolved_at is null and resolution_reason is null)
    or (notification_state = 'read' and read_at is not null and resolved_at is null and resolution_reason is null)
    or (notification_state = 'resolved' and resolved_at is not null and resolution_reason is not null)
  )
);

create index aircraft_document_notifications_recipient_idx
  on public.aircraft_document_notifications (
    organization_id, recipient_membership_id, notification_state, due_date, id
  );

create table public.aircraft_document_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_type text not null check (target_type in ('category', 'requirement', 'document', 'version', 'file', 'notification', 'job')),
  target_id uuid,
  event_name text not null check (event_name ~ '^aircraft_document\.[a-z][a-z0-9_.]{2,95}$'),
  outcome text not null check (outcome in ('success', 'denied', 'conflict', 'failed')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  correlation_id uuid not null,
  idempotency_key_hash text check (idempotency_key_hash is null or idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create index aircraft_document_events_org_time_idx
  on public.aircraft_document_events (organization_id, occurred_at desc, id);

create table public.aircraft_document_idempotency (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action ~ '^[a-z][a-z0-9_]{2,63}$'),
  target_id uuid,
  expected_version bigint,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (organization_id, actor_user_id, idempotency_key_hash)
);

create table public.aircraft_document_rate_limit_state (
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  bucket text not null check (bucket in ('general', 'read', 'mutation', 'lifecycle', 'upload', 'download')),
  tokens numeric not null check (tokens >= 0),
  updated_at timestamptz not null,
  primary key (limiter_key_hash, bucket)
);

create table public.aircraft_document_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  limiter_key_hash text not null check (limiter_key_hash ~ '^[0-9a-f]{64}$'),
  bucket text not null check (bucket in ('general', 'read', 'mutation', 'lifecycle', 'upload', 'download')),
  outcome text not null check (outcome in ('allowed', 'rate_limited')),
  retry_after_seconds integer check (retry_after_seconds between 1 and 3600),
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  check ((outcome = 'allowed' and retry_after_seconds is null)
    or (outcome = 'rate_limited' and retry_after_seconds is not null))
);

create index aircraft_document_rate_events_time_idx
  on public.aircraft_document_rate_limit_events (occurred_at desc);

alter table public.aircraft_document_categories enable row level security;
alter table public.aircraft_document_requirements enable row level security;
alter table public.aircraft_documents enable row level security;
alter table public.aircraft_document_versions enable row level security;
alter table public.stored_files enable row level security;
alter table public.aircraft_document_notifications enable row level security;
alter table public.aircraft_document_events enable row level security;
alter table public.aircraft_document_idempotency enable row level security;
alter table public.aircraft_document_rate_limit_state enable row level security;
alter table public.aircraft_document_rate_limit_events enable row level security;

revoke all on table public.aircraft_document_categories from public, anon, authenticated;
revoke all on table public.aircraft_document_requirements from public, anon, authenticated;
revoke all on table public.aircraft_documents from public, anon, authenticated;
revoke all on table public.aircraft_document_versions from public, anon, authenticated;
revoke all on table public.stored_files from public, anon, authenticated;
revoke all on table public.aircraft_document_notifications from public, anon, authenticated;
revoke all on table public.aircraft_document_events from public, anon, authenticated;
revoke all on table public.aircraft_document_idempotency from public, anon, authenticated;
revoke all on table public.aircraft_document_rate_limit_state from public, anon, authenticated;
revoke all on table public.aircraft_document_rate_limit_events from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'aircraft-documents',
  'aircraft-documents',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.aircraft_document_actor_is_authorized(
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

revoke all on function public.aircraft_document_actor_is_authorized(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.aircraft_document_actor_is_authorized(uuid, uuid, text)
  to service_role;

create or replace function public.resolve_aircraft_document_context(p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_organization_id uuid;
  v_membership_id uuid;
  v_role_code text;
begin
  select membership.organization_id, membership.id, role.code
  into v_organization_id, v_membership_id, v_role_code
  from public.organization_memberships membership
  join public.membership_roles membership_role
    on membership_role.organization_id = membership.organization_id
   and membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id
  join public.organizations organization on organization.id = membership.organization_id
  where membership.user_id = p_actor_user_id
    and membership.status = 'active'
    and organization.status = 'active'
  order by membership.organization_id
  limit 1;

  if v_organization_id is null then
    raise exception using errcode = 'P7102', message = 'Aircraft document context is unavailable.';
  end if;

  return jsonb_build_object(
    'organizationId', v_organization_id,
    'membershipId', v_membership_id,
    'roleCode', v_role_code,
    'canReadStatus', public.aircraft_document_actor_is_authorized(
      p_actor_user_id, v_organization_id, 'aircraft.document.status.read'
    ),
    'canRead', public.aircraft_document_actor_is_authorized(
      p_actor_user_id, v_organization_id, 'aircraft.document.read'
    ),
    'canReadNotifications', public.aircraft_document_actor_is_authorized(
      p_actor_user_id, v_organization_id, 'aircraft.document.notification.read'
    ),
    'canManage', public.aircraft_document_actor_is_authorized(
      p_actor_user_id, v_organization_id, 'aircraft.document.manage'
    ),
    'canManageCategories', public.aircraft_document_actor_is_authorized(
      p_actor_user_id, v_organization_id, 'aircraft.document.category.manage'
    ),
    'canReadAttachment', public.aircraft_document_actor_is_authorized(
      p_actor_user_id, v_organization_id, 'aircraft.document.attachment.read'
    )
  );
end;
$$;

revoke all on function public.resolve_aircraft_document_context(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_aircraft_document_context(uuid) to service_role;

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

create or replace function public.calculate_aircraft_document_status(
  p_expiration_date date,
  p_document_state text,
  p_is_archived boolean,
  p_philippine_date date
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  if p_is_archived or p_document_state = 'archived' then return 'archived'; end if;
  if p_document_state = 'suspended' then return 'suspended'; end if;
  if p_expiration_date is null or p_philippine_date is null then
    raise exception using errcode = '22023', message = 'Aircraft document status input is unavailable.';
  end if;
  if p_expiration_date < p_philippine_date then return 'expired'; end if;
  if p_expiration_date <= p_philippine_date + 7 then return 'expiring_soon'; end if;
  return 'valid';
end;
$$;

revoke all on function public.calculate_aircraft_document_status(date, text, boolean, date)
  from public, anon, authenticated;
grant execute on function public.calculate_aircraft_document_status(date, text, boolean, date)
  to service_role;

create or replace function public.write_aircraft_document_event(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_target_type text,
  p_target_id uuid,
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
  insert into public.aircraft_document_events (
    organization_id, actor_user_id, target_type, target_id, event_name, outcome,
    reason_code, correlation_id, idempotency_key_hash, metadata
  ) values (
    p_organization_id, p_actor_user_id, p_target_type, p_target_id, p_event_name,
    p_outcome, p_reason_code, p_correlation_id, p_idempotency_key_hash,
    coalesce(p_metadata, '{}'::jsonb)
  );
exception when others then
  raise exception using errcode = 'P7101', message = 'Aircraft document audit write failed.';
end;
$$;

revoke all on function public.write_aircraft_document_event(uuid, uuid, text, uuid, text, text, text, uuid, text, jsonb)
  from public, anon, authenticated;

create or replace function public.list_aircraft_document_status(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_aircraft_record_id uuid,
  p_philippine_date date,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_aircraft public.aircraft_records%rowtype;
  v_items jsonb;
  v_available_custom_categories jsonb := '[]'::jsonb;
  v_can_read_details boolean;
  v_can_manage_categories boolean;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.status.read'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  select * into v_aircraft
  from public.aircraft_records aircraft
  where aircraft.organization_id = p_organization_id
    and aircraft.id = p_aircraft_record_id
    and aircraft.registry_state = 'tracked';
  if not found then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  v_can_read_details := public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.read'
  );
  v_can_manage_categories := public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.category.manage'
  );

  with applicable as (
    select category.id, category.category_code, category.category_label, category.category_kind,
      category.version as category_version,
      (
        select requirement.id
        from public.aircraft_document_requirements requirement
        where requirement.organization_id = p_organization_id
          and requirement.aircraft_record_id = p_aircraft_record_id
          and requirement.category_id = category.id
          and requirement.requirement_state = 'active'
        limit 1
      ) as requirement_id,
      (
        select requirement.version
        from public.aircraft_document_requirements requirement
        where requirement.organization_id = p_organization_id
          and requirement.aircraft_record_id = p_aircraft_record_id
          and requirement.category_id = category.id
          and requirement.requirement_state = 'active'
        limit 1
      ) as requirement_version
    from public.aircraft_document_categories category
    where category.organization_id = p_organization_id
      and category.category_state = 'active'
      and (
        category.category_kind = 'system'
        or exists (
          select 1
          from public.aircraft_document_requirements requirement
          where requirement.organization_id = p_organization_id
            and requirement.aircraft_record_id = p_aircraft_record_id
            and requirement.category_id = category.id
            and requirement.requirement_state = 'active'
        )
      )
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'categoryId', applicable.id,
      'categoryCode', applicable.category_code,
      'categoryLabel', applicable.category_label,
      'categoryKind', applicable.category_kind,
      'status', case when version.id is null then 'missing' else
        public.calculate_aircraft_document_status(
          version.expiration_date, document.document_state, false, p_philippine_date
        ) end,
      'expirationDate', version.expiration_date,
      'calculatedOn', p_philippine_date
    )
    || case when v_can_manage_categories then jsonb_build_object(
      'categoryVersion', applicable.category_version,
      'requirementId', applicable.requirement_id,
      'requirementVersion', applicable.requirement_version
    ) else '{}'::jsonb end
    || case when v_can_read_details then jsonb_build_object(
      'documentId', document.id,
      'aggregateVersion', document.version
    ) else '{}'::jsonb end
    order by (applicable.category_kind = 'custom'), applicable.category_label, applicable.id
  ), '[]'::jsonb)
  into v_items
  from applicable
  left join public.aircraft_documents document
    on document.organization_id = p_organization_id
   and document.aircraft_record_id = p_aircraft_record_id
   and document.category_id = applicable.id
   and document.document_state <> 'archived'
  left join public.aircraft_document_versions version
    on version.organization_id = document.organization_id
   and version.id = document.current_version_id;

  if v_can_manage_categories then
    select coalesce(jsonb_agg(jsonb_build_object(
      'categoryId', category.id,
      'categoryCode', category.category_code,
      'categoryLabel', category.category_label,
      'categoryVersion', category.version
    ) order by category.category_label, category.id), '[]'::jsonb)
    into v_available_custom_categories
    from public.aircraft_document_categories category
    where category.organization_id = p_organization_id
      and category.category_kind = 'custom'
      and category.category_state = 'active'
      and not exists (
        select 1 from public.aircraft_document_requirements requirement
        where requirement.organization_id = p_organization_id
          and requirement.aircraft_record_id = p_aircraft_record_id
          and requirement.category_id = category.id
          and requirement.requirement_state = 'active'
      );
  end if;

  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'document', p_aircraft_record_id,
    'aircraft_document.status_listed', 'success', 'status_listed', p_correlation_id,
    null, jsonb_build_object('returnedCount', jsonb_array_length(v_items),
      'calculatedOn', p_philippine_date)
  );
  return jsonb_build_object(
    'decision', 'listed',
    'aircraft', jsonb_build_object(
      'id', v_aircraft.id,
      'label', v_aircraft.registration_mark || ' (' || v_aircraft.manufacturer || ' — ' || v_aircraft.model || ')'
    ),
    'items', v_items,
    'availableCustomCategories', v_available_custom_categories,
    'calculatedOn', p_philippine_date,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.list_aircraft_document_status(uuid, uuid, uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function public.list_aircraft_document_status(uuid, uuid, uuid, date, uuid)
  to service_role;

create or replace function public.list_aircraft_for_document_status(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_page integer,
  p_page_size integer,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_items jsonb;
  v_has_next boolean;
begin
  if p_page not between 1 and 100 or p_page_size not between 1 and 50 then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.status.read'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  with selected as (
    select aircraft.id,
      aircraft.registration_mark || ' (' || aircraft.manufacturer || ' — ' || aircraft.model || ')' as label,
      row_number() over (order by aircraft.registration_key, aircraft.id) as position
    from public.aircraft_records aircraft
    where aircraft.organization_id = p_organization_id and aircraft.registry_state = 'tracked'
    order by aircraft.registration_key, aircraft.id
    offset ((p_page - 1) * p_page_size)
    limit (p_page_size + 1)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object('id', selected.id, 'label', selected.label)
    order by selected.position
  ) filter (where selected.position <= (p_page * p_page_size)), '[]'::jsonb),
  count(*) > p_page_size into v_items, v_has_next from selected;
  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'document', null,
    'aircraft_document.aircraft_listed', 'success', 'aircraft_listed', p_correlation_id,
    null, jsonb_build_object('page', p_page, 'pageSize', p_page_size,
      'returnedCount', jsonb_array_length(v_items))
  );
  return jsonb_build_object(
    'decision', 'listed', 'aircraft', v_items, 'page', p_page,
    'pageSize', p_page_size, 'hasNext', v_has_next, 'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.list_aircraft_for_document_status(uuid, uuid, integer, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.list_aircraft_for_document_status(uuid, uuid, integer, integer, uuid)
  to service_role;

create or replace function public.get_aircraft_document_detail(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_philippine_date date,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.read'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  select jsonb_build_object(
    'id', document.id,
    'aircraftId', aircraft.id,
    'aircraftLabel', aircraft.registration_mark || ' (' || aircraft.manufacturer || ' — ' || aircraft.model || ')',
    'categoryId', category.id,
    'categoryCode', version.category_code,
    'categoryLabel', version.category_label,
    'documentState', document.document_state,
    'aggregateVersion', document.version,
    'status', public.calculate_aircraft_document_status(
      version.expiration_date, document.document_state,
      aircraft.registry_state = 'archived' or category.category_state = 'archived', p_philippine_date
    ),
    'calculatedOn', p_philippine_date,
    'currentVersion', jsonb_build_object(
      'id', version.id,
      'versionNumber', version.version_number,
      'versionKind', version.version_kind,
      'title', version.document_title,
      'source', version.document_source,
      'referenceNumber', version.reference_number,
      'issueDate', version.issue_date,
      'expirationDate', version.expiration_date,
      'notes', version.notes,
      'versionReason', version.version_reason,
      'createdAt', version.created_at,
      'hasAttachment', file.id is not null,
      'attachment', case when file.id is null then null else jsonb_build_object(
        'id', file.id,
        'displayName', file.display_name,
        'mediaType', file.media_type,
        'sizeBytes', file.size_bytes,
        'scanState', file.scan_state
      ) end
    )
  ) into v_result
  from public.aircraft_documents document
  join public.aircraft_records aircraft
    on aircraft.organization_id = document.organization_id
   and aircraft.id = document.aircraft_record_id
  join public.aircraft_document_categories category
    on category.organization_id = document.organization_id
   and category.id = document.category_id
  join public.aircraft_document_versions version
    on version.organization_id = document.organization_id
   and version.id = document.current_version_id
  left join public.stored_files file
    on file.organization_id = version.organization_id
   and file.id = version.stored_file_id
  where document.organization_id = p_organization_id and document.id = p_document_id;

  if v_result is null then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'document', p_document_id,
    'aircraft_document.detail_viewed', 'success', 'detail_viewed', p_correlation_id
  );
  return jsonb_build_object(
    'decision', 'found', 'document', v_result, 'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.get_aircraft_document_detail(uuid, uuid, uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function public.get_aircraft_document_detail(uuid, uuid, uuid, date, uuid)
  to service_role;

create or replace function public.list_aircraft_document_history(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_page integer,
  p_page_size integer,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_items jsonb;
  v_has_next boolean;
begin
  if p_page not between 1 and 100 or p_page_size not between 1 and 50 then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.read'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  if not exists (
    select 1 from public.aircraft_documents document
    where document.organization_id = p_organization_id and document.id = p_document_id
  ) then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;

  with selected as (
    select version.*, file.id as file_id, file.display_name, file.media_type,
      file.size_bytes, file.scan_state,
      row_number() over (order by version.version_number desc, version.id) as position
    from public.aircraft_document_versions version
    left join public.stored_files file
      on file.organization_id = version.organization_id and file.id = version.stored_file_id
    where version.organization_id = p_organization_id
      and version.aircraft_document_id = p_document_id
    order by version.version_number desc, version.id
    offset ((p_page - 1) * p_page_size)
    limit (p_page_size + 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', selected.id,
    'versionNumber', selected.version_number,
    'versionKind', selected.version_kind,
    'categoryCode', selected.category_code,
    'categoryLabel', selected.category_label,
    'title', selected.document_title,
    'source', selected.document_source,
    'referenceNumber', selected.reference_number,
    'issueDate', selected.issue_date,
    'expirationDate', selected.expiration_date,
    'notes', selected.notes,
    'versionReason', selected.version_reason,
    'createdAt', selected.created_at,
    'hasAttachment', selected.file_id is not null,
    'attachment', case when selected.file_id is null then null else jsonb_build_object(
      'id', selected.file_id, 'displayName', selected.display_name,
      'mediaType', selected.media_type, 'sizeBytes', selected.size_bytes,
      'scanState', selected.scan_state
    ) end
  ) order by selected.position) filter (where selected.position <= (p_page * p_page_size)), '[]'::jsonb),
  count(*) > p_page_size
  into v_items, v_has_next
  from selected;

  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'document', p_document_id,
    'aircraft_document.history_listed', 'success', 'history_listed', p_correlation_id,
    null, jsonb_build_object('page', p_page, 'pageSize', p_page_size,
      'returnedCount', jsonb_array_length(v_items))
  );
  return jsonb_build_object(
    'decision', 'listed', 'items', v_items, 'page', p_page, 'pageSize', p_page_size,
    'hasNext', v_has_next, 'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.list_aircraft_document_history(uuid, uuid, uuid, integer, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.list_aircraft_document_history(uuid, uuid, uuid, integer, integer, uuid)
  to service_role;

create or replace function public.lookup_aircraft_document_idempotency(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_permission_code text,
  p_action text,
  p_target_id uuid,
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
  v_existing public.aircraft_document_idempotency%rowtype;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, p_permission_code
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'result', null);
  end if;
  select * into v_existing
  from public.aircraft_document_idempotency item
  where item.organization_id = p_organization_id
    and item.actor_user_id = p_actor_user_id
    and item.idempotency_key_hash = p_idempotency_key_hash;
  if not found then return jsonb_build_object('decision', 'missing', 'result', null); end if;
  if v_existing.action = p_action
     and (p_action in ('create', 'create_category')
       or v_existing.target_id is not distinct from p_target_id)
     and v_existing.expected_version is not distinct from p_expected_version
     and v_existing.request_hash = p_request_hash then
    return jsonb_build_object('decision', 'replay', 'result', v_existing.result);
  end if;
  return jsonb_build_object('decision', 'conflict', 'result', null);
end;
$$;

revoke all on function public.lookup_aircraft_document_idempotency(uuid, uuid, text, text, uuid, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.lookup_aircraft_document_idempotency(uuid, uuid, text, text, uuid, bigint, text, text)
  to service_role;

create or replace function public.resolve_aircraft_document_notifications(
  p_organization_id uuid,
  p_aircraft_document_id uuid,
  p_document_version_id uuid,
  p_event_kind text,
  p_resolution_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_notification record;
  v_resolved integer := 0;
begin
  if p_organization_id is null or p_aircraft_document_id is null
     or p_resolution_reason !~ '^[a-z][a-z0-9_]{2,63}$'
     or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Invalid notification resolution input.';
  end if;
  for v_notification in
    select notification.id, notification.notification_state,
      notification.document_version_id, notification.event_kind
    from public.aircraft_document_notifications notification
    where notification.organization_id = p_organization_id
      and notification.aircraft_document_id = p_aircraft_document_id
      and (p_document_version_id is null
        or notification.document_version_id = p_document_version_id)
      and (p_event_kind is null or notification.event_kind = p_event_kind)
      and notification.notification_state <> 'resolved'
    order by notification.id
    for update
  loop
    update public.aircraft_document_notifications
    set notification_state = 'resolved', resolved_at = now(),
        resolution_reason = p_resolution_reason
    where organization_id = p_organization_id and id = v_notification.id;
    perform public.write_aircraft_document_event(
      p_organization_id, p_actor_user_id, 'notification', v_notification.id,
      'aircraft_document.notification_resolved', 'success', p_resolution_reason,
      p_correlation_id, null,
      jsonb_build_object(
        'documentId', p_aircraft_document_id,
        'documentVersionId', v_notification.document_version_id,
        'eventKind', v_notification.event_kind,
        'previousState', v_notification.notification_state,
        'newState', 'resolved',
        'resolutionReason', p_resolution_reason
      )
    );
    v_resolved := v_resolved + 1;
  end loop;
  return v_resolved;
end;
$$;

revoke all on function public.resolve_aircraft_document_notifications(uuid, uuid, uuid, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.sync_aircraft_document_notifications(
  p_organization_id uuid,
  p_aircraft_document_id uuid,
  p_document_version_id uuid,
  p_philippine_date date,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_document public.aircraft_documents%rowtype;
  v_version public.aircraft_document_versions%rowtype;
  v_aircraft_state text;
  v_category_state text;
  v_status text;
  v_created integer := 0;
  v_reopened integer := 0;
  v_warning_exists boolean := false;
  v_skipped_warning boolean := false;
  v_recipient record;
  v_notification public.aircraft_document_notifications%rowtype;
  v_event_kind text;
  v_due_date date;
begin
  select * into v_document
  from public.aircraft_documents document
  where document.organization_id = p_organization_id and document.id = p_aircraft_document_id
  for update;
  if not found then return jsonb_build_object('decision', 'not_found'); end if;
  select * into v_version
  from public.aircraft_document_versions version
  where version.organization_id = p_organization_id and version.id = p_document_version_id;
  if not found or v_version.aircraft_document_id <> v_document.id then
    return jsonb_build_object('decision', 'not_found');
  end if;
  select aircraft.registry_state, category.category_state
  into v_aircraft_state, v_category_state
  from public.aircraft_records aircraft
  join public.aircraft_document_categories category
    on category.organization_id = aircraft.organization_id and category.id = v_document.category_id
  where aircraft.organization_id = p_organization_id and aircraft.id = v_document.aircraft_record_id;

  -- A job may have selected this version before a concurrent renewal committed.
  -- Its stale snapshot must never resolve the replacement version's alerts.
  if v_document.current_version_id <> v_version.id then
    return jsonb_build_object('decision', 'skipped', 'createdCount', 0);
  end if;

  if v_document.document_state <> 'active'
     or v_aircraft_state <> 'tracked' or v_category_state <> 'active' then
    perform public.resolve_aircraft_document_notifications(
      p_organization_id, v_document.id, null, null, 'record_not_current',
      p_actor_user_id, p_correlation_id
    );
    return jsonb_build_object('decision', 'resolved', 'createdCount', 0);
  end if;

  v_status := public.calculate_aircraft_document_status(
    v_version.expiration_date, v_document.document_state, false, p_philippine_date
  );
  if v_status = 'expired' then
    select exists (
      select 1 from public.aircraft_document_notifications notification
      where notification.organization_id = p_organization_id
        and notification.document_version_id = v_version.id
        and notification.event_kind = 'warning'
    ) into v_warning_exists;
    perform public.resolve_aircraft_document_notifications(
      p_organization_id, v_document.id, v_version.id, 'warning', 'expiration_created',
      p_actor_user_id, p_correlation_id
    );
    v_event_kind := 'expiration';
    v_due_date := v_version.expiration_date + 1;
  elsif v_status = 'expiring_soon' then
    v_event_kind := 'warning';
    v_due_date := v_version.expiration_date - 7;
  end if;

  if v_event_kind is not null then
    for v_recipient in
      select membership.id
      from public.organization_memberships membership
      join public.membership_roles membership_role
        on membership_role.organization_id = membership.organization_id
       and membership_role.membership_id = membership.id
      join public.roles role on role.id = membership_role.role_id and role.code = 'admin'
      where membership.organization_id = p_organization_id and membership.status = 'active'
      order by membership.id
    loop
      select * into v_notification
      from public.aircraft_document_notifications notification
      where notification.organization_id = p_organization_id
        and notification.recipient_membership_id = v_recipient.id
        and notification.document_version_id = v_version.id
        and notification.event_kind = v_event_kind
      for update;
      if not found then
        insert into public.aircraft_document_notifications (
          organization_id, recipient_membership_id, aircraft_document_id,
          document_version_id, event_kind, due_date
        ) values (
          p_organization_id, v_recipient.id, v_document.id,
          v_version.id, v_event_kind, v_due_date
        ) returning * into v_notification;
        v_created := v_created + 1;
        perform public.write_aircraft_document_event(
          p_organization_id, p_actor_user_id, 'notification', v_notification.id,
          'aircraft_document.notification_created', 'success',
          v_event_kind || '_created', p_correlation_id, null,
          jsonb_build_object(
            'documentId', v_document.id, 'documentVersionId', v_version.id,
            'eventKind', v_event_kind, 'previousState', null, 'newState', 'open',
            'calculatedOn', p_philippine_date
          )
        );
      elsif v_notification.notification_state = 'resolved' then
        update public.aircraft_document_notifications
        set notification_state = 'open', read_at = null, resolved_at = null,
            resolution_reason = null, due_date = v_due_date
        where organization_id = p_organization_id and id = v_notification.id;
        v_reopened := v_reopened + 1;
        perform public.write_aircraft_document_event(
          p_organization_id, p_actor_user_id, 'notification', v_notification.id,
          'aircraft_document.notification_reopened', 'success',
          v_event_kind || '_reopened', p_correlation_id, null,
          jsonb_build_object(
            'documentId', v_document.id, 'documentVersionId', v_version.id,
            'eventKind', v_event_kind, 'previousState', 'resolved', 'newState', 'open',
            'calculatedOn', p_philippine_date
          )
        );
      end if;
    end loop;
  end if;
  v_skipped_warning := v_status = 'expired' and v_created > 0 and not v_warning_exists;
  return jsonb_build_object(
    'decision', 'evaluated', 'status', v_status, 'createdCount', v_created,
    'reopenedCount', v_reopened, 'skippedWarning', v_skipped_warning
  );
end;
$$;

revoke all on function public.sync_aircraft_document_notifications(uuid, uuid, uuid, date, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sync_aircraft_document_notifications(uuid, uuid, uuid, date, uuid, uuid)
  to service_role;

create or replace function public.mutate_aircraft_document(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_action text,
  p_aircraft_record_id uuid,
  p_category_id uuid,
  p_document_id uuid,
  p_expected_version bigint,
  p_document_title text,
  p_document_source text,
  p_reference_number text,
  p_issue_date date,
  p_expiration_date date,
  p_notes text,
  p_stored_file_id uuid,
  p_reason text,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_philippine_date date,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_aircraft public.aircraft_records%rowtype;
  v_category public.aircraft_document_categories%rowtype;
  v_document public.aircraft_documents%rowtype;
  v_prior_version public.aircraft_document_versions%rowtype;
  v_new_version public.aircraft_document_versions%rowtype;
  v_file public.stored_files%rowtype;
  v_existing public.aircraft_document_idempotency%rowtype;
  v_result jsonb;
  v_decision text;
  v_event_name text;
  v_prior_aggregate_version bigint;
  v_prior_document_state text;
  v_prior_file_hash text;
  v_new_file_hash text;
begin
  if p_action not in ('create', 'renew', 'correct', 'suspend', 'restore')
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_philippine_date is null or p_correlation_id is null
     or (p_action = 'create' and (p_document_id is not null or p_expected_version is not null))
     or (p_action <> 'create' and (p_document_id is null or p_expected_version is null
       or p_expected_version < 1)) then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key_hash, 0
  ));
  select * into v_existing
  from public.aircraft_document_idempotency item
  where item.organization_id = p_organization_id
    and item.actor_user_id = p_actor_user_id
    and item.idempotency_key_hash = p_idempotency_key_hash;
  if found then
    if v_existing.action = p_action
       and (p_action = 'create' or v_existing.target_id is not distinct from p_document_id)
       and v_existing.expected_version is not distinct from p_expected_version
       and v_existing.request_hash = p_request_hash then
      return v_existing.result || jsonb_build_object('replayed', true, 'correlationId', p_correlation_id);
    end if;
    return jsonb_build_object('decision', 'idempotency_conflict', 'correlationId', p_correlation_id);
  end if;

  select * into v_aircraft
  from public.aircraft_records aircraft
  where aircraft.organization_id = p_organization_id and aircraft.id = p_aircraft_record_id
  for update;
  if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
  if v_aircraft.registry_state <> 'tracked' then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;
  select * into v_category
  from public.aircraft_document_categories category
  where category.organization_id = p_organization_id and category.id = p_category_id
  for update;
  if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
  if v_category.category_state <> 'active' or (
    v_category.category_kind = 'custom' and not exists (
      select 1 from public.aircraft_document_requirements requirement
      where requirement.organization_id = p_organization_id
        and requirement.aircraft_record_id = p_aircraft_record_id
        and requirement.category_id = p_category_id
        and requirement.requirement_state = 'active'
    )
  ) then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;

  if p_action in ('create', 'renew', 'correct') then
    if p_document_title is null or p_document_title <> btrim(p_document_title)
       or char_length(p_document_title) not between 1 and 160
       or p_document_source is null or p_document_source <> btrim(p_document_source)
       or char_length(p_document_source) not between 1 and 160
       or p_expiration_date is null
       or (p_reference_number is not null and (p_reference_number <> btrim(p_reference_number)
         or char_length(p_reference_number) not between 1 and 160))
       or (p_notes is not null and (p_notes <> btrim(p_notes)
         or char_length(p_notes) not between 1 and 500))
       or (p_action in ('renew', 'correct') and (p_reason is null
         or p_reason <> btrim(p_reason) or char_length(p_reason) not between 10 and 300)) then
      return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
    end if;
    if p_stored_file_id is not null then
      select * into v_file
      from public.stored_files file
      where file.organization_id = p_organization_id and file.id = p_stored_file_id
      for update;
      if not found or v_file.aircraft_record_id <> p_aircraft_record_id or v_file.scan_state <> 'clean'
         or exists (
           select 1 from public.aircraft_document_versions version
           where version.organization_id = p_organization_id and version.stored_file_id = v_file.id
         ) then
        return jsonb_build_object('decision', 'file_rejected', 'correlationId', p_correlation_id);
      end if;
    end if;
  elsif p_document_title is not null or p_document_source is not null
     or p_reference_number is not null or p_issue_date is not null
     or p_expiration_date is not null or p_notes is not null or p_stored_file_id is not null
     or p_reason is null or p_reason <> btrim(p_reason)
     or char_length(p_reason) not between 10 and 300 then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  if p_action = 'create' then
    if exists (
      select 1 from public.aircraft_documents document
      where document.organization_id = p_organization_id
        and document.aircraft_record_id = p_aircraft_record_id
        and document.category_id = p_category_id
    ) then
      return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
    end if;
    insert into public.aircraft_documents (
      organization_id, aircraft_record_id, category_id, created_by, updated_by
    ) values (
      p_organization_id, p_aircraft_record_id, p_category_id, p_actor_user_id, p_actor_user_id
    ) returning * into v_document;
    insert into public.aircraft_document_versions (
      organization_id, aircraft_document_id, version_number, version_kind,
      category_code, category_label, document_title, document_source,
      reference_number, issue_date, expiration_date, notes, stored_file_id,
      version_reason, created_by
    ) values (
      p_organization_id, v_document.id, 1, 'create',
      v_category.category_code, v_category.category_label, p_document_title, p_document_source,
      p_reference_number, p_issue_date, p_expiration_date, p_notes, p_stored_file_id,
      null, p_actor_user_id
    ) returning * into v_new_version;
    update public.aircraft_documents
    set current_version_id = v_new_version.id
    where id = v_document.id returning * into v_document;
    v_decision := 'created'; v_event_name := 'aircraft_document.created';
  else
    select * into v_document
    from public.aircraft_documents document
    where document.organization_id = p_organization_id and document.id = p_document_id
      and document.aircraft_record_id = p_aircraft_record_id
      and document.category_id = p_category_id
    for update;
    if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
    v_prior_aggregate_version := v_document.version;
    v_prior_document_state := v_document.document_state;
    if v_document.version <> p_expected_version then
      return jsonb_build_object('decision', 'version_conflict', 'correlationId', p_correlation_id);
    end if;
    select * into v_prior_version
    from public.aircraft_document_versions version
    where version.organization_id = p_organization_id and version.id = v_document.current_version_id
    for update;
    if v_prior_version.stored_file_id is not null then
      select file.sha256_hash into v_prior_file_hash
      from public.stored_files file
      where file.organization_id = p_organization_id
        and file.id = v_prior_version.stored_file_id;
    end if;

    if p_action in ('renew', 'correct') then
      if v_document.document_state = 'archived' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      insert into public.aircraft_document_versions (
        organization_id, aircraft_document_id, version_number, version_kind,
        category_code, category_label, document_title, document_source,
        reference_number, issue_date, expiration_date, notes, stored_file_id,
        version_reason, created_by
      ) values (
        p_organization_id, v_document.id, v_prior_version.version_number + 1,
        case when p_action = 'renew' then 'renewal' else 'correction' end,
        v_category.category_code, v_category.category_label, p_document_title, p_document_source,
        p_reference_number, p_issue_date, p_expiration_date, p_notes, p_stored_file_id,
        p_reason, p_actor_user_id
      ) returning * into v_new_version;
      update public.aircraft_documents
      set current_version_id = v_new_version.id, version = version + 1,
          updated_at = now(), updated_by = p_actor_user_id
      where id = v_document.id returning * into v_document;
      perform public.resolve_aircraft_document_notifications(
        p_organization_id, v_document.id, v_prior_version.id, null,
        'version_superseded', p_actor_user_id, p_correlation_id
      );
      v_decision := case when p_action = 'renew' then 'renewed' else 'corrected' end;
      v_event_name := case when p_action = 'renew' then 'aircraft_document.renewed'
        else 'aircraft_document.corrected' end;
    elsif p_action = 'suspend' then
      if v_document.document_state <> 'active' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      update public.aircraft_documents
      set document_state = 'suspended', suspension_reason = p_reason,
          suspended_at = now(), suspended_by = p_actor_user_id,
          version = version + 1, updated_at = now(), updated_by = p_actor_user_id
      where id = v_document.id returning * into v_document;
      perform public.resolve_aircraft_document_notifications(
        p_organization_id, v_document.id, null, null,
        'suspended', p_actor_user_id, p_correlation_id
      );
      v_new_version := v_prior_version;
      v_decision := 'suspended'; v_event_name := 'aircraft_document.suspended';
    else
      if v_document.document_state <> 'suspended' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      update public.aircraft_documents
      set document_state = 'active', suspension_reason = null,
          suspended_at = null, suspended_by = null,
          version = version + 1, updated_at = now(), updated_by = p_actor_user_id
      where id = v_document.id returning * into v_document;
      v_new_version := v_prior_version;
      v_decision := 'restored'; v_event_name := 'aircraft_document.restored';
    end if;
  end if;

  if v_new_version.stored_file_id is not null then
    select file.sha256_hash into v_new_file_hash
    from public.stored_files file
    where file.organization_id = p_organization_id
      and file.id = v_new_version.stored_file_id;
  end if;

  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'document', v_document.id,
    v_event_name, 'success', v_decision, p_correlation_id, p_idempotency_key_hash,
    jsonb_build_object(
      'priorAggregateVersion', v_prior_aggregate_version,
      'newAggregateVersion', v_document.version,
      'priorDocumentState', v_prior_document_state,
      'newDocumentState', v_document.document_state,
      'priorDocumentVersionId', v_prior_version.id,
      'newDocumentVersionId', v_new_version.id,
      'priorDocumentVersion', v_prior_version.version_number,
      'newDocumentVersion', v_new_version.version_number,
      'categoryCode', v_category.category_code,
      'expirationBefore', v_prior_version.expiration_date,
      'expirationAfter', v_new_version.expiration_date,
      'reason', p_reason,
      'attachmentBeforePresent', v_prior_version.stored_file_id is not null,
      'attachmentAfterPresent', v_new_version.stored_file_id is not null,
      'attachmentHashChanged', v_prior_file_hash is distinct from v_new_file_hash
    )
  );
  perform public.sync_aircraft_document_notifications(
    p_organization_id, v_document.id, v_new_version.id, p_philippine_date,
    p_actor_user_id, p_correlation_id
  );
  v_result := jsonb_build_object(
    'decision', v_decision,
    'documentId', v_document.id,
    'aggregateVersion', v_document.version,
    'documentState', v_document.document_state,
    'currentVersionId', v_new_version.id,
    'currentVersionNumber', v_new_version.version_number,
    'replayed', false
  );
  insert into public.aircraft_document_idempotency (
    organization_id, actor_user_id, idempotency_key_hash, action,
    target_id, expected_version, request_hash, result
  ) values (
    p_organization_id, p_actor_user_id, p_idempotency_key_hash, p_action,
    v_document.id, p_expected_version, p_request_hash, v_result
  );
  return v_result || jsonb_build_object('correlationId', p_correlation_id);
exception when unique_violation then
  return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.mutate_aircraft_document(uuid, uuid, text, uuid, uuid, uuid, bigint, text, text, text, date, date, text, uuid, text, text, text, date, uuid)
  from public, anon, authenticated;
grant execute on function public.mutate_aircraft_document(uuid, uuid, text, uuid, uuid, uuid, bigint, text, text, text, date, date, text, uuid, text, text, text, date, uuid)
  to service_role;

create or replace function public.mutate_aircraft_document_category(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_action text,
  p_category_id uuid,
  p_aircraft_record_id uuid,
  p_expected_version bigint,
  p_category_label text,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_philippine_date date,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_category public.aircraft_document_categories%rowtype;
  v_requirement public.aircraft_document_requirements%rowtype;
  v_document public.aircraft_documents%rowtype;
  v_result jsonb;
  v_code text;
  v_decision text;
begin
  if p_action not in ('create_category', 'rename_category', 'archive_category', 'assign_category', 'remove_category')
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$' or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_philippine_date is null or p_correlation_id is null
     or (p_action = 'create_category' and (p_category_id is not null or p_expected_version is not null))
     or (p_action <> 'create_category' and (p_category_id is null or p_expected_version is null
       or p_expected_version < 1))
     or (p_action in ('assign_category', 'remove_category') and p_aircraft_record_id is null)
     or (p_action not in ('assign_category', 'remove_category') and p_aircraft_record_id is not null)
     or (p_action in ('create_category', 'rename_category') and (
       p_category_label is null or p_category_label <> btrim(p_category_label)
       or char_length(p_category_label) not between 1 and 120))
     or (p_action not in ('create_category', 'rename_category') and p_category_label is not null) then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.category.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key_hash, 0
  ));
  select item.result into v_result
  from public.aircraft_document_idempotency item
  where item.organization_id = p_organization_id and item.actor_user_id = p_actor_user_id
    and item.idempotency_key_hash = p_idempotency_key_hash
    and item.action = p_action
    and (p_action = 'create_category' or item.target_id is not distinct from p_category_id)
    and item.expected_version is not distinct from p_expected_version
    and item.request_hash = p_request_hash;
  if found then return v_result || jsonb_build_object('replayed', true, 'correlationId', p_correlation_id); end if;
  if exists (
    select 1 from public.aircraft_document_idempotency item
    where item.organization_id = p_organization_id and item.actor_user_id = p_actor_user_id
      and item.idempotency_key_hash = p_idempotency_key_hash
  ) then
    return jsonb_build_object('decision', 'idempotency_conflict', 'correlationId', p_correlation_id);
  end if;

  if p_action = 'create_category' then
    v_code := 'custom_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.aircraft_document_categories (
      organization_id, category_code, category_label, category_kind, created_by, updated_by
    ) values (
      p_organization_id, v_code, p_category_label, 'custom', p_actor_user_id, p_actor_user_id
    ) returning * into v_category;
    v_decision := 'category_created';
  else
    if p_action in ('assign_category', 'remove_category') then
      perform 1 from public.aircraft_records aircraft
      where aircraft.organization_id = p_organization_id and aircraft.id = p_aircraft_record_id
        and aircraft.registry_state = 'tracked' for update;
      if not found then
        return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
      end if;
    end if;
    select * into v_category
    from public.aircraft_document_categories category
    where category.organization_id = p_organization_id and category.id = p_category_id
    for update;
    if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
    if v_category.category_kind <> 'custom'
       or (p_action in ('rename_category', 'archive_category', 'assign_category')
         and v_category.version <> p_expected_version) then
      return jsonb_build_object(
        'decision', case when v_category.category_kind = 'custom' then 'version_conflict' else 'state_conflict' end,
        'correlationId', p_correlation_id
      );
    end if;
    if p_action = 'rename_category' then
      if v_category.category_state <> 'active' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      update public.aircraft_document_categories
      set category_label = p_category_label, version = version + 1,
          updated_at = now(), updated_by = p_actor_user_id
      where id = v_category.id returning * into v_category;
      v_decision := 'category_renamed';
    elsif p_action = 'archive_category' then
      if v_category.category_state <> 'active' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      update public.aircraft_document_categories
      set category_state = 'archived', archived_at = now(), archived_by = p_actor_user_id,
          version = version + 1, updated_at = now(), updated_by = p_actor_user_id
      where id = v_category.id returning * into v_category;
      update public.aircraft_document_requirements
      set requirement_state = 'archived', archived_at = now(), archived_by = p_actor_user_id,
          version = version + 1, updated_at = now(), updated_by = p_actor_user_id
      where organization_id = p_organization_id and category_id = v_category.id
        and requirement_state = 'active';
      update public.aircraft_documents
      set document_state = 'archived', archived_at = now(), archived_by = p_actor_user_id,
          version = version + 1, updated_at = now(), updated_by = p_actor_user_id
      where organization_id = p_organization_id and category_id = v_category.id
        and document_state <> 'archived';
      for v_document in
        select document.*
        from public.aircraft_documents document
        where document.organization_id = p_organization_id
          and document.category_id = v_category.id
        order by document.id
      loop
        perform public.resolve_aircraft_document_notifications(
          p_organization_id, v_document.id, null, null,
          'category_archived', p_actor_user_id, p_correlation_id
        );
      end loop;
      v_decision := 'category_archived';
    else
      if v_category.category_state <> 'active' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      select * into v_requirement
      from public.aircraft_document_requirements requirement
      where requirement.organization_id = p_organization_id
        and requirement.aircraft_record_id = p_aircraft_record_id
        and requirement.category_id = v_category.id
      order by requirement.created_at desc limit 1 for update;
      if p_action = 'assign_category' then
        if found and v_requirement.requirement_state = 'active' then
          return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
        elsif found then
          update public.aircraft_document_requirements
          set requirement_state = 'active', archived_at = null, archived_by = null,
              version = version + 1, updated_at = now(), updated_by = p_actor_user_id
          where id = v_requirement.id returning * into v_requirement;
          select * into v_document from public.aircraft_documents document
          where document.organization_id = p_organization_id
            and document.aircraft_record_id = p_aircraft_record_id
            and document.category_id = v_category.id for update;
          if found and v_document.document_state = 'archived' then
            update public.aircraft_documents
            set document_state = 'active', archived_at = null, archived_by = null,
                suspension_reason = null, suspended_at = null, suspended_by = null,
                version = version + 1, updated_at = now(), updated_by = p_actor_user_id
            where id = v_document.id returning * into v_document;
            perform public.sync_aircraft_document_notifications(
              p_organization_id, v_document.id, v_document.current_version_id,
              p_philippine_date, p_actor_user_id, p_correlation_id
            );
          end if;
        else
          insert into public.aircraft_document_requirements (
            organization_id, aircraft_record_id, category_id, created_by, updated_by
          ) values (
            p_organization_id, p_aircraft_record_id, v_category.id,
            p_actor_user_id, p_actor_user_id
          ) returning * into v_requirement;
        end if;
        v_decision := 'category_assigned';
      else
        if not found or v_requirement.requirement_state <> 'active'
           or v_requirement.version <> p_expected_version then
          return jsonb_build_object('decision', 'version_conflict', 'correlationId', p_correlation_id);
        end if;
        update public.aircraft_document_requirements
        set requirement_state = 'archived', archived_at = now(), archived_by = p_actor_user_id,
            version = version + 1, updated_at = now(), updated_by = p_actor_user_id
        where id = v_requirement.id returning * into v_requirement;
        update public.aircraft_documents
        set document_state = 'archived', archived_at = now(), archived_by = p_actor_user_id,
            version = version + 1, updated_at = now(), updated_by = p_actor_user_id
        where organization_id = p_organization_id and aircraft_record_id = p_aircraft_record_id
          and category_id = v_category.id and document_state <> 'archived'
        returning * into v_document;
        if found then
          perform public.resolve_aircraft_document_notifications(
            p_organization_id, v_document.id, null, null,
            'requirement_removed', p_actor_user_id, p_correlation_id
          );
        end if;
        v_decision := 'category_removed';
      end if;
    end if;
  end if;

  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id,
    case when p_action in ('assign_category', 'remove_category') then 'requirement' else 'category' end,
    coalesce(v_requirement.id, v_category.id),
    'aircraft_document.' || v_decision, 'success', v_decision, p_correlation_id,
    p_idempotency_key_hash,
    jsonb_build_object('categoryId', v_category.id, 'aircraftId', p_aircraft_record_id,
      'categoryVersion', v_category.version,
      'requirementVersion', v_requirement.version)
  );
  v_result := jsonb_build_object(
    'decision', v_decision, 'categoryId', v_category.id,
    'categoryCode', v_category.category_code, 'categoryLabel', v_category.category_label,
    'categoryState', v_category.category_state, 'categoryVersion', v_category.version,
    'requirementId', v_requirement.id, 'requirementVersion', v_requirement.version,
    'replayed', false
  );
  insert into public.aircraft_document_idempotency (
    organization_id, actor_user_id, idempotency_key_hash, action,
    target_id, expected_version, request_hash, result
  ) values (
    p_organization_id, p_actor_user_id, p_idempotency_key_hash, p_action,
    v_category.id, p_expected_version, p_request_hash, v_result
  );
  return v_result || jsonb_build_object('correlationId', p_correlation_id);
exception when unique_violation then
  return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.mutate_aircraft_document_category(uuid, uuid, text, uuid, uuid, bigint, text, text, text, date, uuid)
  from public, anon, authenticated;
grant execute on function public.mutate_aircraft_document_category(uuid, uuid, text, uuid, uuid, bigint, text, text, text, date, uuid)
  to service_role;

create or replace function public.stage_aircraft_document_file(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_aircraft_record_id uuid,
  p_file_id uuid,
  p_object_key text,
  p_display_name text,
  p_generated_name text,
  p_media_type text,
  p_size_bytes bigint,
  p_sha256_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_file public.stored_files%rowtype;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  if p_file_id is null or p_correlation_id is null
     or p_object_key !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$'
     or p_generated_name !~ '^[0-9a-f-]{36}\.(pdf|jpg|png)$'
     or p_display_name <> btrim(p_display_name) or char_length(p_display_name) not between 1 and 160
     or p_media_type not in ('application/pdf', 'image/jpeg', 'image/png')
     or p_size_bytes not between 1 and 20971520
     or p_sha256_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not exists (
    select 1 from public.aircraft_records aircraft
    where aircraft.organization_id = p_organization_id and aircraft.id = p_aircraft_record_id
      and aircraft.registry_state = 'tracked'
  ) then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  select * into v_file from public.stored_files file
  where file.organization_id = p_organization_id and file.id = p_file_id;
  if found then
    if v_file.aircraft_record_id = p_aircraft_record_id
       and v_file.object_key = p_object_key and v_file.display_name = p_display_name
       and v_file.generated_name = p_generated_name and v_file.media_type = p_media_type
       and v_file.size_bytes = p_size_bytes and v_file.sha256_hash = p_sha256_hash then
      return jsonb_build_object(
        'decision', 'staged', 'fileId', v_file.id, 'objectKey', v_file.object_key,
        'scanState', v_file.scan_state, 'correlationId', p_correlation_id
      );
    end if;
    return jsonb_build_object('decision', 'idempotency_conflict', 'correlationId', p_correlation_id);
  end if;
  insert into public.stored_files (
    id, organization_id, aircraft_record_id, object_key, display_name, generated_name,
    media_type, size_bytes, sha256_hash, scan_state, uploader_user_id
  ) values (
    p_file_id, p_organization_id, p_aircraft_record_id, p_object_key, p_display_name,
    p_generated_name, p_media_type, p_size_bytes, p_sha256_hash, 'staged', p_actor_user_id
  ) returning * into v_file;
  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'file', v_file.id,
    'aircraft_document.file_staged', 'success', 'file_staged', p_correlation_id,
    null, jsonb_build_object('mediaType', v_file.media_type, 'sizeBytes', v_file.size_bytes,
      'hash', v_file.sha256_hash)
  );
  return jsonb_build_object(
    'decision', 'staged', 'fileId', v_file.id, 'objectKey', v_file.object_key,
    'scanState', v_file.scan_state, 'correlationId', p_correlation_id
  );
exception when unique_violation then
  return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.stage_aircraft_document_file(uuid, uuid, uuid, uuid, text, text, text, text, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.stage_aircraft_document_file(uuid, uuid, uuid, uuid, text, text, text, text, bigint, text, uuid)
  to service_role;

create or replace function public.complete_aircraft_document_file(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_file_id uuid,
  p_scan_state text,
  p_verified_size_bytes bigint,
  p_verified_sha256_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_file public.stored_files%rowtype;
  v_final_state text;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  if p_scan_state not in ('clean', 'rejected', 'scan_failed')
     or p_verified_size_bytes not between 1 and 20971520
     or p_verified_sha256_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  select * into v_file
  from public.stored_files file
  where file.organization_id = p_organization_id and file.id = p_file_id
  for update;
  if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
  if v_file.scan_state = 'clean' and p_scan_state = 'clean'
     and v_file.size_bytes = p_verified_size_bytes
     and v_file.sha256_hash = p_verified_sha256_hash then
    return jsonb_build_object(
      'decision', 'completed', 'fileId', v_file.id, 'scanState', v_file.scan_state,
      'correlationId', p_correlation_id
    );
  end if;
  if v_file.scan_state <> 'staged' then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;
  v_final_state := case
    when p_verified_size_bytes <> v_file.size_bytes
      or p_verified_sha256_hash <> v_file.sha256_hash then 'rejected'
    else p_scan_state
  end;
  update public.stored_files
  set scan_state = v_final_state, updated_at = now()
  where id = v_file.id returning * into v_file;
  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'file', v_file.id,
    case when v_file.scan_state = 'clean' then 'aircraft_document.file_clean'
      else 'aircraft_document.file_rejected' end,
    case when v_file.scan_state = 'clean' then 'success' else 'failed' end,
    v_file.scan_state, p_correlation_id, null,
    jsonb_build_object('mediaType', v_file.media_type, 'sizeBytes', p_verified_size_bytes,
      'hashMatched', p_verified_sha256_hash = v_file.sha256_hash)
  );
  return jsonb_build_object(
    'decision', case when v_file.scan_state = 'clean' then 'completed' else 'file_rejected' end,
    'fileId', v_file.id, 'scanState', v_file.scan_state, 'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.complete_aircraft_document_file(uuid, uuid, uuid, text, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_aircraft_document_file(uuid, uuid, uuid, text, bigint, text, uuid)
  to service_role;

create or replace function public.get_aircraft_document_download_target(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_file_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_file public.stored_files%rowtype;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.attachment.read'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  select file.* into v_file
  from public.stored_files file
  join public.aircraft_document_versions version
    on version.organization_id = file.organization_id and version.stored_file_id = file.id
  join public.aircraft_documents document
    on document.organization_id = version.organization_id
   and document.id = version.aircraft_document_id
  join public.aircraft_records aircraft
    on aircraft.organization_id = document.organization_id
   and aircraft.id = document.aircraft_record_id
  where file.organization_id = p_organization_id and file.id = p_file_id
    and file.scan_state = 'clean' and document.document_state <> 'archived'
    and aircraft.registry_state = 'tracked';
  if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
  return jsonb_build_object(
    'decision', 'authorized', 'fileId', v_file.id, 'bucketId', v_file.bucket_id,
    'objectKey', v_file.object_key, 'downloadName', v_file.display_name,
    'mediaType', v_file.media_type, 'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.get_aircraft_document_download_target(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_aircraft_document_download_target(uuid, uuid, uuid, uuid)
  to service_role;

create or replace function public.confirm_aircraft_document_download_issued(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_file_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_file public.stored_files%rowtype;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.attachment.read'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  select file.* into v_file
  from public.stored_files file
  join public.aircraft_document_versions version
    on version.organization_id = file.organization_id and version.stored_file_id = file.id
  join public.aircraft_documents document
    on document.organization_id = version.organization_id
   and document.id = version.aircraft_document_id
  join public.aircraft_records aircraft
    on aircraft.organization_id = document.organization_id
   and aircraft.id = document.aircraft_record_id
  where file.organization_id = p_organization_id and file.id = p_file_id
    and file.scan_state = 'clean' and document.document_state <> 'archived'
    and aircraft.registry_state = 'tracked';
  if not found then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'file', v_file.id,
    'aircraft_document.download_issued', 'success', 'download_issued', p_correlation_id,
    null, jsonb_build_object('mediaType', v_file.media_type, 'sizeBytes', v_file.size_bytes)
  );
  return jsonb_build_object(
    'decision', 'confirmed', 'fileId', v_file.id, 'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.confirm_aircraft_document_download_issued(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_aircraft_document_download_issued(uuid, uuid, uuid, uuid)
  to service_role;

create or replace function public.get_aircraft_document_staged_file(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_file_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_file public.stored_files%rowtype;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then return jsonb_build_object('decision', 'unauthorized'); end if;
  select * into v_file from public.stored_files file
  where file.organization_id = p_organization_id and file.id = p_file_id;
  if not found then return jsonb_build_object('decision', 'not_found'); end if;
  return jsonb_build_object(
    'decision', 'found', 'fileId', v_file.id, 'objectKey', v_file.object_key,
    'mediaType', v_file.media_type, 'sizeBytes', v_file.size_bytes,
    'sha256Hash', v_file.sha256_hash, 'scanState', v_file.scan_state
  );
end;
$$;

revoke all on function public.get_aircraft_document_staged_file(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_aircraft_document_staged_file(uuid, uuid, uuid)
  to service_role;

create or replace function public.record_aircraft_document_security_event(
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
  if p_action !~ '^[a-z][a-z0-9_]{2,63}$'
     or p_outcome not in ('denied', 'conflict')
     or p_reason !~ '^[a-z][a-z0-9_]{2,63}$' then
    raise exception using errcode = '22023', message = 'Aircraft document security event is invalid.';
  end if;
  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'document', null,
    'aircraft_document.security_' || p_outcome, p_outcome, p_reason,
    p_correlation_id, null, jsonb_build_object('action', p_action)
  );
end;
$$;

revoke all on function public.record_aircraft_document_security_event(uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_aircraft_document_security_event(uuid, uuid, text, text, text, uuid)
  to service_role;

create or replace function public.list_aircraft_document_notifications(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_membership_id uuid,
  p_page integer,
  p_page_size integer,
  p_include_resolved boolean,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_items jsonb;
  v_has_next boolean;
begin
  if p_page not between 1 and 100 or p_page_size not between 1 and 50
     or p_include_resolved is null then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.notification.read'
  ) or not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id and membership.id = p_membership_id
      and membership.user_id = p_actor_user_id and membership.status = 'active'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  with selected as (
    select notification.*, aircraft.registration_mark, category.category_label,
      version.expiration_date,
      row_number() over (order by notification.due_date desc, notification.id) as position
    from public.aircraft_document_notifications notification
    join public.aircraft_documents document
      on document.organization_id = notification.organization_id
     and document.id = notification.aircraft_document_id
    join public.aircraft_records aircraft
      on aircraft.organization_id = document.organization_id
     and aircraft.id = document.aircraft_record_id
    join public.aircraft_document_categories category
      on category.organization_id = document.organization_id
     and category.id = document.category_id
    join public.aircraft_document_versions version
      on version.organization_id = notification.organization_id
     and version.id = notification.document_version_id
    where notification.organization_id = p_organization_id
      and notification.recipient_membership_id = p_membership_id
      and (p_include_resolved or notification.notification_state <> 'resolved')
    order by notification.due_date desc, notification.id
    offset ((p_page - 1) * p_page_size)
    limit (p_page_size + 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', selected.id,
    'documentId', selected.aircraft_document_id,
    'documentVersionId', selected.document_version_id,
    'eventKind', selected.event_kind,
    'state', selected.notification_state,
    'dueDate', selected.due_date,
    'aircraftRegistration', selected.registration_mark,
    'categoryLabel', selected.category_label,
    'expirationDate', selected.expiration_date,
    'createdAt', selected.created_at
  ) order by selected.position) filter (where selected.position <= (p_page * p_page_size)), '[]'::jsonb),
  count(*) > p_page_size into v_items, v_has_next from selected;
  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'notification', p_membership_id,
    'aircraft_document.notifications_listed', 'success', 'notifications_listed',
    p_correlation_id, null, jsonb_build_object('page', p_page, 'pageSize', p_page_size,
      'includeResolved', p_include_resolved, 'returnedCount', jsonb_array_length(v_items))
  );
  return jsonb_build_object(
    'decision', 'listed', 'items', v_items, 'page', p_page, 'pageSize', p_page_size,
    'hasNext', v_has_next, 'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.list_aircraft_document_notifications(uuid, uuid, uuid, integer, integer, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.list_aircraft_document_notifications(uuid, uuid, uuid, integer, integer, boolean, uuid)
  to service_role;

create or replace function public.open_aircraft_document_notification(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_membership_id uuid,
  p_notification_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_notification public.aircraft_document_notifications%rowtype;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.notification.read'
  ) or not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id and membership.id = p_membership_id
      and membership.user_id = p_actor_user_id and membership.status = 'active'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  select * into v_notification
  from public.aircraft_document_notifications notification
  where notification.organization_id = p_organization_id
    and notification.recipient_membership_id = p_membership_id
    and notification.id = p_notification_id
  for update;
  if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
  if v_notification.notification_state = 'open' then
    update public.aircraft_document_notifications
    set notification_state = 'read', read_at = now()
    where id = v_notification.id returning * into v_notification;
  end if;
  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'notification', v_notification.id,
    'aircraft_document.notification_opened', 'success', 'notification_opened', p_correlation_id
  );
  return jsonb_build_object(
    'decision', 'opened', 'notificationId', v_notification.id,
    'documentId', v_notification.aircraft_document_id,
    'state', v_notification.notification_state, 'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.open_aircraft_document_notification(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.open_aircraft_document_notification(uuid, uuid, uuid, uuid, uuid)
  to service_role;

create or replace function public.reconcile_aircraft_document_storage(
  p_organization_id uuid,
  p_observed_hashes jsonb,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_file record;
  v_object record;
  v_observation record;
  v_expected_key text;
  v_failure text;
  v_failures jsonb := '[]'::jsonb;
  v_failure_count integer := 0;
  v_object_key_hash text;
begin
  if p_organization_id is null or p_correlation_id is null
     or p_observed_hashes is null or jsonb_typeof(p_observed_hashes) <> 'object' then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  for v_observation in select key, value from jsonb_each_text(p_observed_hashes)
  loop
    if v_observation.value !~ '^[0-9a-f]{64}$' then
      return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
    end if;
  end loop;
  if not exists (
    select 1 from public.organizations organization where organization.id = p_organization_id
  ) then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;

  for v_file in
    select file.*,
      exists (
        select 1 from public.aircraft_document_versions version
        where version.organization_id = file.organization_id
          and version.stored_file_id = file.id
      ) as is_linked,
      exists (
        select 1 from storage.objects object
        where object.bucket_id = 'aircraft-documents' and object.name = file.object_key
      ) as object_exists
    from public.stored_files file
    where file.organization_id = p_organization_id
    order by file.id
  loop
    v_expected_key := p_organization_id::text || '/' || v_file.aircraft_record_id::text || '/'
      || v_file.id::text || '/' || v_file.generated_name;
    v_failure := case
      when v_file.object_key <> v_expected_key then 'wrong_scope'
      when not v_file.object_exists then 'missing_object'
      when not (p_observed_hashes ? v_file.object_key)
        or p_observed_hashes->>v_file.object_key <> v_file.sha256_hash then 'hash_mismatch'
      when not v_file.is_linked then 'orphan_object'
      when v_file.is_linked and v_file.scan_state <> 'clean' then 'unclean_object'
      else null
    end;
    if v_failure is not null then
      v_failure_count := v_failure_count + 1;
      v_object_key_hash := encode(
        extensions.digest(convert_to(v_file.object_key, 'UTF8'), 'sha256'), 'hex'
      );
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'reason', v_failure, 'fileId', v_file.id
      ));
      perform public.write_aircraft_document_event(
        p_organization_id, null, 'file', v_file.id,
        'aircraft_document.reconciliation_failed', 'failed',
        'reconciliation_' || v_failure, p_correlation_id, null,
        jsonb_build_object(
          'failureKind', v_failure, 'objectKeyHash', v_object_key_hash,
          'linked', v_file.is_linked, 'scanState', v_file.scan_state
        )
      );
    end if;
  end loop;

  for v_object in
    select object.name
    from storage.objects object
    where object.bucket_id = 'aircraft-documents'
      and object.name like p_organization_id::text || '/%'
      and not exists (
        select 1 from public.stored_files file
        where file.organization_id = p_organization_id and file.object_key = object.name
      )
    order by object.name
  loop
    v_failure_count := v_failure_count + 1;
    v_object_key_hash := encode(
      extensions.digest(convert_to(v_object.name, 'UTF8'), 'sha256'), 'hex'
    );
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'reason', 'orphan_object', 'fileId', null
    ));
    perform public.write_aircraft_document_event(
      p_organization_id, null, 'job', null,
      'aircraft_document.reconciliation_failed', 'failed',
      'reconciliation_orphan_object', p_correlation_id, null,
      jsonb_build_object(
        'failureKind', 'orphan_object', 'objectKeyHash', v_object_key_hash
      )
    );
  end loop;

  if v_failure_count = 0 then
    perform public.write_aircraft_document_event(
      p_organization_id, null, 'job', null,
      'aircraft_document.reconciliation_completed', 'success',
      'reconciliation_completed', p_correlation_id, null,
      jsonb_build_object(
        'checkedFileCount', (select count(*) from jsonb_object_keys(p_observed_hashes))
      )
    );
  end if;
  return jsonb_build_object(
    'decision', case when v_failure_count = 0 then 'ready' else 'reconciliation_failed' end,
    'failureCount', v_failure_count, 'failures', v_failures,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.reconcile_aircraft_document_storage(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_aircraft_document_storage(uuid, jsonb, uuid)
  to service_role;

create or replace function public.run_aircraft_document_notification_job(
  p_organization_id uuid,
  p_philippine_date date,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item record;
  v_sync jsonb;
  v_evaluated integer := 0;
  v_skipped_warnings integer := 0;
begin
  if p_organization_id is null or p_philippine_date is null or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'Aircraft document job input is invalid.';
  end if;
  for v_item in
    select document.id, document.current_version_id
    from public.aircraft_documents document
    join public.aircraft_records aircraft
      on aircraft.organization_id = document.organization_id
     and aircraft.id = document.aircraft_record_id
    join public.aircraft_document_categories category
      on category.organization_id = document.organization_id
     and category.id = document.category_id
    where document.organization_id = p_organization_id
      and document.document_state <> 'archived'
      and document.current_version_id is not null
      and aircraft.registry_state = 'tracked'
      and category.category_state = 'active'
    order by document.id
  loop
    select public.sync_aircraft_document_notifications(
      p_organization_id, v_item.id, v_item.current_version_id,
      p_philippine_date, null, p_correlation_id
    ) into v_sync;
    v_evaluated := v_evaluated + 1;
    if coalesce((v_sync->>'skippedWarning')::boolean, false) then
      v_skipped_warnings := v_skipped_warnings + 1;
    end if;
  end loop;
  perform public.write_aircraft_document_event(
    p_organization_id, null, 'job', null,
    'aircraft_document.notification_job_completed', 'success', 'job_completed',
    p_correlation_id, null,
    jsonb_build_object(
      'calculatedOn', p_philippine_date, 'evaluatedCount', v_evaluated,
      'skippedWarningCount', v_skipped_warnings
    )
  );
  return jsonb_build_object(
    'decision', 'completed', 'evaluatedCount', v_evaluated,
    'skippedWarningCount', v_skipped_warnings,
    'calculatedOn', p_philippine_date, 'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.run_aircraft_document_notification_job(uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function public.run_aircraft_document_notification_job(uuid, date, uuid)
  to service_role;

create or replace function public.reconcile_aircraft_document_aircraft_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_document record;
  v_correlation_id uuid := gen_random_uuid();
  v_philippine_date date := (clock_timestamp() at time zone 'Asia/Manila')::date;
begin
  if old.registry_state = new.registry_state then return new; end if;
  if new.registry_state = 'archived' then
    for v_document in
      select document.id, document.current_version_id
      from public.aircraft_documents document
      where document.organization_id = new.organization_id
        and document.aircraft_record_id = new.id
      order by document.id
    loop
      perform public.resolve_aircraft_document_notifications(
        new.organization_id, v_document.id, null, null,
        'aircraft_archived', new.updated_by, v_correlation_id
      );
    end loop;
  else
    for v_document in
      select document.id, document.current_version_id
      from public.aircraft_documents document
      where document.organization_id = new.organization_id
        and document.aircraft_record_id = new.id
        and document.document_state <> 'archived'
        and document.current_version_id is not null
      order by document.id
    loop
      perform public.sync_aircraft_document_notifications(
        new.organization_id, v_document.id, v_document.current_version_id,
        v_philippine_date, new.updated_by, v_correlation_id
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.reconcile_aircraft_document_aircraft_lifecycle()
  from public, anon, authenticated;

create trigger reconcile_aircraft_document_aircraft_lifecycle
after update of registry_state on public.aircraft_records
for each row execute function public.reconcile_aircraft_document_aircraft_lifecycle();

comment on table public.aircraft_documents is
  'FEAT-007B configured aircraft document records. State is administrative and not an airworthiness or operational conclusion.';
comment on column public.aircraft_document_versions.expiration_date is
  'Required FlyEye record date used for configured status; it does not assert a regulatory expiration rule.';
comment on table public.stored_files is
  'Private restricted aircraft-document attachment metadata; browser roles have no direct table grant.';

commit;
