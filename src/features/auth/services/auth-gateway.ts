import type { SupabaseClient } from '@supabase/supabase-js';

import type { AuthGateway, MfaAssurance } from './auth-gateway-contract';
import { AuthGatewayError, asGatewayError, responseStatus } from './auth-gateway-errors';
import { PasswordRecoveryGateway } from './password-recovery-gateway';
import { MemberInvitationGateway } from './member-invitation-gateway';
import { MemberAdministrationGateway } from './member-administration-gateway';
import { AdminOnboardingGateway } from './admin-onboarding-gateway';
import { MemberMfaGateway } from './member-mfa-gateway';

import {
  accessContextResponseSchema,
  type AccessContextResponse,
  type LoginRequest,
} from '../../../lib/access-context';
import type { Database } from '../../../lib/database.types';
import type {
  MemberDetail,
  MemberList,
  MemberProfile,
  MemberRoleResult,
  MemberStatus,
  MemberStatusAction,
  MemberStatusResult,
} from '../../members';
import type {
  AdminBootstrapGrant,
  AdminOnboardingComplete,
  AdminOnboardingStart,
  AdminOnboardingStatus,
  TotpPreparation,
} from '../admin-onboarding';
import type { InvitationMutation, MemberInvitationList } from '../member-invitations';
import type { MemberMfaComplete, MemberMfaStart, MemberMfaStatus } from '../member-mfa';

export { AuthGatewayError, type AuthGatewayErrorCode } from './auth-gateway-errors';

export type { AuthGateway, MfaAssurance } from './auth-gateway-contract';

function supportedAssuranceLevel(level: string | null): 'aal1' | 'aal2' | null {
  return level === 'aal1' || level === 'aal2' ? level : null;
}

export class SupabaseAuthGateway implements AuthGateway {
  private readonly memberMfa: MemberMfaGateway;
  private readonly adminOnboarding: AdminOnboardingGateway;
  private readonly passwordRecovery: PasswordRecoveryGateway;
  private readonly memberInvitations: MemberInvitationGateway;
  private readonly memberAdministration: MemberAdministrationGateway;

  constructor(
    private readonly client: SupabaseClient<Database>,
    recoveryOrigin = () => window.location.origin,
  ) {
    this.memberMfa = new MemberMfaGateway(client);
    this.adminOnboarding = new AdminOnboardingGateway(client);
    this.passwordRecovery = new PasswordRecoveryGateway(client.auth, recoveryOrigin);
    this.memberInvitations = new MemberInvitationGateway(client);
    this.memberAdministration = new MemberAdministrationGateway(client);
  }

  async hasSession(): Promise<boolean> {
    const { data, error } = await this.client.auth.getSession();
    if (error) {
      throw asGatewayError(error);
    }

    return data.session !== null;
  }

  async signIn(request: LoginRequest): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword(request);
    if (!error) {
      return;
    }

    if (error.status === 429) {
      throw new AuthGatewayError('rate_limited', 'Too many attempts. Wait before trying again.');
    }

    if (error.status === 400 || error.status === 401) {
      throw new AuthGatewayError(
        'invalid_credentials',
        'The email or password is incorrect, or access is unavailable.',
      );
    }

    throw asGatewayError(error);
  }

  requestPasswordRecovery(email: string, captchaToken?: string): Promise<void> {
    return this.passwordRecovery.requestPasswordRecovery(email, captchaToken);
  }

  verifyRecoveryCredential(tokenHash: string): Promise<void> {
    return this.passwordRecovery.verifyRecoveryCredential(tokenHash);
  }

  updateRecoveredPassword(password: string): Promise<void> {
    return this.passwordRecovery.updateRecoveredPassword(password);
  }

  signOutEverywhere(): Promise<void> {
    return this.passwordRecovery.signOutEverywhere();
  }

  async loadAccessContext(): Promise<AccessContextResponse> {
    const invocation: unknown = await this.client.functions.invoke('auth-bootstrap', {
      body: {},
    });
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'access_context_unavailable',
        'Your access could not be verified. Try again.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');

    if (error) {
      const status = responseStatus(error);
      if (status === 409) {
        throw new AuthGatewayError(
          'access_context_conflict',
          'Your access information needs administrator review.',
        );
      }

      throw new AuthGatewayError(
        'access_context_unavailable',
        'Your access could not be verified. Try again.',
      );
    }

    const parsed = accessContextResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new AuthGatewayError(
        'access_context_conflict',
        'Your access information needs administrator review.',
      );
    }

    return parsed.data;
  }

  loadAdminOnboardingStatus(): Promise<AdminOnboardingStatus> {
    return this.adminOnboarding.loadAdminOnboardingStatus();
  }

  startAdminOnboarding(grant: AdminBootstrapGrant): Promise<AdminOnboardingStart> {
    return this.adminOnboarding.startAdminOnboarding(grant);
  }

  prepareAdminTotp(factorState: AdminOnboardingStart['factorState']): Promise<TotpPreparation> {
    return this.adminOnboarding.prepareAdminTotp(factorState);
  }

  verifyAdminTotp(factorId: string, code: string): Promise<void> {
    return this.adminOnboarding.verifyAdminTotp(factorId, code);
  }

  completeAdminOnboarding(
    start: AdminOnboardingStart,
    idempotencyKey: string,
  ): Promise<AdminOnboardingComplete> {
    return this.adminOnboarding.completeAdminOnboarding(start, idempotencyKey);
  }

  cancelAdminOnboarding(bootstrapGrantId: string, idempotencyKey: string): Promise<void> {
    return this.adminOnboarding.cancelAdminOnboarding(bootstrapGrantId, idempotencyKey);
  }

  loadMemberMfaStatus(): Promise<MemberMfaStatus> {
    return this.memberMfa.loadMemberMfaStatus();
  }

  startMemberMfaEnrollment(idempotencyKey: string): Promise<MemberMfaStart> {
    return this.memberMfa.startMemberMfaEnrollment(idempotencyKey);
  }

  prepareMemberTotp(start: MemberMfaStart, idempotencyKey: string): Promise<TotpPreparation> {
    return this.memberMfa.prepareMemberTotp(start, idempotencyKey);
  }

  verifyMemberTotp(factorId: string, code: string): Promise<void> {
    return this.memberMfa.verifyMemberTotp(factorId, code);
  }

  completeMemberMfaEnrollment(
    start: MemberMfaStart,
    idempotencyKey: string,
  ): Promise<MemberMfaComplete> {
    return this.memberMfa.completeMemberMfaEnrollment(start, idempotencyKey);
  }

  cancelMemberMfaEnrollment(
    start: MemberMfaStart,
    factorId: string | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    return this.memberMfa.cancelMemberMfaEnrollment(start, factorId, idempotencyKey);
  }

  loadMemberInvitations(organizationId: string): Promise<MemberInvitationList> {
    return this.memberInvitations.loadMemberInvitations(organizationId);
  }

  createMemberInvitation(request: {
    organizationId: string;
    email: string;
    roleCode: string;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.memberInvitations.createMemberInvitation(request);
  }

  resendMemberInvitation(request: {
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.memberInvitations.resendMemberInvitation(request);
  }

  revokeMemberInvitation(request: {
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.memberInvitations.revokeMemberInvitation(request);
  }

  prepareInvitationCredential(
    password: string,
    invitation: { invitationId: string; expectedVersion: number },
  ): Promise<void> {
    return this.memberInvitations.prepareInvitationCredential(password, invitation);
  }

  acceptMemberInvitation(request: {
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.memberInvitations.acceptMemberInvitation(request);
  }

  loadOrganizationMembers(request: {
    organizationId: string;
    status?: MemberStatus;
    search?: string;
    cursor?: string;
  }): Promise<MemberList> {
    return this.memberAdministration.loadOrganizationMembers(request);
  }

  loadOrganizationMember(organizationId: string, membershipId: string): Promise<MemberDetail> {
    return this.memberAdministration.loadOrganizationMember(organizationId, membershipId);
  }

  loadMyMemberProfile(membershipId: string): Promise<MemberProfile> {
    return this.memberAdministration.loadMyMemberProfile(membershipId);
  }

  updateMyMemberProfile(request: {
    membershipId: string;
    displayName: string;
    contactNumber: string;
    expectedVersion: number;
  }): Promise<MemberProfile> {
    return this.memberAdministration.updateMyMemberProfile(request);
  }

  changeOrganizationMemberStatus(request: {
    organizationId: string;
    membershipId: string;
    action: MemberStatusAction;
    reasonCode: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<MemberStatusResult> {
    return this.memberAdministration.changeOrganizationMemberStatus(request);
  }

  changeOrganizationMemberRole(request: {
    organizationId: string;
    membershipId: string;
    roleCode: string;
    reasonCode: 'responsibility_changed' | 'assignment_corrected';
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<MemberRoleResult> {
    return this.memberAdministration.changeOrganizationMemberRole(request);
  }

  async getMfaAssurance(): Promise<MfaAssurance> {
    const { data, error } = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) {
      throw asGatewayError(error);
    }

    return {
      currentLevel: supportedAssuranceLevel(data.currentLevel),
      nextLevel: supportedAssuranceLevel(data.nextLevel),
    };
  }

  async verifyTotp(code: string): Promise<void> {
    const { data: factorData, error: factorError } = await this.client.auth.mfa.listFactors();
    if (factorError) {
      throw asGatewayError(factorError);
    }

    const factor = factorData.totp.find((item) => item.status === 'verified');
    if (!factor) {
      throw new AuthGatewayError(
        'mfa_enrollment_required',
        'A verified authenticator is required. Contact your administrator.',
      );
    }

    const { error } = await this.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (error) {
      throw new AuthGatewayError('mfa_invalid', 'The verification code is invalid or expired.');
    }
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) {
      throw asGatewayError(error);
    }
  }

  onSignedOut(callback: () => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        callback();
      }
    });

    return () => data.subscription.unsubscribe();
  }
}
