import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';
import type { CredentialRequest } from '../_shared/credential-workspace.ts';

export function credentialParameters(
  data: CredentialRequest,
  actor: VerifiedAuthenticationEvidence,
  correlationId: string,
) {
  return {
    p_actor: actor.actorUserId,
    p_session: actor.sessionId,
    p_totp: actor.assuranceLevel === 'aal2' && actor.totpAuthenticatedAt !== null,
    p_school: data.organizationId,
    p_action: data.action,
    p_member: 'membershipId' in data ? data.membershipId : null,
    p_after: 'after' in data ? data.after : null,
    p_applicability: 'applicability' in data ? data.applicability : null,
    p_version: 'expectedVersion' in data ? data.expectedVersion : null,
    p_correlation: correlationId,
  };
}
