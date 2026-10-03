import type { AccessContextResponse, LoginRequest } from '../../../lib/access-context';
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
