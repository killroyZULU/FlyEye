import { z } from 'zod';

const baseSchema = z
  .object({
    organizationId: z.uuid(),
    organizationName: z.string().trim().min(2).max(160),
    membershipId: z.uuid(),
    correlationId: z.uuid(),
  })
  .strict();

export const memberMfaStatusSchema = baseSchema
  .extend({
    decision: z.literal('available'),
    ready: z.boolean(),
    operationState: z.enum(['started', 'bound']).optional(),
    operationId: z.uuid().optional(),
    operationVersion: z.number().int().positive().optional(),
    factorState: z.enum([
      'enrollment_required',
      'challenge_required',
      'resume_required',
      'cancellation_required',
    ]),
  })
  .strict()
  .superRefine((value, refinement) => {
    if (Boolean(value.operationState) !== Boolean(value.operationId && value.operationVersion)) {
      refinement.addIssue({ code: 'custom', message: 'Operation state is inconsistent.' });
    }
    if (
      (value.operationState === 'bound') !== (value.factorState === 'resume_required') ||
      (value.operationState === 'started') !== (value.factorState === 'cancellation_required')
    ) {
      refinement.addIssue({ code: 'custom', message: 'Factor operation state is inconsistent.' });
    }
  });

export const memberMfaStartSchema = baseSchema
  .extend({
    decision: z.literal('ready'),
    operationId: z.uuid(),
    operationVersion: z.number().int().positive(),
    replayed: z.boolean(),
    factorState: z.enum(['enrollment_required', 'challenge_required']),
  })
  .strict();

export const memberMfaBoundSchema = z
  .object({
    decision: z.literal('bound'),
    operationId: z.uuid(),
    operationVersion: z.number().int().positive(),
    replayed: z.boolean(),
    correlationId: z.uuid(),
  })
  .strict();

export const memberMfaCompleteSchema = z
  .object({
    decision: z.literal('completed'),
    organizationId: z.uuid(),
    membershipId: z.uuid(),
    readinessVersion: z.number().int().positive(),
    replayed: z.boolean(),
    correlationId: z.uuid(),
  })
  .strict();

export type MemberMfaStatus = z.infer<typeof memberMfaStatusSchema>;
export type MemberMfaStart = z.infer<typeof memberMfaStartSchema>;
export type MemberMfaComplete = z.infer<typeof memberMfaCompleteSchema>;

export function createMemberMfaIdempotencyKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
