import type { AdminOnboardingContext } from './contracts.ts';
import { recordFailClosedDenial } from './audit.ts';
import { errorResponseForDecision, jsonResponse } from './responses.ts';

export async function checkSessionFactor(
  context: AdminOnboardingContext,
  bootstrapGrantId: string,
  factorId: string | null,
  requireAal2: boolean,
): Promise<Response | undefined> {
  const { dependencies, actor, correlationId, allowedOrigin } = context;
  let valid: boolean;
  try {
    valid = await dependencies.validateSessionFactor({ actor, factorId, requireAal2 });
    if (typeof valid !== 'boolean') throw new Error('Invalid session binding result.');
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
  if (valid) return undefined;
  const auditFailure = await recordFailClosedDenial(
    dependencies,
    actor,
    correlationId,
    'recent_authentication_required',
    bootstrapGrantId,
  );
  return (
    auditFailure ??
    errorResponseForDecision(allowedOrigin, 'recent_authentication_required', correlationId)
  );
}
