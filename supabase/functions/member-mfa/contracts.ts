import { z } from 'zod';
import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';

export const MAX_REQUEST_BYTES = 4096;
const idempotencyKeySchema = z.string().regex(/^[0-9a-f]{32,128}$/);
export const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('start'), idempotencyKey: idempotencyKeySchema }).strict(),
  z
    .object({
      action: z.literal('bind_factor'),
      operationId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      factorId: z.uuid(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('complete'),
      operationId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('cancel'),
      operationId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      factorId: z.uuid().optional(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
]);

export const databaseDecisionSchema = z
  .object({ decision: z.string().min(1).max(64), correlationId: z.uuid() })
  .passthrough();
export const databaseStatusSchema = z
  .object({
    decision: z.string().min(1).max(64),
    organizationId: z.uuid().optional(),
    organizationName: z.string().trim().min(2).max(160).optional(),
    membershipId: z.uuid().optional(),
    ready: z.boolean().optional(),
    operationState: z.enum(['started', 'bound']).optional(),
    operationId: z.uuid().optional(),
    operationVersion: z.number().int().positive().optional(),
    correlationId: z.uuid(),
  })
  .strict();

export type MemberMfaAction = z.infer<typeof requestSchema>['action'];
export type MemberMfaLimiterDecision = {
  allowed: boolean;
  retryAfterSeconds: number | null;
  correlationId: string;
  networkSourceUsed: false;
  policyVersion: 'member-mfa-subject-action-v1';
};

export type MemberMfaDependencies = {
  allowedOrigin: string;
  authenticate: (token: string) => Promise<VerifiedAuthenticationEvidence>;
  listFactors: (userId: string) => Promise<unknown>;
  consumeLimit: (input: {
    actorSubjectId: string;
    action: MemberMfaAction;
    correlationId: string;
  }) => Promise<MemberMfaLimiterDecision>;
  recordDenied: (input: {
    actorUserId: string;
    eventName: 'member_mfa.denied' | 'member_mfa.conflict';
    correlationId: string;
    reasonCode: string;
    operationId?: string;
  }) => Promise<void>;
  status: (input: {
    actorUserId: string;
    factorReferenceHash: string | null;
    correlationId: string;
  }) => Promise<unknown>;
  start: (input: {
    actorUserId: string;
    factorReferenceHash: string | null;
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  bindFactor: (input: {
    actorUserId: string;
    operationId: string;
    expectedVersion: number;
    factorReferenceHash: string;
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  complete: (input: {
    actor: VerifiedAuthenticationEvidence;
    operationId: string;
    expectedVersion: number;
    factorReferenceHash: string;
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  cancel: (input: {
    actorUserId: string;
    operationId: string;
    expectedVersion: number;
    factorReferenceHash: string | null;
    cleanupOutcome: 'not_required' | 'unverified_removed' | 'verified_retained';
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  createCorrelationId?: () => string;
  nowSeconds?: () => number;
};

export type MemberMfaRequest = z.infer<typeof requestSchema>;
export type MemberMfaContext = {
  dependencies: MemberMfaDependencies;
  actor: VerifiedAuthenticationEvidence;
  origin: string;
  correlationId: string;
  nowSeconds: () => number;
};
