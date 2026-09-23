export const MAX_AIRCRAFT_DOCUMENT_REQUEST_BYTES = 16_384;

export function responseHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

export function json(origin: string, status: number, body: object, extra: HeadersInit = {}) {
  return Response.json(body, { status, headers: { ...responseHeaders(origin), ...extra } });
}

export async function readBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_AIRCRAFT_DOCUMENT_REQUEST_BYTES) throw new Error('request_too_large');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_AIRCRAFT_DOCUMENT_REQUEST_BYTES) throw new Error('request_too_large');
  return new TextDecoder().decode(bytes);
}

export function failure(
  origin: string,
  code: string,
  correlationId: string,
  retryAfterSeconds?: number,
) {
  const statuses: Record<string, number> = {
    unauthenticated: 401,
    mfa_required: 403,
    recent_password_required: 403,
    unauthorized: 403,
    not_found: 404,
    validation_failed: 422,
    state_conflict: 409,
    version_conflict: 409,
    idempotency_conflict: 409,
    rate_limited: 429,
    audit_failed: 503,
    file_rejected: 422,
    scan_pending: 409,
    scan_failed: 503,
    scan_unavailable: 503,
    storage_unavailable: 503,
    service_unavailable: 503,
  };
  return json(
    origin,
    statuses[code] ?? 503,
    {
      error: {
        code: `aircraft_documents.${code}`,
        message: 'The aircraft document request could not be completed.',
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
      },
      correlationId,
    },
    retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : {},
  );
}

export function databaseDecision(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'service_unavailable';
  const decision: unknown = Reflect.get(value, 'decision');
  return typeof decision === 'string' ? decision : 'service_unavailable';
}

export function caughtFailureCode(error: unknown, fallback: string): string {
  return error instanceof Error && error.name === 'AircraftDocumentAuditError'
    ? 'audit_failed'
    : fallback;
}
