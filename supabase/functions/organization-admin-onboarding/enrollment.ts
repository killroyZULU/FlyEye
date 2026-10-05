import {
  startResultSchema,
  completeResultSchema,
  type AdminOnboardingContext,
  type AdminOnboardingRequest,
} from './contracts.ts';
import { recordFailClosedDenial } from './audit.ts';
import { readFactorInventory, factorStateForClient } from './factors.ts';
import { sha256Hex } from './idempotency.ts';
import { jsonResponse, errorResponseForDecision } from './responses.ts';

export async function startAdminOnboarding(
  context: AdminOnboardingContext,
  input: Extract<AdminOnboardingRequest, { action: 'start' }>,
): Promise<Response> {
  const { dependencies, actor, allowedOrigin, correlationId } = context;

  const classification = await readFactorInventory(context, input.bootstrapGrantId);
  if (classification instanceof Response) return classification;

  const factorState = factorStateForClient(classification);
  if (factorState === 'conflict') {
    const auditFailure = await recordFailClosedDenial(
      dependencies,
      actor,
      correlationId,
      'factor_state_conflict',
      input.bootstrapGrantId,
      true,
    );
    if (auditFailure) return auditFailure;
    return errorResponseForDecision(allowedOrigin, 'conflict', correlationId);
  }

  const result = startResultSchema.safeParse(
    await dependencies.start({
      actorUserId: actor.actorUserId,
      bootstrapGrantId: input.bootstrapGrantId,
      expectedVersion: input.expectedVersion,
      idempotencyKeyHash: await sha256Hex(input.idempotencyKey),
      correlationId,
    }),
  );
  if (!result.success) throw new Error('Start runtime contract failed.');
  if (result.data.decision !== 'ready') {
    return errorResponseForDecision(allowedOrigin, result.data.decision, result.data.correlationId);
  }
  return jsonResponse(allowedOrigin, 200, { ...result.data, factorState });
}

export async function completeAdminOnboarding(
  context: AdminOnboardingContext,
  input: Extract<AdminOnboardingRequest, { action: 'complete' }>,
): Promise<Response> {
  const { dependencies, actor, allowedOrigin, correlationId } = context;

  if (
    actor.assuranceLevel !== 'aal2' ||
    actor.totpAuthenticatedAt === null ||
    actor.passwordAuthenticatedAt === null
  ) {
    const auditFailure = await recordFailClosedDenial(
      dependencies,
      actor,
      correlationId,
      'mfa_required',
      input.bootstrapGrantId,
    );
    if (auditFailure) return auditFailure;
    return jsonResponse(allowedOrigin, 403, {
      error: {
        code: 'admin_onboarding.mfa_required',
        message: 'Verify your authenticator to continue.',
      },
      correlationId,
    });
  }

  const classification = await readFactorInventory(context, input.bootstrapGrantId);
  if (classification instanceof Response) return classification;

  if (classification.kind !== 'one_verified_totp') {
    const auditFailure = await recordFailClosedDenial(
      dependencies,
      actor,
      correlationId,
      'factor_state_conflict',
      input.bootstrapGrantId,
      true,
    );
    if (auditFailure) return auditFailure;
    return errorResponseForDecision(allowedOrigin, 'conflict', correlationId);
  }

  const result = completeResultSchema.safeParse(
    await dependencies.complete({
      actor,
      verifiedTotpFactorId: classification.factorId,
      totalFactorCount: 1,
      bootstrapGrantId: input.bootstrapGrantId,
      expectedVersion: input.expectedVersion,
      idempotencyKeyHash: await sha256Hex(input.idempotencyKey),
      correlationId,
    }),
  );
  if (!result.success) throw new Error('Completion runtime contract failed.');
  if (result.data.decision !== 'completed' && result.data.decision !== 'already_completed') {
    return errorResponseForDecision(allowedOrigin, result.data.decision, result.data.correlationId);
  }
  return jsonResponse(allowedOrigin, 200, result.data);
}
