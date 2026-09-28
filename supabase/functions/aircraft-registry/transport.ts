import {
  readBoundedRequestBody,
  RequestTooLargeError as AircraftRequestTooLargeError,
} from '../_shared/request-body.ts';

export const MAX_AIRCRAFT_REQUEST_BYTES = 8192;

export { AircraftRequestTooLargeError };

export function isAircraftAuditFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'AircraftAuditError';
}

export function aircraftResponseHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

export function aircraftJson(
  origin: string,
  status: number,
  body: object,
  extra: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: { ...aircraftResponseHeaders(origin), ...extra },
  });
}

export async function readAircraftBody(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_AIRCRAFT_REQUEST_BYTES) throw new AircraftRequestTooLargeError();
  return readBoundedRequestBody(request, MAX_AIRCRAFT_REQUEST_BYTES, { fatalUtf8: false });
}

export function aircraftFailure(
  origin: string,
  code: string,
  correlationId: string,
  retry?: number,
): Response {
  const statuses: Record<string, number> = {
    unauthenticated: 401,
    mfa_required: 403,
    unauthorized: 403,
    not_found: 404,
    validation_failed: 422,
    duplicate_registration: 409,
    state_conflict: 409,
    version_conflict: 409,
    idempotency_conflict: 409,
    rate_limited: 429,
    audit_failed: 503,
    service_unavailable: 503,
  };
  return aircraftJson(
    origin,
    statuses[code] ?? 503,
    {
      error: {
        code: `aircraft_registry.${code}`,
        message: 'The aircraft registry request could not be completed.',
        ...(retry ? { retryAfterSeconds: retry } : {}),
      },
      correlationId,
    },
    retry ? { 'Retry-After': String(retry) } : {},
  );
}

export function aircraftDatabaseDecision(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'service_unavailable';
  const decision: unknown = Reflect.get(value, 'decision');
  return typeof decision === 'string' ? decision : 'service_unavailable';
}

export function aircraftCaughtFailure(
  origin: string,
  error: unknown,
  correlationId: string,
): Response {
  return aircraftFailure(
    origin,
    isAircraftAuditFailure(error) ? 'audit_failed' : 'service_unavailable',
    correlationId,
  );
}
