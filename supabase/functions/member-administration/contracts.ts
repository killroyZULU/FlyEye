import { z } from 'zod';
import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';

export const MAX_REQUEST_BYTES = 8192;
const idempotencyKeySchema = z.string().regex(/^[0-9a-f]{32,128}$/);
const memberStatusSchema = z.enum(['active', 'suspended', 'revoked']);
const searchSchema = z.string().trim().toLowerCase().min(2).max(80);
const statusActionSchema = z.enum(['suspend', 'reactivate', 'revoke']);
const roleReasonSchema = z.enum(['responsibility_changed', 'assignment_corrected']);
const roleOptionSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    label: z.string().min(2).max(80),
    requiresMfa: z.boolean(),
  })
  .strict();
const roleReasonOptionSchema = z
  .object({ code: roleReasonSchema, label: z.string().min(2).max(80) })
  .strict();
const statusReasonOptionSchema = z
  .object({
    action: statusActionSchema,
    code: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    label: z.string().min(2).max(80),
  })
  .strict();
const contactNumberSchema = z
  .string()
  .trim()
  .max(32)
  .refine((value) => value === '' || /^[0-9 +().-]+$/.test(value));

export const requestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('list'),
      organizationId: z.uuid(),
      status: memberStatusSchema.optional(),
      search: searchSchema.optional(),
      cursor: z.string().min(32).max(1024).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('detail'),
      organizationId: z.uuid(),
      membershipId: z.uuid(),
    })
    .strict(),
  z.object({ action: z.literal('get_profile'), membershipId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('update_profile'),
      membershipId: z.uuid(),
      displayName: z.string().trim().min(2).max(80),
      contactNumber: contactNumberSchema,
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
  ...(['suspend', 'reactivate', 'revoke'] as const).map((action) =>
    z
      .object({
        action: z.literal(action),
        organizationId: z.uuid(),
        membershipId: z.uuid(),
        reasonCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
        expectedVersion: z.number().int().positive(),
        idempotencyKey: idempotencyKeySchema,
      })
      .strict(),
  ),
  z
    .object({
      action: z.literal('assign_role'),
      organizationId: z.uuid(),
      membershipId: z.uuid(),
      roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
      reasonCode: roleReasonSchema,
      expectedVersion: z.number().int().positive(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
]);

const memberSummarySchema = z
  .object({
    membershipId: z.uuid(),
    displayName: z.string().min(2).max(80).nullable(),
    email: z.email().max(254),
    roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    roleLabel: z.string().min(2).max(80),
    status: memberStatusSchema,
    membershipVersion: z.number().int().positive(),
    profileVersion: z.number().int().positive(),
    profileComplete: z.boolean(),
    createdAt: z.string().min(1).max(80),
  })
  .strict();

const memberDetailSchema = memberSummarySchema
  .extend({
    contactNumber: z.string().max(32).nullable(),
    statusReasonOptions: z.array(statusReasonOptionSchema).max(4),
    roleOptions: z.array(roleOptionSchema).max(50),
    roleReasonOptions: z.array(roleReasonOptionSchema).max(2),
    updatedAt: z.string().min(1).max(80),
  })
  .strict();

const profileSchema = z
  .object({
    organizationId: z.uuid(),
    organizationName: z.string().min(2).max(160),
    membershipId: z.uuid(),
    displayName: z.string().min(2).max(80).nullable(),
    contactNumber: z.string().max(32).nullable(),
    email: z.email().max(254),
    roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    roleLabel: z.string().min(2).max(80),
    status: z.literal('active'),
    version: z.number().int().positive(),
    complete: z.boolean(),
  })
  .strict();

export const databaseListSchema = z
  .object({
    decision: z.literal('listed'),
    organizationId: z.uuid(),
    members: z.array(memberSummarySchema).max(50),
    hasMore: z.boolean(),
    nextCreatedAt: z.string().min(1).max(80).optional(),
    nextMembershipId: z.uuid().optional(),
    correlationId: z.uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.hasMore !== Boolean(value.nextCreatedAt && value.nextMembershipId)) {
      context.addIssue({ code: 'custom', message: 'Pagination state is inconsistent.' });
    }
  });

export const detailResultSchema = z
  .object({
    decision: z.literal('found'),
    organizationId: z.uuid(),
    member: memberDetailSchema,
    correlationId: z.uuid(),
  })
  .strict();

export const profileResultSchema = z
  .object({
    decision: z.enum(['found', 'updated']),
    profile: profileSchema,
    correlationId: z.uuid(),
  })
  .strict();

export const statusResultSchema = z
  .object({
    decision: z.enum(['active', 'suspended', 'revoked']),
    membershipId: z.uuid(),
    organizationId: z.uuid(),
    status: memberStatusSchema,
    roleCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{2,63}$/)
      .optional(),
    roleLabel: z.string().min(2).max(80).optional(),
    version: z.number().int().positive(),
    replayed: z.boolean(),
    correlationId: z.uuid(),
  })
  .strict();

export const roleAssignmentContextSchema = z
  .object({
    decision: z.literal('authorized'),
    organizationId: z.uuid(),
    membershipId: z.uuid(),
    targetUserId: z.uuid(),
    newRoleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    requiresMfa: z.boolean(),
    correlationId: z.uuid(),
  })
  .strict();

export const roleResultSchema = z
  .object({
    decision: z.literal('changed'),
    membershipId: z.uuid(),
    organizationId: z.uuid(),
    roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    roleLabel: z.string().min(2).max(80),
    version: z.number().int().positive(),
    replayed: z.boolean(),
    correlationId: z.uuid(),
  })
  .strict();

export const decisionSchema = z
  .object({
    decision: z.enum([
      'validation_failed',
      'not_found',
      'state_conflict',
      'last_administrator',
      'self_action',
      'target_mfa_not_ready',
    ]),
    correlationId: z.uuid(),
  })
  .passthrough();

export type MemberAdministrationAction = z.infer<typeof requestSchema>['action'];
export type CursorBoundary = { createdAt: string; membershipId: string };
export type AdministrationLimiterDecision = {
  allowed: boolean;
  retryAfterSeconds: number | null;
  correlationId: string;
  networkSourceUsed: false;
  policyVersion: 'member-administration-subject-scope-v1';
};

export class MemberAdministrationAuditWriteError extends Error {
  constructor() {
    super('Member administration audit write failed.');
    this.name = 'MemberAdministrationAuditWriteError';
  }
}

export type MemberAdministrationDependencies = {
  allowedOrigin: string;
  authenticate: (accessToken: string) => Promise<VerifiedAuthenticationEvidence>;
  resolveLimitScope: (input: {
    actorUserId: string;
    action: MemberAdministrationAction;
    organizationId: string | null;
    membershipId: string | null;
  }) => Promise<string>;
  resolveProfileAssurance: (input: {
    actorUserId: string;
    membershipId: string;
  }) => Promise<'aal1' | 'aal2' | 'denied'>;
  listFactors: (userId: string) => Promise<unknown>;
  consumeLimit: (input: {
    actorSubjectId: string;
    action: MemberAdministrationAction;
    scopeId: string;
    correlationId: string;
  }) => Promise<AdministrationLimiterDecision>;
  recordDenied: (input: {
    actorUserId: string;
    eventName: 'member_administration.denied' | 'member_administration.conflicted';
    reasonCode: string;
    correlationId: string;
    organizationId: string | null;
    membershipId: string | null;
  }) => Promise<void>;
  reportAuditFailure: (input: {
    action: MemberAdministrationAction;
    correlationId: string;
  }) => void;
  decodeCursor: (
    cursor: string,
    status: string | null,
    search: string | null,
  ) => Promise<CursorBoundary>;
  encodeCursor: (
    boundary: CursorBoundary,
    status: string | null,
    search: string | null,
  ) => Promise<string>;
  list: (input: {
    actorUserId: string;
    organizationId: string;
    status: string | null;
    search: string | null;
    boundary: CursorBoundary | null;
    correlationId: string;
  }) => Promise<unknown>;
  detail: (input: {
    actorUserId: string;
    organizationId: string;
    membershipId: string;
    correlationId: string;
  }) => Promise<unknown>;
  getProfile: (input: {
    actorUserId: string;
    membershipId: string;
    correlationId: string;
  }) => Promise<unknown>;
  updateProfile: (input: {
    actorUserId: string;
    membershipId: string;
    displayName: string;
    contactNumber: string;
    expectedVersion: number;
    correlationId: string;
  }) => Promise<unknown>;
  changeStatus: (input: {
    actorUserId: string;
    organizationId: string;
    membershipId: string;
    action: 'suspend' | 'reactivate' | 'revoke';
    reasonCode: string;
    expectedVersion: number;
    idempotencyKeyHash: string;
    correlationId: string;
  }) => Promise<unknown>;
  resolveRoleContext: (input: {
    actorUserId: string;
    organizationId: string;
    membershipId: string;
    roleCode: string;
    expectedVersion: number;
    correlationId: string;
  }) => Promise<unknown>;
  changeRole: (input: {
    actorUserId: string;
    organizationId: string;
    membershipId: string;
    roleCode: string;
    reasonCode: z.infer<typeof roleReasonSchema>;
    expectedVersion: number;
    idempotencyKeyHash: string;
    factorReferenceHash: string | null;
    correlationId: string;
  }) => Promise<unknown>;
  createCorrelationId?: () => string;
  nowSeconds?: () => number;
};

export type MemberAdministrationRequest = z.infer<typeof requestSchema>;
export type AdministrationContext = {
  dependencies: MemberAdministrationDependencies;
  actor: VerifiedAuthenticationEvidence;
  origin: string;
  correlationId: string;
};
