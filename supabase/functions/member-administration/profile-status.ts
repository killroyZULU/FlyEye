import {
  profileResultSchema,
  statusResultSchema,
  type AdministrationContext,
  type MemberAdministrationRequest,
} from './contracts.ts';
import { rejectedResult } from './audit.ts';
import { json } from './responses.ts';
import { sha256 } from './idempotency.ts';

export async function memberProfile(
  context: AdministrationContext,
  data: Extract<MemberAdministrationRequest, { action: 'get_profile' | 'update_profile' }>,
): Promise<Response> {
  const { dependencies, actor, origin, correlationId } = context;
  const result =
    data.action === 'get_profile'
      ? await dependencies.getProfile({
          actorUserId: actor.actorUserId,
          membershipId: data.membershipId,
          correlationId,
        })
      : await dependencies.updateProfile({
          actorUserId: actor.actorUserId,
          membershipId: data.membershipId,
          displayName: data.displayName,
          contactNumber: data.contactNumber,
          expectedVersion: data.expectedVersion,
          correlationId,
        });
  const profile = profileResultSchema.safeParse(result);
  if (
    profile.success &&
    profile.data.correlationId === correlationId &&
    profile.data.profile.membershipId === data.membershipId
  ) {
    return json(origin, 200, profile.data);
  }
  return await rejectedResult(context, data, result);
}

export async function changeMemberStatus(
  context: AdministrationContext,
  data: Extract<MemberAdministrationRequest, { action: 'suspend' | 'reactivate' | 'revoke' }>,
): Promise<Response> {
  const { dependencies, actor, origin, correlationId } = context;
  const result = await dependencies.changeStatus({
    actorUserId: actor.actorUserId,
    organizationId: data.organizationId,
    membershipId: data.membershipId,
    action: data.action,
    reasonCode: data.reasonCode,
    expectedVersion: data.expectedVersion,
    idempotencyKeyHash: await sha256(data.idempotencyKey),
    correlationId,
  });
  const changed = statusResultSchema.safeParse(result);
  const expectedStatus =
    data.action === 'suspend' ? 'suspended' : data.action === 'reactivate' ? 'active' : 'revoked';
  if (
    changed.success &&
    changed.data.correlationId === correlationId &&
    changed.data.organizationId === data.organizationId &&
    changed.data.membershipId === data.membershipId &&
    changed.data.decision === expectedStatus &&
    changed.data.status === expectedStatus
  ) {
    return json(origin, 200, changed.data);
  }
  return await rejectedResult(context, data, result);
}
