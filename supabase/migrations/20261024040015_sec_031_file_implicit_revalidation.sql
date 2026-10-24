-- SEC-031: reject authority revoked during the observed file-operation implicit waits.
-- Signatures, tenant predicates, audit failures and existing replay results remain unchanged.
begin;

create or replace function public.stage_aircraft_document_file(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_aircraft_record_id uuid,
  p_file_id uuid,
  p_object_key text,
  p_display_name text,
  p_generated_name text,
  p_media_type text,
  p_size_bytes bigint,
  p_sha256_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_file public.stored_files%rowtype;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  if p_file_id is null or p_correlation_id is null
     or p_object_key !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$'
     or p_generated_name !~ '^[0-9a-f-]{36}\.(pdf|jpg|png)$'
     or p_display_name <> btrim(p_display_name) or char_length(p_display_name) not between 1 and 160
     or p_media_type not in ('application/pdf', 'image/jpeg', 'image/png')
     or p_size_bytes not between 1 and 20971520
     or p_sha256_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('decision', 'validation_failed', 'correlationId', p_correlation_id);
  end if;
  if not exists (
    select 1 from public.aircraft_records aircraft
    where aircraft.organization_id = p_organization_id and aircraft.id = p_aircraft_record_id
      and aircraft.registry_state = 'tracked'
  ) then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  select * into v_file from public.stored_files file
  where file.organization_id = p_organization_id and file.id = p_file_id;
  if found then
    if v_file.aircraft_record_id = p_aircraft_record_id
       and v_file.object_key = p_object_key and v_file.display_name = p_display_name
       and v_file.generated_name = p_generated_name and v_file.media_type = p_media_type
       and v_file.size_bytes = p_size_bytes and v_file.sha256_hash = p_sha256_hash then
      return jsonb_build_object(
        'decision', 'staged', 'fileId', v_file.id, 'objectKey', v_file.object_key,
        'scanState', v_file.scan_state, 'correlationId', p_correlation_id
      );
    end if;
    return jsonb_build_object('decision', 'idempotency_conflict', 'correlationId', p_correlation_id);
  end if;
  insert into public.stored_files (
    id, organization_id, aircraft_record_id, object_key, display_name, generated_name,
    media_type, size_bytes, sha256_hash, scan_state, uploader_user_id
  ) values (
    p_file_id, p_organization_id, p_aircraft_record_id, p_object_key, p_display_name,
    p_generated_name, p_media_type, p_size_bytes, p_sha256_hash, 'staged', p_actor_user_id
  ) returning * into v_file;
  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'file', v_file.id,
    'aircraft_document.file_staged', 'success', 'file_staged', p_correlation_id,
    null, jsonb_build_object('mediaType', v_file.media_type, 'sizeBytes', v_file.size_bytes,
      'hash', v_file.sha256_hash)
  );
  -- Observe authority changes committed during implicit DML, FK, uniqueness or audit waits.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    raise exception using errcode = 'P7305', message = 'File command authority changed.';
  end if;
  return jsonb_build_object(
    'decision', 'staged', 'fileId', v_file.id, 'objectKey', v_file.object_key,
    'scanState', v_file.scan_state, 'correlationId', p_correlation_id
  );
exception when unique_violation then
  -- The failed statement and prior file/audit effects have already rolled back.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  return jsonb_build_object('decision', 'state_conflict', 'correlationId', p_correlation_id);
when sqlstate 'P7305' then
  -- Roll back file and audit effects; mandatory audit failure P7101 still propagates.
  return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.stage_aircraft_document_file(uuid, uuid, uuid, uuid, text, text, text, text, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.stage_aircraft_document_file(uuid, uuid, uuid, uuid, text, text, text, text, bigint, text, uuid)
  to service_role;

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
  -- Observe authority changes committed during implicit DML, FK, uniqueness or audit waits.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.manage'
  ) then
    raise exception using errcode = 'P7305', message = 'File command authority changed.';
  end if;
  return jsonb_build_object(
    'decision', case when v_file.scan_state = 'clean' then 'completed' else 'file_rejected' end,
    'fileId', v_file.id, 'scanState', v_file.scan_state, 'correlationId', p_correlation_id
  );
exception when sqlstate 'P7305' then
  -- Roll back file and audit effects; mandatory audit failure P7101 still propagates.
  return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.complete_aircraft_document_file(uuid, uuid, uuid, text, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_aircraft_document_file(uuid, uuid, uuid, text, bigint, text, uuid)
  to service_role;

create or replace function public.confirm_aircraft_document_download_issued(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_file_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_file public.stored_files%rowtype;
begin
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.attachment.read'
  ) then
    return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
  end if;
  select file.* into v_file
  from public.stored_files file
  join public.aircraft_document_versions version
    on version.organization_id = file.organization_id and version.stored_file_id = file.id
  join public.aircraft_documents document
    on document.organization_id = version.organization_id
   and document.id = version.aircraft_document_id
  join public.aircraft_records aircraft
    on aircraft.organization_id = document.organization_id
   and aircraft.id = document.aircraft_record_id
  where file.organization_id = p_organization_id and file.id = p_file_id
    and file.scan_state = 'clean' and document.document_state <> 'archived'
    and aircraft.registry_state = 'tracked';
  if not found then
    return jsonb_build_object('decision', 'not_found', 'correlationId', p_correlation_id);
  end if;
  perform public.write_aircraft_document_event(
    p_organization_id, p_actor_user_id, 'file', v_file.id,
    'aircraft_document.download_issued', 'success', 'download_issued', p_correlation_id,
    null, jsonb_build_object('mediaType', v_file.media_type, 'sizeBytes', v_file.size_bytes)
  );
  -- Observe authority changes committed during implicit DML, FK, uniqueness or audit waits.
  if not public.aircraft_document_actor_is_authorized(
    p_actor_user_id, p_organization_id, 'aircraft.document.attachment.read'
  ) then
    raise exception using errcode = 'P7305', message = 'File command authority changed.';
  end if;
  return jsonb_build_object(
    'decision', 'confirmed', 'fileId', v_file.id, 'correlationId', p_correlation_id
  );
exception when sqlstate 'P7305' then
  -- Roll back file and audit effects; mandatory audit failure P7101 still propagates.
  return jsonb_build_object('decision', 'unauthorized', 'correlationId', p_correlation_id);
end;
$$;

revoke all on function public.confirm_aircraft_document_download_issued(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_aircraft_document_download_issued(uuid, uuid, uuid, uuid)
  to service_role;

commit;
