import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { authenticationEvidenceFromVerifiedToken } from '../_shared/authentication-evidence.ts';
import { createAircraftRegistryHandler, type AircraftLimiterDecision } from './handler.ts';
import { readAircraftRegistryRuntimeConfiguration } from './runtime-config.ts';

const configuration = readAircraftRegistryRuntimeConfiguration((name) => Deno.env.get(name));
const publicClient = createClient(configuration.supabaseUrl, configuration.supabasePublishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const serverClient = createClient(configuration.supabaseUrl, configuration.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const hmacKey = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(configuration.limiterSecret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);
const limiterSchema = z
  .object({
    allowed: z.boolean(),
    retryAfterSeconds: z.number().int().min(1).max(3600).nullable(),
    correlationId: z.uuid(),
    policyVersion: z.literal('aircraft-registry-v1'),
  })
  .strict();

class AircraftAuditError extends Error {
  constructor() {
    super('Aircraft registry audit failed.');
    this.name = 'AircraftAuditError';
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sign(value: string): Promise<string> {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(value))),
  );
}

async function rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await serverClient.rpc(name, parameters);
  if (error?.code === 'P7001') throw new AircraftAuditError();
  if (error) throw error;
  return data;
}

Deno.serve(
  createAircraftRegistryHandler({
    allowedOrigin: configuration.allowedOrigin,
    authenticate: async (accessToken) => {
      const { data, error } = await publicClient.auth.getUser(accessToken);
      if (error || !data.user) throw new Error('Authentication failed.');
      return authenticationEvidenceFromVerifiedToken(accessToken, data.user.id);
    },
    resolveContext: (actorUserId) =>
      rpc('resolve_aircraft_registry_context', { p_actor_user_id: actorUserId }),
    limiterKey: (actorSubjectId, organizationId) =>
      sign(`${actorSubjectId}\u0000${organizationId}\u0000aircraft-registry-v1`),
    consumeLimit: ({ limiterKeyHash, bucket, correlationId }) =>
      rpc('consume_aircraft_registry_rate_limit', {
        p_limiter_key_hash: limiterKeyHash,
        p_bucket: bucket,
        p_correlation_id: correlationId,
      }).then((value) => limiterSchema.parse(value) satisfies AircraftLimiterDecision),
    recordSecurity: ({ actorUserId, organizationId, action, outcome, reason, correlationId }) =>
      rpc('record_aircraft_registry_security_event', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_action: action,
        p_outcome: outcome,
        p_reason: reason,
        p_correlation_id: correlationId,
      }).then(() => undefined),
    reportAuditFailure: ({ action, correlationId, kind }) => {
      console.error(
        JSON.stringify({
          event: `aircraft_registry.${kind}_write_failed`,
          action,
          correlationId,
        }),
      );
    },
    list: ({
      actorUserId,
      organizationId,
      search,
      includeArchived,
      page,
      pageSize,
      correlationId,
    }) =>
      rpc('list_aircraft_records', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_search: search,
        p_include_archived: includeArchived,
        p_page: page,
        p_page_size: pageSize,
        p_correlation_id: correlationId,
      }),
    get: ({ actorUserId, organizationId, recordId, correlationId }) =>
      rpc('get_aircraft_record', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_record_id: recordId,
        p_correlation_id: correlationId,
      }),
    lookupIdempotency: (input) =>
      rpc('lookup_aircraft_registry_idempotency', {
        p_actor_user_id: input.actorUserId,
        p_organization_id: input.organizationId,
        p_action: input.action,
        p_record_id: input.recordId,
        p_expected_version: input.expectedVersion,
        p_idempotency_key_hash: input.idempotencyKeyHash,
        p_request_hash: input.requestHash,
      }),
    mutate: (input) =>
      rpc('mutate_aircraft_record', {
        p_actor_user_id: input.actorUserId,
        p_organization_id: input.organizationId,
        p_action: input.action,
        p_record_id: input.recordId,
        p_registration_mark: input.identity?.registrationMark ?? null,
        p_registration_key: input.identity?.registrationKey ?? null,
        p_manufacturer: input.identity?.manufacturer ?? null,
        p_model: input.identity?.model ?? null,
        p_reason: input.reason,
        p_expected_version: input.expectedVersion,
        p_idempotency_key_hash: input.idempotencyKeyHash,
        p_request_hash: input.requestHash,
        p_correlation_id: input.correlationId,
      }),
  }),
);
