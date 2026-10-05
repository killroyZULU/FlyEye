import {
  MemberAdministrationAuditWriteError,
  decisionSchema,
  type MemberAdministrationAction,
  type MemberAdministrationDependencies,
  type MemberAdministrationRequest,
  type AdministrationContext,
} from './contracts.ts';
import { failure } from './responses.ts';
export function requestHints(request: MemberAdministrationRequest) {
  return {
    organizationId: 'organizationId' in request ? request.organizationId : null,
    membershipId: 'membershipId' in request ? request.membershipId : null,
  };
}

export async function auditFailure(
  dependencies: MemberAdministrationDependencies,
  request: MemberAdministrationRequest,
  actorUserId: string,
  decision: string,
  correlationId: string,
): Promise<boolean> {
  const hints = requestHints(request);
  try {
    await dependencies.recordDenied({
      actorUserId,
      eventName:
        decision === 'state_conflict' || decision === 'last_administrator'
          ? 'member_administration.conflicted'
          : 'member_administration.denied',
      reasonCode: decision,
      correlationId,
      ...hints,
    });
    return true;
  } catch (error) {
    if (error instanceof MemberAdministrationAuditWriteError)
      reportAuditFailure(dependencies, request.action, correlationId);
    return false;
  }
}

export function reportAuditFailure(
  dependencies: MemberAdministrationDependencies,
  action: MemberAdministrationAction,
  correlationId: string,
): void {
  try {
    dependencies.reportAuditFailure({ action, correlationId });
  } catch {
    // The protected operation remains fail closed even when telemetry is unavailable.
  }
}

export async function rejectedResult(
  context: AdministrationContext,
  data: MemberAdministrationRequest,
  result: unknown,
): Promise<Response> {
  const { dependencies, actor, origin, correlationId } = context;
  const decision = decisionSchema.safeParse(result);
  const safeDecision = decision.success ? decision.data.decision : 'service_unavailable';
  if (
    safeDecision !== 'service_unavailable' &&
    !(await auditFailure(dependencies, data, actor.actorUserId, safeDecision, correlationId))
  ) {
    return failure(origin, 'service_unavailable', correlationId);
  }
  return failure(origin, safeDecision, correlationId);
}
