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
  const table: Record<string, { status: number; code: string; message: string }> = {
    validation_failed: {
      status: 422,
      code: 'member_administration.validation_failed',
      message: 'The member request is invalid.',
    },
    not_found: {
      status: 404,
      code: 'member_administration.not_found',
      message: 'The requested member information is not available.',
    },
    state_conflict: {
      status: 409,
      code: 'member_administration.state_conflict',
      message: 'The member information changed. Refresh and try again.',
    },
    last_administrator: {
      status: 409,
      code: 'member_administration.last_administrator',
      message: 'At least one active Organization Admin must remain.',
    },
    self_action: {
      status: 403,
      code: 'member_administration.self_action',
      message: 'You cannot apply this change to your own membership.',
    },
    target_mfa_not_ready: {
      status: 409,
      code: 'member_administration.target_mfa_not_ready',
      message: 'The selected privileged role requires the member to verify an authenticator first.',
    },
  };
  const item = table[decision] ?? {
    status: 503,
    code: 'member_administration.service_unavailable',
    message: 'Member administration is temporarily unavailable.',
  };
  return json(origin, item.status, {
    error: { code: item.code, message: item.message },
    correlationId,
  });
}
