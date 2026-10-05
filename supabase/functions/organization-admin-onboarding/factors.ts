import {
  classifyCompleteFactorInventory,
  type FactorInventoryClassification,
} from '../_shared/authentication-evidence.ts';
import type { AdminOnboardingContext } from './contracts.ts';
import { recordFailClosedDenial } from './audit.ts';
import { jsonResponse } from './responses.ts';

export function factorStateForClient(classification: FactorInventoryClassification) {
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

export async function readFactorInventory(
  context: AdminOnboardingContext,
  bootstrapGrantId: string,
): Promise<FactorInventoryClassification | Response> {
  const { dependencies, actor, allowedOrigin, correlationId } = context;
  try {
    return classifyCompleteFactorInventory(await dependencies.listFactors(actor.actorUserId));
  } catch {
    const auditFailure = await recordFailClosedDenial(
      dependencies,
      actor,
      correlationId,
      'factor_inventory_unavailable',
      bootstrapGrantId,
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
}
