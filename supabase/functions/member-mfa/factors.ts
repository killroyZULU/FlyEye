import {
  classifyCompleteFactorInventory,
  type FactorInventoryClassification,
  type VerifiedAuthenticationEvidence,
} from '../_shared/authentication-evidence.ts';
import type { MemberMfaDependencies } from './contracts.ts';
import { json } from './responses.ts';

export async function inventory(
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

export async function deny(
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
