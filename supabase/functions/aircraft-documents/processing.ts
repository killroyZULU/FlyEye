import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';
import type { AircraftDocumentAction, AircraftDocumentRequest } from './domain.ts';
import type { contextSchema } from './response-schemas.ts';
import { caughtFailureCode, databaseDecision, failure, json } from './transport.ts';

export type DocumentLimiterBucket =
  'general' | 'read' | 'mutation' | 'lifecycle' | 'upload' | 'download';

export type AircraftDocumentDependencies = {
  allowedOrigin: string;
  authenticate: (accessToken: string) => Promise<VerifiedAuthenticationEvidence>;
  resolveContext: (actorUserId: string) => Promise<unknown>;
  limiterKey: (actorSubjectId: string, organizationId: string) => Promise<string>;
  consumeLimit: (input: {
    limiterKeyHash: string;
    bucket: DocumentLimiterBucket;
    correlationId: string;
  }) => Promise<{
    allowed: boolean;
    retryAfterSeconds: number | null;
    correlationId: string;
    policyVersion: 'aircraft-documents-v1';
  }>;
  recordSecurity: (input: {
    actorUserId: string;
    organizationId: string;
    action: AircraftDocumentAction;
    outcome: 'denied' | 'conflict';
    reason: string;
    correlationId: string;
  }) => Promise<void>;
  rpc: (name: string, parameters: Record<string, unknown>) => Promise<unknown>;
  createSignedUpload: (objectKey: string) => Promise<{ token: string; path: string }>;
  downloadStagedFile: (objectKey: string) => Promise<Uint8Array>;
  createSignedDownload: (objectKey: string, downloadName: string) => Promise<string>;
  createCorrelationId?: () => string;
  currentPhilippineDate?: () => string;
};

export type ProcessingContext = {
  origin: string;
  actor: VerifiedAuthenticationEvidence;
  access: typeof contextSchema._output;
  requestData: AircraftDocumentRequest;
  correlationId: string;
  limiterKeyHash: string;
  philippineDate: string;
};

export async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function consume(
  dependencies: AircraftDocumentDependencies,
  context: Pick<ProcessingContext, 'limiterKeyHash' | 'correlationId'>,
  bucket: DocumentLimiterBucket,
) {
  try {
    const result = await dependencies.consumeLimit({
      limiterKeyHash: context.limiterKeyHash,
      bucket,
      correlationId: context.correlationId,
    });
    return result.correlationId === context.correlationId &&
      result.policyVersion === 'aircraft-documents-v1'
      ? result
      : null;
  } catch {
    return null;
  }
}

export async function securityFailure(
  dependencies: AircraftDocumentDependencies,
  context: ProcessingContext,
  reason: string,
  outcome: 'denied' | 'conflict' = 'denied',
) {
  try {
    await dependencies.recordSecurity({
      actorUserId: context.actor.actorUserId,
      organizationId: context.access.organizationId,
      action: context.requestData.action,
      outcome,
      reason,
      correlationId: context.correlationId,
    });
    return failure(context.origin, reason, context.correlationId);
  } catch (error) {
    return failure(
      context.origin,
      caughtFailureCode(error, 'service_unavailable'),
      context.correlationId,
    );
  }
}

export async function limited(
  dependencies: AircraftDocumentDependencies,
  context: ProcessingContext,
  bucket: DocumentLimiterBucket,
): Promise<Response | null> {
  const decision = await consume(dependencies, context, bucket);
  if (!decision) return failure(context.origin, 'service_unavailable', context.correlationId);
  if (!decision.allowed) {
    return failure(
      context.origin,
      'rate_limited',
      context.correlationId,
      decision.retryAfterSeconds ?? undefined,
    );
  }
  return null;
}

export async function checkedResponse(
  dependencies: AircraftDocumentDependencies,
  context: ProcessingContext,
  raw: unknown,
  schema: {
    safeParse: (value: unknown) => { success: boolean; data?: unknown };
  },
) {
  const parsed = schema.safeParse(raw);
  if (
    parsed.success &&
    parsed.data &&
    Reflect.get(parsed.data, 'correlationId') === context.correlationId
  ) {
    return json(context.origin, 200, parsed.data);
  }
  const decision = databaseDecision(raw);
  if (decision === 'not_found' || decision === 'unauthorized') {
    return securityFailure(dependencies, context, decision);
  }
  return failure(context.origin, decision, context.correlationId);
}

export async function consumeGeneral(
  dependencies: AircraftDocumentDependencies,
  context: ProcessingContext,
) {
  return consume(dependencies, context, 'general');
}
