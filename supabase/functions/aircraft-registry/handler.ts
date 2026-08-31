import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';
import {
  recordAircraftSecurityEvent,
  reportCaughtAircraftAuditFailure,
  type AircraftAuditFailureInput,
  type AircraftSecurityEventInput,
} from './audit-reporting.ts';
import {
  aircraftRequestSchema,
  canonicalMutationPayload,
  normalizeAircraftIdentity,
  normalizeAircraftSearch,
  type AircraftMutationRequest,
  type AircraftRequest,
} from './domain.ts';
import {
  contextSchema,
  detailSchema,
  idempotencySchema,
  listSchema,
  mutationSchema,
} from './response-schemas.ts';
import {
  aircraftCaughtFailure,
  aircraftDatabaseDecision,
  aircraftFailure,
  aircraftJson,
  aircraftResponseHeaders,
  readAircraftBody,
} from './transport.ts';
export type AircraftLimiterBucket = 'general' | 'read' | 'mutation' | 'lifecycle';
export type AircraftLimiterDecision = {
  allowed: boolean;
  retryAfterSeconds: number | null;
  correlationId: string;
  policyVersion: 'aircraft-registry-v1';
};
export type AircraftMutationCommand = {
  actorUserId: string;
  organizationId: string;
  action: AircraftMutationRequest['action'];
  recordId: string | null;
  expectedVersion: number | null;
  reason: string | null;
  identity: ReturnType<typeof normalizeAircraftIdentity> | null;
  idempotencyKeyHash: string;
  requestHash: string;
  correlationId: string;
};
export type AircraftRegistryDependencies = {
  allowedOrigin: string;
  authenticate: (accessToken: string) => Promise<VerifiedAuthenticationEvidence>;
  resolveContext: (actorUserId: string) => Promise<unknown>;
  limiterKey: (actorSubjectId: string, organizationId: string) => Promise<string>;
  consumeLimit: (input: {
    limiterKeyHash: string;
    bucket: AircraftLimiterBucket;
    correlationId: string;
  }) => Promise<AircraftLimiterDecision>;
  recordSecurity: (input: AircraftSecurityEventInput) => Promise<void>;
  reportAuditFailure: (input: AircraftAuditFailureInput) => void;
  list: (input: {
    actorUserId: string;
    organizationId: string;
    search: string | null;
    includeArchived: boolean;
    page: number;
    pageSize: number;
    correlationId: string;
  }) => Promise<unknown>;
  get: (input: {
    actorUserId: string;
    organizationId: string;
    recordId: string;
    correlationId: string;
  }) => Promise<unknown>;
  lookupIdempotency: (
    input: Omit<AircraftMutationCommand, 'identity' | 'reason' | 'correlationId'>,
  ) => Promise<unknown>;
  mutate: (input: AircraftMutationCommand) => Promise<unknown>;
  createCorrelationId?: () => string;
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

type ProcessingContext = {
  origin: string;
  actor: VerifiedAuthenticationEvidence;
  organizationId: string;
  limiterKeyHash: string;
  correlationId: string;
  requestData: AircraftRequest;
};

async function processRead(
  dependencies: AircraftRegistryDependencies,
  context: ProcessingContext,
): Promise<Response> {
  const request = context.requestData;
  if (request.action !== 'list' && request.action !== 'get') {
    return aircraftFailure(context.origin, 'validation_failed', context.correlationId);
  }
  const read = await consume(dependencies, context.limiterKeyHash, 'read', context.correlationId);
  if (!read) return aircraftFailure(context.origin, 'service_unavailable', context.correlationId);
  if (!read.allowed) {
    return aircraftFailure(
      context.origin,
      'rate_limited',
      context.correlationId,
      read.retryAfterSeconds ?? undefined,
    );
  }
  let search: string | null = null;
  try {
    if (request.action === 'list') search = normalizeAircraftSearch(request.search);
  } catch {
    return aircraftFailure(context.origin, 'validation_failed', context.correlationId);
  }
  try {
    const raw =
      request.action === 'list'
        ? await dependencies.list({
            actorUserId: context.actor.actorUserId,
            organizationId: context.organizationId,
            search,
            includeArchived: request.includeArchived,
            page: request.page,
            pageSize: request.pageSize,
            correlationId: context.correlationId,
          })
        : await dependencies.get({
            actorUserId: context.actor.actorUserId,
            organizationId: context.organizationId,
            recordId: request.recordId,
            correlationId: context.correlationId,
          });
    const result =
      request.action === 'list' ? listSchema.safeParse(raw) : detailSchema.safeParse(raw);
    if (result.success && result.data.correlationId === context.correlationId) {
      return aircraftJson(context.origin, 200, result.data);
    }
    const decision = aircraftDatabaseDecision(raw);
    return decision === 'unauthorized'
      ? securityDecision(dependencies, context, decision, 'denied')
      : aircraftFailure(context.origin, decision, context.correlationId);
  } catch (error) {
    reportCaughtAircraftAuditFailure(
      dependencies.reportAuditFailure,
      context.requestData.action,
      context.correlationId,
      error,
    );
    return aircraftCaughtFailure(context.origin, error, context.correlationId);
  }
}

async function processMutation(
  dependencies: AircraftRegistryDependencies,
  context: ProcessingContext,
): Promise<Response> {
  let prepared: Awaited<ReturnType<typeof prepareMutation>>;
  try {
    prepared = await prepareMutation(context);
  } catch {
    return aircraftFailure(context.origin, 'validation_failed', context.correlationId);
  }
  const lookup = idempotencySchema.safeParse(
    await dependencies.lookupIdempotency(prepared.lookupInput).catch(() => null),
  );
  if (!lookup.success)
    return aircraftFailure(context.origin, 'service_unavailable', context.correlationId);
  if (lookup.data.decision === 'unauthorized') {
    return securityDecision(dependencies, context, 'unauthorized', 'denied');
  }
  if (lookup.data.decision === 'conflict') {
    return securityDecision(dependencies, context, 'idempotency_conflict', 'conflict');
  }
  if (lookup.data.decision === 'replay' && lookup.data.result) {
    return aircraftJson(context.origin, 200, {
      ...lookup.data.result,
      replayed: true,
      correlationId: context.correlationId,
    });
  }
  const actionLimit = await consume(
    dependencies,
    context.limiterKeyHash,
    prepared.bucket,
    context.correlationId,
  );
  if (!actionLimit)
    return aircraftFailure(context.origin, 'service_unavailable', context.correlationId);
  if (!actionLimit.allowed) {
    return aircraftFailure(
      context.origin,
      'rate_limited',
      context.correlationId,
      actionLimit.retryAfterSeconds ?? undefined,
    );
  }
  try {
    const raw = await dependencies.mutate({
      ...prepared.lookupInput,
      identity: prepared.identity ?? null,
      reason: prepared.reason,
      correlationId: context.correlationId,
    });
    const result = mutationSchema.safeParse(raw);
    if (result.success && result.data.correlationId === context.correlationId) {
      return aircraftJson(context.origin, 200, result.data);
    }
    const decision = aircraftDatabaseDecision(raw);
    return decision === 'unauthorized'
      ? securityDecision(dependencies, context, decision, 'denied')
      : decision === 'state_conflict' || decision === 'version_conflict'
        ? securityDecision(dependencies, context, decision, 'conflict')
        : aircraftFailure(context.origin, decision, context.correlationId);
  } catch (error) {
    reportCaughtAircraftAuditFailure(
      dependencies.reportAuditFailure,
      context.requestData.action,
      context.correlationId,
      error,
    );
    return aircraftCaughtFailure(context.origin, error, context.correlationId);
  }
}

async function prepareMutation(context: ProcessingContext) {
  const request = context.requestData;
  if (request.action === 'list' || request.action === 'get') {
    throw new Error('Mutation action required.');
  }
  const identity =
    request.action === 'create' || request.action === 'update'
      ? normalizeAircraftIdentity(request)
      : undefined;
  const lookupInput = {
    actorUserId: context.actor.actorUserId,
    organizationId: context.organizationId,
    action: request.action,
    recordId: request.action === 'create' ? null : request.recordId,
    expectedVersion: request.action === 'create' ? null : request.expectedVersion,
    idempotencyKeyHash: await sha256(request.idempotencyKey),
    requestHash: await sha256(canonicalMutationPayload(request, identity)),
  };
  return {
    identity,
    lookupInput,
    bucket: request.action === 'create' || request.action === 'update' ? 'mutation' : 'lifecycle',
    reason: request.action === 'archive' || request.action === 'reactivate' ? request.reason : null,
  } as const;
}

type ParsedTransport = {
  accessToken: string;
  requestData: AircraftRequest;
};

async function parseTransport(
  origin: string,
  request: Request,
): Promise<Response | ParsedTransport> {
  if (request.headers.get('origin') !== origin) {
    return aircraftFailure(origin, 'unauthorized', crypto.randomUUID());
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: aircraftResponseHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return aircraftJson(origin, 405, { error: { code: 'aircraft_registry.method_not_allowed' } });
  }
  const match = /^Bearer\s+([^\s]+)$/iu.exec(request.headers.get('authorization') ?? '');
  if (!match?.[1]) return aircraftFailure(origin, 'unauthenticated', crypto.randomUUID());
  try {
    const parsed = aircraftRequestSchema.safeParse(JSON.parse(await readAircraftBody(request)));
    return parsed.success
      ? { accessToken: match[1], requestData: parsed.data }
      : aircraftFailure(origin, 'validation_failed', crypto.randomUUID());
  } catch {
    return aircraftFailure(origin, 'validation_failed', crypto.randomUUID());
  }
}

async function prepareContext(
  dependencies: AircraftRegistryDependencies,
  parsed: ParsedTransport,
  createCorrelationId: () => string,
): Promise<Response | ProcessingContext> {
  const origin = dependencies.allowedOrigin;
  let actor: VerifiedAuthenticationEvidence;
  try {
    actor = await dependencies.authenticate(parsed.accessToken);
  } catch {
    return aircraftFailure(origin, 'unauthenticated', crypto.randomUUID());
  }
  const correlationId = createCorrelationId();
  const rawContext = await dependencies.resolveContext(actor.actorUserId).catch(() => null);
  const context = contextSchema.safeParse(rawContext);
  if (!context.success) return aircraftFailure(origin, 'service_unavailable', correlationId);
  const limiterKeyHash = await dependencies
    .limiterKey(actor.actorSubjectId, context.data.organizationId)
    .catch(() => null);
  if (!limiterKeyHash) return aircraftFailure(origin, 'service_unavailable', correlationId);
  const general = await consume(dependencies, limiterKeyHash, 'general', correlationId);
  if (!general) return aircraftFailure(origin, 'service_unavailable', correlationId);
  if (!general.allowed) {
    return aircraftFailure(
      origin,
      'rate_limited',
      correlationId,
      general.retryAfterSeconds ?? undefined,
    );
  }
  const readAction = parsed.requestData.action === 'list' || parsed.requestData.action === 'get';
  const permitted = readAction ? context.data.canRead : context.data.canManage;
  if (!permitted || actor.assuranceLevel !== 'aal2' || actor.totpAuthenticatedAt === null) {
    const reason = permitted ? 'mfa_required' : 'unauthorized';
    const recorded = await recordAircraftSecurityEvent(dependencies, {
      actorUserId: actor.actorUserId,
      organizationId: context.data.organizationId,
      action: parsed.requestData.action,
      outcome: 'denied',
      reason,
      correlationId,
    });
    return recorded
      ? aircraftFailure(origin, reason, correlationId)
      : aircraftFailure(origin, 'service_unavailable', correlationId);
  }
  return {
    origin,
    actor,
    organizationId: context.data.organizationId,
    limiterKeyHash,
    correlationId,
    requestData: parsed.requestData,
  };
}

async function securityDecision(
  dependencies: AircraftRegistryDependencies,
  context: ProcessingContext,
  reason: 'unauthorized' | 'idempotency_conflict' | 'state_conflict' | 'version_conflict',
  outcome: 'denied' | 'conflict',
): Promise<Response> {
  const recorded = await recordAircraftSecurityEvent(dependencies, {
    actorUserId: context.actor.actorUserId,
    organizationId: context.organizationId,
    action: context.requestData.action,
    outcome,
    reason,
    correlationId: context.correlationId,
  });
  return aircraftFailure(
    context.origin,
    recorded ? reason : 'service_unavailable',
    context.correlationId,
  );
}

async function consume(
  dependencies: AircraftRegistryDependencies,
  limiterKeyHash: string,
  bucket: AircraftLimiterBucket,
  correlationId: string,
): Promise<AircraftLimiterDecision | null> {
  try {
    const result = await dependencies.consumeLimit({ limiterKeyHash, bucket, correlationId });
    if (result.correlationId !== correlationId || result.policyVersion !== 'aircraft-registry-v1') {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

export function createAircraftRegistryHandler(
  dependencies: AircraftRegistryDependencies,
): (request: Request) => Promise<Response> {
  const createCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());
  return async (request: Request): Promise<Response> => {
    const parsed = await parseTransport(dependencies.allowedOrigin, request);
    if (parsed instanceof Response) return parsed;
    const context = await prepareContext(dependencies, parsed, createCorrelationId);
    if (context instanceof Response) return context;
    return context.requestData.action === 'list' || context.requestData.action === 'get'
      ? processRead(dependencies, context)
      : processMutation(dependencies, context);
  };
}
