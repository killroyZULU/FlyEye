import { z } from 'zod';

import {
  passwordAuthenticationIsRecent,
  type VerifiedAuthenticationEvidence,
} from '../_shared/authentication-evidence.ts';

const MAX_REQUEST_BYTES = 8192;
const idempotencyKeySchema = z.string().regex(/^[0-9a-f]{32,128}$/);
const baseMutationSchema = {
  organizationId: z.uuid(),
  invitationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: idempotencyKeySchema,
};

const requestSchema = z.discriminatedUnion('action', [
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
const listResultSchema = z
  .object({
    decision: z.literal('listed'),
    organizationId: z.uuid(),
    invitations: z.array(invitationSchema).max(100),
    roles: z.array(roleSchema).max(64),
    correlationId: z.uuid(),
  })
  .strict();
const beginResultSchema = z
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
const stateResultSchema = z
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
const preparationResultSchema = z
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

function failure(origin: string, decision: string, correlationId: string): Response {
  switch (decision) {
    case 'not_available':
      return json(origin, 404, {
        error: {
          code: 'member_invitation.not_available',
          message: 'This invitation is not available.',
        },
        correlationId,
      });
    case 'recent_authentication_required':
      return json(origin, 403, {
        error: {
          code: 'member_invitation.recent_authentication_required',
          message: 'Sign in with your password again to continue.',
        },
        correlationId,
      });
    case 'delivery_failed':
      return json(origin, 502, {
        error: {
          code: 'member_invitation.delivery_failed',
          message: 'The invitation could not be sent. It may be retried safely.',
        },
        correlationId,
      });
    case 'delivery_uncertain':
      return json(origin, 503, {
        error: {
          code: 'member_invitation.delivery_uncertain',
          message: 'The delivery result could not be confirmed. Wait before retrying.',
        },
        correlationId,
      });
    default:
      return json(origin, 409, {
        error: {
          code: 'member_invitation.conflict',
          message: 'The invitation state changed. Refresh and try again.',
        },
        correlationId,
      });
  }
}

function requiresAdminFreshness(action: MemberInvitationAction): boolean {
  return action === 'create' || action === 'resend' || action === 'revoke';
}

async function finalizeWithReadBack(
  dependencies: MemberInvitationDependencies,
  input: Parameters<MemberInvitationDependencies['finalizeDelivery']>[0],
): Promise<unknown> {
  try {
    return await dependencies.finalizeDelivery(input);
  } catch {
    return await dependencies.finalizeDelivery(input);
  }
}

export function createMemberInvitationsHandler(
  dependencies: MemberInvitationDependencies,
): (request: Request) => Promise<Response> {
  const createCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());
  const nowSeconds = dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  return async (request: Request): Promise<Response> => {
    const origin = dependencies.allowedOrigin;
    if (request.headers.get('origin') !== origin) {
      return json(origin, 403, {
        error: { code: 'member_invitation.origin_denied', message: 'This request is not allowed.' },
      });
    }
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== 'POST') {
      return json(origin, 405, {
        error: {
          code: 'member_invitation.method_not_allowed',
          message: 'This request is not supported.',
        },
      });
    }

    const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') ?? '');
    if (!match?.[1]) {
      return json(origin, 401, {
        error: {
          code: 'member_invitation.authentication_required',
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
              ? 'member_invitation.request_too_large'
              : 'member_invitation.invalid_request',
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
        error: { code: 'member_invitation.invalid_request', message: 'The request is invalid.' },
      });
    }

    let actor: Awaited<ReturnType<MemberInvitationDependencies['authenticate']>>;
    try {
      actor = await dependencies.authenticate(match[1]);
    } catch {
      return json(origin, 401, {
        error: {
          code: 'member_invitation.authentication_required',
          message: 'Sign in to continue.',
        },
      });
    }

    const correlationId = createCorrelationId();
    let scopeId: string;
    try {
      scopeId = await dependencies.resolveLimitScope({
        actorUserId: actor.actorUserId,
        action: parsed.data.action,
        organizationId: 'organizationId' in parsed.data ? parsed.data.organizationId : null,
        invitationId: 'invitationId' in parsed.data ? parsed.data.invitationId : null,
        confirmedEmail: actor.confirmedEmail,
      });
    } catch {
      return json(origin, 503, {
        error: {
          code: 'member_invitation.limiter_unavailable',
          message: 'Invitations are temporarily unavailable.',
        },
        correlationId,
      });
    }
    let limit: InvitationLimiterDecision;
    try {
      limit = await dependencies.consumeLimit({
        actorSubjectId: actor.actorSubjectId,
        action: parsed.data.action,
        scopeId,
        correlationId,
      });
    } catch {
      return json(origin, 503, {
        error: {
          code: 'member_invitation.limiter_unavailable',
          message: 'Invitations are temporarily unavailable.',
        },
        correlationId,
      });
    }
    if (
      limit.correlationId !== correlationId ||
      limit.networkSourceUsed !== false ||
      limit.policyVersion !== 'invitation-subject-scope-v1'
    ) {
      return json(origin, 503, {
        error: {
          code: 'member_invitation.limiter_unavailable',
          message: 'Invitations are temporarily unavailable.',
        },
        correlationId,
      });
    }
    if (!limit.allowed) {
      const retry = limit.retryAfterSeconds;
      if (retry === null || retry < 1 || retry > 3600) {
        return json(origin, 503, {
          error: {
            code: 'member_invitation.limiter_unavailable',
            message: 'Invitations are temporarily unavailable.',
          },
          correlationId,
        });
      }
      return json(
        origin,
        429,
        {
          error: {
            code: 'member_invitation.rate_limited',
            message: `Wait ${retry} seconds before trying again.`,
          },
          correlationId,
        },
        { 'Retry-After': String(retry) },
      );
    }

    const hasPassword = actor.authenticationMethods.includes('password');
    const assuranceInvalid =
      (parsed.data.action === 'list' || requiresAdminFreshness(parsed.data.action)) &&
      actor.assuranceLevel !== 'aal2';
    const passwordInvalid =
      (parsed.data.action === 'list' && !hasPassword) ||
      ((requiresAdminFreshness(parsed.data.action) || parsed.data.action === 'accept') &&
        !passwordAuthenticationIsRecent(actor, nowSeconds()));
    if (assuranceInvalid || passwordInvalid) {
      try {
        await dependencies.recordDenied({
          actorUserId: actor.actorUserId,
          eventName: 'member_invitation.denied',
          reasonCode: assuranceInvalid
            ? 'authentication_assurance_required'
            : 'recent_authentication_required',
          correlationId,
        });
      } catch {
        return json(origin, 503, {
          error: {
            code: 'member_invitation.audit_unavailable',
            message: 'The invitation action could not be verified.',
          },
          correlationId,
        });
      }
      return failure(origin, 'recent_authentication_required', correlationId);
    }

    try {
      switch (parsed.data.action) {
        case 'list': {
          const result = listResultSchema.safeParse(
            await dependencies.list({
              actorUserId: actor.actorUserId,
              organizationId: parsed.data.organizationId,
              correlationId,
            }),
          );
          if (!result.success) return failure(origin, 'not_available', correlationId);
          return json(origin, 200, result.data);
        }
        case 'create':
        case 'resend': {
          const keyHash = await sha256(parsed.data.idempotencyKey);
          const beginning = beginResultSchema.safeParse(
            parsed.data.action === 'create'
              ? await dependencies.beginCreate({
                  actorUserId: actor.actorUserId,
                  organizationId: parsed.data.organizationId,
                  email: parsed.data.email,
                  roleCode: parsed.data.roleCode,
                  idempotencyKeyHash: keyHash,
                  correlationId,
                })
              : await dependencies.beginResend({
                  actorUserId: actor.actorUserId,
                  organizationId: parsed.data.organizationId,
                  invitationId: parsed.data.invitationId,
                  expectedVersion: parsed.data.expectedVersion,
                  idempotencyKeyHash: keyHash,
                  correlationId,
                }),
          );
          if (!beginning.success) return failure(origin, 'conflict', correlationId);
          if (beginning.data.replayed) {
            if (
              beginning.data.decision === 'pending' &&
              beginning.data.invitationId &&
              beginning.data.version
            ) {
              return json(origin, 200, {
                decision: 'pending',
                invitationId: beginning.data.invitationId,
                version: beginning.data.version,
                replayed: true,
                correlationId,
              });
            }
            return failure(
              origin,
              beginning.data.decision === 'issuing'
                ? 'delivery_uncertain'
                : beginning.data.decision,
              correlationId,
            );
          }
          if (
            beginning.data.decision !== 'issuing' ||
            !beginning.data.invitationId ||
            !beginning.data.version ||
            !beginning.data.email
          ) {
            return failure(origin, beginning.data.decision, correlationId);
          }

          const operationId = createCorrelationId();
          let delivery: DeliveryResult;
          try {
            delivery = await dependencies.send({
              invitationId: beginning.data.invitationId,
              invitationVersion: beginning.data.version,
              email: beginning.data.email,
            });
          } catch {
            delivery = { outcome: 'uncertain', operationClass: 'new_identity_invite' };
          }

          let finalized: unknown;
          try {
            finalized = await finalizeWithReadBack(dependencies, {
              actorUserId: actor.actorUserId,
              invitationId: beginning.data.invitationId,
              deliveryOperationId: operationId,
              delivery,
              correlationId,
            });
          } catch {
            return failure(origin, 'delivery_uncertain', correlationId);
          }
          const result = stateResultSchema.safeParse(finalized);
          if (!result.success || result.data.decision !== 'pending') {
            return failure(
              origin,
              result.success ? result.data.decision : 'delivery_uncertain',
              correlationId,
            );
          }
          return json(origin, 200, result.data);
        }
        case 'revoke': {
          const result = stateResultSchema.safeParse(
            await dependencies.revoke({
              actorUserId: actor.actorUserId,
              organizationId: parsed.data.organizationId,
              invitationId: parsed.data.invitationId,
              expectedVersion: parsed.data.expectedVersion,
              idempotencyKeyHash: await sha256(parsed.data.idempotencyKey),
              correlationId,
            }),
          );
          if (!result.success || result.data.decision !== 'revoked') {
            return failure(
              origin,
              result.success ? result.data.decision : 'conflict',
              correlationId,
            );
          }
          return json(origin, 200, result.data);
        }
        case 'prepare': {
          if (!actor.confirmedEmail) {
            await dependencies.recordDenied({
              actorUserId: actor.actorUserId,
              eventName: 'member_invitation.denied',
              reasonCode: 'confirmed_email_required',
              correlationId,
            });
            return failure(origin, 'not_available', correlationId);
          }
          const result = preparationResultSchema.safeParse(
            await dependencies.prepare({
              actorUserId: actor.actorUserId,
              confirmedEmail: actor.confirmedEmail,
              invitationId: parsed.data.invitationId,
              expectedVersion: parsed.data.expectedVersion,
              correlationId,
            }),
          );
          if (
            !result.success ||
            result.data.decision !== 'prepared' ||
            !result.data.invitationId ||
            !result.data.credentialMode ||
            !result.data.version
          ) {
            return failure(origin, 'not_available', correlationId);
          }
          return json(origin, 200, result.data);
        }
        case 'accept': {
          if (!actor.confirmedEmail) {
            await dependencies.recordDenied({
              actorUserId: actor.actorUserId,
              eventName: 'member_invitation.denied',
              reasonCode: 'confirmed_email_required',
              correlationId,
            });
            return failure(origin, 'not_available', correlationId);
          }
          const result = stateResultSchema.safeParse(
            await dependencies.accept({
              actor,
              confirmedEmail: actor.confirmedEmail,
              invitationId: parsed.data.invitationId,
              expectedVersion: parsed.data.expectedVersion,
              idempotencyKeyHash: await sha256(parsed.data.idempotencyKey),
              correlationId,
            }),
          );
          if (!result.success || result.data.decision !== 'accepted') {
            return failure(
              origin,
              result.success ? result.data.decision : 'conflict',
              correlationId,
            );
          }
          return json(origin, 200, result.data);
        }
      }
    } catch {
      return json(origin, 503, {
        error: {
          code: 'member_invitation.audit_unavailable',
          message: 'The invitation action could not be verified.',
        },
        correlationId,
      });
    }
  };
}
