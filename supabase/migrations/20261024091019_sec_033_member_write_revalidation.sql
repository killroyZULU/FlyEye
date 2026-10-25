begin;

-- Preserve mandatory audit errors; only the fresh-authority signal is handled.
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
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.notification.read'
  ) or not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id and membership.id = p_membership_id
      and membership.user_id = p_actor_user_id and membership.status = 'active'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
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
  -- Implicit domain/audit waits can outlive the earlier authority check.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.notification.read'
  ) or not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id and membership.id = p_membership_id
      and membership.user_id = p_actor_user_id and membership.status = 'active'
  ) then
    raise exception using errcode = 'P7306', message = 'Notification authority changed during write.';
  end if;

  return jsonb_build_object(
    'decision', 'opened', 'notificationId', v_notification.id,
    'documentId', v_notification.aircraft_document_id,
    'state', v_notification.notification_state, 'correlationId', p_correlation_id
  );
exception
  when sqlstate 'P7306' then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
end;
$$;

create or replace function public.update_my_member_profile(
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_display_name text,
  p_contact_number text,
  p_expected_version bigint,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_display_name text := btrim(p_display_name);
  v_contact_number text := nullif(btrim(p_contact_number), '');
  v_profile public.organization_member_profiles%rowtype;
  v_organization_name text;
  v_email text;
  v_role_code text;
  v_role_label text;
  v_changed_fields jsonb := '[]'::jsonb;
begin
  if p_actor_user_id is null
     or p_membership_id is null
     or p_display_name is null
     or p_expected_version is null
     or p_correlation_id is null
     or char_length(v_display_name) not between 2 and 80
     or (v_contact_number is not null and (
       char_length(v_contact_number) > 32 or v_contact_number !~ '^[0-9 +().-]+$'
     ))
     or p_expected_version < 1 then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  select profile.*
  into v_profile
  from public.organization_member_profiles profile
  join public.organization_memberships membership
    on membership.organization_id = profile.organization_id
   and membership.id = profile.membership_id
   and membership.status = 'active'
   and membership.user_id = p_actor_user_id
  join public.membership_roles membership_role
    on membership_role.organization_id = membership.organization_id
   and membership_role.membership_id = membership.id
  join public.roles role
    on role.id = membership_role.role_id
   and role.is_active = true
  join public.organizations organization
    on organization.id = membership.organization_id
   and organization.status = 'active'
  where profile.membership_id = p_membership_id
  for update of profile;

  if not found then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  -- The joined locking read only locks the profile; reload authority after its wait.
  if not exists (
    select 1 from public.organization_memberships membership
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.is_active
    join public.organizations organization
      on organization.id = membership.organization_id and organization.status = 'active'
    where membership.id = p_membership_id and membership.user_id = p_actor_user_id
      and membership.organization_id = v_profile.organization_id and membership.status = 'active'
  ) then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  if v_profile.version <> p_expected_version then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;

  if v_profile.display_name is distinct from v_display_name then
    v_changed_fields := v_changed_fields || '"displayName"'::jsonb;
  end if;
  if v_profile.contact_number is distinct from v_contact_number then
    v_changed_fields := v_changed_fields || '"contactNumber"'::jsonb;
  end if;

  update public.organization_member_profiles
  set display_name = v_display_name,
      contact_number = v_contact_number,
      version = version + 1,
      updated_at = now(),
      updated_by = p_actor_user_id
  where id = v_profile.id
  returning * into v_profile;

  select organization.name, auth_user.email, role.code, role.display_name
  into v_organization_name, v_email, v_role_code, v_role_label
  from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
  join auth.users auth_user on auth_user.id = membership.user_id
  join public.membership_roles membership_role
    on membership_role.organization_id = membership.organization_id
   and membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id
  where membership.id = p_membership_id;

  perform public.write_member_administration_event(
    v_profile.organization_id, p_actor_user_id, p_membership_id,
    'member_profile.updated', 'success', 'member_profile_updated', p_correlation_id,
    null,
    jsonb_build_object('changedFields', v_changed_fields, 'priorVersion', p_expected_version, 'newVersion', v_profile.version)
  );

  -- Implicit domain/audit waits can outlive the earlier authority check.
  if not exists (
    select 1 from public.organization_memberships membership
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.is_active
    join public.organizations organization
      on organization.id = membership.organization_id and organization.status = 'active'
    where membership.id = p_membership_id and membership.user_id = p_actor_user_id
      and membership.organization_id = v_profile.organization_id and membership.status = 'active'
  ) then
    raise exception using errcode = 'P7306', message = 'Profile authority changed during write.';
  end if;

  return jsonb_build_object(
    'decision', 'updated',
    'profile', jsonb_build_object(
      'organizationId', v_profile.organization_id,
      'organizationName', v_organization_name,
      'membershipId', v_profile.membership_id,
      'displayName', v_profile.display_name,
      'contactNumber', v_profile.contact_number,
      'email', v_email,
      'roleCode', v_role_code,
      'roleLabel', v_role_label,
      'status', 'active',
      'version', v_profile.version,
      'complete', true
    ),
    'correlationId', p_correlation_id
  );
exception
  when sqlstate 'P7306' then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
end;
$$;

commit;
