import { z } from 'zod';

export const adminBootstrapGrantSchema = z
  .object({
    bootstrapGrantId: z.uuid(),
    organizationId: z.uuid(),
    organizationName: z.string().trim().min(2).max(160),
    grantVersion: z.number().int().positive(),
    expiresAt: z.string().min(1).max(80),
  })
  .strict();

export const adminOnboardingStatusSchema = z
  .object({
    grants: z.array(adminBootstrapGrantSchema).max(16),
    correlationId: z.uuid(),
  })
  .strict()
  .superRefine((status, refinement) => {
    const grantIds = status.grants.map((grant) => grant.bootstrapGrantId);
    if (new Set(grantIds).size !== grantIds.length) {
      refinement.addIssue({ code: 'custom', message: 'Duplicate grant context.' });
    }
  });

export const adminOnboardingStartSchema = z
  .object({
    decision: z.literal('ready'),
    bootstrapGrantId: z.uuid(),
    organizationId: z.uuid(),
    organizationName: z.string().trim().min(2).max(160),
    grantVersion: z.number().int().positive(),
    replayed: z.boolean(),
    correlationId: z.uuid(),
    factorState: z.enum(['enrollment_required', 'challenge_required']),
  })
  .strict();

export const adminOnboardingCompleteSchema = z
  .object({
    decision: z.enum(['completed', 'already_completed']),
    bootstrapGrantId: z.uuid(),
    organizationId: z.uuid(),
    organizationName: z.string().trim().min(2).max(160),
    membershipId: z.uuid(),
    grantVersion: z.number().int().positive(),
    correlationId: z.uuid(),
  })
  .strict();

export type AdminBootstrapGrant = z.infer<typeof adminBootstrapGrantSchema>;
export type AdminOnboardingStatus = z.infer<typeof adminOnboardingStatusSchema>;
export type AdminOnboardingStart = z.infer<typeof adminOnboardingStartSchema>;
export type AdminOnboardingComplete = z.infer<typeof adminOnboardingCompleteSchema>;

export type TotpPreparation =
  | {
      kind: 'enrollment';
      factorId: string;
      qrSvg: string;
      manualSecret: string;
    }
  | {
      kind: 'challenge';
      factorId: string;
    };

export function createOpaqueIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
