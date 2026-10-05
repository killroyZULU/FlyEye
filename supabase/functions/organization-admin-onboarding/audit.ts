import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';
import type { AdminOnboardingDependencies } from './contracts.ts';
import { jsonResponse } from './responses.ts';

export async function recordFailClosedDenial(
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
