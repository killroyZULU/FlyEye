-- SEC-027: revalidate captured recipient identity under an Auth row lock.
-- Preserve current-email accepted replay and atomic uniqueness-conflict audit.

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
  v_confirmed_identity boolean;
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

  -- Serialize current confirmed identity before domain locks and any authority writes.
  select email_confirmed_at is not null and lower(btrim(email)) = v_email_canonical
  into v_confirmed_identity from auth.users where id = p_actor_user_id for share;

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

  if not coalesce(v_confirmed_identity, false)
     or v_invitation.email_canonical <> v_email_canonical
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
  v_confirmed_identity boolean;
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

  -- Serialize current confirmed identity before domain locks and any authority writes.
  select email_confirmed_at is not null and lower(btrim(email)) = v_email
  into v_confirmed_identity from auth.users where id = p_actor_user_id for share;

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

  if coalesce(v_confirmed_identity, false)
     and v_invitation.status = 'accepted'
     and v_invitation.accepted_by = p_actor_user_id
     and v_invitation.acceptance_idempotency_key_hash = p_idempotency_key_hash then
    return jsonb_build_object(
      'decision', 'accepted', 'organizationId', v_invitation.organization_id,
      'membershipId', v_invitation.accepted_membership_id,
      'invitationId', v_invitation.id, 'version', v_invitation.version,
      'replayed', true, 'correlationId', p_correlation_id
    );
  end if;

  if not coalesce(v_confirmed_identity, false)
     or v_organization_status <> 'active' or v_invitation.status <> 'pending'
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
    -- The exception subtransaction has rolled back all partial authority writes.
    perform public.record_member_invitation_denial(
      p_actor_user_id, 'member_invitation.conflicted', 'membership_state_conflict', p_correlation_id,
      v_organization_id, p_invitation_id
    );
    return jsonb_build_object('decision', 'conflict', 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.accept_member_invitation(uuid, text, bigint, uuid, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.accept_member_invitation(uuid, text, bigint, uuid, bigint, text, uuid)
  to service_role;
