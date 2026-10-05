import type { FactorInventoryClassification } from '../_shared/authentication-evidence.ts';
import {
  databaseDecisionSchema,
  databaseStatusSchema,
  type MemberMfaContext,
  type MemberMfaRequest,
} from './contracts.ts';
import { deny } from './factors.ts';
import { sha256 } from './idempotency.ts';
import { decisionError, json } from './responses.ts';

export async function cancelMfaEnrollment(
  context: MemberMfaContext,
  input: Extract<MemberMfaRequest, { action: 'cancel' }>,
  classified: FactorInventoryClassification,
): Promise<Response> {
  const { dependencies, actor, origin, correlationId } = context;

  if (classified.kind === 'conflict') {
    return deny(dependencies, actor, correlationId, 'cleanup_factor_conflict', input.operationId);
  }
  const currentFactorId =
    classified.kind === 'one_verified_totp' || classified.kind === 'one_unverified_totp'
      ? classified.factorId
      : undefined;
  if (input.factorId && input.factorId !== currentFactorId) {
    return deny(dependencies, actor, correlationId, 'cleanup_factor_conflict', input.operationId);
  }
  const factorHash = currentFactorId ? await sha256(currentFactorId) : null;
  const preflight = databaseStatusSchema.parse(
    await dependencies.status({
      actorUserId: actor.actorUserId,
      factorReferenceHash: factorHash,
      correlationId,
    }),
  );
  if (
    preflight.decision !== 'available' ||
    !preflight.operationState ||
    preflight.operationId !== input.operationId ||
    preflight.operationVersion !== input.expectedVersion
  ) {
    return deny(
      dependencies,
      actor,
      correlationId,
      'cleanup_operation_conflict',
      input.operationId,
    );
  }
  if (currentFactorId) {
    return deny(
      dependencies,
      actor,
      correlationId,
      'factor_retained_for_safe_resume',
      input.operationId,
    );
  }
  const result = databaseDecisionSchema.parse(
    await dependencies.cancel({
      actorUserId: actor.actorUserId,
      operationId: input.operationId,
      expectedVersion: input.expectedVersion,
      factorReferenceHash: factorHash,
      cleanupOutcome: 'not_required',
      idempotencyKeyHash: await sha256(input.idempotencyKey),
      correlationId,
    }),
  );
  if (result.decision !== 'cancelled')
    return decisionError(origin, result.decision, result.correlationId);
  return json(origin, 200, result);
}
