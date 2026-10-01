import { responseStatus } from './auth-gateway-errors';

export async function edgeErrorDetails(
  error: unknown,
): Promise<{ status: number; code?: string; retryAfterSeconds?: number }> {
  const status = responseStatus(error);
  if (typeof error !== 'object' || error === null) return { status };
  const context: unknown = Reflect.get(error, 'context');
  if (!(context instanceof Response)) return { status };

  try {
    const payload: unknown = await context.clone().json();
    if (typeof payload !== 'object' || payload === null) return { status };
    const errorPayload: unknown = Reflect.get(payload, 'error');
    const code: unknown =
      typeof errorPayload === 'object' && errorPayload !== null
        ? (Reflect.get(errorPayload, 'code') as unknown)
        : undefined;
    const retryHeader = context.headers.get('retry-after');
    const retryAfterSeconds =
      retryHeader && /^\d+$/.test(retryHeader) ? Number.parseInt(retryHeader, 10) : undefined;
    return {
      status,
      code: typeof code === 'string' ? code : undefined,
      retryAfterSeconds,
    };
  } catch {
    return { status };
  }
}
