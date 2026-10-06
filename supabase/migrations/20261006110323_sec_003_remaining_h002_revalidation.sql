begin;

-- SEC-003 / H002: corrections for the reproduced document and profile waits.
-- Preserve signatures, grants, lock order and the existing audit error behavior.

create or replace function public.mutate_aircraft_document(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_action text,
  p_aircraft_record_id uuid,
  p_category_id uuid,
  p_document_id uuid,
  p_expected_version bigint,
  p_document_title text,
  p_document_source text,
  p_reference_number text,
  p_issue_date date,
  p_expiration_date date,
  p_notes text,
  p_stored_file_id uuid,
  p_reason text,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_philippine_date date,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_aircraft public.aircraft_records%rowtype;
  v_category public.aircraft_document_categories%rowtype;
  v_document public.aircraft_documents%rowtype;
  v_prior_version public.aircraft_document_versions%rowtype;
  v_new_version public.aircraft_document_versions%rowtype;
  v_file public.stored_files%rowtype;
  v_existing public.aircraft_document_idempotency%rowtype;
  v_result jsonb;
  v_decision text;
  v_event_name text;
  v_prior_aggregate_version bigint;
  v_prior_document_state text;
  v_prior_file_hash text;
  v_new_file_hash text;
begin
  if p_action not in ('create', 'renew', 'correct', 'suspend', 'restore')
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_philippine_date is null or p_correlation_id is null
     or (p_action = 'create' and (p_document_id is not null or p_expected_version is not null))
     or (p_action <> 'create' and (p_document_id is null or p_expected_version is null
       or p_expected_version < 1)) then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key_hash, 0
  ));
  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;

  select * into v_existing
  from public.aircraft_document_idempotency item
  where item.organization_id = p_organization_id
    and item.actor_user_id = p_actor_user_id
    and item.idempotency_key_hash = p_idempotency_key_hash;
  if found then
    if v_existing.action = p_action
       and (p_action = 'create' or v_existing.target_id is not distinct from p_document_id)
       and v_existing.expected_version is not distinct from p_expected_version
       and v_existing.request_hash = p_request_hash then
      return v_existing.result || jsonb_build_object('replayed', true, 'correlationId', p_correlation_id);
    end if;
    return jsonb_build_object('decision', 'idempotency_conflict', 'correlationId', p_correlation_id);
  end if;

  select * into v_aircraft
  from public.aircraft_records aircraft
  where aircraft.organization_id = p_organization_id and aircraft.id = p_aircraft_record_id
  for update;
  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;

  if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
  if v_aircraft.registry_state <> 'tracked' then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;
  select * into v_category
  from public.aircraft_document_categories category
  where category.organization_id = p_organization_id and category.id = p_category_id
  for update;
  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;

  if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
  if v_category.category_state <> 'active' or (
    v_category.category_kind = 'custom' and not exists (
      select 1 from public.aircraft_document_requirements requirement
      where requirement.organization_id = p_organization_id
        and requirement.aircraft_record_id = p_aircraft_record_id
        and requirement.category_id = p_category_id
        and requirement.requirement_state = 'active'
    )
  ) then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;

  if p_action in ('create', 'renew', 'correct') then
    if p_document_title is null or p_document_title <> btrim(p_document_title)
       or char_length(p_document_title) not between 1 and 160
       or p_document_source is null or p_document_source <> btrim(p_document_source)
       or char_length(p_document_source) not between 1 and 160
       or p_expiration_date is null
       or (p_reference_number is not null and (p_reference_number <> btrim(p_reference_number)
         or char_length(p_reference_number) not between 1 and 160))
       or (p_notes is not null and (p_notes <> btrim(p_notes)
         or char_length(p_notes) not between 1 and 500))
       or (p_action in ('renew', 'correct') and (p_reason is null
         or p_reason <> btrim(p_reason) or char_length(p_reason) not between 10 and 300)) then
      return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
    end if;
    if p_stored_file_id is not null then
      select * into v_file
      from public.stored_files file
      where file.organization_id = p_organization_id and file.id = p_stored_file_id
      for update;
  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;

      if not found or v_file.aircraft_record_id <> p_aircraft_record_id or v_file.scan_state <> 'clean'
         or exists (
           select 1 from public.aircraft_document_versions version
           where version.organization_id = p_organization_id and version.stored_file_id = v_file.id
         ) then
        return jsonb_build_object('decision', 'file_rejected', 'correlationId', p_correlation_id);
      end if;
    end if;
  elsif p_document_title is not null or p_document_source is not null
     or p_reference_number is not null or p_issue_date is not null
     or p_expiration_date is not null or p_notes is not null or p_stored_file_id is not null
     or p_reason is null or p_reason <> btrim(p_reason)
     or char_length(p_reason) not between 10 and 300 then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;

  if p_action = 'create' then
    if exists (
      select 1 from public.aircraft_documents document
      where document.organization_id = p_organization_id
        and document.aircraft_record_id = p_aircraft_record_id
        and document.category_id = p_category_id
    ) then
      return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
    end if;
    insert into public.aircraft_documents (
      organization_id, aircraft_record_id, category_id, created_by, updated_by
    ) values (
      p_organization_id, p_aircraft_record_id, p_category_id, p_actor_user_id, p_actor_user_id
    ) returning * into v_document;
    insert into public.aircraft_document_versions (
      organization_id, aircraft_document_id, version_number, version_kind,
      category_code, category_label, document_title, document_source,
      reference_number, issue_date, expiration_date, notes, stored_file_id,
      version_reason, created_by
    ) values (
      p_organization_id, v_document.id, 1, 'create',
      v_category.category_code, v_category.category_label, p_document_title, p_document_source,
      p_reference_number, p_issue_date, p_expiration_date, p_notes, p_stored_file_id,
      null, p_actor_user_id
    ) returning * into v_new_version;
    update public.aircraft_documents
    set current_version_id = v_new_version.id
    where id = v_document.id returning * into v_document;
    v_decision := 'created'; v_event_name := 'aircraft_document.created';
  else
    select * into v_document
    from public.aircraft_documents document
    where document.organization_id = p_organization_id and document.id = p_document_id
      and document.aircraft_record_id = p_aircraft_record_id
      and document.category_id = p_category_id
    for update;
  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;

    if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
    v_prior_aggregate_version := v_document.version;
    v_prior_document_state := v_document.document_state;
    if v_document.version <> p_expected_version then
      return jsonb_build_object('decision', 'version_conflict', 'correlationId', p_correlation_id);
    end if;
    select * into v_prior_version
    from public.aircraft_document_versions version
    where version.organization_id = p_organization_id and version.id = v_document.current_version_id
    for update;
  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;

    if v_prior_version.stored_file_id is not null then
      select file.sha256_hash into v_prior_file_hash
      from public.stored_files file
      where file.organization_id = p_organization_id
        and file.id = v_prior_version.stored_file_id;
    end if;

    if p_action in ('renew', 'correct') then
      if v_document.document_state = 'archived' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      insert into public.aircraft_document_versions (
        organization_id, aircraft_document_id, version_number, version_kind,
        category_code, category_label, document_title, document_source,
        reference_number, issue_date, expiration_date, notes, stored_file_id,
        version_reason, created_by
      ) values (
        p_organization_id, v_document.id, v_prior_version.version_number + 1,
        case when p_action = 'renew' then 'renewal' else 'correction' end,
        v_category.category_code, v_category.category_label, p_document_title, p_document_source,
        p_reference_number, p_issue_date, p_expiration_date, p_notes, p_stored_file_id,
        p_reason, p_actor_user_id
      ) returning * into v_new_version;
      update public.aircraft_documents
      set current_version_id = v_new_version.id, version = version + 1,
          updated_at = now(), updated_by = p_actor_user_id
      where id = v_document.id returning * into v_document;
      perform public.resolve_aircraft_document_notifications(
        p_organization_id, v_document.id, v_prior_version.id, null,
        'version_superseded', p_actor_user_id, p_correlation_id
      );
      v_decision := case when p_action = 'renew' then 'renewed' else 'corrected' end;
      v_event_name := case when p_action = 'renew' then 'aircraft_document.renewed'
        else 'aircraft_document.corrected' end;
    elsif p_action = 'suspend' then
      if v_document.document_state <> 'active' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      update public.aircraft_documents
      set document_state = 'suspended', suspension_reason = p_reason,
          suspended_at = now(), suspended_by = p_actor_user_id,
          version = version + 1, updated_at = now(), updated_by = p_actor_user_id
      where id = v_document.id returning * into v_document;
      perform public.resolve_aircraft_document_notifications(
        p_organization_id, v_document.id, null, null,
        'suspended', p_actor_user_id, p_correlation_id
      );
      v_new_version := v_prior_version;
      v_decision := 'suspended'; v_event_name := 'aircraft_document.suspended';
    else
      if v_document.document_state <> 'suspended' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      update public.aircraft_documents
      set document_state = 'active', suspension_reason = null,
          suspended_at = null, suspended_by = null,
          version = version + 1, updated_at = now(), updated_by = p_actor_user_id
      where id = v_document.id returning * into v_document;
      v_new_version := v_prior_version;
      v_decision := 'restored'; v_event_name := 'aircraft_document.restored';
    end if;
  end if;

  if v_new_version.stored_file_id is not null then
    select file.sha256_hash into v_new_file_hash
    from public.stored_files file
    where file.organization_id = p_organization_id
      and file.id = v_new_version.stored_file_id;
  end if;

  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'document', v_document.id,
    v_event_name, 'success', v_decision, p_correlation_id, p_idempotency_key_hash,
    jsonb_build_object(
      'priorAggregateVersion', v_prior_aggregate_version,
      'newAggregateVersion', v_document.version,
      'priorDocumentState', v_prior_document_state,
      'newDocumentState', v_document.document_state,
      'priorDocumentVersionId', v_prior_version.id,
      'newDocumentVersionId', v_new_version.id,
      'priorDocumentVersion', v_prior_version.version_number,
      'newDocumentVersion', v_new_version.version_number,
      'categoryCode', v_category.category_code,
      'expirationBefore', v_prior_version.expiration_date,
      'expirationAfter', v_new_version.expiration_date,
      'reason', p_reason,
      'attachmentBeforePresent', v_prior_version.stored_file_id is not null,
      'attachmentAfterPresent', v_new_version.stored_file_id is not null,
      'attachmentHashChanged', v_prior_file_hash is distinct from v_new_file_hash
    )
  );
  perform public.sync_aircraft_document_notifications(
    p_organization_id, v_document.id, v_new_version.id, p_philippine_date,
    p_actor_user_id, p_correlation_id
  );
  v_result := jsonb_build_object(
    'decision', v_decision,
    'documentId', v_document.id,
    'aggregateVersion', v_document.version,
    'documentState', v_document.document_state,
    'currentVersionId', v_new_version.id,
    'currentVersionNumber', v_new_version.version_number,
    'replayed', false
  );
  insert into public.aircraft_document_idempotency (
    organization_id, actor_user_id, idempotency_key_hash, action,
    target_id, expected_version, request_hash, result
  ) values (
    p_organization_id, p_actor_user_id, p_idempotency_key_hash, p_action,
    v_document.id, p_expected_version, p_request_hash, v_result
  );

  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;
  return v_result || jsonb_build_object('correlationId', p_correlation_id);
exception when sqlstate 'P7303' then
  -- The existing exception block rolls back earlier domain, notification and audit writes.
  return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
when unique_violation then
  return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
end;
$$;

create or replace function public.mutate_aircraft_document_category(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_action text,
  p_category_id uuid,
  p_aircraft_record_id uuid,
  p_expected_version bigint,
  p_category_label text,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_philippine_date date,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_category public.aircraft_document_categories%rowtype;
  v_requirement public.aircraft_document_requirements%rowtype;
  v_document public.aircraft_documents%rowtype;
  v_result jsonb;
  v_code text;
  v_decision text;
begin
  if p_action not in ('create_category', 'rename_category', 'archive_category', 'assign_category', 'remove_category')
     or p_idempotency_key_hash !~ '^[0-9a-f]{64}$' or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_philippine_date is null or p_correlation_id is null
     or (p_action = 'create_category' and (p_category_id is not null or p_expected_version is not null))
     or (p_action <> 'create_category' and (p_category_id is null or p_expected_version is null
       or p_expected_version < 1))
     or (p_action in ('assign_category', 'remove_category') and p_aircraft_record_id is null)
     or (p_action not in ('assign_category', 'remove_category') and p_aircraft_record_id is not null)
     or (p_action in ('create_category', 'rename_category') and (
       p_category_label is null or p_category_label <> btrim(p_category_label)
       or char_length(p_category_label) not between 1 and 120))
     or (p_action not in ('create_category', 'rename_category') and p_category_label is not null) then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.category.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key_hash, 0
  ));
  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.category.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;

  select item.result into v_result
  from public.aircraft_document_idempotency item
  where item.organization_id = p_organization_id and item.actor_user_id = p_actor_user_id
    and item.idempotency_key_hash = p_idempotency_key_hash
    and item.action = p_action
    and (p_action = 'create_category' or item.target_id is not distinct from p_category_id)
    and item.expected_version is not distinct from p_expected_version
    and item.request_hash = p_request_hash;
  if found then return v_result || jsonb_build_object('replayed', true, 'correlationId', p_correlation_id); end if;
  if exists (
    select 1 from public.aircraft_document_idempotency item
    where item.organization_id = p_organization_id and item.actor_user_id = p_actor_user_id
      and item.idempotency_key_hash = p_idempotency_key_hash
  ) then
    return jsonb_build_object('decision', 'idempotency_conflict', 'correlationId', p_correlation_id);
  end if;

  if p_action = 'create_category' then
    v_code := 'custom_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.aircraft_document_categories (
      organization_id, category_code, category_label, category_kind, created_by, updated_by
    ) values (
      p_organization_id, v_code, p_category_label, 'custom', p_actor_user_id, p_actor_user_id
    ) returning * into v_category;
    v_decision := 'category_created';
  else
    if p_action in ('assign_category', 'remove_category') then
      perform 1 from public.aircraft_records aircraft
      where aircraft.organization_id = p_organization_id and aircraft.id = p_aircraft_record_id
        and aircraft.registry_state = 'tracked' for update;
  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.category.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;

      if not found then
        return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
      end if;
    end if;
    select * into v_category
    from public.aircraft_document_categories category
    where category.organization_id = p_organization_id and category.id = p_category_id
    for update;
  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.category.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;

    if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
    if v_category.category_kind <> 'custom'
       or (p_action in ('rename_category', 'archive_category', 'assign_category')
         and v_category.version <> p_expected_version) then
      return jsonb_build_object(
        'decision', case when v_category.category_kind = 'custom' then 'version_conflict' else 'state_conflict' end,
        'correlationId', p_correlation_id
      );
    end if;
    if p_action = 'rename_category' then
      if v_category.category_state <> 'active' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      update public.aircraft_document_categories
      set category_label = p_category_label, version = version + 1,
          updated_at = now(), updated_by = p_actor_user_id
      where id = v_category.id returning * into v_category;
      v_decision := 'category_renamed';
    elsif p_action = 'archive_category' then
      if v_category.category_state <> 'active' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      update public.aircraft_document_categories
      set category_state = 'archived', archived_at = now(), archived_by = p_actor_user_id,
          version = version + 1, updated_at = now(), updated_by = p_actor_user_id
      where id = v_category.id returning * into v_category;
      update public.aircraft_document_requirements
      set requirement_state = 'archived', archived_at = now(), archived_by = p_actor_user_id,
          version = version + 1, updated_at = now(), updated_by = p_actor_user_id
      where organization_id = p_organization_id and category_id = v_category.id
        and requirement_state = 'active';
      update public.aircraft_documents
      set document_state = 'archived', archived_at = now(), archived_by = p_actor_user_id,
          version = version + 1, updated_at = now(), updated_by = p_actor_user_id
      where organization_id = p_organization_id and category_id = v_category.id
        and document_state <> 'archived';
      for v_document in
        select document.*
        from public.aircraft_documents document
        where document.organization_id = p_organization_id
          and document.category_id = v_category.id
        order by document.id
      loop
        perform public.resolve_aircraft_document_notifications(
          p_organization_id, v_document.id, null, null,
          'category_archived', p_actor_user_id, p_correlation_id
        );
      end loop;
      v_decision := 'category_archived';
    else
      if v_category.category_state <> 'active' then
        return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
      end if;
      select * into v_requirement
      from public.aircraft_document_requirements requirement
      where requirement.organization_id = p_organization_id
        and requirement.aircraft_record_id = p_aircraft_record_id
        and requirement.category_id = v_category.id
      order by requirement.created_at desc limit 1 for update;
  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.category.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;

      if p_action = 'assign_category' then
        if found and v_requirement.requirement_state = 'active' then
          return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
        elsif found then
          update public.aircraft_document_requirements
          set requirement_state = 'active', archived_at = null, archived_by = null,
              version = version + 1, updated_at = now(), updated_by = p_actor_user_id
          where id = v_requirement.id returning * into v_requirement;
          select * into v_document from public.aircraft_documents document
          where document.organization_id = p_organization_id
            and document.aircraft_record_id = p_aircraft_record_id
            and document.category_id = v_category.id for update;
  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.category.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;

          if found and v_document.document_state = 'archived' then
            update public.aircraft_documents
            set document_state = 'active', archived_at = null, archived_by = null,
                suspension_reason = null, suspended_at = null, suspended_by = null,
                version = version + 1, updated_at = now(), updated_by = p_actor_user_id
            where id = v_document.id returning * into v_document;
            perform public.sync_aircraft_document_notifications(
              p_organization_id, v_document.id, v_document.current_version_id,
              p_philippine_date, p_actor_user_id, p_correlation_id
            );
          end if;
        else
          insert into public.aircraft_document_requirements (
            organization_id, aircraft_record_id, category_id, created_by, updated_by
          ) values (
            p_organization_id, p_aircraft_record_id, v_category.id,
            p_actor_user_id, p_actor_user_id
          ) returning * into v_requirement;
        end if;
        v_decision := 'category_assigned';
      else
        if not found or v_requirement.requirement_state <> 'active'
           or v_requirement.version <> p_expected_version then
          return jsonb_build_object('decision', 'version_conflict', 'correlationId', p_correlation_id);
        end if;
        update public.aircraft_document_requirements
        set requirement_state = 'archived', archived_at = now(), archived_by = p_actor_user_id,
            version = version + 1, updated_at = now(), updated_by = p_actor_user_id
        where id = v_requirement.id returning * into v_requirement;
        update public.aircraft_documents
        set document_state = 'archived', archived_at = now(), archived_by = p_actor_user_id,
            version = version + 1, updated_at = now(), updated_by = p_actor_user_id
        where organization_id = p_organization_id and aircraft_record_id = p_aircraft_record_id
          and category_id = v_category.id and document_state <> 'archived'
        returning * into v_document;
        if found then
          perform public.resolve_aircraft_document_notifications(
            p_organization_id, v_document.id, null, null,
            'requirement_removed', p_actor_user_id, p_correlation_id
          );
        end if;
        v_decision := 'category_removed';
      end if;
    end if;
  end if;

  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id,
    case when p_action in ('assign_category', 'remove_category') then 'requirement' else 'category' end,
    coalesce(v_requirement.id, v_category.id),
    'aircraft_document.' || v_decision, 'success', v_decision, p_correlation_id,
    p_idempotency_key_hash,
    jsonb_build_object('categoryId', v_category.id, 'aircraftId', p_aircraft_record_id,
      'categoryVersion', v_category.version,
      'requirementVersion', v_requirement.version)
  );
  v_result := jsonb_build_object(
    'decision', v_decision, 'categoryId', v_category.id,
    'categoryCode', v_category.category_code, 'categoryLabel', v_category.category_label,
    'categoryState', v_category.category_state, 'categoryVersion', v_category.version,
    'requirementId', v_requirement.id, 'requirementVersion', v_requirement.version,
    'replayed', false
  );
  insert into public.aircraft_document_idempotency (
    organization_id, actor_user_id, idempotency_key_hash, action,
    target_id, expected_version, request_hash, result
  ) values (
    p_organization_id, p_actor_user_id, p_idempotency_key_hash, p_action,
    v_category.id, p_expected_version, p_request_hash, v_result
  );

  -- A fresh statement observes authority changes committed while this command waited.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.category.manage'
  ) then
    raise exception using errcode = 'P7303', message = 'Document command authority changed.';
  end if;
  return v_result || jsonb_build_object('correlationId', p_correlation_id);
exception when sqlstate 'P7303' then
  -- The existing exception block rolls back earlier domain, notification and audit writes.
  return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
when unique_violation then
  return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
end;
$$;

create or replace function public.complete_aircraft_document_file(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_file_id uuid,
  p_scan_state text,
  p_verified_size_bytes bigint,
  p_verified_sha256_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_file public.stored_files%rowtype;
  v_final_state text;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  if p_scan_state not in ('clean', 'rejected', 'scan_failed')
     or p_verified_size_bytes not between 1 and 20971520
     or p_verified_sha256_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  select * into v_file
  from public.stored_files file
  where file.organization_id = p_organization_id and file.id = p_file_id
  for update;
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  if not found then return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id); end if;
  if v_file.scan_state = 'clean' and p_scan_state = 'clean'
     and v_file.size_bytes = p_verified_size_bytes
     and v_file.sha256_hash = p_verified_sha256_hash then
    return jsonb_build_object(
      'decision', 'completed', 'fileId', v_file.id, 'scanState', v_file.scan_state,
      'correlationId', p_correlation_id
    );
  end if;
  if v_file.scan_state <> 'staged' then
    return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
  end if;
  v_final_state := case
    when p_verified_size_bytes <> v_file.size_bytes
      or p_verified_sha256_hash <> v_file.sha256_hash then 'rejected'
    else p_scan_state
  end;
  update public.stored_files
  set scan_state = v_final_state, updated_at = now()
  where id = v_file.id returning * into v_file;
  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'file', v_file.id,
    case when v_file.scan_state = 'clean' then 'aircraft_document.file_clean'
      else 'aircraft_document.file_rejected' end,
    case when v_file.scan_state = 'clean' then 'success' else 'failed' end,
    v_file.scan_state, p_correlation_id, null,
    jsonb_build_object('mediaType', v_file.media_type, 'sizeBytes', p_verified_size_bytes,
      'hashMatched', p_verified_sha256_hash = v_file.sha256_hash)
  );
  return jsonb_build_object(
    'decision', case when v_file.scan_state = 'clean' then 'completed' else 'file_rejected' end,
    'fileId', v_file.id, 'scanState', v_file.scan_state, 'correlationId', p_correlation_id
  );
end;
$$;

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
  return jsonb_build_object(
    'decision', 'opened', 'notificationId', v_notification.id,
    'documentId', v_notification.aircraft_document_id,
    'state', v_notification.notification_state, 'correlationId', p_correlation_id
  );
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
end;
$$;

commit;
