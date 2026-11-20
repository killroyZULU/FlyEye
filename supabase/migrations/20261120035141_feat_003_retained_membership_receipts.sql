begin;

-- Composite references prevent substituting another member or profile in the same school.
create unique index retained_receipt_membership_identity_idx
  on public.organization_memberships (organization_id, id, user_id);
create unique index retained_receipt_profile_identity_idx
  on public.organization_member_profiles (organization_id, membership_id, id);

create table staging_private.retained_membership_receipts (
  operation_id uuid primary key,
  attempt_id uuid not null unique,
  run_id uuid not null,
  project_ref text not null check (project_ref = 'ubzihnhmskkdinydlzlb'),
  package_sha256 text not null check (package_sha256 ~ '^[0-9a-f]{64}$'),
  database_system_id text not null check (database_system_id ~ '^[0-9]{1,20}$'),
  organization_id uuid not null,
  slot_code text not null check (slot_code in ('student_pilot', 'instructor_pilot')),
  initial_role_code text not null check (initial_role_code = 'student_pilot'),
  event_name text not null check (event_name = 'fixture.retained_membership_established'),
  user_id uuid not null unique,
  membership_id uuid not null unique,
  profile_id uuid not null unique,
  occurred_at timestamptz not null default transaction_timestamp(),
  unique (organization_id, slot_code),
  foreign key (organization_id, membership_id, user_id)
    references public.organization_memberships (organization_id, id, user_id),
  foreign key (organization_id, membership_id, profile_id)
    references public.organization_member_profiles (organization_id, membership_id, id)
);

alter table staging_private.retained_membership_receipts enable row level security;
revoke all on table staging_private.retained_membership_receipts
  from public, anon, authenticated, service_role, supabase_auth_admin;
create trigger immutable_retained_membership_receipt before update or delete or truncate
  on staging_private.retained_membership_receipts for each statement
  execute function staging_private.reject_student_receipt_change();

commit;
