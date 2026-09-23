import { z } from 'zod';

const idempotencyKeySchema = z.string().regex(/^[0-9a-f]{32,128}$/);
const uuid = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rawText = z.string().max(600);

const metadata = {
  documentTitle: rawText,
  documentSource: rawText,
  referenceNumber: rawText.nullable().optional(),
  issueDate: date.nullable().optional(),
  expirationDate: date,
  notes: rawText.nullable().optional(),
  storedFileId: uuid.nullable().optional(),
};

export const aircraftDocumentRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('aircraft_list'),
      page: z.number().int().min(1).max(100),
      pageSize: z.number().int().min(1).max(50),
    })
    .strict(),
  z.object({ action: z.literal('status_list'), aircraftId: uuid }).strict(),
  z.object({ action: z.literal('detail'), documentId: uuid }).strict(),
  z
    .object({
      action: z.literal('history'),
      documentId: uuid,
      page: z.number().int().min(1).max(100),
      pageSize: z.number().int().min(1).max(50),
    })
    .strict(),
  z
    .object({
      action: z.literal('notifications_list'),
      page: z.number().int().min(1).max(100),
      pageSize: z.number().int().min(1).max(50),
      includeResolved: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('notification_open'), notificationId: uuid }).strict(),
  z
    .object({
      action: z.literal('create'),
      aircraftId: uuid,
      categoryId: uuid,
      ...metadata,
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  ...(['renew', 'correct'] as const).map((action) =>
    z
      .object({
        action: z.literal(action),
        aircraftId: uuid,
        categoryId: uuid,
        documentId: uuid,
        expectedVersion: z.number().int().positive(),
        ...metadata,
        reason: rawText,
        idempotencyKey: idempotencyKeySchema,
      })
      .strict(),
  ),
  ...(['suspend', 'restore'] as const).map((action) =>
    z
      .object({
        action: z.literal(action),
        aircraftId: uuid,
        categoryId: uuid,
        documentId: uuid,
        expectedVersion: z.number().int().positive(),
        reason: rawText,
        idempotencyKey: idempotencyKeySchema,
      })
      .strict(),
  ),
  z
    .object({
      action: z.literal('category_create'),
      categoryLabel: rawText,
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('category_rename'),
      categoryId: uuid,
      expectedVersion: z.number().int().positive(),
      categoryLabel: rawText,
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('category_archive'),
      categoryId: uuid,
      expectedVersion: z.number().int().positive(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  ...(['category_assign', 'category_remove'] as const).map((action) =>
    z
      .object({
        action: z.literal(action),
        categoryId: uuid,
        aircraftId: uuid,
        expectedVersion: z.number().int().positive(),
        idempotencyKey: idempotencyKeySchema,
      })
      .strict(),
  ),
  z
    .object({
      action: z.literal('file_initiate'),
      aircraftId: uuid,
      displayName: rawText,
      mediaType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
      sizeBytes: z
        .number()
        .int()
        .min(1)
        .max(20 * 1024 * 1024),
      sha256Hash: z.string().regex(/^[0-9a-f]{64}$/),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('file_complete'),
      fileId: uuid,
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z.object({ action: z.literal('attachment_download'), fileId: uuid }).strict(),
]);

export type AircraftDocumentRequest = z.infer<typeof aircraftDocumentRequestSchema>;
export type AircraftDocumentAction = AircraftDocumentRequest['action'];

const disallowed = /[\p{Cc}\p{Cf}]/u;
const unusualSeparator = /[\p{Z}\p{Pd}]/u;

function normalizeText(
  value: string | null | undefined,
  maximum: number,
  optional = false,
): string | null {
  if (value === null || value === undefined || (optional && value.trim() === '')) return null;
  const normalized = value.normalize('NFC').trim();
  if (
    !normalized ||
    [...normalized].length > maximum ||
    [...normalized].some(
      (character) =>
        disallowed.test(character) ||
        (unusualSeparator.test(character) && character !== ' ' && character !== '-'),
    )
  ) {
    throw new Error('Aircraft document text validation failed.');
  }
  return normalized;
}

function validDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Aircraft document date validation failed.');
  }
  return value;
}

export function normalizeDocumentMetadata(
  request: Extract<AircraftDocumentRequest, { action: 'create' | 'renew' | 'correct' }>,
) {
  return {
    documentTitle: normalizeText(request.documentTitle, 160)!,
    documentSource: normalizeText(request.documentSource, 160)!,
    referenceNumber: normalizeText(request.referenceNumber, 160, true),
    issueDate: validDate(request.issueDate),
    expirationDate: validDate(request.expirationDate)!,
    notes: normalizeText(request.notes, 500, true),
    storedFileId: request.storedFileId ?? null,
    reason: request.action === 'create' ? null : normalizeText(request.reason, 300),
  };
}

export function normalizeCategoryLabel(value: string): string {
  return normalizeText(value, 120)!;
}

export function normalizeLifecycleReason(value: string): string {
  const reason = normalizeText(value, 300)!;
  if ([...reason].length < 10) throw new Error('Aircraft document reason validation failed.');
  return reason;
}

export function normalizeDisplayName(value: string): string {
  return normalizeText(value, 160)!;
}

export function canonicalDocumentMutationPayload(
  request: Exclude<
    AircraftDocumentRequest,
    | {
        action:
          | 'aircraft_list'
          | 'status_list'
          | 'detail'
          | 'history'
          | 'notifications_list'
          | 'notification_open';
      }
    | { action: 'file_initiate' | 'file_complete' | 'attachment_download' }
  >,
  normalized: Record<string, unknown>,
): string {
  return JSON.stringify({ action: request.action, ...normalized });
}
