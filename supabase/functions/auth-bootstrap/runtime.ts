import { createClient } from '@supabase/supabase-js';

import {
  authenticationEvidenceFromVerifiedToken,
  classifyCompleteFactorInventory,
} from '../_shared/authentication-evidence.ts';
import {
  type EdgeEnvironmentReader,
  readAuthBootstrapRuntimeConfiguration,
} from '../_shared/edge-runtime-configuration.ts';
import type { AuthBootstrapDependencies } from './handler.ts';

export function createAuthBootstrapDependencies(
  read: EdgeEnvironmentReader,
): AuthBootstrapDependencies {
  const { supabaseUrl, supabasePublishableKey, supabaseServiceRoleKey, allowedOrigin } =
    readAuthBootstrapRuntimeConfiguration(read);

  const publicClient = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const serverClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
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
        sessionId: authenticationContext.sessionId,
        assuranceLevel: authenticationContext.assuranceLevel,
        authenticationMethods: authenticationContext.authenticationMethods,
      };
    },
    consumeLimit: async (actorUserId, correlationId) => {
      const result = await serverClient
        .rpc('consume_auth_bootstrap_rate_limit', {
          p_actor_user_id: actorUserId,
          p_correlation_id: correlationId,
        })
        .abortSignal(AbortSignal.timeout(3000));
      if (result.error) throw result.error;
      return result.data as unknown;
    },
    validateAdminFactorState: async (actorUserId, sessionId) => {
      const { data, error } = await serverClient.auth.admin.mfa.listFactors({
        userId: actorUserId,
      });
      if (error) throw error;
      const classification = classifyCompleteFactorInventory(data.factors);
      if (classification.kind !== 'one_verified_totp') return false;
      const binding = await serverClient.rpc('validate_admin_session_factor', {
        p_actor_user_id: actorUserId,
        p_session_id: sessionId,
        p_factor_id: classification.factorId,
        p_require_aal2: true,
      });
      if (binding.error || typeof binding.data !== 'boolean')
        throw new Error('Session factor validation failed.');
      return binding.data;
    },
    resolveAccessContext: async ({ actorUserId, assuranceLevel }) => {
      const result = await serverClient.rpc('resolve_auth_access_context', {
        p_actor_user_id: actorUserId,
        p_assurance_level: assuranceLevel,
        p_selected_organization_id: null,
      });
      if (result.error) throw result.error;
      return result.data as unknown;
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
  };
}
