import { readBoundedRequestBody, RequestTooLargeError } from '../_shared/request-body.ts';
import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';
import { MAX_REQUEST_BYTES, requestSchema, type AdminOnboardingDependencies } from './contracts.ts';
import { responseHeaders, jsonResponse } from './responses.ts';
import { checkRequestGuards } from './guards.ts';
import { executeAdminOnboardingAction } from './actions.ts';

export type {
  AdminOnboardingAction,
  LimiterDecision,
  AdminOnboardingDependencies,
} from './contracts.ts';

export function createAdminOnboardingHandler(
  dependencies: AdminOnboardingDependencies,
): (request: Request) => Promise<Response> {
  const createCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());
  const nowSeconds = dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  return async (request: Request): Promise<Response> => {
    const { allowedOrigin } = dependencies;
    const requestOrigin = request.headers.get('origin');

    if (requestOrigin !== allowedOrigin) {
      return jsonResponse(allowedOrigin, 403, {
        error: {
          code: 'admin_onboarding.origin_denied',
          message: 'This request is not allowed.',
        },
      });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: responseHeaders(allowedOrigin) });
    }
    if (request.method !== 'POST') {
      return jsonResponse(allowedOrigin, 405, {
        error: {
          code: 'admin_onboarding.method_not_allowed',
          message: 'This request is not supported.',
        },
      });
    }

    const authorization = request.headers.get('authorization') ?? '';
    const tokenMatch = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    if (!tokenMatch?.[1]) {
      return jsonResponse(allowedOrigin, 401, {
        error: {
          code: 'admin_onboarding.authentication_required',
          message: 'Sign in to continue.',
        },
      });
    }

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(await readBoundedRequestBody(request, MAX_REQUEST_BYTES));
    } catch (error) {
      if (error instanceof RequestTooLargeError) {
        return jsonResponse(allowedOrigin, 413, {
          error: {
            code: 'admin_onboarding.request_too_large',
            message: 'The request is too large.',
          },
        });
      }
      return jsonResponse(allowedOrigin, 400, {
        error: {
          code: 'admin_onboarding.invalid_request',
          message: 'The request is invalid.',
        },
      });
    }

    const parsedRequest = requestSchema.safeParse(requestBody);
    if (!parsedRequest.success) {
      return jsonResponse(allowedOrigin, 422, {
        error: {
          code: 'admin_onboarding.invalid_request',
          message: 'The request is invalid.',
        },
      });
    }

    let actor: VerifiedAuthenticationEvidence;
    try {
      actor = await dependencies.authenticate(tokenMatch[1]);
    } catch {
      return jsonResponse(allowedOrigin, 401, {
        error: {
          code: 'admin_onboarding.authentication_required',
          message: 'Sign in to continue.',
        },
      });
    }

    const correlationId = createCorrelationId();
    const context = { dependencies, actor, allowedOrigin, correlationId };
    const denied = await checkRequestGuards(context, parsedRequest.data, nowSeconds);
    if (denied) return denied;
    return await executeAdminOnboardingAction(context, parsedRequest.data);
  };
}
