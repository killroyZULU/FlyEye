import {
  passwordAuthenticationIsPresent,
  passwordAuthenticationIsRecent,
} from '../_shared/authentication-evidence.ts';
import type { MemberMfaContext, MemberMfaRequest } from './contracts.ts';
import { decisionError, json } from './responses.ts';

export async function checkRequestGuards(
  context: MemberMfaContext,
  input: MemberMfaRequest,
): Promise<Response | null> {
  const { dependencies, actor, origin, correlationId, nowSeconds } = context;
  try {
    const limited = await dependencies.consumeLimit({
      actorSubjectId: actor.actorSubjectId,
      action: input.action,
      correlationId,
    });
    if (
      limited.correlationId !== correlationId ||
      limited.networkSourceUsed !== false ||
      limited.policyVersion !== 'member-mfa-subject-action-v1'
    )
      throw new Error();
    if (!limited.allowed) {
      if (!limited.retryAfterSeconds) throw new Error();
      return json(
        origin,
        429,
        {
          error: {
            code: 'member_mfa.rate_limited',
            message: `Wait ${limited.retryAfterSeconds} seconds before trying again.`,
          },
          correlationId,
        },
        { 'Retry-After': String(limited.retryAfterSeconds) },
      );
    }
  } catch {
    return json(origin, 503, {
      error: {
        code: 'member_mfa.limiter_unavailable',
        message: 'Authenticator setup is temporarily unavailable.',
      },
      correlationId,
    });
  }

  if (
    input.action === 'status'
      ? !passwordAuthenticationIsPresent(actor, nowSeconds())
      : input.action !== 'cancel' && !passwordAuthenticationIsRecent(actor, nowSeconds())
  ) {
    try {
      await dependencies.recordDenied({
        actorUserId: actor.actorUserId,
        eventName: 'member_mfa.denied',
        correlationId,
        reasonCode:
          input.action === 'status'
            ? 'password_authentication_required'
            : 'recent_authentication_required',
        operationId: 'operationId' in input ? input.operationId : undefined,
      });
    } catch {
      return json(origin, 500, {
        error: {
          code: 'member_mfa.audit_unavailable',
          message: 'Authenticator setup could not be verified.',
        },
        correlationId,
      });
    }
    return decisionError(origin, 'recent_authentication_required', correlationId);
  }

  return null;
}
