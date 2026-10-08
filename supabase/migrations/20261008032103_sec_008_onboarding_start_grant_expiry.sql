-- Recheck grant expiry after START's explicit row locks, before new/replay readiness.
create or replace function public.start_organization_admin_onboarding(
  p_actor_user_id uuid,
  p_bootstrap_grant_id uuid,
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
  v_organization_id uuid;
  v_organization_name text;
  v_organization_status text;
  v_grant public.organization_admin_bootstrap_grants%rowtype;
  v_replay boolean;
  v_grant_check_at timestamptz;
begin
  if p_actor_user_id is null
     or p_bootstrap_grant_id is null
     or p_expected_version is null
     or p_expected_version < 1
     or p_idempotency_key_hash is null
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception using errcode = '22023', message = 'Onboarding start input is invalid.';
  end if;

  select organization_id into v_organization_id
  from public.organization_admin_bootstrap_grants
  where id = p_bootstrap_grant_id;

  if v_organization_id is null then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_user_id, 'admin_onboarding.denied', 'denied',
      p_correlation_id, null, '{}'::uuid[], 'grant_not_available', null, null, '{}'::jsonb
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  select name, status into v_organization_name, v_organization_status
  from public.organizations
  where id = v_organization_id
  for update;

  select * into v_grant
  from public.organization_admin_bootstrap_grants
  where id = p_bootstrap_grant_id
  for update;

  if v_grant.eligible_user_id <> p_actor_user_id then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_user_id, 'admin_onboarding.denied', 'denied',
      p_correlation_id, null, '{}'::uuid[], 'grant_not_available', null, null, '{}'::jsonb
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  v_grant_check_at := clock_timestamp();

  if v_grant.organization_id <> v_organization_id
     or v_organization_name is null
     or v_organization_status <> 'active'
     or v_grant.status <> 'pending'
     or v_grant.version <> p_expected_version
     or v_grant_check_at >= v_grant.expires_at then
    if v_grant.status = 'pending' and v_grant_check_at >= v_grant.expires_at then
      update public.organization_admin_bootstrap_grants
      set status = 'expired', version = version + 1
      where id = v_grant.id;
      perform public.write_admin_onboarding_event(
        p_actor_user_id, p_actor_user_id, 'admin_onboarding.grant_expired', 'denied',
        p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
        'grant_expired', v_grant.id, null,
        jsonb_build_object('grantVersion', v_grant.version + 1)
      );
      return jsonb_build_object('decision', 'expired', 'correlationId', p_correlation_id);
    end if;

    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_user_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'grant_state_conflict', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  select exists (
    select 1
    from public.authentication_events
    where actor_subject_id = p_actor_user_id
      and event_name = 'admin_onboarding.started'
      and target_id = p_bootstrap_grant_id
      and idempotency_key_hash = p_idempotency_key_hash
  ) into v_replay;

  if v_replay then
    return jsonb_build_object(
      'decision', 'ready',
      'bootstrapGrantId', v_grant.id,
      'organizationId', v_grant.organization_id,
      'organizationName', v_organization_name,
      'grantVersion', v_grant.version,
      'replayed', true,
      'correlationId', p_correlation_id
    );
  end if;

  if exists (
    select 1
    from public.organization_memberships membership
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role
      on role.id = membership_role.role_id
     and role.code = 'admin'
     and role.is_active
    where membership.organization_id = v_grant.organization_id
      and membership.status = 'active'
  ) then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_user_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'active_admin_exists', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  perform public.write_admin_onboarding_event(
    p_actor_user_id,
    p_actor_user_id,
    'admin_onboarding.started',
    'success',
    p_correlation_id,
    v_grant.organization_id,
    array[v_grant.organization_id],
    'onboarding_started',
    v_grant.id,
    p_idempotency_key_hash,
    jsonb_build_object('grantVersion', v_grant.version)
  );

  return jsonb_build_object(
    'decision', 'ready',
    'bootstrapGrantId', v_grant.id,
    'organizationId', v_grant.organization_id,
    'organizationName', v_organization_name,
    'grantVersion', v_grant.version,
    'replayed', false,
    'correlationId', p_correlation_id
  );
end;
$$;
