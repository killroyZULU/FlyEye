import { auditFailure, rejectedResult, reportAuditFailure } from './audit.ts';
import {
  MemberAdministrationAuditWriteError,
  roleResultSchema,
  type AdministrationContext,
  type MemberAdministrationRequest,
  type MemberAdministrationDependencies,
} from './contracts.ts';
import { checkAssurance } from './guards.ts';
import { sha256 } from './idempotency.ts';
import { failure, json } from './responses.ts';
import type { z } from 'zod';
import type { RetainedInstructorPolicy } from '../_shared/retained-instructor-policy.ts';

function matchesAssignment(
  result: z.infer<typeof roleResultSchema>,
  policy: RetainedInstructorPolicy,
  correlationId: string,
) {
  return (
    !result.replayed &&
    result.version === 2 &&
    result.correlationId === correlationId &&
    result.organizationId === policy.schoolId &&
    result.membershipId === policy.membershipId &&
    result.roleCode === 'instructor_pilot'
  );
}

export async function consumeRetainedAssignment(
  context: AdministrationContext,
  data: Extract<MemberAdministrationRequest, { action: 'assign_role' }>,
  capability: NonNullable<MemberAdministrationDependencies['retainedInstructor']>,
  nowSeconds: () => number,
) {
  const { actor, dependencies, correlationId, origin } = context;
  const p = capability.policy;
  if (
    actor.actorUserId !== p.adminId ||
    actor.actorSubjectId !== p.adminId ||
    data.organizationId !== p.schoolId ||
    data.membershipId !== p.membershipId ||
    data.roleCode !== 'instructor_pilot' ||
    data.reasonCode !== 'responsibility_changed' ||
    data.expectedVersion !== 1 ||
    (await sha256(data.idempotencyKey)) !== p.keyHash ||
    nowSeconds() * 1000 >= Date.parse(p.expiresAt)
  ) {
    if (
      !(await auditFailure(
        dependencies,
        data,
        actor.actorUserId,
        'runtime_action_denied',
        correlationId,
      ))
    )
      return failure(origin, 'service_unavailable', correlationId);
    return failure(origin, 'not_found', correlationId);
  }
  const denied = await checkAssurance(context, data, nowSeconds);
  if (denied) return denied;
  try {
    const raw = await capability.consume(actor, correlationId);
    const result = roleResultSchema.safeParse(raw);
    if (!result.success) return await rejectedResult(context, data, raw);
    if (!matchesAssignment(result.data, p, correlationId))
      return failure(origin, 'service_unavailable', correlationId);
    return json(origin, 200, result.data);
  } catch (error) {
    if (error instanceof MemberAdministrationAuditWriteError)
      reportAuditFailure(dependencies, 'assign_role', correlationId);
    return failure(origin, 'service_unavailable', correlationId);
  }
}
