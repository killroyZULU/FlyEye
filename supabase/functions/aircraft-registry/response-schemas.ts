import { z } from 'zod';

export const contextSchema = z
  .object({ organizationId: z.uuid(), canRead: z.boolean(), canManage: z.boolean() })
  .strict();

function boundedCodePointString(maximum: number) {
  return z.string().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= maximum;
  });
}

const recordSchema = z
  .object({
    id: z.uuid(),
    registrationMark: boundedCodePointString(32),
    manufacturer: boundedCodePointString(100),
    model: boundedCodePointString(100),
    registryState: z.enum(['tracked', 'archived']),
    version: z.number().int().positive(),
    updatedAt: z.string().min(1).max(80),
  })
  .strict();

export const listSchema = z
  .object({
    decision: z.literal('listed'),
    records: z.array(recordSchema).max(50),
    page: z.number().int().min(1).max(100),
    pageSize: z.number().int().min(1).max(50),
    hasNext: z.boolean(),
    correlationId: z.uuid(),
  })
  .strict();

export const detailSchema = z
  .object({ decision: z.literal('found'), record: recordSchema, correlationId: z.uuid() })
  .strict();

export const mutationSchema = z
  .object({
    decision: z.enum(['created', 'updated', 'archived', 'reactivated']),
    record: recordSchema,
    replayed: z.boolean(),
    correlationId: z.uuid(),
  })
  .strict();

export const idempotencySchema = z
  .object({
    decision: z.enum(['missing', 'replay', 'conflict', 'unauthorized']),
    result: mutationSchema.omit({ correlationId: true }).nullable(),
  })
  .strict();
