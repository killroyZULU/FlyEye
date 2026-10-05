import { passwordAuthenticationIsRecent } from '../_shared/authentication-evidence.ts';
import type {
  AdminOnboardingContext,
  AdminOnboardingRequest,
  LimiterDecision,
} from './contracts.ts';
import { recordFailClosedDenial } from './audit.ts';
import { jsonResponse, errorResponseForDecision } from './responses.ts';

export async function checkRequestGuards(
  context: AdminOnboardingContext,
  input: AdminOnboardingRequest,
  nowSeconds: () => number,
): Promise<Response | null> {
  const { dependencies, actor, allowedOrigin, correlationId } = context;
  let limiterDecision: LimiterDecision;
  try {
    limiterDecision = await dependencies.consumeLimit({
      actorSubjectId: actor.actorSubjectId,
      action: input.action,
      correlationId,
    });
  } catch {
    return jsonResponse(allowedOrigin, 503, {
      error: {
        code: 'admin_onboarding.limiter_unavailable',
        message:
          input.action === 'cancel'
            ? 'Server cancellation could not be confirmed. You will be signed out.'
            : 'Onboarding is temporarily unavailable. Try again later.',
      },
      correlationId,
    });
  }

  if (
    limiterDecision.correlationId !== correlationId ||
    limiterDecision.networkSourceUsed !== false ||
    limiterDecision.policyVersion !== 'subject-action-v1'
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

  if (input.action !== 'cancel' && !passwordAuthenticationIsRecent(actor, nowSeconds())) {
    const auditFailure = await recordFailClosedDenial(
      dependencies,
      actor,
      correlationId,
      'recent_authentication_required',
      'bootstrapGrantId' in input ? input.bootstrapGrantId : undefined,
    );
    if (auditFailure) return auditFailure;
    return errorResponseForDecision(allowedOrigin, 'recent_authentication_required', correlationId);
  }

  return null;
}
