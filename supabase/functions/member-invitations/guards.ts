import { passwordAuthenticationIsRecent } from '../_shared/authentication-evidence.ts';
import type {
  MemberInvitationDependencies,
  MemberInvitationRequest,
  MemberInvitationAction,
  InvitationActor,
  InvitationLimiterDecision,
} from './contracts.ts';
import { json, failure } from './responses.ts';

function requiresAdminFreshness(action: MemberInvitationAction): boolean {
  return action === 'create' || action === 'resend' || action === 'revoke';
}

export async function checkInvitationGuards(
  dependencies: MemberInvitationDependencies,
  data: MemberInvitationRequest,
  actor: InvitationActor,
  origin: string,
  correlationId: string,
  nowSeconds: () => number,
): Promise<Response | undefined> {
  let scopeId: string;
  try {
    scopeId = await dependencies.resolveLimitScope({
      actorUserId: actor.actorUserId,
      action: data.action,
      organizationId: 'organizationId' in data ? data.organizationId : null,
      invitationId: 'invitationId' in data ? data.invitationId : null,
      confirmedEmail: actor.confirmedEmail,
    });
  } catch {
    return json(origin, 503, {
      error: {
        code: 'member_invitation.limiter_unavailable',
        message: 'Invitations are temporarily unavailable.',
      },
      correlationId,
    });
  }
  let limit: InvitationLimiterDecision;
  try {
    limit = await dependencies.consumeLimit({
      actorSubjectId: actor.actorSubjectId,
      action: data.action,
      scopeId,
      correlationId,
    });
  } catch {
    return json(origin, 503, {
      error: {
        code: 'member_invitation.limiter_unavailable',
        message: 'Invitations are temporarily unavailable.',
      },
      correlationId,
    });
  }
  if (
    limit.correlationId !== correlationId ||
    limit.networkSourceUsed !== false ||
    limit.policyVersion !== 'invitation-subject-scope-v1'
  ) {
    return json(origin, 503, {
      error: {
        code: 'member_invitation.limiter_unavailable',
        message: 'Invitations are temporarily unavailable.',
      },
      correlationId,
    });
  }
  if (!limit.allowed) {
    const retry = limit.retryAfterSeconds;
    if (retry === null || retry < 1 || retry > 3600) {
      return json(origin, 503, {
        error: {
          code: 'member_invitation.limiter_unavailable',
          message: 'Invitations are temporarily unavailable.',
        },
        correlationId,
      });
    }
    return json(
      origin,
      429,
      {
        error: {
          code: 'member_invitation.rate_limited',
          message: `Wait ${retry} seconds before trying again.`,
        },
        correlationId,
      },
      { 'Retry-After': String(retry) },
    );
  }

  return checkAuthentication(dependencies, data, actor, origin, correlationId, nowSeconds);
}

async function checkAuthentication(
  dependencies: MemberInvitationDependencies,
  data: MemberInvitationRequest,
  actor: InvitationActor,
  origin: string,
  correlationId: string,
  nowSeconds: () => number,
): Promise<Response | undefined> {
  const hasPassword = actor.authenticationMethods.includes('password');
  const assuranceInvalid =
    (data.action === 'list' || requiresAdminFreshness(data.action)) &&
    actor.assuranceLevel !== 'aal2';
  const passwordInvalid =
    (data.action === 'list' && !hasPassword) ||
    ((requiresAdminFreshness(data.action) || data.action === 'accept') &&
      !passwordAuthenticationIsRecent(actor, nowSeconds()));
  if (assuranceInvalid || passwordInvalid) {
    try {
      await dependencies.recordDenied({
        actorUserId: actor.actorUserId,
        eventName: 'member_invitation.denied',
        reasonCode: assuranceInvalid
          ? 'authentication_assurance_required'
          : 'recent_authentication_required',
        correlationId,
      });
    } catch {
      return json(origin, 503, {
        error: {
          code: 'member_invitation.audit_unavailable',
          message: 'The invitation action could not be verified.',
        },
        correlationId,
      });
    }
    return failure(origin, 'recent_authentication_required', correlationId);
  }

  return undefined;
}
