import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  authenticationEvidenceFromVerifiedToken,
  completeFactorInventorySchema,
} from '../_shared/authentication-evidence.ts';
import { readAdminOnboardingRuntimeConfiguration } from '../_shared/edge-runtime-configuration.ts';
import {
  createAdminOnboardingHandler,
  type AdminOnboardingAction,
  type LimiterDecision,
} from './handler.ts';

const limiterDecisionSchema = z
  .object({
    allowed: z.boolean(),
    retryAfterSeconds: z.number().int().min(1).max(60).nullable(),
    correlationId: z.uuid(),
    networkSourceUsed: z.literal(false),
    policyVersion: z.literal('subject-action-v1'),
  })
  .strict();

const {
  supabaseUrl,
  supabasePublishableKey,
  supabaseServiceRoleKey,
  limiterSecret,
  allowedOrigin,
} = readAdminOnboardingRuntimeConfiguration((name) => Deno.env.get(name));

const publicClient = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const serverClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const limiterHmacKey = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(limiterSecret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);

async function limiterKeyHash(
  actorSubjectId: string,
  action: AdminOnboardingAction,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    limiterHmacKey,
    new TextEncoder().encode(`${actorSubjectId}\u0000${action}`),
  );
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await serverClient.rpc(name, parameters);
  if (error) throw error;
  return data;
}

Deno.serve(
  createAdminOnboardingHandler({
    allowedOrigin,
    authenticate: async (accessToken) => {
      const { data, error } = await publicClient.auth.getUser(accessToken);
      if (error || !data.user) throw new Error('Authentication failed.');
      return authenticationEvidenceFromVerifiedToken(accessToken, data.user.id);
    },
    listFactors: async (actorUserId) => {
      const { data, error } = await serverClient.auth.admin.mfa.listFactors({
        userId: actorUserId,
      });
      if (error) throw error;
      return completeFactorInventorySchema.parse(data.factors);
    },
    consumeLimit: async ({ actorSubjectId, action, correlationId }) => {
      const result = await rpc('consume_admin_onboarding_rate_limit', {
        p_limiter_key_hash: await limiterKeyHash(actorSubjectId, action),
        p_action: action,
        p_correlation_id: correlationId,
      });
      return limiterDecisionSchema.parse(result) satisfies LimiterDecision;
    },
    recordDenied: async ({ actor, eventName, correlationId, reasonCode, targetId, metadata }) => {
      await rpc('write_admin_onboarding_event', {
        p_actor_user_id: actor.actorUserId,
        p_actor_subject_id: actor.actorSubjectId,
        p_event_name: eventName,
        p_outcome: 'denied',
        p_correlation_id: correlationId,
        p_organization_id: null,
        p_organization_ids: [],
        p_reason_code: reasonCode,
        p_target_id: targetId ?? null,
        p_idempotency_key_hash: null,
        p_metadata: metadata ?? {},
      });
    },
    status: ({ actorUserId, correlationId }) =>
      rpc('get_organization_admin_onboarding_status', {
        p_actor_user_id: actorUserId,
        p_correlation_id: correlationId,
      }),
    start: ({
      actorUserId,
      bootstrapGrantId,
      expectedVersion,
      idempotencyKeyHash,
      correlationId,
    }) =>
      rpc('start_organization_admin_onboarding', {
        p_actor_user_id: actorUserId,
        p_bootstrap_grant_id: bootstrapGrantId,
        p_expected_version: expectedVersion,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
    complete: ({
      actor,
      verifiedTotpFactorId,
      totalFactorCount,
      bootstrapGrantId,
      expectedVersion,
      idempotencyKeyHash,
      correlationId,
    }) =>
      rpc('complete_first_organization_admin_bootstrap', {
        p_actor_user_id: actor.actorUserId,
        p_actor_subject_id: actor.actorSubjectId,
        p_session_id: actor.sessionId,
        p_password_authenticated_at: actor.passwordAuthenticatedAt,
        p_assurance_level: actor.assuranceLevel,
        p_authentication_methods: actor.authenticationMethods,
        p_verified_totp_factor_id: verifiedTotpFactorId,
        p_total_factor_count: totalFactorCount,
        p_bootstrap_grant_id: bootstrapGrantId,
        p_expected_version: expectedVersion,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
    cancel: ({ actorUserId, bootstrapGrantId, idempotencyKeyHash, correlationId }) =>
      rpc('cancel_organization_admin_onboarding', {
        p_actor_user_id: actorUserId,
        p_bootstrap_grant_id: bootstrapGrantId,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
  }),
);
