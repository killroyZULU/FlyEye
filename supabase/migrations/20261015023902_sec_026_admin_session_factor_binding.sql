begin;

-- Identity/session metadata, not a school-owned record. A missing row means
-- unknown history. Never backfill a current factor as an original factor.
create table public.admin_session_factor_bindings (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  factor_id uuid
);
create index admin_session_factor_bindings_actor_idx
  on public.admin_session_factor_bindings(actor_user_id);
alter table public.admin_session_factor_bindings enable row level security;
revoke all on public.admin_session_factor_bindings from public, anon, authenticated, service_role;
comment on column public.admin_session_factor_bindings.factor_id is
  'Immutable first factor context; deliberately retained after factor deletion.';

create function public.capture_admin_session_factor()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
  v_factor_id uuid;
  v_unverified boolean;
begin
  if tg_op = 'INSERT' then
    select count(*),
      (array_agg(id) filter (where factor_type = 'totp' and status = 'verified'))[1],
      bool_and(factor_type = 'totp' and status = 'unverified')
    into v_count, v_factor_id, v_unverified
    from auth.mfa_factors where user_id = new.user_id;
    if v_count > 1 then return new; end if;
    if v_count = 1 and v_factor_id is null and not v_unverified then return new; end if;
    insert into public.admin_session_factor_bindings(session_id, actor_user_id, factor_id)
    values(new.id, new.user_id, coalesce(new.factor_id, v_factor_id));
  elsif new.factor_id is not null then
    -- UPDATE cannot create provenance for pre-migration or missing rows.
    update public.admin_session_factor_bindings set factor_id = new.factor_id
    where session_id = new.id and actor_user_id = new.user_id and factor_id is null;
  end if;
  return new;
end;
$$;
revoke all on function public.capture_admin_session_factor() from public, anon, authenticated, service_role;
create trigger capture_admin_session_factor
after insert or update of factor_id on auth.sessions
for each row execute function public.capture_admin_session_factor();

create function public.validate_admin_session_factor(
  p_actor_user_id uuid,
  p_session_id uuid,
  p_factor_id uuid,
  p_require_aal2 boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_binding public.admin_session_factor_bindings%rowtype;
  v_session auth.sessions%rowtype;
  v_count integer;
  v_matching boolean;
begin
  if p_actor_user_id is null or p_session_id is null or p_require_aal2 is null then
    return false;
  end if;
  -- Only the child binding is locked. Never request an Auth parent lock after
  -- this lock: provider writes lock their session before invoking the trigger.
  select * into v_binding from public.admin_session_factor_bindings
  where session_id = p_session_id and actor_user_id = p_actor_user_id for update;
  if not found then return false; end if;
  select * into v_session from auth.sessions
  where id = p_session_id and user_id = p_actor_user_id;
  if not found or (v_session.not_after is not null and v_session.not_after <= clock_timestamp())
     or not exists (select 1 from auth.mfa_amr_claims
       where session_id = p_session_id and authentication_method = 'password') then
    return false;
  end if;
  select count(*), coalesce(bool_or(id = p_factor_id and factor_type = 'totp' and status = 'verified'),false)
  into v_count, v_matching from auth.mfa_factors where user_id = p_actor_user_id;
  if p_factor_id is null then
    return not p_require_aal2 and v_count = 0 and v_binding.factor_id is null
      and v_session.factor_id is null;
  end if;
  if v_count <> 1 or not v_matching then return false; end if;
  if v_binding.factor_id is not null and v_binding.factor_id <> p_factor_id then
    return false;
  end if;
  if p_require_aal2 and (
    v_session.aal is distinct from 'aal2' or v_session.factor_id is distinct from p_factor_id
    or not exists (select 1 from auth.mfa_amr_claims
      where session_id = p_session_id and authentication_method = 'totp')
  ) then return false; end if;
  if v_binding.factor_id is null then
    -- Restrictive first-use binding also captures AAL1 START before verification.
    update public.admin_session_factor_bindings set factor_id = p_factor_id
    where session_id = p_session_id and actor_user_id = p_actor_user_id and factor_id is null;
  end if;
  return true;
end;
$$;
revoke all on function public.validate_admin_session_factor(uuid,uuid,uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.validate_admin_session_factor(uuid,uuid,uuid,boolean)
  to service_role;

commit;
