import { z } from 'zod';
import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';

const idempotencyKeySchema = z.string().regex(/^[0-9a-f]{32,128}$/);
const baseMutationSchema = {
  organizationId: z.uuid(),
  invitationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: idempotencyKeySchema,
};

export const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), organizationId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('create'),
      organizationId: z.uuid(),
      email: z.string().min(3).max(254),
      roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z.object({ action: z.literal('resend'), ...baseMutationSchema }).strict(),
  z.object({ action: z.literal('revoke'), ...baseMutationSchema }).strict(),
  z
    .object({
      action: z.literal('prepare'),
      invitationId: z.uuid(),
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal('accept'),
      invitationId: z.uuid(),
      expectedVersion: z.number().int().positive(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
]);

const roleSchema = z
  .object({ code: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/), label: z.string().min(2).max(80) })
  .strict();
const invitationSchema = z
  .object({
    invitationId: z.uuid(),
    email: z.string().min(3).max(254),
    roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    roleLabel: z.string().min(2).max(80),
    status: z.enum([
      'issuing',
      'pending',
      'delivery_failed',
      'delivery_uncertain',
      'accepted',
      'expired',
      'superseded',
      'revoked',
    ]),
    version: z.number().int().positive(),
    issuedAt: z.string().min(1).max(80),
    expiresAt: z.string().min(1).max(80),
  })
  .strict();
export const listResultSchema = z
  .object({
    decision: z.literal('listed'),
    organizationId: z.uuid(),
    invitations: z.array(invitationSchema).max(100),
    roles: z.array(roleSchema).max(64),
    correlationId: z.uuid(),
  })
  .strict();
export const beginResultSchema = z
  .object({
    decision: z.enum([
      'issuing',
      'pending',
      'delivery_failed',
      'delivery_uncertain',
      'accepted',
      'expired',
      'superseded',
      'revoked',
      'not_available',
      'conflict',
    ]),
    invitationId: z.uuid().optional(),
    email: z.string().min(3).max(254).optional(),
    version: z.number().int().positive().optional(),
    expiresAt: z.string().min(1).max(80).optional(),
    replayed: z.boolean().optional(),
    correlationId: z.uuid(),
  })
  .strict();
export const stateResultSchema = z
  .object({
    decision: z.enum([
      'pending',
      'delivery_failed',
      'delivery_uncertain',
      'revoked',
      'accepted',
      'not_available',
      'conflict',
      'recent_authentication_required',
    ]),
    invitationId: z.uuid().optional(),
    organizationId: z.uuid().optional(),
    membershipId: z.uuid().optional(),
    version: z.number().int().positive().optional(),
    replayed: z.boolean().optional(),
    correlationId: z.uuid(),
  })
  .strict();
export const preparationResultSchema = z
  .object({
    decision: z.enum(['prepared', 'not_available']),
    invitationId: z.uuid().optional(),
    credentialMode: z.enum(['new', 'existing']).optional(),
    version: z.number().int().positive().optional(),
    correlationId: z.uuid(),
  })
  .strict();

export type MemberInvitationAction = z.infer<typeof requestSchema>['action'];
export type DeliveryResult = {
  outcome: 'accepted' | 'failed' | 'uncertain';
  operationClass: 'new_identity_invite' | 'existing_identity_sign_in';
};
export type InvitationLimiterDecision = {
  allowed: boolean;
  retryAfterSeconds: number | null;
  correlationId: string;
  networkSourceUsed: false;
  policyVersion: 'invitation-subject-scope-v1';
};
export type MemberInvitationDependencies = {
  allowedOrigin: string;
  authenticate: (accessToken: string) => Promise<
    VerifiedAuthenticationEvidence & {
      confirmedEmail: string | null;
    }
  >;
  resolveLimitScope: (input: {
    actorUserId: string;
    action: MemberInvitationAction;
    organizationId: string | null;
    invitationId: string | null;
    confirmedEmail: string | null;
  }) => Promise<string>;
  consumeLimit: (input: {
    actorSubjectId: string;
    action: MemberInvitationAction;
    scopeId: string;
    correlationId: string;
  }) => Promise<InvitationLimiterDecision>;
  recordDenied: (input: {
    actorUserId: string;
    eventName: 'member_invitation.denied' | 'member_invitation.conflicted';
    reasonCode: string;
    correlationId: string;
  }) => Promise<void>;
  list: (input: {
    actorUserId: string;
    organizationId: string;
    correlationId: string;
  }) => Promise<unknown>;
  beginCreate: (input: {
    actorUserId: string;
    organizationId: string;
    email: string;
    roleCode: string;
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  beginResend: (input: {
    actorUserId: string;
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  finalizeDelivery: (input: {
    actorUserId: string;
    invitationId: string;
    deliveryOperationId: string;
    delivery: DeliveryResult;
    correlationId: string;
  }) => Promise<unknown>;
  send: (input: {
    invitationId: string;
    invitationVersion: number;
    email: string;
  }) => Promise<DeliveryResult>;
  revoke: (input: {
    actorUserId: string;
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  prepare: (input: {
    actorUserId: string;
    confirmedEmail: string;
    invitationId: string;
    expectedVersion: number;
    correlationId: string;
  }) => Promise<unknown>;
  accept: (input: {
    actor: VerifiedAuthenticationEvidence;
    confirmedEmail: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  createCorrelationId?: () => string;
  nowSeconds?: () => number;
};

export type MemberInvitationRequest = z.infer<typeof requestSchema>;
export type InvitationActor = Awaited<ReturnType<MemberInvitationDependencies['authenticate']>>;
