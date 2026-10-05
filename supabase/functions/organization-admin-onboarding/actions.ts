import {
  statusResultSchema,
  cancelResultSchema,
  type AdminOnboardingContext,
  type AdminOnboardingRequest,
} from './contracts.ts';
import { startAdminOnboarding, completeAdminOnboarding } from './enrollment.ts';
import { sha256Hex } from './idempotency.ts';
import { jsonResponse, errorResponseForDecision } from './responses.ts';

export async function executeAdminOnboardingAction(
  context: AdminOnboardingContext,
  input: AdminOnboardingRequest,
): Promise<Response> {
  const { dependencies, actor, allowedOrigin, correlationId } = context;
  try {
    // Await RPC-backed actions within the existing fail-closed catch boundary.
    switch (input.action) {
      case 'status': {
        const result = statusResultSchema.safeParse(
          await dependencies.status({ actorUserId: actor.actorUserId, correlationId }),
        );
        if (!result.success) throw new Error('Status runtime contract failed.');
        return jsonResponse(allowedOrigin, 200, result.data);
      }
      case 'start':
        return await startAdminOnboarding(context, input);
      case 'complete':
        return await completeAdminOnboarding(context, input);
      case 'cancel': {
        const result = cancelResultSchema.safeParse(
          await dependencies.cancel({
            actorUserId: actor.actorUserId,
            bootstrapGrantId: input.bootstrapGrantId,
            idempotencyKeyHash: await sha256Hex(input.idempotencyKey),
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
}
