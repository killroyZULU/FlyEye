import { readBoundedRequestBody, RequestTooLargeError } from '../_shared/request-body.ts';
import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';
import {
  MAX_REQUEST_BYTES,
  requestSchema,
  type MemberMfaDependencies,
  type MemberMfaRequest,
} from './contracts.ts';
import { headers, json } from './responses.ts';
import { checkRequestGuards } from './guards.ts';
import { inventory } from './factors.ts';
import { executeMfaAction } from './actions.ts';

export type {
  MemberMfaAction,
  MemberMfaLimiterDecision,
  MemberMfaDependencies,
} from './contracts.ts';

export function createMemberMfaHandler(dependencies: MemberMfaDependencies) {
  const makeCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());
  const nowSeconds = dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  return async (request: Request): Promise<Response> => {
    const origin = dependencies.allowedOrigin;
    if (request.headers.get('origin') !== origin) {
      return json(origin, 403, {
        error: { code: 'member_mfa.origin_denied', message: 'This request is not allowed.' },
      });
    }
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== 'POST')
      return json(origin, 405, {
        error: { code: 'member_mfa.method_not_allowed', message: 'This request is not supported.' },
      });

    const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token)
      return json(origin, 401, {
        error: { code: 'member_mfa.authentication_required', message: 'Sign in to continue.' },
      });

    let input: MemberMfaRequest;
    try {
      const parsed = requestSchema.safeParse(
        JSON.parse(await readBoundedRequestBody(request, MAX_REQUEST_BYTES)),
      );
      if (!parsed.success)
        return json(origin, 422, {
          error: { code: 'member_mfa.validation_failed', message: 'The request is invalid.' },
        });
      input = parsed.data;
    } catch (error) {
      return json(origin, error instanceof RequestTooLargeError ? 413 : 400, {
        error: {
          code:
            error instanceof RequestTooLargeError
              ? 'member_mfa.request_too_large'
              : 'member_mfa.validation_failed',
          message: 'The request is invalid.',
        },
      });
    }

    let actor: VerifiedAuthenticationEvidence;
    try {
      actor = await dependencies.authenticate(token);
    } catch {
      return json(origin, 401, {
        error: { code: 'member_mfa.authentication_required', message: 'Sign in to continue.' },
      });
    }

    const correlationId = makeCorrelationId();
    const context = { dependencies, actor, origin, correlationId, nowSeconds };
    const denied = await checkRequestGuards(context, input);
    if (denied) return denied;
    const classified = await inventory(dependencies, actor, correlationId);
    if (classified instanceof Response) return classified;
    return await executeMfaAction(context, input, classified);
  };
}
