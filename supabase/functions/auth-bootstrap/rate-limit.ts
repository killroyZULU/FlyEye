import { z } from 'zod';

import type { AuthBootstrapDependencies } from './contracts.ts';
import { jsonResponse } from './responses.ts';

const decisionSchema = z
  .object({
    allowed: z.boolean(),
    retryAfterSeconds: z.number().int().min(1).max(2).nullable(),
    correlationId: z.uuid(),
    policyVersion: z.literal('auth-bootstrap-subject-v1'),
  })
  .strict()
  .refine((value) => value.allowed === (value.retryAfterSeconds === null));

export async function checkBootstrapLimit(
  dependencies: AuthBootstrapDependencies,
  actorUserId: string,
  correlationId: string,
): Promise<Response | null> {
  const origin = dependencies.allowedOrigin;
  try {
    const result = decisionSchema.parse(
      await dependencies.consumeLimit(actorUserId, correlationId),
    );
    if (result.correlationId !== correlationId) throw new Error('Invalid limiter decision.');
    if (result.allowed) return null;
    const response = jsonResponse(origin, 429, {
      error: {
        code: 'auth.rate_limited',
        message: `Wait ${result.retryAfterSeconds} seconds before trying again.`,
      },
      correlationId,
    });
    response.headers.set('Retry-After', String(result.retryAfterSeconds));
    return response;
  } catch {
    return jsonResponse(origin, 503, {
      error: {
        code: 'auth.limiter_unavailable',
        message: 'Access is temporarily unavailable. Try again shortly.',
      },
      correlationId,
    });
  }
}
