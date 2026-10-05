import { readBoundedRequestBody, RequestTooLargeError } from '../_shared/request-body.ts';
import { requestSchema, type MemberInvitationDependencies } from './contracts.ts';
import { headers, json } from './responses.ts';
import { checkInvitationGuards } from './guards.ts';
import { executeInvitationAction } from './actions.ts';

export type {
  MemberInvitationDependencies,
  MemberInvitationAction,
  DeliveryResult,
  InvitationLimiterDecision,
} from './contracts.ts';

const MAX_REQUEST_BYTES = 8192;

export function createMemberInvitationsHandler(
  dependencies: MemberInvitationDependencies,
): (request: Request) => Promise<Response> {
  const createCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());
  const nowSeconds = dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  return async (request: Request): Promise<Response> => {
    const origin = dependencies.allowedOrigin;
    if (request.headers.get('origin') !== origin) {
      return json(origin, 403, {
        error: { code: 'member_invitation.origin_denied', message: 'This request is not allowed.' },
      });
    }
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== 'POST') {
      return json(origin, 405, {
        error: {
          code: 'member_invitation.method_not_allowed',
          message: 'This request is not supported.',
        },
      });
    }

    const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') ?? '');
    if (!match?.[1]) {
      return json(origin, 401, {
        error: {
          code: 'member_invitation.authentication_required',
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
              ? 'member_invitation.request_too_large'
              : 'member_invitation.invalid_request',
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
        error: { code: 'member_invitation.invalid_request', message: 'The request is invalid.' },
      });
    }

    let actor: Awaited<ReturnType<MemberInvitationDependencies['authenticate']>>;
    try {
      actor = await dependencies.authenticate(match[1]);
    } catch {
      return json(origin, 401, {
        error: {
          code: 'member_invitation.authentication_required',
          message: 'Sign in to continue.',
        },
      });
    }

    const correlationId = createCorrelationId();
    const denial = await checkInvitationGuards(
      dependencies,
      parsed.data,
      actor,
      origin,
      correlationId,
      nowSeconds,
    );
    if (denial) return denial;
    return executeInvitationAction(
      dependencies,
      parsed.data,
      actor,
      origin,
      correlationId,
      createCorrelationId,
    );
  };
}
