import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeTotpQrSvg } from './totp-qr-svg';
import { AuthGatewayError, asGatewayError, responseStatus } from './auth-gateway-errors';
import { PasswordRecoveryGateway } from './password-recovery-gateway';
import { MemberInvitationGateway } from './member-invitation-gateway';
import { MemberAdministrationGateway } from './member-administration-gateway';
import { edgeErrorDetails } from './edge-error-details';

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
import {
  adminOnboardingCompleteSchema,
  adminOnboardingStartSchema,
  adminOnboardingStatusSchema,
  type AdminBootstrapGrant,
  type AdminOnboardingComplete,
  type AdminOnboardingStart,
  type AdminOnboardingStatus,
  type TotpPreparation,
} from '../admin-onboarding';
import type { InvitationMutation, MemberInvitationList } from '../member-invitations';
import {
  memberMfaBoundSchema,
  memberMfaCompleteSchema,
  memberMfaStartSchema,
  memberMfaStatusSchema,
  type MemberMfaComplete,
  type MemberMfaStart,
  type MemberMfaStatus,
} from '../member-mfa';

export { AuthGatewayError, type AuthGatewayErrorCode } from './auth-gateway-errors';

export type MfaAssurance = {
  currentLevel: 'aal1' | 'aal2' | null;
  nextLevel: 'aal1' | 'aal2' | null;
};

export interface AuthGateway {
  hasSession(): Promise<boolean>;
  signIn(request: LoginRequest): Promise<void>;
  requestPasswordRecovery(email: string, captchaToken?: string): Promise<void>;
  verifyRecoveryCredential(tokenHash: string): Promise<void>;
  updateRecoveredPassword(password: string): Promise<void>;
  signOutEverywhere(): Promise<void>;
  loadAccessContext(): Promise<AccessContextResponse>;
  loadAdminOnboardingStatus(): Promise<AdminOnboardingStatus>;
  startAdminOnboarding(grant: AdminBootstrapGrant): Promise<AdminOnboardingStart>;
  prepareAdminTotp(factorState: AdminOnboardingStart['factorState']): Promise<TotpPreparation>;
  verifyAdminTotp(factorId: string, code: string): Promise<void>;
  completeAdminOnboarding(
    start: AdminOnboardingStart,
    idempotencyKey: string,
  ): Promise<AdminOnboardingComplete>;
  cancelAdminOnboarding(bootstrapGrantId: string, idempotencyKey: string): Promise<void>;
  loadMemberMfaStatus(): Promise<MemberMfaStatus>;
  startMemberMfaEnrollment(idempotencyKey: string): Promise<MemberMfaStart>;
  prepareMemberTotp(start: MemberMfaStart, idempotencyKey: string): Promise<TotpPreparation>;
  verifyMemberTotp(factorId: string, code: string): Promise<void>;
  completeMemberMfaEnrollment(
    start: MemberMfaStart,
    idempotencyKey: string,
  ): Promise<MemberMfaComplete>;
  cancelMemberMfaEnrollment(
    start: MemberMfaStart,
    factorId: string | undefined,
    idempotencyKey: string,
  ): Promise<void>;
  loadMemberInvitations(organizationId: string): Promise<MemberInvitationList>;
  createMemberInvitation(request: {
    organizationId: string;
    email: string;
    roleCode: string;
    idempotencyKey: string;
  }): Promise<InvitationMutation>;
  resendMemberInvitation(request: {
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation>;
  revokeMemberInvitation(request: {
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation>;
  prepareInvitationCredential(
    password: string,
    invitation: { invitationId: string; expectedVersion: number },
  ): Promise<void>;
  acceptMemberInvitation(request: {
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation>;
  loadOrganizationMembers(request: {
    organizationId: string;
    status?: MemberStatus;
    search?: string;
    cursor?: string;
  }): Promise<MemberList>;
  loadOrganizationMember(organizationId: string, membershipId: string): Promise<MemberDetail>;
  loadMyMemberProfile(membershipId: string): Promise<MemberProfile>;
  updateMyMemberProfile(request: {
    membershipId: string;
    displayName: string;
    contactNumber: string;
    expectedVersion: number;
  }): Promise<MemberProfile>;
  changeOrganizationMemberStatus(request: {
    organizationId: string;
    membershipId: string;
    action: MemberStatusAction;
    reasonCode: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<MemberStatusResult>;
  changeOrganizationMemberRole(request: {
    organizationId: string;
    membershipId: string;
    roleCode: string;
    reasonCode: 'responsibility_changed' | 'assignment_corrected';
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<MemberRoleResult>;
  getMfaAssurance(): Promise<MfaAssurance>;
  verifyTotp(code: string): Promise<void>;
  signOut(): Promise<void>;
  onSignedOut(callback: () => void): () => void;
}

function supportedAssuranceLevel(level: string | null): 'aal1' | 'aal2' | null {
  return level === 'aal1' || level === 'aal2' ? level : null;
}

function factorInventory(input: unknown): Array<{
  id: string;
  factor_type: 'totp' | 'phone' | 'webauthn';
  status: 'verified' | 'unverified';
}> {
  if (!Array.isArray(input) || input.length > 16) {
    throw new AuthGatewayError(
      'admin_onboarding_conflict',
      'Your authenticator information needs administrator review.',
    );
  }

  const factors = input.map((factor) => {
    if (typeof factor !== 'object' || factor === null) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }
    const id: unknown = Reflect.get(factor, 'id') as unknown;
    const factorType: unknown = Reflect.get(factor, 'factor_type') as unknown;
    const status: unknown = Reflect.get(factor, 'status') as unknown;
    if (
      typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
      !['totp', 'phone', 'webauthn'].includes(String(factorType)) ||
      !['verified', 'unverified'].includes(String(status))
    ) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }
    return {
      id,
      factor_type: factorType as 'totp' | 'phone' | 'webauthn',
      status: status as 'verified' | 'unverified',
    };
  });

  if (new Set(factors.map((factor) => factor.id)).size !== factors.length) {
    throw new AuthGatewayError(
      'admin_onboarding_conflict',
      'Your authenticator information needs administrator review.',
    );
  }
  return factors;
}

export class SupabaseAuthGateway implements AuthGateway {
  private readonly passwordRecovery: PasswordRecoveryGateway;
  private readonly memberInvitations: MemberInvitationGateway;
  private readonly memberAdministration: MemberAdministrationGateway;

  constructor(
    private readonly client: SupabaseClient<Database>,
    recoveryOrigin = () => window.location.origin,
  ) {
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

  private async invokeAdminOnboarding(body: Record<string, unknown>): Promise<unknown> {
    const invocation: unknown = await this.client.functions.invoke(
      'organization-admin-onboarding',
      { body },
    );
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'admin_onboarding_audit_unavailable',
        'Administrator onboarding could not be verified. Try again.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');
    if (!error) return data;

    const details = await edgeErrorDetails(error);
    switch (details.code) {
      case 'admin_onboarding.rate_limited':
        throw new AuthGatewayError(
          'rate_limited',
          details.retryAfterSeconds
            ? `Wait ${details.retryAfterSeconds} seconds before trying again.`
            : 'Too many attempts. Wait before trying again.',
        );
      case 'admin_onboarding.recent_authentication_required':
        throw new AuthGatewayError(
          'admin_onboarding_recent_authentication_required',
          'Sign in with your password again to continue.',
        );
      case 'admin_onboarding.not_available':
      case 'admin_onboarding.not_eligible':
        throw new AuthGatewayError(
          'admin_onboarding_not_available',
          'This administrator onboarding request is not available.',
        );
      case 'admin_onboarding.conflict':
        throw new AuthGatewayError(
          'admin_onboarding_conflict',
          'Your administrator onboarding information needs review.',
        );
      case 'admin_onboarding.provider_unavailable':
        throw new AuthGatewayError(
          'admin_onboarding_provider_unavailable',
          'Authenticator state could not be confirmed. Try again.',
        );
      case 'admin_onboarding.limiter_unavailable':
        throw new AuthGatewayError(
          'admin_onboarding_limiter_unavailable',
          'Administrator onboarding is temporarily unavailable. Try again later.',
        );
      case 'admin_onboarding.audit_unavailable':
        throw new AuthGatewayError(
          'admin_onboarding_audit_unavailable',
          'Administrator onboarding could not be verified. Try again.',
        );
      default:
        if (details.status === 429) {
          throw new AuthGatewayError(
            'rate_limited',
            'Too many attempts. Wait before trying again.',
          );
        }
        throw new AuthGatewayError(
          'admin_onboarding_audit_unavailable',
          'Administrator onboarding could not be verified. Try again.',
        );
    }
  }

  async loadAdminOnboardingStatus(): Promise<AdminOnboardingStatus> {
    const parsed = adminOnboardingStatusSchema.safeParse(
      await this.invokeAdminOnboarding({ action: 'status' }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your administrator onboarding information needs review.',
      );
    }
    return parsed.data;
  }

  async startAdminOnboarding(grant: AdminBootstrapGrant): Promise<AdminOnboardingStart> {
    const parsed = adminOnboardingStartSchema.safeParse(
      await this.invokeAdminOnboarding({
        action: 'start',
        bootstrapGrantId: grant.bootstrapGrantId,
        expectedVersion: grant.grantVersion,
        idempotencyKey: crypto
          .getRandomValues(new Uint8Array(16))
          .reduce((value, byte) => `${value}${byte.toString(16).padStart(2, '0')}`, ''),
      }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your administrator onboarding information needs review.',
      );
    }
    return parsed.data;
  }

  async prepareAdminTotp(
    factorState: AdminOnboardingStart['factorState'],
  ): Promise<TotpPreparation> {
    const { data, error } = await this.client.auth.mfa.listFactors();
    if (error) throw asGatewayError(error);

    const all = factorInventory(data.all);
    const allTotpIds = all
      .filter((factor) => factor.factor_type === 'totp')
      .map((factor) => factor.id)
      .sort();
    const convenienceTotpIds = factorInventory(data.totp)
      .map((factor) => factor.id)
      .sort();
    if (
      allTotpIds.length !== convenienceTotpIds.length ||
      allTotpIds.some((id, index) => id !== convenienceTotpIds[index])
    ) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }

    if (factorState === 'challenge_required') {
      if (all.length !== 1 || all[0]?.factor_type !== 'totp' || all[0].status !== 'verified') {
        throw new AuthGatewayError(
          'admin_onboarding_conflict',
          'Your authenticator information needs administrator review.',
        );
      }
      return { kind: 'challenge', factorId: all[0].id };
    }

    if (all.length !== 0) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }

    const { data: enrollment, error: enrollmentError } = await this.client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'FlyEye authenticator',
    });
    if (enrollmentError) throw asGatewayError(enrollmentError);

    const qrSvg = normalizeTotpQrSvg(enrollment.totp.qr_code);
    const manualSecret = enrollment.totp.secret;
    const uri = enrollment.totp.uri;
    if (
      !qrSvg ||
      !/^[A-Z2-7]+=*$/i.test(manualSecret) ||
      manualSecret.length < 16 ||
      manualSecret.length > 256 ||
      !uri.startsWith('otpauth://totp/') ||
      uri.length > 2048
    ) {
      throw new AuthGatewayError(
        'admin_onboarding_provider_unavailable',
        'Authenticator enrollment could not be prepared safely.',
      );
    }

    return {
      kind: 'enrollment',
      factorId: enrollment.id,
      qrSvg,
      manualSecret,
    };
  }

  async verifyAdminTotp(factorId: string, code: string): Promise<void> {
    const { error } = await this.client.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      if (error.status === 429) {
        throw new AuthGatewayError('rate_limited', 'Too many attempts. Wait before trying again.');
      }
      throw new AuthGatewayError('mfa_invalid', 'The verification code is invalid or expired.');
    }

    const { data: assurance, error: assuranceError } =
      await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw asGatewayError(assuranceError);
    if (assurance.currentLevel !== 'aal2') {
      throw new AuthGatewayError(
        'admin_onboarding_provider_unavailable',
        'Authenticator verification could not be confirmed.',
      );
    }
  }

  async completeAdminOnboarding(
    start: AdminOnboardingStart,
    idempotencyKey: string,
  ): Promise<AdminOnboardingComplete> {
    const parsed = adminOnboardingCompleteSchema.safeParse(
      await this.invokeAdminOnboarding({
        action: 'complete',
        bootstrapGrantId: start.bootstrapGrantId,
        expectedVersion: start.grantVersion,
        idempotencyKey,
      }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Administrator onboarding completion could not be revalidated.',
      );
    }
    return parsed.data;
  }

  async cancelAdminOnboarding(bootstrapGrantId: string, idempotencyKey: string): Promise<void> {
    try {
      await this.invokeAdminOnboarding({
        action: 'cancel',
        bootstrapGrantId,
        idempotencyKey,
      });
    } finally {
      try {
        await this.client.auth.signOut({ scope: 'local' });
      } catch {
        // The UI clears in-memory enrollment state even if local SDK cleanup reports failure.
      }
    }
  }

  private async invokeMemberMfa(body: Record<string, unknown>): Promise<unknown> {
    const invocation: unknown = await this.client.functions.invoke('member-mfa', { body });
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'member_mfa_unavailable',
        'Authenticator setup is temporarily unavailable.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');
    if (!error) return data;

    const details = await edgeErrorDetails(error);
    switch (details.code) {
      case 'member_mfa.rate_limited':
        throw new AuthGatewayError(
          'rate_limited',
          details.retryAfterSeconds
            ? `Wait ${details.retryAfterSeconds} seconds before trying again.`
            : 'Too many attempts. Wait before trying again.',
        );
      case 'member_mfa.not_available':
        throw new AuthGatewayError(
          'member_mfa_not_available',
          'Authenticator setup is not available for this membership.',
        );
      case 'member_mfa.recent_authentication_required':
        throw new AuthGatewayError(
          'member_mfa_recent_authentication_required',
          'Sign in with your password again to continue.',
        );
      case 'member_mfa.factor_conflict':
        throw new AuthGatewayError(
          'member_mfa_factor_conflict',
          'Your authenticator information needs support review.',
        );
      case 'member_mfa.state_conflict':
        throw new AuthGatewayError(
          'member_mfa_state_conflict',
          'Authenticator setup changed. Sign in again before retrying.',
        );
      case 'member_mfa.cleanup_uncertain':
        throw new AuthGatewayError(
          'member_mfa_cleanup_uncertain',
          'Authenticator cleanup could not be confirmed. Sign in again before retrying.',
        );
      default:
        throw new AuthGatewayError(
          'member_mfa_unavailable',
          'Authenticator setup could not be confirmed. Try again.',
        );
    }
  }

  async loadMemberMfaStatus(): Promise<MemberMfaStatus> {
    const parsed = memberMfaStatusSchema.safeParse(
      await this.invokeMemberMfa({ action: 'status' }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_mfa_state_conflict',
        'Authenticator readiness could not be confirmed.',
      );
    }
    return parsed.data;
  }

  async startMemberMfaEnrollment(idempotencyKey: string): Promise<MemberMfaStart> {
    const parsed = memberMfaStartSchema.safeParse(
      await this.invokeMemberMfa({ action: 'start', idempotencyKey }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_mfa_state_conflict',
        'Authenticator setup could not be started safely.',
      );
    }
    return parsed.data;
  }

  async prepareMemberTotp(start: MemberMfaStart, idempotencyKey: string): Promise<TotpPreparation> {
    const { data, error } = await this.client.auth.mfa.listFactors();
    if (error) throw asGatewayError(error);

    const all = factorInventory(data.all);
    const allTotpIds = all
      .filter((factor) => factor.factor_type === 'totp')
      .map((factor) => factor.id)
      .sort();
    const convenienceTotpIds = factorInventory(data.totp)
      .map((factor) => factor.id)
      .sort();
    if (
      allTotpIds.length !== convenienceTotpIds.length ||
      allTotpIds.some((id, index) => id !== convenienceTotpIds[index])
    ) {
      throw new AuthGatewayError(
        'member_mfa_factor_conflict',
        'Your authenticator information needs support review.',
      );
    }

    if (start.factorState === 'challenge_required') {
      if (
        all.length !== 1 ||
        all[0]?.factor_type !== 'totp' ||
        (start.operationVersion > 1
          ? !['unverified', 'verified'].includes(all[0].status)
          : all[0].status !== 'verified')
      ) {
        throw new AuthGatewayError(
          'member_mfa_factor_conflict',
          'Your authenticator information needs support review.',
        );
      }
      return { kind: 'challenge', factorId: all[0].id };
    }

    if (all.length !== 0) {
      throw new AuthGatewayError(
        'member_mfa_factor_conflict',
        'Your authenticator information needs support review.',
      );
    }

    const { data: enrollment, error: enrollmentError } = await this.client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'FlyEye authenticator',
    });
    if (enrollmentError) throw asGatewayError(enrollmentError);

    const qrSvg = normalizeTotpQrSvg(enrollment.totp.qr_code);
    const manualSecret = enrollment.totp.secret;
    const uri = enrollment.totp.uri;
    if (
      !qrSvg ||
      !/^[A-Z2-7]+=*$/i.test(manualSecret) ||
      manualSecret.length < 16 ||
      manualSecret.length > 256 ||
      !uri.startsWith('otpauth://totp/') ||
      uri.length > 2048
    ) {
      let cleanupFailed: boolean;
      try {
        const cleanup = await this.client.auth.mfa.unenroll({ factorId: enrollment.id });
        cleanupFailed = Boolean(cleanup.error);
      } catch {
        cleanupFailed = true;
      }
      throw new AuthGatewayError(
        cleanupFailed ? 'member_mfa_cleanup_uncertain' : 'member_mfa_unavailable',
        cleanupFailed
          ? 'Authenticator setup could not be cleaned up safely. Sign in again before retrying.'
          : 'Authenticator enrollment could not be prepared safely.',
      );
    }

    const preparation = {
      kind: 'enrollment' as const,
      factorId: enrollment.id,
      qrSvg,
      manualSecret,
    };
    const reconcileBinding = async (): Promise<TotpPreparation> => {
      const reconciled = memberMfaStatusSchema.safeParse(
        await this.invokeMemberMfa({ action: 'status' }),
      );
      if (
        reconciled.success &&
        reconciled.data.operationState === 'bound' &&
        reconciled.data.operationId === start.operationId &&
        reconciled.data.factorState === 'resume_required' &&
        reconciled.data.operationVersion
      ) {
        start.operationVersion = reconciled.data.operationVersion;
        return preparation;
      }
      throw new AuthGatewayError(
        'member_mfa_cleanup_uncertain',
        'Authenticator binding could not be confirmed. Sign in again to resume safely.',
      );
    };
    let boundPayload: unknown;
    try {
      boundPayload = await this.invokeMemberMfa({
        action: 'bind_factor',
        operationId: start.operationId,
        expectedVersion: start.operationVersion,
        factorId: enrollment.id,
        idempotencyKey,
      });
    } catch (error) {
      try {
        return await reconcileBinding();
      } catch (reconciliationError) {
        throw new AuthGatewayError(
          'member_mfa_cleanup_uncertain',
          'Authenticator binding could not be confirmed. Sign in again to resume safely.',
          { cause: new AggregateError([error, reconciliationError]) },
        );
      }
    }

    const bound = memberMfaBoundSchema.safeParse(boundPayload);
    if (!bound.success || bound.data.operationId !== start.operationId) {
      try {
        return await reconcileBinding();
      } catch (error) {
        throw new AuthGatewayError(
          'member_mfa_cleanup_uncertain',
          'Authenticator binding could not be confirmed. Sign in again to resume safely.',
          { cause: error },
        );
      }
    }
    start.operationVersion = bound.data.operationVersion;
    return preparation;
  }

  async verifyMemberTotp(factorId: string, code: string): Promise<void> {
    await this.verifyAdminTotp(factorId, code);
  }

  async completeMemberMfaEnrollment(
    start: MemberMfaStart,
    idempotencyKey: string,
  ): Promise<MemberMfaComplete> {
    const parsed = memberMfaCompleteSchema.safeParse(
      await this.invokeMemberMfa({
        action: 'complete',
        operationId: start.operationId,
        expectedVersion: start.operationVersion,
        idempotencyKey,
      }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_mfa_state_conflict',
        'Authenticator readiness could not be confirmed.',
      );
    }
    return parsed.data;
  }

  async cancelMemberMfaEnrollment(
    start: MemberMfaStart,
    factorId: string | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      await this.invokeMemberMfa({
        action: 'cancel',
        operationId: start.operationId,
        expectedVersion: start.operationVersion,
        factorId,
        idempotencyKey,
      });
    } finally {
      try {
        await this.client.auth.signOut({ scope: 'local' });
      } catch {
        // The UI still clears all enrollment material and fails closed.
      }
    }
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
