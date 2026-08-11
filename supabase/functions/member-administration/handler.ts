import { z } from 'zod';

import {
  passwordAuthenticationIsRecent,
  type VerifiedAuthenticationEvidence,
} from '../_shared/authentication-evidence.ts';

const MAX_REQUEST_BYTES = 8192;
const idempotencyKeySchema = z.string().regex(/^[0-9a-f]{32,128}$/);
const memberStatusSchema = z.enum(['active', 'suspended', 'revoked']);
const searchSchema = z.string().trim().toLowerCase().min(2).max(80);
const statusActionSchema = z.enum(['suspend', 'reactivate', 'revoke']);
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

const requestSchema = z.discriminatedUnion('action', [
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

const databaseListSchema = z
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

const detailResultSchema = z
  .object({
    decision: z.literal('found'),
    organizationId: z.uuid(),
    member: memberDetailSchema,
    correlationId: z.uuid(),
  })
  .strict();

const profileResultSchema = z
  .object({
    decision: z.enum(['found', 'updated']),
    profile: profileSchema,
    correlationId: z.uuid(),
  })
  .strict();

const statusResultSchema = z
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

const decisionSchema = z
  .object({
    decision: z.enum([
      'validation_failed',
      'not_found',
      'state_conflict',
      'last_administrator',
      'self_action',
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
  createCorrelationId?: () => string;
  nowSeconds?: () => number;
};

class RequestTooLargeError extends Error {}

function headers(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
}

function json(origin: string, status: number, body: object, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers(origin), ...extra } });
}

async function readBody(request: Request): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) throw new RequestTooLargeError();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(combined);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requestHints(request: z.infer<typeof requestSchema>) {
  return {
    organizationId: 'organizationId' in request ? request.organizationId : null,
    membershipId: 'membershipId' in request ? request.membershipId : null,
  };
}

function requiresAal2(action: MemberAdministrationAction): boolean {
  return ['list', 'detail', 'suspend', 'reactivate', 'revoke'].includes(action);
}

function requiresFreshPassword(action: MemberAdministrationAction): boolean {
  return ['suspend', 'reactivate', 'revoke'].includes(action);
}

function failure(origin: string, decision: string, correlationId: string): Response {
  const table: Record<string, { status: number; code: string; message: string }> = {
    validation_failed: {
      status: 422,
      code: 'member_administration.validation_failed',
      message: 'The member request is invalid.',
    },
    not_found: {
      status: 404,
      code: 'member_administration.not_found',
      message: 'The requested member information is not available.',
    },
    state_conflict: {
      status: 409,
      code: 'member_administration.state_conflict',
      message: 'The member information changed. Refresh and try again.',
    },
    last_administrator: {
      status: 409,
      code: 'member_administration.last_administrator',
      message: 'At least one active Organization Admin must remain.',
    },
    self_action: {
      status: 403,
      code: 'member_administration.self_action',
      message: 'You cannot change your own membership status.',
    },
  };
  const item = table[decision] ?? {
    status: 503,
    code: 'member_administration.service_unavailable',
    message: 'Member administration is temporarily unavailable.',
  };
  return json(origin, item.status, {
    error: { code: item.code, message: item.message },
    correlationId,
  });
}

async function auditFailure(
  dependencies: MemberAdministrationDependencies,
  request: z.infer<typeof requestSchema>,
  actorUserId: string,
  decision: string,
  correlationId: string,
): Promise<boolean> {
  const hints = requestHints(request);
  try {
    await dependencies.recordDenied({
      actorUserId,
      eventName:
        decision === 'state_conflict' || decision === 'last_administrator'
          ? 'member_administration.conflicted'
          : 'member_administration.denied',
      reasonCode: decision,
      correlationId,
      ...hints,
    });
    return true;
  } catch (error) {
    if (error instanceof MemberAdministrationAuditWriteError)
      reportAuditFailure(dependencies, request.action, correlationId);
    return false;
  }
}

function reportAuditFailure(
  dependencies: MemberAdministrationDependencies,
  action: MemberAdministrationAction,
  correlationId: string,
): void {
  try {
    dependencies.reportAuditFailure({ action, correlationId });
  } catch {
    // The protected operation remains fail closed even when telemetry is unavailable.
  }
}

export function createMemberAdministrationHandler(
  dependencies: MemberAdministrationDependencies,
): (request: Request) => Promise<Response> {
  const createCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());
  const nowSeconds = dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  return async (request: Request): Promise<Response> => {
    const origin = dependencies.allowedOrigin;
    if (request.headers.get('origin') !== origin) {
      return json(origin, 403, {
        error: {
          code: 'member_administration.origin_denied',
          message: 'This request is not allowed.',
        },
      });
    }
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== 'POST') {
      return json(origin, 405, {
        error: {
          code: 'member_administration.method_not_allowed',
          message: 'This request is not supported.',
        },
      });
    }

    const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') ?? '');
    if (!match?.[1]) {
      return json(origin, 401, {
        error: {
          code: 'member_administration.authentication_required',
          message: 'Sign in to continue.',
        },
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(request));
    } catch (error) {
      return json(origin, error instanceof RequestTooLargeError ? 413 : 400, {
        error: {
          code:
            error instanceof RequestTooLargeError
              ? 'member_administration.request_too_large'
              : 'member_administration.invalid_request',
          message:
            error instanceof RequestTooLargeError
              ? 'The request is too large.'
              : 'The request is invalid.',
        },
      });
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return json(origin, 422, {
        error: {
          code: 'member_administration.invalid_request',
          message: 'The request is invalid.',
        },
      });
    }

    let actor: VerifiedAuthenticationEvidence;
    try {
      actor = await dependencies.authenticate(match[1]);
    } catch {
      return json(origin, 401, {
        error: {
          code: 'member_administration.authentication_required',
          message: 'Sign in to continue.',
        },
      });
    }

    const correlationId = createCorrelationId();
    const hints = requestHints(parsed.data);
    let scopeId: string;
    try {
      scopeId = await dependencies.resolveLimitScope({
        actorUserId: actor.actorUserId,
        action: parsed.data.action,
        ...hints,
      });
    } catch {
      return failure(origin, 'service_unavailable', correlationId);
    }

    let limit: AdministrationLimiterDecision;
    try {
      limit = await dependencies.consumeLimit({
        actorSubjectId: actor.actorSubjectId,
        action: parsed.data.action,
        scopeId,
        correlationId,
      });
    } catch {
      return failure(origin, 'service_unavailable', correlationId);
    }
    if (
      limit.correlationId !== correlationId ||
      limit.networkSourceUsed !== false ||
      limit.policyVersion !== 'member-administration-subject-scope-v1'
    ) {
      return failure(origin, 'service_unavailable', correlationId);
    }
    if (!limit.allowed) {
      const retry = limit.retryAfterSeconds;
      if (
        retry === null ||
        retry < 1 ||
        retry > 3600 ||
        !(await auditFailure(
          dependencies,
          parsed.data,
          actor.actorUserId,
          'rate_limited',
          correlationId,
        ))
      ) {
        return failure(origin, 'service_unavailable', correlationId);
      }
      return json(
        origin,
        429,
        {
          error: {
            code: 'member_administration.rate_limited',
            message: `Wait ${retry} seconds before trying again.`,
          },
          correlationId,
        },
        { 'Retry-After': String(retry) },
      );
    }

    let profileAssurance: 'aal1' | 'aal2' | 'denied' = 'denied';
    if (parsed.data.action === 'get_profile' || parsed.data.action === 'update_profile') {
      try {
        profileAssurance = await dependencies.resolveProfileAssurance({
          actorUserId: actor.actorUserId,
          membershipId: parsed.data.membershipId,
        });
      } catch {
        return failure(origin, 'service_unavailable', correlationId);
      }
      if (profileAssurance === 'denied') {
        if (
          !(await auditFailure(
            dependencies,
            parsed.data,
            actor.actorUserId,
            'not_found',
            correlationId,
          ))
        ) {
          return failure(origin, 'service_unavailable', correlationId);
        }
        return failure(origin, 'not_found', correlationId);
      }
    }

    const assuranceInvalid =
      (requiresAal2(parsed.data.action) || profileAssurance === 'aal2') &&
      (actor.assuranceLevel !== 'aal2' || actor.totpAuthenticatedAt === null);
    const passwordInvalid =
      requiresFreshPassword(parsed.data.action) &&
      !passwordAuthenticationIsRecent(actor, nowSeconds());
    if (assuranceInvalid || passwordInvalid) {
      const reason = assuranceInvalid
        ? 'authentication_assurance_required'
        : 'recent_authentication_required';
      if (
        !(await auditFailure(dependencies, parsed.data, actor.actorUserId, reason, correlationId))
      ) {
        return failure(origin, 'service_unavailable', correlationId);
      }
      return json(origin, 403, {
        error: {
          code: `member_administration.${reason}`,
          message: assuranceInvalid
            ? 'Verify your authenticator to continue.'
            : 'Sign in with your password again to continue.',
        },
        correlationId,
      });
    }

    try {
      let result: unknown;
      switch (parsed.data.action) {
        case 'list': {
          let boundary: CursorBoundary | null = null;
          if (parsed.data.cursor) {
            try {
              boundary = await dependencies.decodeCursor(
                parsed.data.cursor,
                parsed.data.status ?? null,
                parsed.data.search ?? null,
              );
            } catch {
              if (
                !(await auditFailure(
                  dependencies,
                  parsed.data,
                  actor.actorUserId,
                  'validation_failed',
                  correlationId,
                ))
              ) {
                return failure(origin, 'service_unavailable', correlationId);
              }
              return failure(origin, 'validation_failed', correlationId);
            }
          }
          const rawList = await dependencies.list({
            actorUserId: actor.actorUserId,
            organizationId: parsed.data.organizationId,
            status: parsed.data.status ?? null,
            search: parsed.data.search ?? null,
            boundary,
            correlationId,
          });
          const listed = databaseListSchema.safeParse(rawList);
          if (
            listed.success &&
            listed.data.correlationId === correlationId &&
            listed.data.organizationId === parsed.data.organizationId
          ) {
            const nextCursor = listed.data.hasMore
              ? await dependencies.encodeCursor(
                  {
                    createdAt: listed.data.nextCreatedAt!,
                    membershipId: listed.data.nextMembershipId!,
                  },
                  parsed.data.status ?? null,
                  parsed.data.search ?? null,
                )
              : undefined;
            return json(origin, 200, {
              decision: 'listed',
              organizationId: listed.data.organizationId,
              members: listed.data.members,
              nextCursor,
              correlationId,
            });
          }
          result = rawList;
          break;
        }
        case 'detail': {
          const rawDetail = await dependencies.detail({
            actorUserId: actor.actorUserId,
            organizationId: parsed.data.organizationId,
            membershipId: parsed.data.membershipId,
            correlationId,
          });
          const detailed = detailResultSchema.safeParse(rawDetail);
          if (
            detailed.success &&
            detailed.data.correlationId === correlationId &&
            detailed.data.organizationId === parsed.data.organizationId &&
            detailed.data.member.membershipId === parsed.data.membershipId
          ) {
            return json(origin, 200, detailed.data);
          }
          result = rawDetail;
          break;
        }
        case 'get_profile':
        case 'update_profile': {
          result =
            parsed.data.action === 'get_profile'
              ? await dependencies.getProfile({
                  actorUserId: actor.actorUserId,
                  membershipId: parsed.data.membershipId,
                  correlationId,
                })
              : await dependencies.updateProfile({
                  actorUserId: actor.actorUserId,
                  membershipId: parsed.data.membershipId,
                  displayName: parsed.data.displayName,
                  contactNumber: parsed.data.contactNumber,
                  expectedVersion: parsed.data.expectedVersion,
                  correlationId,
                });
          const profile = profileResultSchema.safeParse(result);
          if (
            profile.success &&
            profile.data.correlationId === correlationId &&
            profile.data.profile.membershipId === parsed.data.membershipId
          ) {
            return json(origin, 200, profile.data);
          }
          break;
        }
        case 'suspend':
        case 'reactivate':
        case 'revoke': {
          result = await dependencies.changeStatus({
            actorUserId: actor.actorUserId,
            organizationId: parsed.data.organizationId,
            membershipId: parsed.data.membershipId,
            action: parsed.data.action,
            reasonCode: parsed.data.reasonCode,
            expectedVersion: parsed.data.expectedVersion,
            idempotencyKeyHash: await sha256(parsed.data.idempotencyKey),
            correlationId,
          });
          const changed = statusResultSchema.safeParse(result);
          const expectedStatus =
            parsed.data.action === 'suspend'
              ? 'suspended'
              : parsed.data.action === 'reactivate'
                ? 'active'
                : 'revoked';
          if (
            changed.success &&
            changed.data.correlationId === correlationId &&
            changed.data.organizationId === parsed.data.organizationId &&
            changed.data.membershipId === parsed.data.membershipId &&
            changed.data.decision === expectedStatus &&
            changed.data.status === expectedStatus
          ) {
            return json(origin, 200, changed.data);
          }
          break;
        }
      }

      const decision = decisionSchema.safeParse(result);
      const safeDecision = decision.success ? decision.data.decision : 'service_unavailable';
      if (
        safeDecision !== 'service_unavailable' &&
        !(await auditFailure(
          dependencies,
          parsed.data,
          actor.actorUserId,
          safeDecision,
          correlationId,
        ))
      ) {
        return failure(origin, 'service_unavailable', correlationId);
      }
      return failure(origin, safeDecision, correlationId);
    } catch (error) {
      if (error instanceof MemberAdministrationAuditWriteError) {
        reportAuditFailure(dependencies, parsed.data.action, correlationId);
      }
      return failure(origin, 'service_unavailable', correlationId);
    }
  };
}
