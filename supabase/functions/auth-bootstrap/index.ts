import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { assuranceLevelSchema, type AssuranceLevel } from '../_shared/access-context.ts';
import { createAuthBootstrapHandler } from './handler.ts';

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function configuredAllowedOrigin(supabaseUrl: string): string {
  const configured = Deno.env.get('ALLOWED_ORIGIN');
  if (configured) return configured;
  throw new Error(`ALLOWED_ORIGIN is required for ${new URL(supabaseUrl).hostname}.`);
}

type VerifiedAuthenticationContext = {
  assuranceLevel: AssuranceLevel;
  authenticationMethods: string[];
};

const authenticationMethodReferenceSchema = z
  .object({
    method: z.string().trim().min(1).max(64),
  })
  .passthrough();

function authenticationContextFromVerifiedToken(
  accessToken: string,
): VerifiedAuthenticationContext {
  const payloadSegment = accessToken.split('.')[1];
  if (!payloadSegment) throw new Error('The verified token payload is unavailable.');

  const padded = payloadSegment
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
  const payload = JSON.parse(atob(padded)) as { aal?: unknown; amr?: unknown };
  const authenticationMethods = z
    .array(authenticationMethodReferenceSchema)
    .max(16)
    .safeParse(payload.amr);

  return {
    assuranceLevel: assuranceLevelSchema.parse(payload.aal ?? 'aal1'),
    authenticationMethods: authenticationMethods.success
      ? [...new Set(authenticationMethods.data.map((reference) => reference.method))]
      : [],
  };
}

const supabaseUrl = requiredEnvironment('SUPABASE_URL');
const supabasePublishableKey = requiredEnvironment('SUPABASE_ANON_KEY');
const supabaseServiceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
const allowedOrigin = configuredAllowedOrigin(supabaseUrl);

const publicClient = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const serverClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(
  createAuthBootstrapHandler({
    allowedOrigin,
    authenticate: async (accessToken) => {
      const { data, error } = await publicClient.auth.getUser(accessToken);
      if (error || !data.user) throw new Error('Authentication failed.');
      const authenticationContext = authenticationContextFromVerifiedToken(accessToken);
      return {
        userId: data.user.id,
        ...authenticationContext,
      };
    },
    resolveAccessContext: async ({ actorUserId, assuranceLevel, selectedOrganizationId }) => {
      const { data, error } = await serverClient.rpc('resolve_auth_access_context', {
        p_actor_user_id: actorUserId,
        p_assurance_level: assuranceLevel,
        p_selected_organization_id: selectedOrganizationId ?? null,
      });
      if (error) throw error;
      return data;
    },
    recordDecision: async (decision) => {
      const { error } = await serverClient.rpc('record_authentication_access_decision', {
        p_actor_user_id: decision.actorUserId,
        p_actor_subject_id: decision.actorSubjectId,
        p_event_name: decision.eventName,
        p_outcome: decision.outcome,
        p_correlation_id: decision.correlationId,
        p_organization_id: decision.organizationId,
        p_organization_ids: decision.organizationIds,
        p_reason_code: decision.reasonCode,
        p_metadata: decision.metadata,
      });
      if (error) throw error;
    },
  }),
);
