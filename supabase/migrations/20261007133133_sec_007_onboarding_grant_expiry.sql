begin;

-- SEC-007: revalidate grant expiry after the organization and grant locks.
-- CREATE OR REPLACE preserves the existing function signature and execution grants.
create or replace function public.complete_first_organization_admin_bootstrap(
  p_actor_user_id uuid,
  p_actor_subject_id uuid,
  p_session_id uuid,
  p_password_authenticated_at bigint,
  p_assurance_level text,
  p_authentication_methods text[],
  p_verified_totp_factor_id uuid,
  p_total_factor_count integer,
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
  v_admin_role_id uuid;
  v_membership_id uuid;
  v_password_time timestamptz;
  v_grant_check_at timestamptz;
begin
  if p_actor_user_id is null
     or p_actor_subject_id is null
     or p_actor_user_id <> p_actor_subject_id
     or p_session_id is null
     or p_password_authenticated_at is null
     or p_assurance_level <> 'aal2'
     or p_authentication_methods is null
     or cardinality(p_authentication_methods) not between 1 and 16
     or array_position(p_authentication_methods, null) is not null
     or not ('password' = any(p_authentication_methods))
     or not ('totp' = any(p_authentication_methods))
     or p_verified_totp_factor_id is null
     or p_total_factor_count <> 1
     or p_bootstrap_grant_id is null
     or p_expected_version is null
     or p_expected_version < 1
     or p_idempotency_key_hash is null
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception using errcode = '22023', message = 'Onboarding completion input is invalid.';
  end if;

  v_password_time := to_timestamp(p_password_authenticated_at);
  if v_password_time > transaction_timestamp()
     or transaction_timestamp() - v_password_time > interval '600 seconds' then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.denied', 'denied',
      p_correlation_id, null, '{}'::uuid[], 'recent_authentication_required',
      p_bootstrap_grant_id, null, '{}'::jsonb
    );
    return jsonb_build_object(
      'decision', 'recent_authentication_required',
      'correlationId', p_correlation_id
    );
  end if;

  select organization_id into v_organization_id
  from public.organization_admin_bootstrap_grants
  where id = p_bootstrap_grant_id;

  if v_organization_id is null then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.denied', 'denied',
      p_correlation_id, null, '{}'::uuid[], 'grant_not_available',
      null, null, '{}'::jsonb
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
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.denied', 'denied',
      p_correlation_id, null, '{}'::uuid[], 'grant_not_available',
      null, null, '{}'::jsonb
    );
    return jsonb_build_object('decision', 'not_available', 'correlationId', p_correlation_id);
  end if;

  if v_organization_name is null
     or v_organization_status <> 'active'
     or v_grant.organization_id <> v_organization_id then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'organization_state_conflict', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  if v_grant.status = 'completed' then
    if v_grant.completion_idempotency_key_hash = p_idempotency_key_hash then
      return jsonb_build_object(
        'decision', 'already_completed',
        'bootstrapGrantId', v_grant.id,
        'organizationId', v_grant.organization_id,
        'organizationName', v_organization_name,
        'membershipId', v_grant.completed_membership_id,
        'grantVersion', v_grant.version,
        'correlationId', p_correlation_id
      );
    end if;

    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'completed_grant_conflict', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  -- Eligibility expires during a lock wait; transaction time cannot extend it.
  -- Password freshness intentionally retains the approved transaction-time rule.
  v_grant_check_at := clock_timestamp();
  if v_grant.status <> 'pending'
     or v_grant.version <> p_expected_version
     or v_grant_check_at >= v_grant.expires_at then
    if v_grant.status = 'pending' and v_grant_check_at >= v_grant.expires_at then
      update public.organization_admin_bootstrap_grants
      set status = 'expired', version = version + 1
      where id = v_grant.id;
      perform public.write_admin_onboarding_event(
        p_actor_user_id, p_actor_subject_id, 'admin_onboarding.grant_expired', 'denied',
        p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
        'grant_expired', v_grant.id, null,
        jsonb_build_object('grantVersion', v_grant.version + 1)
      );
      return jsonb_build_object('decision', 'expired', 'correlationId', p_correlation_id);
    end if;

    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'grant_state_conflict', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
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
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'active_admin_exists', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  if exists (
    select 1
    from public.organization_memberships
    where organization_id = v_grant.organization_id
      and user_id = p_actor_user_id
  ) then
    perform public.write_admin_onboarding_event(
      p_actor_user_id, p_actor_subject_id, 'admin_onboarding.conflict', 'denied',
      p_correlation_id, v_grant.organization_id, array[v_grant.organization_id],
      'membership_state_conflict', v_grant.id, null,
      jsonb_build_object('grantVersion', v_grant.version)
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
  end if;

  select id into v_admin_role_id
  from public.roles
  where code = 'admin'
    and is_active;

  if v_admin_role_id is null then
    raise exception using errcode = '23514', message = 'The admin role is unavailable.';
  end if;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    status,
    created_by,
    updated_by
  )
  values (
    v_grant.organization_id,
    p_actor_user_id,
    'active',
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_membership_id;

  insert into public.membership_roles (
    organization_id,
    membership_id,
    role_id,
    assigned_by
  )
  values (
    v_grant.organization_id,
    v_membership_id,
    v_admin_role_id,
    p_actor_user_id
  );

  update public.organization_admin_bootstrap_grants
  set status = 'completed',
      version = version + 1,
      completed_at = transaction_timestamp(),
      completed_membership_id = v_membership_id,
      completion_idempotency_key_hash = p_idempotency_key_hash
  where id = v_grant.id;

  perform public.write_admin_onboarding_event(
    p_actor_user_id,
    p_actor_subject_id,
    'admin_onboarding.completed',
    'success',
    p_correlation_id,
    v_grant.organization_id,
    array[v_grant.organization_id],
    'first_admin_created',
    v_grant.id,
    null,
    jsonb_build_object(
      'grantVersion', v_grant.version + 1,
      'membershipId', v_membership_id,
      'assuranceLevel', p_assurance_level,
      'authenticationMethods', to_jsonb(p_authentication_methods),
      'factorCount', p_total_factor_count
    )
  );

  return jsonb_build_object(
    'decision', 'completed',
    'bootstrapGrantId', v_grant.id,
    'organizationId', v_grant.organization_id,
    'organizationName', v_organization_name,
    'membershipId', v_membership_id,
    'grantVersion', v_grant.version + 1,
    'correlationId', p_correlation_id
  );
end;
$$;

commit;
