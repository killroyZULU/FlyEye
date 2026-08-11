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

  perform public.write_member_administration_event(
    p_organization_id, p_actor_user_id, null,
    'member_directory.listed', 'success', 'member_directory_listed', p_correlation_id,
    null,
    jsonb_build_object('resultCount', v_count, 'statusFiltered', p_status is not null, 'searchApplied', v_search is not null)
  );

  return jsonb_build_object(
    'decision', 'listed',
    'organizationId', p_organization_id,
    'members', v_members,
    'hasMore', v_has_more,
    'correlationId', p_correlation_id
  ) || case when v_has_more then jsonb_build_object(
    'nextCreatedAt', v_next_created_at,
    'nextMembershipId', v_next_membership_id
  ) else '{}'::jsonb end;
end;
$$;

comment on function public.list_organization_members(uuid, uuid, uuid, text, text, timestamptz, uuid, integer)
is 'Returns an audited tenant-scoped member directory while preserving required nullable profile fields.';
