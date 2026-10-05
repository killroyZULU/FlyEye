import { readBoundedRequestBody, RequestTooLargeError } from '../_shared/request-body.ts';
import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';
import {
  MAX_REQUEST_BYTES,
  requestSchema,
  type MemberAdministrationDependencies,
} from './contracts.ts';
import { headers, json } from './responses.ts';
import { checkLimit, checkAssurance } from './guards.ts';
import { executeAdministrationAction } from './actions.ts';

export {
  MemberAdministrationAuditWriteError,
  type MemberAdministrationAction,
  type CursorBoundary,
  type AdministrationLimiterDecision,
  type MemberAdministrationDependencies,
} from './contracts.ts';

export function createMemberAdministrationHandler(
  dependencies: MemberAdministrationDependencies,
): (request: Request) => Promise<Response> {
  const createCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());
  const nowSeconds = dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  return async (request: Request): Promise<Response> => {
    const origin = dependencies.allowedOrigin;
    if (request.headers.get('origin') !== origin) {
      return json(origin, 403, {
        error: {
          code: 'member_administration.origin_denied',
          message: 'This request is not allowed.',
        },
      });
    }
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== 'POST') {
      return json(origin, 405, {
        error: {
          code: 'member_administration.method_not_allowed',
          message: 'This request is not supported.',
        },
      });
    }

    const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') ?? '');
    if (!match?.[1]) {
      return json(origin, 401, {
        error: {
          code: 'member_administration.authentication_required',
          message: 'Sign in to continue.',
        },
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBoundedRequestBody(request, MAX_REQUEST_BYTES));
    } catch (error) {
      return json(origin, error instanceof RequestTooLargeError ? 413 : 400, {
        error: {
          code:
            error instanceof RequestTooLargeError
              ? 'member_administration.request_too_large'
              : 'member_administration.invalid_request',
          message:
            error instanceof RequestTooLargeError
              ? 'The request is too large.'
              : 'The request is invalid.',
        },
      });
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return json(origin, 422, {
        error: {
          code: 'member_administration.invalid_request',
          message: 'The request is invalid.',
        },
      });
    }

    let actor: VerifiedAuthenticationEvidence;
    try {
      actor = await dependencies.authenticate(match[1]);
    } catch {
      return json(origin, 401, {
        error: {
          code: 'member_administration.authentication_required',
          message: 'Sign in to continue.',
        },
      });
    }

    const correlationId = createCorrelationId();
    const context = { dependencies, actor, origin, correlationId };
    const limited = await checkLimit(context, parsed.data);
    if (limited) return limited;
    const denied = await checkAssurance(context, parsed.data, nowSeconds);
    if (denied) return denied;
    return await executeAdministrationAction(context, parsed.data);
  };
}
