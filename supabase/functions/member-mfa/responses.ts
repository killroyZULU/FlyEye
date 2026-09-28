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

export function decisionError(origin: string, decision: string, correlationId: string): Response {
  const definitions: Record<string, [number, string, string]> = {
    not_available: [404, 'member_mfa.not_available', 'Member MFA setup is not available.'],
    conflict: [409, 'member_mfa.state_conflict', 'Authenticator setup needs review.'],
    recent_authentication_required: [
      403,
      'member_mfa.recent_authentication_required',
      'Sign in with your password again to continue.',
    ],
  };
  const [status, code, message] = definitions[decision] ?? [
    500,
    'member_mfa.service_unavailable',
    'Authenticator setup could not be confirmed.',
  ];
  return json(origin, status, { error: { code, message }, correlationId });
}
