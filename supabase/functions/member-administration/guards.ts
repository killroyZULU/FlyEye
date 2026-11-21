import {
  passwordAuthenticationIsPresent,
  passwordAuthenticationIsRecent,
} from '../_shared/authentication-evidence.ts';
import type {
  AdministrationContext,
  MemberAdministrationRequest,
  MemberAdministrationAction,
  AdministrationLimiterDecision,
} from './contracts.ts';
import { requestHints, auditFailure } from './audit.ts';
import { failure, json } from './responses.ts';

function requiresAal2(action: MemberAdministrationAction): boolean {
  return ['list', 'detail', 'suspend', 'reactivate', 'revoke', 'assign_role'].includes(action);
}

function requiresFreshPassword(action: MemberAdministrationAction): boolean {
  return ['suspend', 'reactivate', 'revoke', 'assign_role'].includes(action);
}

export async function checkLimit(
  context: AdministrationContext,
  data: MemberAdministrationRequest,
): Promise<Response | null> {
  const { dependencies, actor, origin, correlationId } = context;
  const hints = requestHints(data);
  // Share the existing subject/school budget with the corresponding member operation.
  const action =
    data.action === 'my_credentials'
      ? 'get_profile'
      : data.action === 'personnel_credentials'
        ? 'list'
        : data.action === 'set_credential_applicability'
          ? 'update_profile'
          : data.action;
  let scopeId: string;
  try {
    scopeId = await dependencies.resolveLimitScope({
      actorUserId: actor.actorUserId,
      action,
      ...hints,
    });
  } catch {
    return failure(origin, 'service_unavailable', correlationId);
  }

  let limit: AdministrationLimiterDecision;
  try {
    limit = await dependencies.consumeLimit({
      actorSubjectId: actor.actorSubjectId,
      action,
      scopeId,
      correlationId,
    });
  } catch {
    return failure(origin, 'service_unavailable', correlationId);
  }
  if (
    limit.correlationId !== correlationId ||
    limit.networkSourceUsed !== false ||
    limit.policyVersion !== 'member-administration-subject-scope-v1'
  ) {
    return failure(origin, 'service_unavailable', correlationId);
  }
  if (!limit.allowed) {
    const retry = limit.retryAfterSeconds;
    if (
      retry === null ||
      retry < 1 ||
      retry > 3600 ||
      !(await auditFailure(dependencies, data, actor.actorUserId, 'rate_limited', correlationId))
    ) {
      return failure(origin, 'service_unavailable', correlationId);
    }
    return json(
      origin,
      429,
      {
        error: {
          code: 'member_administration.rate_limited',
          message: `Wait ${retry} seconds before trying again.`,
        },
        correlationId,
      },
      { 'Retry-After': String(retry) },
    );
  }

  return null;
}

export async function checkAssurance(
  context: AdministrationContext,
  data: MemberAdministrationRequest,
  nowSeconds: () => number,
): Promise<Response | null> {
  const { dependencies, actor, origin, correlationId } = context;
  let profileAssurance: 'aal1' | 'aal2' | 'denied' = 'denied';
  if (
    data.action === 'get_profile' ||
    data.action === 'update_profile' ||
    data.action === 'my_credentials'
  ) {
    try {
      profileAssurance = await dependencies.resolveProfileAssurance({
        actorUserId: actor.actorUserId,
        membershipId: data.membershipId,
      });
    } catch {
      return failure(origin, 'service_unavailable', correlationId);
    }
    if (profileAssurance === 'denied') {
      if (
        !(await auditFailure(dependencies, data, actor.actorUserId, 'not_found', correlationId))
      ) {
        return failure(origin, 'service_unavailable', correlationId);
      }
      return failure(origin, 'not_found', correlationId);
    }
  }

  const assuranceInvalid =
    (requiresAal2(data.action) ||
      data.action === 'personnel_credentials' ||
      data.action === 'set_credential_applicability' ||
      profileAssurance === 'aal2') &&
    (actor.assuranceLevel !== 'aal2' || actor.totpAuthenticatedAt === null);
  const passwordInvalid =
    (requiresFreshPassword(data.action) && !passwordAuthenticationIsRecent(actor, nowSeconds())) ||
    (['my_credentials', 'personnel_credentials', 'set_credential_applicability'].includes(
      data.action,
    ) &&
      !passwordAuthenticationIsPresent(actor, nowSeconds()));
  if (assuranceInvalid || passwordInvalid) {
    const reason = assuranceInvalid
      ? 'authentication_assurance_required'
      : 'recent_authentication_required';
    if (!(await auditFailure(dependencies, data, actor.actorUserId, reason, correlationId))) {
      return failure(origin, 'service_unavailable', correlationId);
    }
    return json(origin, 403, {
      error: {
        code: `member_administration.${reason}`,
        message: assuranceInvalid
          ? 'Verify your authenticator to continue.'
          : 'Sign in with your password again to continue.',
      },
      correlationId,
    });
  }

  return null;
}
