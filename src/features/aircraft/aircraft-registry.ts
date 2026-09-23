import { z } from 'zod';

export const aircraftRegistryStateSchema = z.enum(['tracked', 'archived']);
export const archiveReasonSchema = z.enum([
  'no_longer_tracked',
  'duplicate_record',
  'created_in_error',
]);
export const reactivationReasonSchema = z.enum(['tracking_resumed', 'archive_incorrect']);

function boundedCodePointString(maximum: number) {
  return z.string().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= maximum;
  });
}

export const aircraftRecordSchema = z
  .object({
    id: z.uuid(),
    registrationMark: boundedCodePointString(32),
    manufacturer: boundedCodePointString(100),
    model: boundedCodePointString(100),
    registryState: aircraftRegistryStateSchema,
    version: z.number().int().positive(),
    updatedAt: z.string().min(1).max(80),
  })
  .strict();

export const aircraftListResultSchema = z
  .object({
    decision: z.literal('listed'),
    records: z.array(aircraftRecordSchema).max(50),
    page: z.number().int().min(1).max(100),
    pageSize: z.number().int().min(1).max(50),
    hasNext: z.boolean(),
    correlationId: z.uuid(),
  })
  .strict();

export const aircraftDetailResultSchema = z
  .object({
    decision: z.literal('found'),
    record: aircraftRecordSchema,
    correlationId: z.uuid(),
  })
  .strict();

export const aircraftMutationResultSchema = z
  .object({
    decision: z.enum(['created', 'updated', 'archived', 'reactivated']),
    record: aircraftRecordSchema,
    replayed: z.boolean(),
    correlationId: z.uuid(),
  })
  .strict();

const controlOrFormat = /[\p{Cc}\p{Cf}]/u;
const separator = /\p{Z}/u;
const dash = /\p{Pd}/u;

function normalizeField(value: string, maximum: number): string | undefined {
  const normalized = value.normalize('NFC').replace(/^ +| +$/gu, '');
  const disallowed = [...normalized].some(
    (character) =>
      controlOrFormat.test(character) ||
      (character !== ' ' && separator.test(character)) ||
      (character !== '-' && dash.test(character)),
  );
  if (!normalized || [...normalized].length > maximum || disallowed) {
    return undefined;
  }
  return normalized;
}

export type AircraftFormValues = {
  registrationMark: string;
  manufacturer: string;
  model: string;
};

export function validateAircraftForm(
  values: AircraftFormValues,
): { success: true; data: AircraftFormValues } | { success: false; messages: string[] } {
  const registrationMark = normalizeField(values.registrationMark, 32);
  const manufacturer = normalizeField(values.manufacturer, 100);
  const model = normalizeField(values.model, 100);
  const messages: string[] = [];
  if (!registrationMark) messages.push('Enter a valid registration mark of up to 32 characters.');
  if (!manufacturer) messages.push('Enter a valid manufacturer of up to 100 characters.');
  if (!model) messages.push('Enter a valid model of up to 100 characters.');
  if (messages.length > 0) return { success: false, messages };
  return {
    success: true,
    data: {
      registrationMark: registrationMark!.replace(/[a-z]/gu, (letter) => letter.toUpperCase()),
      manufacturer: manufacturer!,
      model: model!,
    },
  };
}

export function createAircraftIdempotencyKey(): string {
  return crypto
    .getRandomValues(new Uint8Array(16))
    .reduce((value, byte) => `${value}${byte.toString(16).padStart(2, '0')}`, '');
}

export type AircraftRecord = z.infer<typeof aircraftRecordSchema>;
export type AircraftListResult = z.infer<typeof aircraftListResultSchema>;
export type AircraftMutationResult = z.infer<typeof aircraftMutationResultSchema>;
export type ArchiveReason = z.infer<typeof archiveReasonSchema>;
export type ReactivationReason = z.infer<typeof reactivationReasonSchema>;
