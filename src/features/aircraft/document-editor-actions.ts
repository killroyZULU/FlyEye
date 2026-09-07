import type { MutableRefObject } from 'react';

import {
  validateDocumentForm,
  type AircraftDocumentDetail,
  type AircraftDocumentFormValues,
  type AircraftDocumentMutation,
} from './aircraft-documents';
import type { AircraftDocumentGateway } from './document-gateway';
import { createAircraftIdempotencyKey } from './aircraft-registry';
import { idempotencyKeyForAttempt, type PendingAircraftAttempt } from './idempotency-retry';

type EditorMode = 'create' | 'renew' | 'correct';
export type UploadCache = { file: File; idempotencyKey: string; fileId?: string } | undefined;

export function validateEditorSubmission(
  values: AircraftDocumentFormValues,
  mode: EditorMode,
  reason: string,
  file: File | undefined,
  online: boolean,
) {
  const parsed = validateDocumentForm(values);
  const messages = parsed.success ? [] : [...parsed.messages];
  if (mode !== 'create' && (reason.trim().length < 10 || reason.trim().length > 300)) {
    messages.push('Enter an administrative reason of 10 to 300 characters.');
  }
  if (
    file &&
    (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) ||
      file.size > 20 * 1024 * 1024)
  ) {
    messages.push('Choose one PDF, JPEG, or PNG file no larger than 20 MiB.');
  }
  if (!online) messages.push('Reconnect before saving.');
  return parsed.success && messages.length === 0
    ? { success: true as const, data: parsed.data }
    : { success: false as const, messages };
}

type SaveRequest = {
  gateway: AircraftDocumentGateway;
  aircraftId: string;
  categoryId: string;
  mode: EditorMode;
  detail?: AircraftDocumentDetail;
  values: ReturnType<typeof validateDocumentForm> & { success: true };
  reason: string;
  file?: File;
  metadataOnly: boolean;
  uploadCache: MutableRefObject<UploadCache>;
  mutationAttempt: MutableRefObject<PendingAircraftAttempt>;
};

export async function saveAircraftDocument(
  request: SaveRequest,
): Promise<AircraftDocumentMutation> {
  const { gateway, file, uploadCache } = request;
  let storedFileId: string | null = null;
  if (file && !request.metadataOnly) {
    if (uploadCache.current?.file !== file) {
      uploadCache.current = { file, idempotencyKey: createAircraftIdempotencyKey() };
    }
    if (!uploadCache.current.fileId) {
      const fileId = await gateway.upload(
        request.aircraftId,
        file,
        uploadCache.current.idempotencyKey,
      );
      uploadCache.current = { ...uploadCache.current, fileId };
    }
    storedFileId = uploadCache.current.fileId ?? null;
  }
  const payload = {
    aircraftId: request.aircraftId,
    categoryId: request.categoryId,
    ...request.values.data,
    storedFileId,
  };
  const idempotencyKey = idempotencyKeyForAttempt(request.mutationAttempt, {
    mode: request.mode,
    ...payload,
    documentId: request.detail?.id,
    expectedVersion: request.detail?.aggregateVersion,
    reason: request.reason.trim(),
  });
  if (request.mode === 'create') return gateway.create({ ...payload, idempotencyKey });
  const versioned = {
    ...payload,
    documentId: request.detail?.id ?? '',
    expectedVersion: request.detail?.aggregateVersion ?? 0,
    reason: request.reason.trim(),
    idempotencyKey,
  };
  return request.mode === 'renew' ? gateway.renew(versioned) : gateway.correct(versioned);
}
