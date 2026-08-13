import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  authenticationEvidenceFromVerifiedToken,
  completeFactorInventorySchema,
} from '../_shared/authentication-evidence.ts';
import { readMemberMfaRuntimeConfiguration } from '../_shared/edge-runtime-configuration.ts';
import { createMemberMfaHandler, type MemberMfaLimiterDecision } from './handler.ts';

const configuration = readMemberMfaRuntimeConfiguration((name) => Deno.env.get(name));
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
    retryAfterSeconds: z.number().int().min(1).max(60).nullable(),
    correlationId: z.uuid(),
    networkSourceUsed: z.literal(false),
    policyVersion: z.literal('member-mfa-subject-action-v1'),
  })
  .strict();

async function hexHash(value: string) {
  const signature = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await serverClient.rpc(name, parameters);
  if (error) throw error;
  return data;
}

Deno.serve(
  createMemberMfaHandler({
    allowedOrigin: configuration.allowedOrigin,
    authenticate: async (token) => {
      const { data, error } = await publicClient.auth.getUser(token);
      if (error || !data.user) throw new Error('Authentication failed.');
      return authenticationEvidenceFromVerifiedToken(token, data.user.id);
    },
    listFactors: async (userId) => {
      const { data, error } = await serverClient.auth.admin.mfa.listFactors({ userId });
      if (error) throw error;
      return completeFactorInventorySchema.parse(data.factors);
    },
    consumeLimit: async ({ actorSubjectId, action, correlationId }) =>
      limiterSchema.parse(
        await rpc('consume_member_mfa_rate_limit', {
          p_limiter_key_hash: await hexHash(`${actorSubjectId}\u0000${action}`),
          p_action: action,
          p_correlation_id: correlationId,
        }),
      ) satisfies MemberMfaLimiterDecision,
    recordDenied: ({ actorUserId, eventName, correlationId, reasonCode, operationId }) =>
      rpc('write_member_mfa_event', {
        p_actor_user_id: actorUserId,
        p_event_name: eventName,
        p_outcome: 'denied',
        p_correlation_id: correlationId,
        p_reason_code: reasonCode,
        p_operation_id: operationId ?? null,
      }).then(() => undefined),
    status: ({ actorUserId, factorReferenceHash, correlationId }) =>
      rpc('get_member_mfa_status', {
        p_actor_user_id: actorUserId,
        p_factor_reference_hash: factorReferenceHash,
        p_correlation_id: correlationId,
      }),
    start: ({ actorUserId, factorReferenceHash, idempotencyKeyHash, correlationId }) =>
      rpc('start_member_mfa_enrollment', {
        p_actor_user_id: actorUserId,
        p_factor_reference_hash: factorReferenceHash,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
    bindFactor: ({
      actorUserId,
      operationId,
      expectedVersion,
      factorReferenceHash,
      idempotencyKeyHash,
      correlationId,
    }) =>
      rpc('bind_member_mfa_factor', {
        p_actor_user_id: actorUserId,
        p_operation_id: operationId,
        p_expected_version: expectedVersion,
        p_factor_reference_hash: factorReferenceHash,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
    complete: ({
      actor,
      operationId,
      expectedVersion,
      factorReferenceHash,
      idempotencyKeyHash,
      correlationId,
    }) =>
      rpc('complete_member_mfa_enrollment', {
        p_actor_user_id: actor.actorUserId,
        p_session_id: actor.sessionId,
        p_password_authenticated_at: actor.passwordAuthenticatedAt,
        p_assurance_level: actor.assuranceLevel,
        p_authentication_methods: actor.authenticationMethods,
        p_operation_id: operationId,
        p_expected_version: expectedVersion,
        p_factor_reference_hash: factorReferenceHash,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
    cancel: ({
      actorUserId,
      operationId,
      expectedVersion,
      factorReferenceHash,
      cleanupOutcome,
      idempotencyKeyHash,
      correlationId,
    }) =>
      rpc('cancel_member_mfa_enrollment', {
        p_actor_user_id: actorUserId,
        p_operation_id: operationId,
        p_expected_version: expectedVersion,
        p_factor_reference_hash: factorReferenceHash,
        p_cleanup_outcome: cleanupOutcome,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
  }),
);
