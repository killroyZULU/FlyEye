export function headers(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
}

export function json(
  origin: string,
  status: number,
  body: object,
  extra: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers(origin), ...extra } });
}

export function failure(origin: string, decision: string, correlationId: string): Response {
  switch (decision) {
    case 'not_available':
      return json(origin, 404, {
        error: {
          code: 'member_invitation.not_available',
          message: 'This invitation is not available.',
        },
        correlationId,
      });
    case 'recent_authentication_required':
      return json(origin, 403, {
        error: {
          code: 'member_invitation.recent_authentication_required',
          message: 'Sign in with your password again to continue.',
        },
        correlationId,
      });
    case 'delivery_failed':
      return json(origin, 502, {
        error: {
          code: 'member_invitation.delivery_failed',
          message: 'The invitation could not be sent. It may be retried safely.',
        },
        correlationId,
      });
    case 'delivery_uncertain':
      return json(origin, 503, {
        error: {
          code: 'member_invitation.delivery_uncertain',
          message: 'The delivery result could not be confirmed. Wait before retrying.',
        },
        correlationId,
      });
    default:
      return json(origin, 409, {
        error: {
          code: 'member_invitation.conflict',
          message: 'The invitation state changed. Refresh and try again.',
        },
        correlationId,
      });
  }
}
