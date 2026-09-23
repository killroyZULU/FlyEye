import { z } from 'zod';

import { defaultCaseFolding15_1 } from './case-folding-15_1.ts';

const idempotencyKeySchema = z.string().regex(/^[0-9a-f]{32,128}$/);
const rawTextSchema = z.string().max(256);

export const aircraftRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('list'),
      search: z.string().max(256).optional(),
      includeArchived: z.boolean(),
      page: z.number().int().min(1).max(100),
      pageSize: z.number().int().min(1).max(50),
    })
    .strict(),
  z.object({ action: z.literal('get'), recordId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('create'),
      registrationMark: rawTextSchema,
      manufacturer: rawTextSchema,
      model: rawTextSchema,
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      recordId: z.uuid(),
      registrationMark: rawTextSchema,
      manufacturer: rawTextSchema,
      model: rawTextSchema,
      expectedVersion: z.number().int().positive(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('archive'),
      recordId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      reason: z.enum(['no_longer_tracked', 'duplicate_record', 'created_in_error']),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('reactivate'),
      recordId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      reason: z.enum(['tracking_resumed', 'archive_incorrect']),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
]);

export type AircraftRequest = z.infer<typeof aircraftRequestSchema>;
export type AircraftAction = AircraftRequest['action'];
export type AircraftMutationRequest = Extract<
  AircraftRequest,
  { action: 'create' | 'update' | 'archive' | 'reactivate' }
>;

const controlOrFormat = /[\p{Cc}\p{Cf}]/u;
const separator = /\p{Z}/u;
const dash = /\p{Pd}/u;

function containsDisallowedCharacter(value: string): boolean {
  return [...value].some(
    (character) =>
      controlOrFormat.test(character) ||
      (character !== ' ' && separator.test(character)) ||
      (character !== '-' && dash.test(character)),
  );
}

function normalizeField(value: string, maximum: number): string {
  const normalized = value.normalize('NFC').replace(/^ +| +$/gu, '');
  if (
    normalized.length === 0 ||
    [...normalized].length > maximum ||
    containsDisallowedCharacter(normalized)
  ) {
    throw new Error('Aircraft field validation failed.');
  }
  return normalized;
}

export function defaultCaseFold15_1(value: string): string {
  return [...value]
    .map((character) => defaultCaseFolding15_1.get(character.codePointAt(0)!) ?? character)
    .join('')
    .normalize('NFC');
}

export function normalizeAircraftIdentity(input: {
  registrationMark: string;
  manufacturer: string;
  model: string;
}) {
  const registrationMark = normalizeField(input.registrationMark, 32).replace(/[a-z]/gu, (letter) =>
    letter.toUpperCase(),
  );
  const registrationKey = defaultCaseFold15_1(registrationMark)
    .replaceAll(' ', '')
    .replaceAll('-', '');
  if (!registrationKey) throw new Error('Aircraft registration validation failed.');
  return {
    registrationMark,
    registrationKey,
    manufacturer: normalizeField(input.manufacturer, 100),
    model: normalizeField(input.model, 100),
  };
}

export function normalizeAircraftSearch(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.normalize('NFC').replace(/^ +| +$/gu, '');
  if ([...normalized].length > 100 || containsDisallowedCharacter(normalized)) {
    throw new Error('Aircraft search validation failed.');
  }
  return normalized || null;
}

export function canonicalMutationPayload(
  request: AircraftMutationRequest,
  identity?: ReturnType<typeof normalizeAircraftIdentity>,
): string {
  if (request.action === 'create') return JSON.stringify({ action: request.action, ...identity });
  if (request.action === 'update') {
    return JSON.stringify({
      action: request.action,
      recordId: request.recordId,
      expectedVersion: request.expectedVersion,
      ...identity,
    });
  }
  return JSON.stringify({
    action: request.action,
    recordId: request.recordId,
    expectedVersion: request.expectedVersion,
    reason: request.reason,
  });
}
