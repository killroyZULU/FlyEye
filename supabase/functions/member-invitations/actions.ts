import {
  listResultSchema,
  stateResultSchema,
  preparationResultSchema,
  type MemberInvitationDependencies,
  type MemberInvitationRequest,
  type InvitationActor,
} from './contracts.ts';
import { deliverInvitation } from './delivery.ts';
import { sha256 } from './idempotency.ts';
import { failure, json } from './responses.ts';

export async function executeInvitationAction(
  dependencies: MemberInvitationDependencies,
  data: MemberInvitationRequest,
  actor: InvitationActor,
  origin: string,
  correlationId: string,
  createCorrelationId: () => string,
): Promise<Response> {
  try {
    switch (data.action) {
      case 'list': {
        const result = listResultSchema.safeParse(
          await dependencies.list({
            actorUserId: actor.actorUserId,
            organizationId: data.organizationId,
            correlationId,
          }),
        );
        if (!result.success) return failure(origin, 'not_available', correlationId);
        return json(origin, 200, result.data);
      }
      case 'create':
      case 'resend':
        return await deliverInvitation(
          dependencies,
          data,
          actor,
          origin,
          correlationId,
          createCorrelationId,
        );
      case 'revoke': {
        const result = stateResultSchema.safeParse(
          await dependencies.revoke({
            actorUserId: actor.actorUserId,
            organizationId: data.organizationId,
            invitationId: data.invitationId,
            expectedVersion: data.expectedVersion,
            idempotencyKeyHash: await sha256(data.idempotencyKey),
            correlationId,
          }),
        );
        if (!result.success || result.data.decision !== 'revoked') {
          return failure(origin, result.success ? result.data.decision : 'conflict', correlationId);
        }
        return json(origin, 200, result.data);
      }
      case 'prepare':
      case 'accept':
        return await executeRecipientAction(dependencies, data, actor, origin, correlationId);
    }
  } catch {
    return json(origin, 503, {
      error: {
        code: 'member_invitation.audit_unavailable',
        message: 'The invitation action could not be verified.',
      },
      correlationId,
    });
  }
}

async function executeRecipientAction(
  dependencies: MemberInvitationDependencies,
  data: Extract<MemberInvitationRequest, { action: 'prepare' | 'accept' }>,
  actor: InvitationActor,
  origin: string,
  correlationId: string,
): Promise<Response> {
  switch (data.action) {
    case 'prepare': {
      if (!actor.confirmedEmail) {
        await dependencies.recordDenied({
          actorUserId: actor.actorUserId,
          eventName: 'member_invitation.denied',
          reasonCode: 'confirmed_email_required',
          correlationId,
        });
        return failure(origin, 'not_available', correlationId);
      }
      const result = preparationResultSchema.safeParse(
        await dependencies.prepare({
          actorUserId: actor.actorUserId,
          confirmedEmail: actor.confirmedEmail,
          invitationId: data.invitationId,
          expectedVersion: data.expectedVersion,
          correlationId,
        }),
      );
      if (
        !result.success ||
        result.data.decision !== 'prepared' ||
        !result.data.invitationId ||
        !result.data.credentialMode ||
        !result.data.version
      ) {
        return failure(origin, 'not_available', correlationId);
      }
      return json(origin, 200, result.data);
    }
    case 'accept': {
      if (!actor.confirmedEmail) {
        await dependencies.recordDenied({
          actorUserId: actor.actorUserId,
          eventName: 'member_invitation.denied',
          reasonCode: 'confirmed_email_required',
          correlationId,
        });
        return failure(origin, 'not_available', correlationId);
      }
      const result = stateResultSchema.safeParse(
        await dependencies.accept({
          actor,
          confirmedEmail: actor.confirmedEmail,
          invitationId: data.invitationId,
          expectedVersion: data.expectedVersion,
          idempotencyKeyHash: await sha256(data.idempotencyKey),
          correlationId,
        }),
      );
      if (!result.success || result.data.decision !== 'accepted') {
        return failure(origin, result.success ? result.data.decision : 'conflict', correlationId);
      }
      return json(origin, 200, result.data);
    }
  }
}
