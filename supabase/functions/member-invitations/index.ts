import { AuthApiError, createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { authenticationEvidenceFromVerifiedToken } from '../_shared/authentication-evidence.ts';
import { readMemberInvitationRuntimeConfiguration } from '../_shared/edge-runtime-configuration.ts';
import {
  createMemberInvitationsHandler,
  type DeliveryResult,
  type InvitationLimiterDecision,
  type MemberInvitationAction,
} from './handler.ts';

const limiterSchema = z
  .object({
    allowed: z.boolean(),
    retryAfterSeconds: z.number().int().min(1).max(3600).nullable(),
    correlationId: z.uuid(),
    networkSourceUsed: z.literal(false),
    policyVersion: z.literal('invitation-subject-scope-v1'),
  })
  .strict();

const configuration = readMemberInvitationRuntimeConfiguration((name) => Deno.env.get(name));
const publicClient = createClient(configuration.supabaseUrl, configuration.supabasePublishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const serverClient = createClient(configuration.supabaseUrl, configuration.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const limiterKey = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(configuration.limiterSecret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);

async function hmac(actorSubjectId: string, action: MemberInvitationAction, scopeId: string) {
  const signature = await crypto.subtle.sign(
    'HMAC',
    limiterKey,
    new TextEncoder().encode(`${actorSubjectId}\u0000${action}\u0000${scopeId}`),
  );
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await serverClient.rpc(name, parameters);
  if (error) throw error;
  return data;
}

function isExistingConfirmedIdentity(error: unknown): boolean {
  if (!(error instanceof AuthApiError)) return false;
  return (
    error.code === 'email_exists' ||
    error.code === 'user_already_exists' ||
    /already (?:been )?registered|already exists/i.test(error.message)
  );
}

function knownProviderFailure(error: unknown): boolean {
  return (
    error instanceof AuthApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

Deno.serve(
  createMemberInvitationsHandler({
    allowedOrigin: configuration.allowedOrigin,
    authenticate: async (accessToken) => {
      const { data, error } = await publicClient.auth.getUser(accessToken);
      if (error || !data.user) throw new Error('Authentication failed.');
      return {
        ...authenticationEvidenceFromVerifiedToken(accessToken, data.user.id),
        confirmedEmail: data.user.email && data.user.email_confirmed_at ? data.user.email : null,
      };
    },
    resolveLimitScope: async ({
      actorUserId,
      action,
      organizationId,
      invitationId,
      confirmedEmail,
    }) => {
      const result = await rpc('resolve_member_invitation_limiter_scope', {
        p_actor_user_id: actorUserId,
        p_action: action,
        p_organization_id: organizationId,
        p_invitation_id: invitationId,
        p_confirmed_email: confirmedEmail,
      });
      return z.uuid().parse(result);
    },
    consumeLimit: async ({ actorSubjectId, action, scopeId, correlationId }) => {
      const result = await rpc('consume_member_invitation_rate_limit', {
        p_limiter_key_hash: await hmac(actorSubjectId, action, scopeId),
        p_action: action,
        p_correlation_id: correlationId,
      });
      return limiterSchema.parse(result) satisfies InvitationLimiterDecision;
    },
    recordDenied: async ({ actorUserId, eventName, reasonCode, correlationId }) => {
      await rpc('record_member_invitation_denial', {
        p_actor_user_id: actorUserId,
        p_event_name: eventName,
        p_reason_code: reasonCode,
        p_correlation_id: correlationId,
        p_organization_id: null,
        p_invitation_id: null,
      });
    },
    list: ({ actorUserId, organizationId, correlationId }) =>
      rpc('list_member_invitations', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_correlation_id: correlationId,
      }),
    beginCreate: ({
      actorUserId,
      organizationId,
      email,
      roleCode,
      idempotencyKeyHash,
      correlationId,
    }) =>
      rpc('begin_member_invitation', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_email: email,
        p_role_code: roleCode,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
    beginResend: ({
      actorUserId,
      organizationId,
      invitationId,
      expectedVersion,
      idempotencyKeyHash,
      correlationId,
    }) =>
      rpc('begin_resend_member_invitation', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_invitation_id: invitationId,
        p_expected_version: expectedVersion,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
    finalizeDelivery: ({
      actorUserId,
      invitationId,
      deliveryOperationId,
      delivery,
      correlationId,
    }) =>
      rpc('finalize_member_invitation_delivery', {
        p_actor_user_id: actorUserId,
        p_invitation_id: invitationId,
        p_delivery_operation_id: deliveryOperationId,
        p_delivery_outcome: delivery.outcome,
        p_provider_operation_class: delivery.operationClass,
        p_correlation_id: correlationId,
      }),
    send: async ({ invitationId, invitationVersion, email }): Promise<DeliveryResult> => {
      const redirectTo = new URL(configuration.invitationRedirectUrl);
      redirectTo.searchParams.set('invitation', invitationId);
      redirectTo.searchParams.set('version', String(invitationVersion + 1));
      try {
        const { error } = await serverClient.auth.admin.inviteUserByEmail(email, {
          redirectTo: redirectTo.href,
        });
        if (error) throw error;
        return { outcome: 'accepted', operationClass: 'new_identity_invite' };
      } catch (error) {
        if (isExistingConfirmedIdentity(error)) {
          try {
            const { error: signInError } = await publicClient.auth.signInWithOtp({
              email,
              options: { shouldCreateUser: false, emailRedirectTo: redirectTo.href },
            });
            if (signInError) throw signInError;
            return { outcome: 'accepted', operationClass: 'existing_identity_sign_in' };
          } catch (signInError) {
            return {
              outcome: knownProviderFailure(signInError) ? 'failed' : 'uncertain',
              operationClass: 'existing_identity_sign_in',
            };
          }
        }
        return {
          outcome: knownProviderFailure(error) ? 'failed' : 'uncertain',
          operationClass: 'new_identity_invite',
        };
      }
    },
    revoke: ({
      actorUserId,
      organizationId,
      invitationId,
      expectedVersion,
      idempotencyKeyHash,
      correlationId,
    }) =>
      rpc('revoke_member_invitation', {
        p_actor_user_id: actorUserId,
        p_organization_id: organizationId,
        p_invitation_id: invitationId,
        p_expected_version: expectedVersion,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
    prepare: ({ actorUserId, confirmedEmail, invitationId, expectedVersion, correlationId }) =>
      rpc('prepare_member_invitation_acceptance', {
        p_actor_user_id: actorUserId,
        p_confirmed_email: confirmedEmail,
        p_invitation_id: invitationId,
        p_expected_version: expectedVersion,
        p_correlation_id: correlationId,
      }),
    accept: ({
      actor,
      confirmedEmail,
      invitationId,
      expectedVersion,
      idempotencyKeyHash,
      correlationId,
    }) =>
      rpc('accept_member_invitation', {
        p_actor_user_id: actor.actorUserId,
        p_confirmed_email: confirmedEmail,
        p_password_authenticated_at: actor.passwordAuthenticatedAt,
        p_invitation_id: invitationId,
        p_expected_version: expectedVersion,
        p_idempotency_key_hash: idempotencyKeyHash,
        p_correlation_id: correlationId,
      }),
  }),
);
