import {
  passwordAuthenticationIsRecent,
  type FactorInventoryClassification,
} from '../_shared/authentication-evidence.ts';
import {
  databaseDecisionSchema,
  databaseStatusSchema,
  type MemberMfaContext,
  type MemberMfaRequest,
} from './contracts.ts';
import { deny } from './factors.ts';
import { sha256 } from './idempotency.ts';
import { decisionError, json } from './responses.ts';

export async function readMfaStatus(
  context: MemberMfaContext,
  classified: FactorInventoryClassification,
): Promise<Response> {
  const { dependencies, actor, origin, correlationId } = context;

  if (classified.kind === 'conflict')
    return deny(dependencies, actor, correlationId, 'factor_state_conflict');
  const factorHash =
    classified.kind === 'one_verified_totp' || classified.kind === 'one_unverified_totp'
      ? await sha256(classified.factorId)
      : null;
  const result = databaseStatusSchema.parse(
    await dependencies.status({
      actorUserId: actor.actorUserId,
      factorReferenceHash: factorHash,
      correlationId,
    }),
  );
  if (result.decision !== 'available')
    return decisionError(origin, result.decision, result.correlationId);
  if (classified.kind === 'one_unverified_totp' && result.operationState !== 'bound') {
    return deny(dependencies, actor, correlationId, 'factor_state_conflict');
  }
  return json(origin, 200, {
    ...result,
    factorState:
      result.operationState === 'bound'
        ? 'resume_required'
        : result.operationState === 'started'
          ? 'cancellation_required'
          : classified.kind === 'none'
            ? 'enrollment_required'
            : 'challenge_required',
  });
}

export async function startMfaEnrollment(
  context: MemberMfaContext,
  input: Extract<MemberMfaRequest, { action: 'start' }>,
  classified: FactorInventoryClassification,
): Promise<Response> {
  const { dependencies, actor, origin, correlationId } = context;

  if (classified.kind === 'conflict' || classified.kind === 'one_unverified_totp')
    return deny(dependencies, actor, correlationId, 'factor_state_conflict');
  const factorHash =
    classified.kind === 'one_verified_totp' ? await sha256(classified.factorId) : null;
  const result = databaseDecisionSchema.parse(
    await dependencies.start({
      actorUserId: actor.actorUserId,
      factorReferenceHash: factorHash,
      idempotencyKeyHash: await sha256(input.idempotencyKey),
      correlationId,
    }),
  );
  if (result.decision !== 'ready')
    return decisionError(origin, result.decision, result.correlationId);
  return json(origin, 200, {
    ...result,
    factorState: classified.kind === 'none' ? 'enrollment_required' : 'challenge_required',
  });
}

export async function bindMfaFactor(
  context: MemberMfaContext,
  input: Extract<MemberMfaRequest, { action: 'bind_factor' }>,
  classified: FactorInventoryClassification,
): Promise<Response> {
  const { dependencies, actor, origin, correlationId } = context;

  if (classified.kind !== 'one_unverified_totp' || classified.factorId !== input.factorId)
    return deny(dependencies, actor, correlationId, 'factor_binding_conflict', input.operationId);
  const result = databaseDecisionSchema.parse(
    await dependencies.bindFactor({
      actorUserId: actor.actorUserId,
      operationId: input.operationId,
      expectedVersion: input.expectedVersion,
      factorReferenceHash: await sha256(input.factorId),
      idempotencyKeyHash: await sha256(input.idempotencyKey),
      correlationId,
    }),
  );
  if (result.decision !== 'bound')
    return decisionError(origin, result.decision, result.correlationId);
  return json(origin, 200, result);
}

export async function completeMfaEnrollment(
  context: MemberMfaContext,
  input: Extract<MemberMfaRequest, { action: 'complete' }>,
  classified: FactorInventoryClassification,
): Promise<Response> {
  const { dependencies, actor, origin, correlationId, nowSeconds } = context;

  if (
    actor.assuranceLevel !== 'aal2' ||
    actor.totpAuthenticatedAt === null ||
    !passwordAuthenticationIsRecent(actor, nowSeconds())
  ) {
    return deny(dependencies, actor, correlationId, 'mfa_assurance_required', input.operationId);
  }
  if (classified.kind !== 'one_verified_totp')
    return deny(
      dependencies,
      actor,
      correlationId,
      'completion_factor_conflict',
      input.operationId,
    );
  const result = databaseDecisionSchema.parse(
    await dependencies.complete({
      actor,
      operationId: input.operationId,
      expectedVersion: input.expectedVersion,
      factorReferenceHash: await sha256(classified.factorId),
      idempotencyKeyHash: await sha256(input.idempotencyKey),
      correlationId,
    }),
  );
  if (result.decision !== 'completed')
    return decisionError(origin, result.decision, result.correlationId);
  return json(origin, 200, result);
}
