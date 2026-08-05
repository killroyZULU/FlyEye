import { z } from 'zod';

import {
  accessContextResponseSchema,
  type AccessContextResponse,
  type AssuranceLevel,
} from '../_shared/access-context.ts';

const MAX_REQUEST_BYTES = 2048;
const requestSchema = z.object({ organizationId: z.uuid().optional() }).strict();

export type AuthenticatedActor = {
  userId: string;
  assuranceLevel: AssuranceLevel;
  authenticationMethods: string[];
};

export type AuditDecision = {
  actorUserId: string;
  actorSubjectId: string;
  eventName: 'authentication.access_context_loaded' | 'authentication.access_denied';
  outcome: 'success' | 'denied';
  correlationId: string;
  organizationId: string | null;
  organizationIds: string[];
  reasonCode: string;
  metadata: Record<string, unknown>;
};

export type AuthBootstrapDependencies = {
  allowedOrigin: string;
  authenticate: (accessToken: string) => Promise<AuthenticatedActor>;
  validateAdminFactorState?: (actorUserId: string) => Promise<boolean>;
  resolveAccessContext: (input: {
    actorUserId: string;
    assuranceLevel: AssuranceLevel;
    selectedOrganizationId?: string;
  }) => Promise<unknown>;
  recordDecision: (decision: AuditDecision) => Promise<void>;
  createCorrelationId?: () => string;
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

function jsonResponse(origin: string, status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin),
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

async function recordDenied(
  dependencies: AuthBootstrapDependencies,
  actor: AuthenticatedActor,
  correlationId: string,
  reasonCode: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await dependencies.recordDecision({
    actorUserId: actor.userId,
    actorSubjectId: actor.userId,
    eventName: 'authentication.access_denied',
    outcome: 'denied',
    correlationId,
    organizationId: null,
    organizationIds: [],
    reasonCode,
    metadata,
  });
}

function decisionReason(response: AccessContextResponse): string {
  switch (response.decision) {
    case 'granted':
      return 'access_context_granted';
    case 'mfa_required':
      return 'mfa_required';
    case 'denied':
      return response.memberships.length === 0 ? 'no_active_membership' : 'permission_denied';
  }
}

export function createAuthBootstrapHandler(
  dependencies: AuthBootstrapDependencies,
): (request: Request) => Promise<Response> {
  const { allowedOrigin } = dependencies;
  const createCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());

  return async (request: Request): Promise<Response> => {
    const requestOrigin = request.headers.get('origin');

    if (requestOrigin !== allowedOrigin) {
      return jsonResponse(allowedOrigin, 403, {
        error: { code: 'auth.origin_denied', message: 'This request is not allowed.' },
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: responseHeaders(allowedOrigin) });
    }

    if (request.method !== 'POST') {
      return jsonResponse(allowedOrigin, 405, {
        error: { code: 'auth.method_not_allowed', message: 'This request is not supported.' },
      });
    }

    const authorization = request.headers.get('authorization') ?? '';
    const tokenMatch = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    if (!tokenMatch?.[1]) {
      return jsonResponse(allowedOrigin, 401, {
        error: { code: 'auth.authentication_required', message: 'Sign in to continue.' },
      });
    }

    let requestBody: unknown;
    try {
      const bodyText = await readRequestBody(request);
      requestBody = JSON.parse(bodyText);
    } catch (error) {
      if (error instanceof RequestTooLargeError) {
        return jsonResponse(allowedOrigin, 413, {
          error: { code: 'auth.request_too_large', message: 'The request is too large.' },
        });
      }
      return jsonResponse(allowedOrigin, 400, {
        error: { code: 'auth.invalid_request', message: 'The request is invalid.' },
      });
    }

    const parsedRequest = requestSchema.safeParse(requestBody);
    if (!parsedRequest.success) {
      return jsonResponse(allowedOrigin, 422, {
        error: { code: 'auth.invalid_request', message: 'The request is invalid.' },
      });
    }

    let actor: AuthenticatedActor;
    try {
      actor = await dependencies.authenticate(tokenMatch[1]);
    } catch {
      return jsonResponse(allowedOrigin, 401, {
        error: { code: 'auth.authentication_required', message: 'Sign in to continue.' },
      });
    }

    if (!actor.authenticationMethods.includes('password')) {
      const correlationId = createCorrelationId();
      try {
        await recordDenied(
          dependencies,
          actor,
          correlationId,
          'authentication_method_not_allowed',
          {
            currentAssuranceLevel: actor.assuranceLevel,
            requiredAuthenticationMethod: 'password',
          },
        );
      } catch {
        return jsonResponse(allowedOrigin, 500, {
          error: {
            code: 'auth.audit_unavailable',
            message: 'Access could not be verified. Try again.',
          },
        });
      }

      return jsonResponse(allowedOrigin, 403, {
        error: {
          code: 'auth.authentication_method_not_allowed',
          message: 'Sign in with your password to continue.',
        },
      });
    }

    let rawContext: unknown;
    try {
      rawContext = await dependencies.resolveAccessContext({
        actorUserId: actor.userId,
        assuranceLevel: actor.assuranceLevel,
        selectedOrganizationId: parsedRequest.data.organizationId,
      });
    } catch {
      const correlationId = createCorrelationId();
      try {
        await recordDenied(dependencies, actor, correlationId, 'access_context_unavailable', {
          currentAssuranceLevel: actor.assuranceLevel,
        });
      } catch {
        // Failure to write required audit evidence still blocks the access response.
      }
      return jsonResponse(allowedOrigin, 500, {
        error: {
          code: 'auth.access_context_unavailable',
          message: 'Access could not be verified. Try again.',
        },
      });
    }

    const parsedContext = accessContextResponseSchema.safeParse(rawContext);
    if (!parsedContext.success) {
      const correlationId = createCorrelationId();
      try {
        await recordDenied(dependencies, actor, correlationId, 'runtime_contract_rejected', {
          currentAssuranceLevel: actor.assuranceLevel,
        });
      } catch {
        // The response remains failed closed whether or not the audit backend is available.
      }
      return jsonResponse(allowedOrigin, 409, {
        error: {
          code: 'auth.access_context_conflict',
          message: 'Your access information needs administrator review.',
        },
      });
    }

    const context = parsedContext.data;
    const success = context.decision === 'granted';
    const organizationId =
      context.selectedOrganizationId ??
      (context.organizationIds.length === 1 ? context.organizationIds[0]! : null);

    const grantedAdmin = context.memberships.some(
      (membership) => membership.role === 'admin' && membership.accessStatus === 'granted',
    );
    if (grantedAdmin && dependencies.validateAdminFactorState) {
      let factorStateValid: boolean;
      try {
        factorStateValid = await dependencies.validateAdminFactorState(actor.userId);
      } catch {
        try {
          await dependencies.recordDecision({
            actorUserId: actor.userId,
            actorSubjectId: actor.userId,
            eventName: 'authentication.access_denied',
            outcome: 'denied',
            correlationId: context.correlationId,
            organizationId,
            organizationIds: context.organizationIds,
            reasonCode: 'factor_inventory_unavailable',
            metadata: {
              membershipCount: context.memberships.length,
              currentAssuranceLevel: context.currentAssuranceLevel,
            },
          });
        } catch {
          return jsonResponse(allowedOrigin, 500, {
            error: {
              code: 'auth.audit_unavailable',
              message: 'Access could not be verified. Try again.',
            },
          });
        }
        return jsonResponse(allowedOrigin, 503, {
          error: {
            code: 'auth.factor_inventory_unavailable',
            message: 'Your authenticator state could not be confirmed. Try again.',
          },
        });
      }

      if (!factorStateValid) {
        try {
          await dependencies.recordDecision({
            actorUserId: actor.userId,
            actorSubjectId: actor.userId,
            eventName: 'authentication.access_denied',
            outcome: 'denied',
            correlationId: context.correlationId,
            organizationId,
            organizationIds: context.organizationIds,
            reasonCode: 'factor_state_conflict',
            metadata: {
              membershipCount: context.memberships.length,
              currentAssuranceLevel: context.currentAssuranceLevel,
            },
          });
        } catch {
          return jsonResponse(allowedOrigin, 500, {
            error: {
              code: 'auth.audit_unavailable',
              message: 'Access could not be verified. Try again.',
            },
          });
        }
        return jsonResponse(allowedOrigin, 409, {
          error: {
            code: 'auth.access_context_conflict',
            message: 'Your authenticator information needs administrator review.',
          },
        });
      }
    }

    try {
      await dependencies.recordDecision({
        actorUserId: actor.userId,
        actorSubjectId: actor.userId,
        eventName: success
          ? 'authentication.access_context_loaded'
          : 'authentication.access_denied',
        outcome: success ? 'success' : 'denied',
        correlationId: context.correlationId,
        organizationId,
        organizationIds: context.organizationIds,
        reasonCode: decisionReason(context),
        metadata: {
          membershipCount: context.memberships.length,
          currentAssuranceLevel: context.currentAssuranceLevel,
          organizationSelection: parsedRequest.data.organizationId !== undefined,
        },
      });
    } catch {
      return jsonResponse(allowedOrigin, 500, {
        error: {
          code: 'auth.audit_unavailable',
          message: 'Access could not be verified. Try again.',
        },
      });
    }

    return jsonResponse(allowedOrigin, 200, context satisfies AccessContextResponse);
  };
}
