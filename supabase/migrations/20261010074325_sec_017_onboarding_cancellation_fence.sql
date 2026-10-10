begin;

-- SEC-017: serialize accepted cancellation with bootstrap completion.
-- CREATE OR REPLACE preserves the signature, ownership and existing execution grants.
create or replace function public.cancel_organization_admin_onboarding(
  p_actor_user_id uuid,
  p_bootstrap_grant_id uuid,
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
  v_grant public.organization_admin_bootstrap_grants%rowtype;
begin
  if p_actor_user_id is null
     or p_bootstrap_grant_id is null
     or p_idempotency_key_hash is null
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception using errcode = '22023', message = 'Onboarding cancel input is invalid.';
  end if;

  select organization_id into v_organization_id
  from public.organization_admin_bootstrap_grants
  where id = p_bootstrap_grant_id
    and eligible_user_id = p_actor_user_id;

  if v_organization_id is null then
    return jsonb_build_object(
      'decision', 'not_available',
      'cleanupOutcome', 'not_attempted',
      'correlationId', p_correlation_id
    );
  end if;

  -- Match start/completion lock order, including the audit's organization FK.
  perform 1 from public.organizations
  where id = v_organization_id
  for update;

  if not found then
    return jsonb_build_object(
      'decision', 'not_available',
      'cleanupOutcome', 'not_attempted',
      'correlationId', p_correlation_id
    );
  end if;

  select * into v_grant
  from public.organization_admin_bootstrap_grants
  where id = p_bootstrap_grant_id
    and eligible_user_id = p_actor_user_id
  for update;

  if v_grant.id is null or v_grant.organization_id <> v_organization_id then
    return jsonb_build_object(
      'decision', 'not_available',
      'cleanupOutcome', 'not_attempted',
      'correlationId', p_correlation_id
    );
  end if;

  if exists (
    select 1
    from public.authentication_events
    where actor_subject_id = p_actor_user_id
      and event_name = 'admin_onboarding.cancelled'
      and target_id = p_bootstrap_grant_id
      and idempotency_key_hash = p_idempotency_key_hash
  ) then
    return jsonb_build_object(
      'decision', 'cancelled',
      'cleanupOutcome', 'not_attempted',
      'replayed', true,
      'correlationId', p_correlation_id
    );
  end if;

  -- A committed cancellation invalidates outstanding completion versions.
  -- Replays and completed/terminal grants must retain their exact state.
  if v_grant.status = 'pending' then
    update public.organization_admin_bootstrap_grants
    set version = version + 1
    where id = v_grant.id
    returning * into v_grant;
  end if;

  perform public.write_admin_onboarding_event(
    p_actor_user_id,
    p_actor_user_id,
    'admin_onboarding.cancelled',
    'success',
    p_correlation_id,
    v_grant.organization_id,
    array[v_grant.organization_id],
    'onboarding_cancelled',
    v_grant.id,
    p_idempotency_key_hash,
    jsonb_build_object(
      'grantVersion', v_grant.version,
      'cleanupOutcome', 'not_attempted'
    )
  );

  return jsonb_build_object(
    'decision', 'cancelled',
    'cleanupOutcome', 'not_attempted',
    'replayed', false,
    'correlationId', p_correlation_id
  );
end;
$$;

commit;
