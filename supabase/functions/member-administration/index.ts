import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { authenticationEvidenceFromVerifiedToken } from '../_shared/authentication-evidence.ts';
import { readMemberAdministrationRuntimeConfiguration } from '../_shared/edge-runtime-configuration.ts';
import {
  createMemberAdministrationHandler,
  type AdministrationLimiterDecision,
  type CursorBoundary,
  type MemberAdministrationAction,
} from './handler.ts';
import { createMemberCursorCodec } from './cursor.ts';

const configuration = readMemberAdministrationRuntimeConfiguration((name) => Deno.env.get(name));
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
  ['sign', 'verify'],
);

const limiterSchema = z
  .object({
    allowed: z.boolean(),
    retryAfterSeconds: z.number().int().min(1).max(3600).nullable(),
    correlationId: z.uuid(),
    networkSourceUsed: z.literal(false),
    policyVersion: z.literal('member-administration-subject-scope-v1'),
  })
  .strict();

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sign(value: string): Promise<string> {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(value))),
  );
}

function actionGroup(action: MemberAdministrationAction): 'directory' | 'profile' | 'status' {
  if (action === 'list' || action === 'detail') return 'directory';
  if (action === 'get_profile' || action === 'update_profile') return 'profile';
  return 'status';
}

const cursorCodec = await createMemberCursorCodec(configuration.limiterSecret);

async function rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await serverClient.rpc(name, parameters);
  if (error) throw error;
  return data;
}

async function limiterHash(
  actorSubjectId: string,
  action: MemberAdministrationAction,
  scopeId: string,
) {
  return sign(`${actorSubjectId}\u0000${actionGroup(action)}\u0000${scopeId}`);
}

Deno.serve(
  createMemberAdministrationHandler({
    allowedOrigin: configuration.allowedOrigin,
    authenticate: async (accessToken) => {
      const { data, error } = await publicClient.auth.getUser(accessToken);
      if (error || !data.user) throw new Error('Authentication failed.');
      return authenticationEvidenceFromVerifiedToken(accessToken, data.user.id);
    },
    resolveLimitScope: ({ actorUserId, action, organizationId, membershipId }) =>
      rpc('resolve_member_administration_limiter_scope', {
        p_actor_user_id: actorUserId,
        p_action: action,
        p_organization_id: organizationId,
        p_membership_id: membershipId,
      }).then((value) => z.uuid().parse(value)),
    resolveProfileAssurance: ({ actorUserId, membershipId }) =>
      rpc('required_member_profile_assurance', {
        p_actor_user_id: actorUserId,
        p_membership_id: membershipId,
      }).then((value) => z.enum(['aal1', 'aal2', 'denied']).parse(value)),
    consumeLimit: async ({ actorSubjectId, action, scopeId, correlationId }) => {
      const value = await rpc('consume_member_administration_rate_limit', {
        p_limiter_key_hash: await limiterHash(actorSubjectId, action, scopeId),
        p_action: action,
        p_correlation_id: correlationId,
      });
      return limiterSchema.parse(value) satisfies AdministrationLimiterDecision;
    },
    recordDenied: ({
      actorUserId,
      eventName,
      reasonCode,
      correlationId,
      organizationId,
      membershipId,
    }) =>
      rpc('record_member_administration_denial', {
        p_actor_user_id: actorUserId,
        p_event_name: eventName,
        p_reason_code: reasonCode,
        p_correlation_id: correlationId,
        p_organization_id: organizationId,
        p_target_membership_id: membershipId,
      }).then(() => undefined),
    decodeCursor: (cursor, status, search): Promise<CursorBoundary> =>
      cursorCodec.decode(cursor, status, search),
    encodeCursor: (boundary, status, search) => cursorCodec.encode(boundary, status, search),
    list: ({ actorUserId, organizationId, status, search, boundary, correlationId }) =>
      rpc('list_organization_members', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_correlation_id: correlationId,
        p_status: status,
        p_search: search,
        p_before_created_at: boundary?.createdAt ?? null,
        p_before_membership_id: boundary?.membershipId ?? null,
        p_limit: 50,
      }),
    detail: ({ actorUserId, organizationId, membershipId, correlationId }) =>
      rpc('get_organization_member', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_target_membership_id: membershipId,
        p_correlation_id: correlationId,
      }),
    getProfile: ({ actorUserId, membershipId, correlationId }) =>
      rpc('get_my_member_profile', {
        p_actor_user_id: actorUserId,
        p_membership_id: membershipId,
        p_correlation_id: correlationId,
      }),
    updateProfile: ({
      actorUserId,
      membershipId,
      displayName,
      contactNumber,
      expectedVersion,
      correlationId,
    }) =>
      rpc('update_my_member_profile', {
        p_actor_user_id: actorUserId,
        p_membership_id: membershipId,
        p_display_name: displayName,
        p_contact_number: contactNumber,
        p_expected_version: expectedVersion,
        p_correlation_id: correlationId,
      }),
    changeStatus: ({
      actorUserId,
      organizationId,
      membershipId,
      action,
      reasonCode,
      expectedVersion,
      idempotencyKeyHash,
      correlationId,
    }) =>
      rpc('change_organization_member_status', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_target_membership_id: membershipId,
        p_action: action,
        p_reason_code: reasonCode,
        p_expected_version: expectedVersion,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
  }),
);
