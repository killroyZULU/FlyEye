begin;

do $$
begin
  if (select count(*) from public.organizations) > 1 then
    raise exception using
      errcode = '23514',
      message = 'Single-school deployment requires at most one organization.';
  end if;

  if exists (
    select 1
    from public.organization_memberships
    group by user_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23514',
      message = 'Single-school deployment requires at most one membership per user.';
  end if;
end;
$$;

alter table public.organizations
  add column deployment_slot smallint not null default 1,
  add constraint organizations_single_school_deployment_slot_check
    check (deployment_slot = 1) not valid;

alter table public.organizations
  validate constraint organizations_single_school_deployment_slot_check;

alter table public.organizations
  add constraint organizations_single_school_deployment_key
    unique (deployment_slot) deferrable initially immediate;

alter table public.organization_memberships
  add constraint organization_memberships_single_school_user_key
    unique (user_id) deferrable initially immediate;

alter table public.authentication_events
  add constraint authentication_events_single_school_context_check
    check (cardinality(organization_ids) <= 1) not valid;

alter table public.authentication_events
  validate constraint authentication_events_single_school_context_check;

comment on constraint organizations_single_school_deployment_key on public.organizations is
  'Enforces exactly zero or one configured school record per isolated FlyEye deployment.';

comment on constraint organization_memberships_single_school_user_key on public.organization_memberships is
  'Prevents an account from holding multiple school memberships inside one deployment.';

commit;
