begin;

-- Nonhuman provenance for the single disposable Student slot. No callable writer.
create table staging_private.student_fixture_receipts (
  operation_id uuid primary key,
  attempt_id uuid not null unique,
  run_id uuid not null unique,
  target text not null check (target = 'flyeye-nosend-p3d1'),
  instance_digest text not null check (instance_digest ~ '^[0-9a-f]{64}$'),
  database_system_id text not null check (database_system_id ~ '^[0-9]{1,20}$'),
  event_name text not null check (event_name = 'fixture.local_student_established'),
  role_code text not null check (role_code = 'student_pilot'),
  organization_id uuid not null check (organization_id = '00000000-0000-4000-8000-000000000099'),
  user_id uuid not null unique references auth.users(id),
  membership_id uuid not null unique,
  profile_id uuid not null unique references public.organization_member_profiles(id),
  occurred_at timestamptz not null default transaction_timestamp(),
  unique (organization_id, role_code),
  foreign key (organization_id, membership_id)
    references public.organization_memberships(organization_id, id)
);
alter table staging_private.student_fixture_receipts enable row level security;
revoke all on table staging_private.student_fixture_receipts
  from public, anon, authenticated, service_role, supabase_auth_admin;

create function staging_private.reject_student_receipt_change() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'Student fixture receipts are append-only.';
end;
$$;
revoke all on function staging_private.reject_student_receipt_change()
  from public, anon, authenticated, service_role, supabase_auth_admin;
create trigger immutable_student_fixture_receipt before update or delete or truncate
  on staging_private.student_fixture_receipts for each statement
  execute function staging_private.reject_student_receipt_change();

commit;
