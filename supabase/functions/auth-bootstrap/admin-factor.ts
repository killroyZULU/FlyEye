import type { AccessContextResponse } from '../_shared/access-context.ts';
import type { AuthBootstrapDependencies, AuthenticatedActor } from './contracts.ts';
import { jsonResponse } from './responses.ts';

export async function checkAdminFactorState(
  dependencies: AuthBootstrapDependencies,
  actor: AuthenticatedActor,
  context: AccessContextResponse,
  organizationId: string | null,
  allowedOrigin: string,
): Promise<Response | undefined> {
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

  return undefined;
}
