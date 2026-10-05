export function responseHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
}

export function jsonResponse(
  origin: string,
  status: number,
  body: object,
  additionalHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders(origin), ...additionalHeaders },
  });
}

export function errorResponseForDecision(origin: string, decision: string, correlationId: string) {
  switch (decision) {
    case 'not_available':
      return jsonResponse(origin, 404, {
        error: {
          code: 'admin_onboarding.not_available',
          message: 'This onboarding request is not available.',
        },
        correlationId,
      });
    case 'expired':
      return jsonResponse(origin, 403, {
        error: {
          code: 'admin_onboarding.not_eligible',
          message: 'Sign in again or contact support to continue.',
        },
        correlationId,
      });
    case 'recent_authentication_required':
      return jsonResponse(origin, 403, {
        error: {
          code: 'admin_onboarding.recent_authentication_required',
          message: 'Sign in with your password again to continue.',
        },
        correlationId,
      });
    default:
      return jsonResponse(origin, 409, {
        error: {
          code: 'admin_onboarding.conflict',
          message: 'Your administrator onboarding information needs review.',
        },
        correlationId,
      });
  }
}
