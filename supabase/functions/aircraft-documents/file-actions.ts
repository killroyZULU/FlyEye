import { normalizeDisplayName, type AircraftDocumentRequest } from './domain.ts';
import { validateSyntheticFile } from './file-validation.ts';
import {
  downloadConfirmationSchema,
  downloadTargetSchema,
  fileCompleteSchema,
  fileStageSchema,
  stagedFileSchema,
} from './response-schemas.ts';
import { caughtFailureCode, databaseDecision, failure, json } from './transport.ts';
import {
  checkedResponse,
  limited,
  securityFailure,
  sha256,
  type AircraftDocumentDependencies,
  type ProcessingContext,
} from './processing.ts';

function uuidFromHash(hash: string): string {
  const chars = hash.slice(0, 32).split('');
  chars[12] = '4';
  chars[16] = ['8', '9', 'a', 'b'][Number.parseInt(chars[16]!, 16) % 4]!;
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function extension(mediaType: string): 'pdf' | 'jpg' | 'png' {
  return mediaType === 'application/pdf' ? 'pdf' : mediaType === 'image/jpeg' ? 'jpg' : 'png';
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function initiate(
  dependencies: AircraftDocumentDependencies,
  context: ProcessingContext,
  request: Extract<AircraftDocumentRequest, { action: 'file_initiate' }>,
) {
  const displayName = normalizeDisplayName(request.displayName);
  const seed = await sha256(
    `${context.access.organizationId}\0${context.actor.actorUserId}\0${request.idempotencyKey}`,
  );
  const fileId = uuidFromHash(seed);
  const generatedName = `${fileId}.${extension(request.mediaType)}`;
  const objectKey = `${context.access.organizationId}/${request.aircraftId}/${fileId}/${generatedName}`;
  const raw = await dependencies.rpc('stage_aircraft_document_file', {
    p_actor_user_id: context.actor.actorUserId,
    p_organization_id: context.access.organizationId,
    p_aircraft_record_id: request.aircraftId,
    p_file_id: fileId,
    p_object_key: objectKey,
    p_display_name: displayName,
    p_generated_name: generatedName,
    p_media_type: request.mediaType,
    p_size_bytes: request.sizeBytes,
    p_sha256_hash: request.sha256Hash,
    p_correlation_id: context.correlationId,
  });
  const staged = fileStageSchema.safeParse(raw);
  if (!staged.success || staged.data.correlationId !== context.correlationId) {
    const decision = databaseDecision(raw);
    return decision === 'not_found' || decision === 'unauthorized'
      ? securityFailure(dependencies, context, decision)
      : failure(context.origin, decision, context.correlationId);
  }
  if (staged.data.scanState === 'clean') {
    return json(context.origin, 200, {
      decision: 'completed',
      fileId,
      scanState: 'clean',
      correlationId: context.correlationId,
    });
  }
  if (staged.data.scanState !== 'staged') {
    return failure(
      context.origin,
      staged.data.scanState === 'scan_failed' ? 'scan_failed' : 'file_rejected',
      context.correlationId,
    );
  }
  const signed = await dependencies.createSignedUpload(objectKey);
  return json(context.origin, 200, {
    decision: 'staged',
    fileId,
    uploadToken: signed.token,
    uploadPath: signed.path,
    mediaType: request.mediaType,
    sizeBytes: request.sizeBytes,
    correlationId: context.correlationId,
  });
}

async function complete(
  dependencies: AircraftDocumentDependencies,
  context: ProcessingContext,
  request: Extract<AircraftDocumentRequest, { action: 'file_complete' }>,
) {
  const rawFile = await dependencies.rpc('get_aircraft_document_staged_file', {
    p_actor_user_id: context.actor.actorUserId,
    p_organization_id: context.access.organizationId,
    p_file_id: request.fileId,
  });
  const staged = stagedFileSchema.safeParse(rawFile);
  if (!staged.success) {
    const decision = databaseDecision(rawFile);
    return decision === 'not_found' || decision === 'unauthorized'
      ? securityFailure(dependencies, context, decision)
      : failure(context.origin, decision, context.correlationId);
  }
  if (staged.data.scanState === 'clean') {
    return json(context.origin, 200, {
      decision: 'completed',
      fileId: staged.data.fileId,
      scanState: 'clean',
      correlationId: context.correlationId,
    });
  }
  if (staged.data.scanState !== 'staged') {
    return failure(
      context.origin,
      staged.data.scanState === 'scan_failed' ? 'scan_failed' : 'file_rejected',
      context.correlationId,
    );
  }
  const bytes = await dependencies.downloadStagedFile(staged.data.objectKey);
  const scanState = await validateSyntheticFile({
    bytes,
    mediaType: staged.data.mediaType,
    expectedSize: staged.data.sizeBytes,
    expectedHash: staged.data.sha256Hash,
  });
  return checkedResponse(
    dependencies,
    context,
    await dependencies.rpc('complete_aircraft_document_file', {
      p_actor_user_id: context.actor.actorUserId,
      p_organization_id: context.access.organizationId,
      p_file_id: request.fileId,
      p_scan_state: scanState,
      p_verified_size_bytes: bytes.byteLength,
      p_verified_sha256_hash: await sha256Bytes(bytes),
      p_correlation_id: context.correlationId,
    }),
    fileCompleteSchema,
  );
}

async function download(
  dependencies: AircraftDocumentDependencies,
  context: ProcessingContext,
  request: Extract<AircraftDocumentRequest, { action: 'attachment_download' }>,
) {
  const raw = await dependencies.rpc('get_aircraft_document_download_target', {
    p_actor_user_id: context.actor.actorUserId,
    p_organization_id: context.access.organizationId,
    p_file_id: request.fileId,
    p_correlation_id: context.correlationId,
  });
  const target = downloadTargetSchema.safeParse(raw);
  if (!target.success || target.data.correlationId !== context.correlationId) {
    const decision = databaseDecision(raw);
    return decision === 'not_found' || decision === 'unauthorized'
      ? securityFailure(dependencies, context, decision)
      : failure(context.origin, decision, context.correlationId);
  }
  const signedUrl = await dependencies.createSignedDownload(
    target.data.objectKey,
    target.data.downloadName,
  );
  const confirmationRaw = await dependencies.rpc('confirm_aircraft_document_download_issued', {
    p_actor_user_id: context.actor.actorUserId,
    p_organization_id: context.access.organizationId,
    p_file_id: request.fileId,
    p_correlation_id: context.correlationId,
  });
  const confirmation = downloadConfirmationSchema.safeParse(confirmationRaw);
  if (!confirmation.success || confirmation.data.correlationId !== context.correlationId) {
    const decision = databaseDecision(confirmationRaw);
    return decision === 'not_found' || decision === 'unauthorized'
      ? securityFailure(dependencies, context, decision)
      : failure(context.origin, decision, context.correlationId);
  }
  return json(context.origin, 200, {
    decision: 'authorized',
    fileId: target.data.fileId,
    signedUrl,
    expiresInSeconds: 60,
    correlationId: context.correlationId,
  });
}

export async function processFile(
  dependencies: AircraftDocumentDependencies,
  context: ProcessingContext,
) {
  const request = context.requestData as
    | Extract<AircraftDocumentRequest, { action: 'file_initiate' }>
    | Extract<AircraftDocumentRequest, { action: 'file_complete' }>
    | Extract<AircraftDocumentRequest, { action: 'attachment_download' }>;
  const denied = await limited(
    dependencies,
    context,
    request.action === 'attachment_download' ? 'download' : 'upload',
  );
  if (denied) return denied;
  try {
    if (request.action === 'file_initiate') return await initiate(dependencies, context, request);
    if (request.action === 'file_complete') return await complete(dependencies, context, request);
    return await download(dependencies, context, request);
  } catch (error) {
    return failure(
      context.origin,
      caughtFailureCode(error, 'storage_unavailable'),
      context.correlationId,
    );
  }
}
