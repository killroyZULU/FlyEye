import { z } from 'zod';

import { readBoundedRequestBody, RequestTooLargeError } from '../_shared/request-body.ts';
import type { AuthBootstrapDependencies, AuthenticatedActor } from './contracts.ts';
import { resolveAuthenticatedAccess } from './access-decision.ts';
import { jsonResponse, responseHeaders } from './responses.ts';

export type { AuthBootstrapDependencies, AuthenticatedActor, AuditDecision } from './contracts.ts';

const MAX_REQUEST_BYTES = 2048;
const requestSchema = z.object({}).strict();

export function createAuthBootstrapHandler(
  dependencies: AuthBootstrapDependencies,
): (request: Request) => Promise<Response> {
  const { allowedOrigin } = dependencies;
  const createCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());

  return async (request: Request): Promise<Response> => {
    const requestOrigin = request.headers.get('origin');

    if (requestOrigin !== allowedOrigin) {
      return jsonResponse(allowedOrigin, 403, {
        error: { code: 'auth.origin_denied', message: 'This request is not allowed.' },
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: responseHeaders(allowedOrigin) });
    }

    if (request.method !== 'POST') {
      return jsonResponse(allowedOrigin, 405, {
        error: { code: 'auth.method_not_allowed', message: 'This request is not supported.' },
      });
    }

    const authorization = request.headers.get('authorization') ?? '';
    const tokenMatch = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    if (!tokenMatch?.[1]) {
      return jsonResponse(allowedOrigin, 401, {
        error: { code: 'auth.authentication_required', message: 'Sign in to continue.' },
      });
    }

    let requestBody: unknown;
    try {
      const bodyText = await readBoundedRequestBody(request, MAX_REQUEST_BYTES);
      requestBody = JSON.parse(bodyText);
    } catch (error) {
      if (error instanceof RequestTooLargeError) {
        return jsonResponse(allowedOrigin, 413, {
          error: { code: 'auth.request_too_large', message: 'The request is too large.' },
        });
      }
      return jsonResponse(allowedOrigin, 400, {
        error: { code: 'auth.invalid_request', message: 'The request is invalid.' },
      });
    }

    const parsedRequest = requestSchema.safeParse(requestBody);
    if (!parsedRequest.success) {
      return jsonResponse(allowedOrigin, 422, {
        error: { code: 'auth.invalid_request', message: 'The request is invalid.' },
      });
    }

    let actor: AuthenticatedActor;
    try {
      actor = await dependencies.authenticate(tokenMatch[1]);
    } catch {
      return jsonResponse(allowedOrigin, 401, {
        error: { code: 'auth.authentication_required', message: 'Sign in to continue.' },
      });
    }

    return resolveAuthenticatedAccess(dependencies, actor, allowedOrigin, createCorrelationId);
  };
}
