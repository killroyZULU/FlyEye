import { createClient } from '@supabase/supabase-js';

import {
  authenticationEvidenceFromVerifiedToken,
  classifyCompleteFactorInventory,
} from '../_shared/authentication-evidence.ts';
import { readCommonEdgeRuntimeConfiguration } from '../_shared/edge-runtime-configuration.ts';
import { createAuthBootstrapHandler } from './handler.ts';

const { supabaseUrl, supabasePublishableKey, supabaseServiceRoleKey, allowedOrigin } =
  readCommonEdgeRuntimeConfiguration((name) => Deno.env.get(name));

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
      const authenticationContext = authenticationEvidenceFromVerifiedToken(
        accessToken,
        data.user.id,
      );
      return {
        userId: data.user.id,
        assuranceLevel: authenticationContext.assuranceLevel,
        authenticationMethods: authenticationContext.authenticationMethods,
      };
    },
    validateAdminFactorState: async (actorUserId) => {
      const { data, error } = await serverClient.auth.admin.mfa.listFactors({
        userId: actorUserId,
      });
      if (error) throw error;
      return classifyCompleteFactorInventory(data.factors).kind === 'one_verified_totp';
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
