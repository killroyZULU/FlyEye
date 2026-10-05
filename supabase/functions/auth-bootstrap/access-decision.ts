import {
  accessContextResponseSchema,
  type AccessContextResponse,
} from '../_shared/access-context.ts';
import type { AuthBootstrapDependencies, AuthenticatedActor } from './contracts.ts';
import { checkAdminFactorState } from './admin-factor.ts';
import { jsonResponse } from './responses.ts';

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

export async function resolveAuthenticatedAccess(
  dependencies: AuthBootstrapDependencies,
  actor: AuthenticatedActor,
  allowedOrigin: string,
  createCorrelationId: () => string,
): Promise<Response> {
  if (!actor.authenticationMethods.includes('password')) {
    const correlationId = createCorrelationId();
    try {
      await recordDenied(dependencies, actor, correlationId, 'authentication_method_not_allowed', {
        currentAssuranceLevel: actor.assuranceLevel,
        requiredAuthenticationMethod: 'password',
      });
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
  const organizationId = context.organizationIds.length === 1 ? context.organizationIds[0]! : null;

  const factorResponse = await checkAdminFactorState(
    dependencies,
    actor,
    context,
    organizationId,
    allowedOrigin,
  );
  if (factorResponse) return factorResponse;

  try {
    await dependencies.recordDecision({
      actorUserId: actor.userId,
      actorSubjectId: actor.userId,
      eventName: success ? 'authentication.access_context_loaded' : 'authentication.access_denied',
      outcome: success ? 'success' : 'denied',
      correlationId: context.correlationId,
      organizationId,
      organizationIds: context.organizationIds,
      reasonCode: decisionReason(context),
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

  return jsonResponse(allowedOrigin, 200, context satisfies AccessContextResponse);
}
