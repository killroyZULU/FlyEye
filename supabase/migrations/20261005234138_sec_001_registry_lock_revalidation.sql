begin;

-- SEC-001 / H002: preserve grants, signatures and mutation/audit atomicity.
create or replace function public.mutate_aircraft_record(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_action text,
  p_record_id uuid,
  p_registration_mark text,
  p_registration_key text,
  p_manufacturer text,
  p_model text,
  p_reason text,
  p_expected_version bigint,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_record public.aircraft_records%rowtype;
  v_prior public.aircraft_records%rowtype;
  v_existing public.aircraft_registry_idempotency%rowtype;
  v_result jsonb;
  v_event_name text;
  v_decision text;
  v_metadata jsonb;
begin
  if p_action not in ('create', 'update', 'archive', 'reactivate')
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_correlation_id is null
     or (p_action = 'create' and (p_record_id is not null or p_expected_version is not null))
     or (p_action <> 'create' and (p_record_id is null or p_expected_version is null or p_expected_version < 1)) then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not public.aircraft_registry_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.record.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key_hash, 0
  ));
  -- A separate statement obtains current authorization after the lock wait.
  if not public.aircraft_registry_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.record.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  select * into v_existing
  from public.aircraft_registry_idempotency item
  where item.organization_id = p_organization_id
    and item.actor_user_id = p_actor_user_id
    and item.idempotency_key_hash = p_idempotency_key_hash;
  if found then
    if v_existing.action = p_action
       and (p_action = 'create' or v_existing.target_record_id is not distinct from p_record_id)
       and v_existing.expected_version is not distinct from p_expected_version
       and v_existing.request_hash = p_request_hash then
      return v_existing.result || jsonb_build_object('replayed', true, 'correlationId', p_correlation_id);
    end if;
    return jsonb_build_object('decision', 'idempotency_conflict', 'correlationId', p_correlation_id);
  end if;

  begin
    if p_action in ('create', 'update') then
      if p_registration_mark is null or p_registration_key is null
         or p_manufacturer is null or p_model is null or p_reason is not null
         or p_registration_mark <> btrim(p_registration_mark)
         or p_registration_mark ~ '[a-z]'
         or char_length(p_registration_mark) not between 1 and 32
         or char_length(p_registration_key) not between 1 and 96
         or p_manufacturer <> btrim(p_manufacturer)
         or char_length(p_manufacturer) not between 1 and 100
         or p_model <> btrim(p_model)
         or char_length(p_model) not between 1 and 100 then
        return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
      end if;
    elsif p_registration_mark is not null or p_registration_key is not null
       or p_manufacturer is not null or p_model is not null then
      return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
    end if;

    if p_action = 'create' then
      insert into public.aircraft_records (
        organization_id, registration_mark, registration_key, manufacturer, model,
        created_by, updated_by
      ) values (
        p_organization_id, p_registration_mark, p_registration_key, p_manufacturer, p_model,
        p_actor_user_id, p_actor_user_id
      ) returning * into v_record;
      v_event_name := 'aircraft_record.created';
      v_decision := 'created';
      v_metadata := jsonb_build_object(
        'priorVersion', null, 'newVersion', 1, 'registryState', 'tracked',
        'registrationMark', v_record.registration_mark,
        'manufacturer', v_record.manufacturer,
        'model', v_record.model
      );
    else
      select * into v_record
      from public.aircraft_records record
      where record.organization_id = p_organization_id and record.id = p_record_id
      for update;
      if not found then
        perform public.write_aircraft_registry_event(
          p_organization_id, p_actor_user_id, null, 'aircraft_registry.denied', 'denied',
          'not_found', p_correlation_id, null, jsonb_build_object('action', p_action)
        );
        return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
      end if;
      -- The record lock can wait independently of the idempotency lock.
      if not public.aircraft_registry_actor_is_authorized(
        p_actor_user_id, p_organization_id, 'aircraft.record.manage'
      ) then
        return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
      end if;
      if v_record.version <> p_expected_version then
        return jsonb_build_object('decision', 'version_conflict', 'correlationId', p_correlation_id);
      end if;
      v_prior := v_record;

      if p_action = 'update' then
        if v_record.registry_state <> 'tracked' then
          return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
        end if;
        update public.aircraft_records
        set registration_mark = p_registration_mark,
            registration_key = p_registration_key,
            manufacturer = p_manufacturer,
            model = p_model,
            version = version + 1,
            updated_at = now(),
            updated_by = p_actor_user_id
        where id = v_record.id
        returning * into v_record;
        v_event_name := 'aircraft_record.updated';
        v_decision := 'updated';
        v_metadata := jsonb_build_object(
          'priorVersion', v_prior.version, 'newVersion', v_record.version,
          'registryState', v_record.registry_state,
          'before', jsonb_build_object(
            'registrationMark', v_prior.registration_mark,
            'manufacturer', v_prior.manufacturer,
            'model', v_prior.model
          ),
          'after', jsonb_build_object(
            'registrationMark', v_record.registration_mark,
            'manufacturer', v_record.manufacturer,
            'model', v_record.model
          )
        );
      elsif p_action = 'archive' then
        if v_record.registry_state <> 'tracked' then
          return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
        end if;
        if p_reason is null
           or p_reason not in ('no_longer_tracked', 'duplicate_record', 'created_in_error') then
          return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
        end if;
        update public.aircraft_records
        set registry_state = 'archived',
            archive_reason = p_reason,
            archived_at = now(),
            archived_by = p_actor_user_id,
            version = version + 1,
            updated_at = now(),
            updated_by = p_actor_user_id
        where id = v_record.id
        returning * into v_record;
        v_event_name := 'aircraft_record.archived';
        v_decision := 'archived';
        v_metadata := jsonb_build_object(
          'priorVersion', v_prior.version, 'newVersion', v_record.version,
          'priorState', 'tracked', 'newState', 'archived', 'reason', p_reason
        );
      else
        if v_record.registry_state <> 'archived' then
          return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
        end if;
        if p_reason is null or p_reason not in ('tracking_resumed', 'archive_incorrect') then
          return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
        end if;
        update public.aircraft_records
        set registry_state = 'tracked',
            archive_reason = null,
            archived_at = null,
            archived_by = null,
            version = version + 1,
            updated_at = now(),
            updated_by = p_actor_user_id
        where id = v_record.id
        returning * into v_record;
        v_event_name := 'aircraft_record.reactivated';
        v_decision := 'reactivated';
        v_metadata := jsonb_build_object(
          'priorVersion', v_prior.version, 'newVersion', v_record.version,
          'priorState', 'archived', 'newState', 'tracked', 'reason', p_reason
        );
      end if;
    end if;

    perform public.write_aircraft_registry_event(
      p_organization_id, p_actor_user_id, v_record.id, v_event_name, 'success',
      coalesce(p_reason, v_decision), p_correlation_id, p_idempotency_key_hash, v_metadata
    );
    v_result := jsonb_build_object(
      'decision', v_decision,
      'record', public.aircraft_record_summary(v_record),
      'replayed', false
    );
    insert into public.aircraft_registry_idempotency (
      organization_id, actor_user_id, idempotency_key_hash, action,
      target_record_id, expected_version, request_hash, result
    ) values (
      p_organization_id, p_actor_user_id, p_idempotency_key_hash, p_action,
      v_record.id, p_expected_version, p_request_hash, v_result
    );
  exception when unique_violation then
    perform public.write_aircraft_registry_event(
      p_organization_id, p_actor_user_id, null, 'aircraft_registry.conflicted', 'conflict',
      'duplicate_registration', p_correlation_id, null, jsonb_build_object('action', p_action)
    );
    return jsonb_build_object('decision', 'duplicate_registration', 'correlationId', p_correlation_id);
  end;

  return v_result || jsonb_build_object('correlationId', p_correlation_id);
end;
$$;

revoke all on function public.mutate_aircraft_record(uuid, uuid, text, uuid, text, text, text, text, text, bigint, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mutate_aircraft_record(uuid, uuid, text, uuid, text, text, text, text, text, bigint, text, text, uuid)
  to service_role;


commit;
