import { z } from 'zod';

import {
  classifyCompleteFactorInventory,
  passwordAuthenticationIsRecent,
  type FactorInventoryClassification,
  type VerifiedAuthenticationEvidence,
} from '../_shared/authentication-evidence.ts';

const MAX_REQUEST_BYTES = 4096;
const idempotencyKeySchema = z.string().regex(/^[0-9a-f]{32,128}$/);

const requestSchema = z.discriminatedUnion('action', [
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

const statusResultSchema = z
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

const startResultSchema = z
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

const cancelResultSchema = z
  .object({
    decision: z.enum(['cancelled', 'not_available']),
    cleanupOutcome: z.literal('not_attempted'),
    replayed: z.boolean().optional(),
    correlationId: z.uuid(),
  })
  .strict();

const completeResultSchema = z
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

class RequestTooLargeError extends Error {}

function responseHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
}

function jsonResponse(
  origin: string,
  status: number,
  body: object,
  additionalHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders(origin), ...additionalHeaders },
  });
}

async function readRequestBody(request: Request): Promise<string> {
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_REQUEST_BYTES) {
        throw new RequestTooLargeError('Request body exceeds the configured byte limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function errorResponseForDecision(origin: string, decision: string, correlationId: string) {
  switch (decision) {
    case 'not_available':
      return jsonResponse(origin, 404, {
        error: {
          code: 'admin_onboarding.not_available',
          message: 'This onboarding request is not available.',
        },
        correlationId,
      });
    case 'expired':
      return jsonResponse(origin, 403, {
        error: {
          code: 'admin_onboarding.not_eligible',
          message: 'Sign in again or contact support to continue.',
        },
        correlationId,
      });
    case 'recent_authentication_required':
      return jsonResponse(origin, 403, {
        error: {
          code: 'admin_onboarding.recent_authentication_required',
          message: 'Sign in with your password again to continue.',
        },
        correlationId,
      });
    default:
      return jsonResponse(origin, 409, {
        error: {
          code: 'admin_onboarding.conflict',
          message: 'Your administrator onboarding information needs review.',
        },
        correlationId,
      });
  }
}

function factorStateForClient(classification: FactorInventoryClassification) {
  switch (classification.kind) {
    case 'none':
      return 'enrollment_required' as const;
    case 'one_verified_totp':
      return 'challenge_required' as const;
    case 'one_unverified_totp':
    case 'conflict':
      return 'conflict' as const;
  }
}

async function recordFailClosedDenial(
  dependencies: AdminOnboardingDependencies,
  actor: VerifiedAuthenticationEvidence,
  correlationId: string,
  reasonCode: string,
  targetId?: string,
  conflict = false,
): Promise<Response | null> {
  try {
    await dependencies.recordDenied({
      actor,
      eventName: conflict ? 'admin_onboarding.conflict' : 'admin_onboarding.denied',
      correlationId,
      reasonCode,
      targetId,
      metadata: { currentAssuranceLevel: actor.assuranceLevel },
    });
    return null;
  } catch {
    return jsonResponse(dependencies.allowedOrigin, 500, {
      error: {
        code: 'admin_onboarding.audit_unavailable',
        message: 'Onboarding could not be verified. Try again.',
      },
      correlationId,
    });
  }
}

export function createAdminOnboardingHandler(
  dependencies: AdminOnboardingDependencies,
): (request: Request) => Promise<Response> {
  const createCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());
  const nowSeconds = dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  return async (request: Request): Promise<Response> => {
    const { allowedOrigin } = dependencies;
    const requestOrigin = request.headers.get('origin');

    if (requestOrigin !== allowedOrigin) {
      return jsonResponse(allowedOrigin, 403, {
        error: {
          code: 'admin_onboarding.origin_denied',
          message: 'This request is not allowed.',
        },
      });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: responseHeaders(allowedOrigin) });
    }
    if (request.method !== 'POST') {
      return jsonResponse(allowedOrigin, 405, {
        error: {
          code: 'admin_onboarding.method_not_allowed',
          message: 'This request is not supported.',
        },
      });
    }

    const authorization = request.headers.get('authorization') ?? '';
    const tokenMatch = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    if (!tokenMatch?.[1]) {
      return jsonResponse(allowedOrigin, 401, {
        error: {
          code: 'admin_onboarding.authentication_required',
          message: 'Sign in to continue.',
        },
      });
    }

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(await readRequestBody(request));
    } catch (error) {
      if (error instanceof RequestTooLargeError) {
        return jsonResponse(allowedOrigin, 413, {
          error: {
            code: 'admin_onboarding.request_too_large',
            message: 'The request is too large.',
          },
        });
      }
      return jsonResponse(allowedOrigin, 400, {
        error: {
          code: 'admin_onboarding.invalid_request',
          message: 'The request is invalid.',
        },
      });
    }

    const parsedRequest = requestSchema.safeParse(requestBody);
    if (!parsedRequest.success) {
      return jsonResponse(allowedOrigin, 422, {
        error: {
          code: 'admin_onboarding.invalid_request',
          message: 'The request is invalid.',
        },
      });
    }

    let actor: VerifiedAuthenticationEvidence;
    try {
      actor = await dependencies.authenticate(tokenMatch[1]);
    } catch {
      return jsonResponse(allowedOrigin, 401, {
        error: {
          code: 'admin_onboarding.authentication_required',
          message: 'Sign in to continue.',
        },
      });
    }

    const correlationId = createCorrelationId();
    let limiterDecision: LimiterDecision;
    try {
      limiterDecision = await dependencies.consumeLimit({
        actorSubjectId: actor.actorSubjectId,
        action: parsedRequest.data.action,
        correlationId,
      });
    } catch {
      return jsonResponse(allowedOrigin, 503, {
        error: {
          code: 'admin_onboarding.limiter_unavailable',
          message:
            parsedRequest.data.action === 'cancel'
              ? 'Server cancellation could not be confirmed. You will be signed out.'
              : 'Onboarding is temporarily unavailable. Try again later.',
        },
        correlationId,
      });
    }

    if (
      limiterDecision.correlationId !== correlationId ||
      limiterDecision.networkSourceUsed !== false
    ) {
      return jsonResponse(allowedOrigin, 503, {
        error: {
          code: 'admin_onboarding.limiter_unavailable',
          message: 'Onboarding is temporarily unavailable. Try again later.',
        },
        correlationId,
      });
    }

    if (!limiterDecision.allowed) {
      const retryAfter = limiterDecision.retryAfterSeconds;
      if (retryAfter === null || retryAfter < 1 || retryAfter > 60) {
        return jsonResponse(allowedOrigin, 503, {
          error: {
            code: 'admin_onboarding.limiter_unavailable',
            message: 'Onboarding is temporarily unavailable. Try again later.',
          },
          correlationId,
        });
      }
      return jsonResponse(
        allowedOrigin,
        429,
        {
          error: {
            code: 'admin_onboarding.rate_limited',
            message: `Wait ${retryAfter} seconds before trying again.`,
          },
          correlationId,
        },
        { 'Retry-After': String(retryAfter) },
      );
    }

    if (
      parsedRequest.data.action !== 'cancel' &&
      !passwordAuthenticationIsRecent(actor, nowSeconds())
    ) {
      const auditFailure = await recordFailClosedDenial(
        dependencies,
        actor,
        correlationId,
        'recent_authentication_required',
        'bootstrapGrantId' in parsedRequest.data ? parsedRequest.data.bootstrapGrantId : undefined,
      );
      if (auditFailure) return auditFailure;
      return errorResponseForDecision(
        allowedOrigin,
        'recent_authentication_required',
        correlationId,
      );
    }

    try {
      switch (parsedRequest.data.action) {
        case 'status': {
          const result = statusResultSchema.safeParse(
            await dependencies.status({ actorUserId: actor.actorUserId, correlationId }),
          );
          if (!result.success) throw new Error('Status runtime contract failed.');
          return jsonResponse(allowedOrigin, 200, result.data);
        }

        case 'start': {
          let classification: FactorInventoryClassification;
          try {
            classification = classifyCompleteFactorInventory(
              await dependencies.listFactors(actor.actorUserId),
            );
          } catch {
            const auditFailure = await recordFailClosedDenial(
              dependencies,
              actor,
              correlationId,
              'factor_inventory_unavailable',
              parsedRequest.data.bootstrapGrantId,
              true,
            );
            if (auditFailure) return auditFailure;
            return jsonResponse(allowedOrigin, 503, {
              error: {
                code: 'admin_onboarding.provider_unavailable',
                message: 'Authenticator state could not be confirmed. Try again.',
              },
              correlationId,
            });
          }

          const factorState = factorStateForClient(classification);
          if (factorState === 'conflict') {
            const auditFailure = await recordFailClosedDenial(
              dependencies,
              actor,
              correlationId,
              'factor_state_conflict',
              parsedRequest.data.bootstrapGrantId,
              true,
            );
            if (auditFailure) return auditFailure;
            return errorResponseForDecision(allowedOrigin, 'conflict', correlationId);
          }

          const result = startResultSchema.safeParse(
            await dependencies.start({
              actorUserId: actor.actorUserId,
              bootstrapGrantId: parsedRequest.data.bootstrapGrantId,
              expectedVersion: parsedRequest.data.expectedVersion,
              idempotencyKeyHash: await sha256Hex(parsedRequest.data.idempotencyKey),
              correlationId,
            }),
          );
          if (!result.success) throw new Error('Start runtime contract failed.');
          if (result.data.decision !== 'ready') {
            return errorResponseForDecision(
              allowedOrigin,
              result.data.decision,
              result.data.correlationId,
            );
          }
          return jsonResponse(allowedOrigin, 200, { ...result.data, factorState });
        }

        case 'complete': {
          if (
            actor.assuranceLevel !== 'aal2' ||
            actor.totpAuthenticatedAt === null ||
            actor.passwordAuthenticatedAt === null
          ) {
            const auditFailure = await recordFailClosedDenial(
              dependencies,
              actor,
              correlationId,
              'mfa_required',
              parsedRequest.data.bootstrapGrantId,
            );
            if (auditFailure) return auditFailure;
            return jsonResponse(allowedOrigin, 403, {
              error: {
                code: 'admin_onboarding.mfa_required',
                message: 'Verify your authenticator to continue.',
              },
              correlationId,
            });
          }

          let classification: FactorInventoryClassification;
          try {
            classification = classifyCompleteFactorInventory(
              await dependencies.listFactors(actor.actorUserId),
            );
          } catch {
            const auditFailure = await recordFailClosedDenial(
              dependencies,
              actor,
              correlationId,
              'factor_inventory_unavailable',
              parsedRequest.data.bootstrapGrantId,
              true,
            );
            if (auditFailure) return auditFailure;
            return jsonResponse(allowedOrigin, 503, {
              error: {
                code: 'admin_onboarding.provider_unavailable',
                message: 'Authenticator state could not be confirmed. Try again.',
              },
              correlationId,
            });
          }

          if (classification.kind !== 'one_verified_totp') {
            const auditFailure = await recordFailClosedDenial(
              dependencies,
              actor,
              correlationId,
              'factor_state_conflict',
              parsedRequest.data.bootstrapGrantId,
              true,
            );
            if (auditFailure) return auditFailure;
            return errorResponseForDecision(allowedOrigin, 'conflict', correlationId);
          }

          const result = completeResultSchema.safeParse(
            await dependencies.complete({
              actor,
              verifiedTotpFactorId: classification.factorId,
              totalFactorCount: 1,
              bootstrapGrantId: parsedRequest.data.bootstrapGrantId,
              expectedVersion: parsedRequest.data.expectedVersion,
              idempotencyKeyHash: await sha256Hex(parsedRequest.data.idempotencyKey),
              correlationId,
            }),
          );
          if (!result.success) throw new Error('Completion runtime contract failed.');
          if (
            result.data.decision !== 'completed' &&
            result.data.decision !== 'already_completed'
          ) {
            return errorResponseForDecision(
              allowedOrigin,
              result.data.decision,
              result.data.correlationId,
            );
          }
          return jsonResponse(allowedOrigin, 200, result.data);
        }

        case 'cancel': {
          const result = cancelResultSchema.safeParse(
            await dependencies.cancel({
              actorUserId: actor.actorUserId,
              bootstrapGrantId: parsedRequest.data.bootstrapGrantId,
              idempotencyKeyHash: await sha256Hex(parsedRequest.data.idempotencyKey),
              correlationId,
            }),
          );
          if (!result.success) throw new Error('Cancel runtime contract failed.');
          if (result.data.decision !== 'cancelled') {
            return errorResponseForDecision(
              allowedOrigin,
              result.data.decision,
              result.data.correlationId,
            );
          }
          return jsonResponse(allowedOrigin, 200, result.data);
        }
      }
    } catch {
      return jsonResponse(allowedOrigin, 500, {
        error: {
          code: 'admin_onboarding.audit_unavailable',
          message: 'Onboarding could not be verified. Try again.',
        },
        correlationId,
      });
    }
  };
}
