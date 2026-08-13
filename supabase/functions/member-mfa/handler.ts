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

const databaseDecisionSchema = z
  .object({ decision: z.string().min(1).max(64), correlationId: z.uuid() })
  .passthrough();
const databaseStatusSchema = z
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
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) throw new RequestTooLargeError();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decisionError(origin: string, decision: string, correlationId: string): Response {
  const definitions: Record<string, [number, string, string]> = {
    not_available: [404, 'member_mfa.not_available', 'Member MFA setup is not available.'],
    conflict: [409, 'member_mfa.state_conflict', 'Authenticator setup needs review.'],
    recent_authentication_required: [
      403,
      'member_mfa.recent_authentication_required',
      'Sign in with your password again to continue.',
    ],
  };
  const [status, code, message] = definitions[decision] ?? [
    500,
    'member_mfa.service_unavailable',
    'Authenticator setup could not be confirmed.',
  ];
  return json(origin, status, { error: { code, message }, correlationId });
}

async function inventory(
  dependencies: MemberMfaDependencies,
  actor: VerifiedAuthenticationEvidence,
  correlationId: string,
): Promise<FactorInventoryClassification | Response> {
  try {
    return classifyCompleteFactorInventory(await dependencies.listFactors(actor.actorUserId));
  } catch {
    try {
      await dependencies.recordDenied({
        actorUserId: actor.actorUserId,
        eventName: 'member_mfa.conflict',
        correlationId,
        reasonCode: 'factor_inventory_unavailable',
      });
    } catch {
      return json(dependencies.allowedOrigin, 500, {
        error: {
          code: 'member_mfa.audit_unavailable',
          message: 'Authenticator setup could not be verified.',
        },
        correlationId,
      });
    }
    return json(dependencies.allowedOrigin, 503, {
      error: {
        code: 'member_mfa.provider_unavailable',
        message: 'Authenticator state could not be confirmed.',
      },
      correlationId,
    });
  }
}

async function deny(
  dependencies: MemberMfaDependencies,
  actor: VerifiedAuthenticationEvidence,
  correlationId: string,
  reasonCode: string,
  operationId?: string,
): Promise<Response> {
  try {
    await dependencies.recordDenied({
      actorUserId: actor.actorUserId,
      eventName: 'member_mfa.conflict',
      correlationId,
      reasonCode,
      operationId,
    });
  } catch {
    return json(dependencies.allowedOrigin, 500, {
      error: {
        code: 'member_mfa.audit_unavailable',
        message: 'Authenticator setup could not be verified.',
      },
      correlationId,
    });
  }
  return json(dependencies.allowedOrigin, 409, {
    error: { code: 'member_mfa.factor_conflict', message: 'Authenticator state needs review.' },
    correlationId,
  });
}

export function createMemberMfaHandler(dependencies: MemberMfaDependencies) {
  const makeCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());
  const nowSeconds = dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  return async (request: Request): Promise<Response> => {
    const origin = dependencies.allowedOrigin;
    if (request.headers.get('origin') !== origin) {
      return json(origin, 403, {
        error: { code: 'member_mfa.origin_denied', message: 'This request is not allowed.' },
      });
    }
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== 'POST')
      return json(origin, 405, {
        error: { code: 'member_mfa.method_not_allowed', message: 'This request is not supported.' },
      });

    const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token)
      return json(origin, 401, {
        error: { code: 'member_mfa.authentication_required', message: 'Sign in to continue.' },
      });

    let input: z.infer<typeof requestSchema>;
    try {
      const parsed = requestSchema.safeParse(JSON.parse(await readBody(request)));
      if (!parsed.success)
        return json(origin, 422, {
          error: { code: 'member_mfa.validation_failed', message: 'The request is invalid.' },
        });
      input = parsed.data;
    } catch (error) {
      return json(origin, error instanceof RequestTooLargeError ? 413 : 400, {
        error: {
          code:
            error instanceof RequestTooLargeError
              ? 'member_mfa.request_too_large'
              : 'member_mfa.validation_failed',
          message: 'The request is invalid.',
        },
      });
    }

    let actor: VerifiedAuthenticationEvidence;
    try {
      actor = await dependencies.authenticate(token);
    } catch {
      return json(origin, 401, {
        error: { code: 'member_mfa.authentication_required', message: 'Sign in to continue.' },
      });
    }

    const correlationId = makeCorrelationId();
    try {
      const limited = await dependencies.consumeLimit({
        actorSubjectId: actor.actorSubjectId,
        action: input.action,
        correlationId,
      });
      if (
        limited.correlationId !== correlationId ||
        limited.networkSourceUsed !== false ||
        limited.policyVersion !== 'member-mfa-subject-action-v1'
      )
        throw new Error();
      if (!limited.allowed) {
        if (!limited.retryAfterSeconds) throw new Error();
        return json(
          origin,
          429,
          {
            error: {
              code: 'member_mfa.rate_limited',
              message: `Wait ${limited.retryAfterSeconds} seconds before trying again.`,
            },
            correlationId,
          },
          { 'Retry-After': String(limited.retryAfterSeconds) },
        );
      }
    } catch {
      return json(origin, 503, {
        error: {
          code: 'member_mfa.limiter_unavailable',
          message: 'Authenticator setup is temporarily unavailable.',
        },
        correlationId,
      });
    }

    if (
      input.action !== 'status' &&
      input.action !== 'cancel' &&
      !passwordAuthenticationIsRecent(actor, nowSeconds())
    ) {
      try {
        await dependencies.recordDenied({
          actorUserId: actor.actorUserId,
          eventName: 'member_mfa.denied',
          correlationId,
          reasonCode: 'recent_authentication_required',
          operationId: 'operationId' in input ? input.operationId : undefined,
        });
      } catch {
        return json(origin, 500, {
          error: {
            code: 'member_mfa.audit_unavailable',
            message: 'Authenticator setup could not be verified.',
          },
          correlationId,
        });
      }
      return decisionError(origin, 'recent_authentication_required', correlationId);
    }

    const classified = await inventory(dependencies, actor, correlationId);
    if (classified instanceof Response) return classified;

    try {
      switch (input.action) {
        case 'status': {
          if (classified.kind === 'conflict')
            return deny(dependencies, actor, correlationId, 'factor_state_conflict');
          const factorHash =
            classified.kind === 'one_verified_totp' || classified.kind === 'one_unverified_totp'
              ? await sha256(classified.factorId)
              : null;
          const result = databaseStatusSchema.parse(
            await dependencies.status({
              actorUserId: actor.actorUserId,
              factorReferenceHash: factorHash,
              correlationId,
            }),
          );
          if (result.decision !== 'available')
            return decisionError(origin, result.decision, result.correlationId);
          if (classified.kind === 'one_unverified_totp' && result.operationState !== 'bound') {
            return deny(dependencies, actor, correlationId, 'factor_state_conflict');
          }
          return json(origin, 200, {
            ...result,
            factorState:
              result.operationState === 'bound'
                ? 'resume_required'
                : result.operationState === 'started'
                  ? 'cancellation_required'
                  : classified.kind === 'none'
                    ? 'enrollment_required'
                    : 'challenge_required',
          });
        }
        case 'start': {
          if (classified.kind === 'conflict' || classified.kind === 'one_unverified_totp')
            return deny(dependencies, actor, correlationId, 'factor_state_conflict');
          const factorHash =
            classified.kind === 'one_verified_totp' ? await sha256(classified.factorId) : null;
          const result = databaseDecisionSchema.parse(
            await dependencies.start({
              actorUserId: actor.actorUserId,
              factorReferenceHash: factorHash,
              idempotencyKeyHash: await sha256(input.idempotencyKey),
              correlationId,
            }),
          );
          if (result.decision !== 'ready')
            return decisionError(origin, result.decision, result.correlationId);
          return json(origin, 200, {
            ...result,
            factorState: classified.kind === 'none' ? 'enrollment_required' : 'challenge_required',
          });
        }
        case 'bind_factor': {
          if (classified.kind !== 'one_unverified_totp' || classified.factorId !== input.factorId)
            return deny(
              dependencies,
              actor,
              correlationId,
              'factor_binding_conflict',
              input.operationId,
            );
          const result = databaseDecisionSchema.parse(
            await dependencies.bindFactor({
              actorUserId: actor.actorUserId,
              operationId: input.operationId,
              expectedVersion: input.expectedVersion,
              factorReferenceHash: await sha256(input.factorId),
              idempotencyKeyHash: await sha256(input.idempotencyKey),
              correlationId,
            }),
          );
          if (result.decision !== 'bound')
            return decisionError(origin, result.decision, result.correlationId);
          return json(origin, 200, result);
        }
        case 'complete': {
          if (
            actor.assuranceLevel !== 'aal2' ||
            actor.totpAuthenticatedAt === null ||
            !passwordAuthenticationIsRecent(actor, nowSeconds())
          ) {
            return deny(
              dependencies,
              actor,
              correlationId,
              'mfa_assurance_required',
              input.operationId,
            );
          }
          if (classified.kind !== 'one_verified_totp')
            return deny(
              dependencies,
              actor,
              correlationId,
              'completion_factor_conflict',
              input.operationId,
            );
          const result = databaseDecisionSchema.parse(
            await dependencies.complete({
              actor,
              operationId: input.operationId,
              expectedVersion: input.expectedVersion,
              factorReferenceHash: await sha256(classified.factorId),
              idempotencyKeyHash: await sha256(input.idempotencyKey),
              correlationId,
            }),
          );
          if (result.decision !== 'completed')
            return decisionError(origin, result.decision, result.correlationId);
          return json(origin, 200, result);
        }
        case 'cancel': {
          if (classified.kind === 'conflict') {
            return deny(
              dependencies,
              actor,
              correlationId,
              'cleanup_factor_conflict',
              input.operationId,
            );
          }
          const currentFactorId =
            classified.kind === 'one_verified_totp' || classified.kind === 'one_unverified_totp'
              ? classified.factorId
              : undefined;
          if (input.factorId && input.factorId !== currentFactorId) {
            return deny(
              dependencies,
              actor,
              correlationId,
              'cleanup_factor_conflict',
              input.operationId,
            );
          }
          const factorHash = currentFactorId ? await sha256(currentFactorId) : null;
          const preflight = databaseStatusSchema.parse(
            await dependencies.status({
              actorUserId: actor.actorUserId,
              factorReferenceHash: factorHash,
              correlationId,
            }),
          );
          if (
            preflight.decision !== 'available' ||
            !preflight.operationState ||
            preflight.operationId !== input.operationId ||
            preflight.operationVersion !== input.expectedVersion
          ) {
            return deny(
              dependencies,
              actor,
              correlationId,
              'cleanup_operation_conflict',
              input.operationId,
            );
          }
          if (currentFactorId) {
            return deny(
              dependencies,
              actor,
              correlationId,
              'factor_retained_for_safe_resume',
              input.operationId,
            );
          }
          const result = databaseDecisionSchema.parse(
            await dependencies.cancel({
              actorUserId: actor.actorUserId,
              operationId: input.operationId,
              expectedVersion: input.expectedVersion,
              factorReferenceHash: factorHash,
              cleanupOutcome: 'not_required',
              idempotencyKeyHash: await sha256(input.idempotencyKey),
              correlationId,
            }),
          );
          if (result.decision !== 'cancelled')
            return decisionError(origin, result.decision, result.correlationId);
          return json(origin, 200, result);
        }
      }
    } catch {
      return json(origin, 500, {
        error: {
          code: 'member_mfa.audit_unavailable',
          message: 'Authenticator setup could not be verified.',
        },
        correlationId,
      });
    }
  };
}
