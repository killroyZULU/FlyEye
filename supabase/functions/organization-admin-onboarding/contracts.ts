import { z } from 'zod';
import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';

export const MAX_REQUEST_BYTES = 4096;
const idempotencyKeySchema = z.string().regex(/^[0-9a-f]{32,128}$/);

export const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z
    .object({
      action: z.literal('start'),
      bootstrapGrantId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('complete'),
      bootstrapGrantId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('cancel'),
      bootstrapGrantId: z.uuid(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
]);

const safeGrantSchema = z
  .object({
    bootstrapGrantId: z.uuid(),
    organizationId: z.uuid(),
    organizationName: z.string().trim().min(2).max(160),
    grantVersion: z.number().int().positive(),
    expiresAt: z.string().min(1).max(80),
  })
  .strict();

export const statusResultSchema = z
  .object({
    grants: z.array(safeGrantSchema).max(16),
    correlationId: z.uuid(),
  })
  .strict()
  .superRefine((result, refinement) => {
    const grantIds = result.grants.map((grant) => grant.bootstrapGrantId);
    if (new Set(grantIds).size !== grantIds.length) {
      refinement.addIssue({ code: 'custom', message: 'Duplicate grant context.' });
    }
  });

export const startResultSchema = z
  .object({
    decision: z.enum(['ready', 'not_available', 'expired', 'conflict']),
    bootstrapGrantId: z.uuid().optional(),
    organizationId: z.uuid().optional(),
    organizationName: z.string().trim().min(2).max(160).optional(),
    grantVersion: z.number().int().positive().optional(),
    replayed: z.boolean().optional(),
    correlationId: z.uuid(),
  })
  .strict();

export const cancelResultSchema = z
  .object({
    decision: z.enum(['cancelled', 'not_available']),
    cleanupOutcome: z.literal('not_attempted'),
    replayed: z.boolean().optional(),
    correlationId: z.uuid(),
  })
  .strict();

export const completeResultSchema = z
  .object({
    decision: z.enum([
      'completed',
      'already_completed',
      'not_available',
      'expired',
      'conflict',
      'recent_authentication_required',
    ]),
    bootstrapGrantId: z.uuid().optional(),
    organizationId: z.uuid().optional(),
    organizationName: z.string().trim().min(2).max(160).optional(),
    membershipId: z.uuid().optional(),
    grantVersion: z.number().int().positive().optional(),
    correlationId: z.uuid(),
  })
  .strict();

export type AdminOnboardingAction = z.infer<typeof requestSchema>['action'];

export type LimiterDecision = {
  allowed: boolean;
  retryAfterSeconds: number | null;
  correlationId: string;
  networkSourceUsed: false;
  policyVersion: 'subject-action-v1';
};

export type AdminOnboardingDependencies = {
  allowedOrigin: string;
  authenticate: (accessToken: string) => Promise<VerifiedAuthenticationEvidence>;
  listFactors: (actorUserId: string) => Promise<unknown>;
  consumeLimit: (input: {
    actorSubjectId: string;
    action: AdminOnboardingAction;
    correlationId: string;
  }) => Promise<LimiterDecision>;
  recordDenied: (input: {
    actor: VerifiedAuthenticationEvidence;
    eventName: 'admin_onboarding.denied' | 'admin_onboarding.conflict';
    correlationId: string;
    reasonCode: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  status: (input: { actorUserId: string; correlationId: string }) => Promise<unknown>;
  start: (input: {
    actorUserId: string;
    bootstrapGrantId: string;
    expectedVersion: number;
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  complete: (input: {
    actor: VerifiedAuthenticationEvidence;
    verifiedTotpFactorId: string;
    totalFactorCount: number;
    bootstrapGrantId: string;
    expectedVersion: number;
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  cancel: (input: {
    actorUserId: string;
    bootstrapGrantId: string;
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  createCorrelationId?: () => string;
  nowSeconds?: () => number;
};

export type AdminOnboardingRequest = z.infer<typeof requestSchema>;
export type AdminOnboardingContext = {
  dependencies: AdminOnboardingDependencies;
  actor: VerifiedAuthenticationEvidence;
  allowedOrigin: string;
  correlationId: string;
};
