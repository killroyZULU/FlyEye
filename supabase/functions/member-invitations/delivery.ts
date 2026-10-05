import {
  beginResultSchema,
  stateResultSchema,
  type MemberInvitationDependencies,
  type MemberInvitationRequest,
  type InvitationActor,
  type DeliveryResult,
} from './contracts.ts';
import { sha256, finalizeWithReadBack } from './idempotency.ts';
import { failure, json } from './responses.ts';

export async function deliverInvitation(
  dependencies: MemberInvitationDependencies,
  data: Extract<MemberInvitationRequest, { action: 'create' | 'resend' }>,
  actor: InvitationActor,
  origin: string,
  correlationId: string,
  createCorrelationId: () => string,
): Promise<Response> {
  const keyHash = await sha256(data.idempotencyKey);
  const beginning = beginResultSchema.safeParse(
    data.action === 'create'
      ? await dependencies.beginCreate({
          actorUserId: actor.actorUserId,
          organizationId: data.organizationId,
          email: data.email,
          roleCode: data.roleCode,
          idempotencyKeyHash: keyHash,
          correlationId,
        })
      : await dependencies.beginResend({
          actorUserId: actor.actorUserId,
          organizationId: data.organizationId,
          invitationId: data.invitationId,
          expectedVersion: data.expectedVersion,
          idempotencyKeyHash: keyHash,
          correlationId,
        }),
  );
  if (!beginning.success) return failure(origin, 'conflict', correlationId);
  if (beginning.data.replayed) {
    if (
      beginning.data.decision === 'pending' &&
      beginning.data.invitationId &&
      beginning.data.version
    ) {
      return json(origin, 200, {
        decision: 'pending',
        invitationId: beginning.data.invitationId,
        version: beginning.data.version,
        replayed: true,
        correlationId,
      });
    }
    return failure(
      origin,
      beginning.data.decision === 'issuing' ? 'delivery_uncertain' : beginning.data.decision,
      correlationId,
    );
  }
  if (
    beginning.data.decision !== 'issuing' ||
    !beginning.data.invitationId ||
    !beginning.data.version ||
    !beginning.data.email
  ) {
    return failure(origin, beginning.data.decision, correlationId);
  }

  const operationId = createCorrelationId();
  let delivery: DeliveryResult;
  try {
    delivery = await dependencies.send({
      invitationId: beginning.data.invitationId,
      invitationVersion: beginning.data.version,
      email: beginning.data.email,
    });
  } catch {
    delivery = { outcome: 'uncertain', operationClass: 'new_identity_invite' };
  }

  let finalized: unknown;
  try {
    finalized = await finalizeWithReadBack(dependencies, {
      actorUserId: actor.actorUserId,
      invitationId: beginning.data.invitationId,
      deliveryOperationId: operationId,
      delivery,
      correlationId,
    });
  } catch {
    return failure(origin, 'delivery_uncertain', correlationId);
  }
  const result = stateResultSchema.safeParse(finalized);
  if (!result.success || result.data.decision !== 'pending') {
    return failure(
      origin,
      result.success ? result.data.decision : 'delivery_uncertain',
      correlationId,
    );
  }
  return json(origin, 200, result.data);
}
