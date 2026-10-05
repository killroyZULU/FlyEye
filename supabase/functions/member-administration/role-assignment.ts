import { classifyCompleteFactorInventory } from '../_shared/authentication-evidence.ts';
import {
  decisionSchema,
  roleAssignmentContextSchema,
  roleResultSchema,
  type AdministrationContext,
  type MemberAdministrationRequest,
} from './contracts.ts';
import { sha256 } from './idempotency.ts';
import { auditFailure, rejectedResult } from './audit.ts';
import { failure, json } from './responses.ts';

export async function assignMemberRole(
  context: AdministrationContext,
  data: Extract<MemberAdministrationRequest, { action: 'assign_role' }>,
): Promise<Response> {
  const { dependencies, actor, correlationId } = context;
  const rawContext = await dependencies.resolveRoleContext({
    actorUserId: actor.actorUserId,
    organizationId: data.organizationId,
    membershipId: data.membershipId,
    roleCode: data.roleCode,
    expectedVersion: data.expectedVersion,
    correlationId,
  });
  const contextResult = roleAssignmentContextSchema.safeParse(rawContext);
  const contextDecision = decisionSchema.safeParse(rawContext);
  if (
    !contextResult.success &&
    contextDecision.success &&
    contextDecision.data.decision === 'state_conflict' &&
    contextDecision.data.correlationId === correlationId
  ) {
    return await replayRole(context, data);
  }
  if (
    !contextResult.success ||
    contextResult.data.correlationId !== correlationId ||
    contextResult.data.organizationId !== data.organizationId ||
    contextResult.data.membershipId !== data.membershipId ||
    contextResult.data.newRoleCode !== data.roleCode
  ) {
    return await rejectedResult(context, data, rawContext);
  }

  return await assignValidatedRole(context, data, contextResult.data);
}
async function replayRole(
  context: AdministrationContext,
  data: Extract<MemberAdministrationRequest, { action: 'assign_role' }>,
): Promise<Response> {
  const { dependencies, actor, origin, correlationId } = context;
  const result = await dependencies.changeRole({
    actorUserId: actor.actorUserId,
    organizationId: data.organizationId,
    membershipId: data.membershipId,
    roleCode: data.roleCode,
    reasonCode: data.reasonCode,
    expectedVersion: data.expectedVersion,
    idempotencyKeyHash: await sha256(data.idempotencyKey),
    factorReferenceHash: null,
    correlationId,
  });
  const replayed = roleResultSchema.safeParse(result);
  if (
    replayed.success &&
    replayed.data.replayed &&
    replayed.data.correlationId === correlationId &&
    replayed.data.organizationId === data.organizationId &&
    replayed.data.membershipId === data.membershipId &&
    replayed.data.roleCode === data.roleCode
  ) {
    return json(origin, 200, replayed.data);
  }
  return await rejectedResult(context, data, result);
}

async function assignValidatedRole(
  context: AdministrationContext,
  data: Extract<MemberAdministrationRequest, { action: 'assign_role' }>,
  roleContext: { requiresMfa: boolean; targetUserId: string },
): Promise<Response> {
  const { dependencies, actor, origin, correlationId } = context;
  let factorReferenceHash: string | null = null;
  if (roleContext.requiresMfa) {
    let factors: ReturnType<typeof classifyCompleteFactorInventory>;
    try {
      factors = classifyCompleteFactorInventory(
        await dependencies.listFactors(roleContext.targetUserId),
      );
    } catch {
      if (
        !(await auditFailure(
          dependencies,
          data,
          actor.actorUserId,
          'factor_inventory_unavailable',
          correlationId,
        ))
      ) {
        return failure(origin, 'service_unavailable', correlationId);
      }
      return failure(origin, 'service_unavailable', correlationId);
    }
    if (factors.kind !== 'one_verified_totp') {
      if (
        !(await auditFailure(
          dependencies,
          data,
          actor.actorUserId,
          'target_mfa_not_ready',
          correlationId,
        ))
      ) {
        return failure(origin, 'service_unavailable', correlationId);
      }
      return failure(origin, 'target_mfa_not_ready', correlationId);
    }
    factorReferenceHash = await sha256(factors.factorId);
  }

  const result = await dependencies.changeRole({
    actorUserId: actor.actorUserId,
    organizationId: data.organizationId,
    membershipId: data.membershipId,
    roleCode: data.roleCode,
    reasonCode: data.reasonCode,
    expectedVersion: data.expectedVersion,
    idempotencyKeyHash: await sha256(data.idempotencyKey),
    factorReferenceHash,
    correlationId,
  });
  const changed = roleResultSchema.safeParse(result);
  if (
    changed.success &&
    changed.data.correlationId === correlationId &&
    changed.data.organizationId === data.organizationId &&
    changed.data.membershipId === data.membershipId &&
    changed.data.roleCode === data.roleCode
  ) {
    return json(origin, 200, changed.data);
  }
  return await rejectedResult(context, data, result);
}
