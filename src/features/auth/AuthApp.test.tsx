import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AccessContextResponse, RoleCode } from '../../lib/access-context';
import { AuthApp } from './AuthApp';
import { AuthGatewayError, type AuthGateway } from './services/auth-gateway';

/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies injected gateway mocks. */

const rolePermission = {
  student_pilot: 'portal.student.access',
  instructor_pilot: 'portal.instructor.access',
  admin: 'portal.admin.access',
} as const;

function context(
  role: RoleCode,
  permissions = [
    rolePermission[role as keyof typeof rolePermission] ?? 'portal.future_role.access',
  ],
  accessStatus: 'granted' | 'mfa_required' | 'denied' = role === 'student_pilot'
    ? 'granted'
    : 'mfa_required',
): AccessContextResponse {
  const organizationId = '20000000-0000-4000-8000-000000000001';
  const workspacePermission =
    rolePermission[role as keyof typeof rolePermission] ?? 'portal.future_role.access';
  return {
    memberships: [
      {
        membershipId: '10000000-0000-4000-8000-000000000001',
        organizationId,
        organizationName: 'Synthetic Flight School',
        role,
        roleLabel:
          role === 'student_pilot'
            ? 'Student Pilot'
            : role === 'instructor_pilot'
              ? 'Instructor Pilot'
              : role === 'admin'
                ? 'Organization Admin'
                : 'Future Role',
        workspacePermission,
        permissions,
        membershipVersion: 1,
        requiredAssuranceLevel: role === 'student_pilot' ? 'aal1' : 'aal2',
        accessStatus,
      },
    ],
    correlationId: '30000000-0000-4000-8000-000000000001',
    decision: accessStatus,
    currentAssuranceLevel: accessStatus === 'granted' && role !== 'student_pilot' ? 'aal2' : 'aal1',
    selectedOrganizationId: null,
    organizationIds: [organizationId],
  };
}

function gateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    hasSession: vi.fn().mockResolvedValue(false),
    signIn: vi.fn().mockResolvedValue(undefined),
    requestPasswordRecovery: vi.fn().mockResolvedValue(undefined),
    verifyRecoveryCredential: vi.fn().mockResolvedValue(undefined),
    updateRecoveredPassword: vi.fn().mockResolvedValue(undefined),
    signOutEverywhere: vi.fn().mockResolvedValue(undefined),
    loadAccessContext: vi.fn().mockResolvedValue(context('student_pilot')),
    loadAdminOnboardingStatus: vi.fn().mockResolvedValue({
      grants: [],
      correlationId: '30000000-0000-4000-8000-000000000010',
    }),
    startAdminOnboarding: vi.fn(),
    prepareAdminTotp: vi.fn(),
    verifyAdminTotp: vi.fn(),
    completeAdminOnboarding: vi.fn(),
    cancelAdminOnboarding: vi.fn().mockResolvedValue(undefined),
    loadMemberMfaStatus: vi.fn().mockResolvedValue({
      decision: 'available',
      organizationId: '20000000-0000-4000-8000-000000000001',
      organizationName: 'Synthetic Flight School',
      membershipId: '10000000-0000-4000-8000-000000000001',
      ready: false,
      factorState: 'enrollment_required',
      correlationId: '30000000-0000-4000-8000-000000000020',
    }),
    startMemberMfaEnrollment: vi.fn(),
    prepareMemberTotp: vi.fn(),
    verifyMemberTotp: vi.fn(),
    completeMemberMfaEnrollment: vi.fn(),
    cancelMemberMfaEnrollment: vi.fn(),
    loadMemberInvitations: vi.fn(),
    createMemberInvitation: vi.fn(),
    resendMemberInvitation: vi.fn(),
    revokeMemberInvitation: vi.fn(),
    prepareInvitationCredential: vi.fn(),
    acceptMemberInvitation: vi.fn(),
    loadOrganizationMembers: vi.fn(),
    loadOrganizationMember: vi.fn(),
    loadMyMemberProfile: vi.fn(),
    updateMyMemberProfile: vi.fn(),
    changeOrganizationMemberStatus: vi.fn(),
    changeOrganizationMemberRole: vi.fn(),
    getMfaAssurance: vi.fn().mockResolvedValue({ currentLevel: 'aal1', nextLevel: 'aal2' }),
    verifyTotp: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    onSignedOut: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

async function signIn(gatewayUnderTest: AuthGateway) {
  const user = userEvent.setup();
  render(<AuthApp gateway={gatewayUnderTest} />);
  await screen.findByRole('heading', { name: 'Sign in to FlyEye' });
  await user.type(screen.getByLabelText('Email address'), 'student@example.test');
  await user.type(screen.getByLabelText('Password'), 'NotARealPassword1!');
  await user.click(screen.getByRole('button', { name: 'Sign in securely' }));
  return user;
}

describe('FEAT-001 authentication UI', () => {
  it('signs in an active student and shows the success state', async () => {
    const gatewayUnderTest = gateway();

    await signIn(gatewayUnderTest);

    expect(await screen.findByRole('heading', { name: 'Student dashboard' })).toBeInTheDocument();
    expect(screen.getAllByText('Synthetic Flight School')).toHaveLength(2);
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByLabelText('FlyEye introduction')).not.toBeInTheDocument();
    expect(screen.queryByText('Secure school access')).not.toBeInTheDocument();
    expect(gatewayUnderTest.signIn).toHaveBeenCalledWith({
      email: 'student@example.test',
      password: 'NotARealPassword1!',
    });
  });

  it('shows a non-enumerating authentication error', async () => {
    const gatewayUnderTest = gateway({
      signIn: vi
        .fn()
        .mockRejectedValue(
          new AuthGatewayError(
            'invalid_credentials',
            'The email or password is incorrect, or access is unavailable.',
          ),
        ),
    });

    await signIn(gatewayUnderTest);

    expect(
      await screen.findByText('The email or password is incorrect, or access is unavailable.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/account does not exist/i)).not.toBeInTheDocument();
  });

  it('shows the empty state when no active membership exists', async () => {
    const gatewayUnderTest = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      loadAccessContext: vi.fn().mockResolvedValue({
        memberships: [],
        correlationId: '30000000-0000-4000-8000-000000000001',
        decision: 'denied',
        currentAssuranceLevel: 'aal1',
        selectedOrganizationId: null,
        organizationIds: [],
      }),
    });

    render(<AuthApp gateway={gatewayUnderTest} />);

    expect(
      await screen.findByRole('heading', { name: 'Your account is not assigned' }),
    ).toBeInTheDocument();
  });

  it('requires MFA for an instructor before showing success', async () => {
    const loadAccessContext = vi
      .fn()
      .mockResolvedValueOnce(context('instructor_pilot'))
      .mockResolvedValueOnce(context('instructor_pilot', ['portal.instructor.access'], 'granted'));
    const gatewayUnderTest = gateway({
      loadAccessContext,
    });
    const user = await signIn(gatewayUnderTest);

    expect(
      await screen.findByRole('heading', { name: 'Verify your identity' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(
      await screen.findByRole('heading', { name: 'Instructor dashboard' }),
    ).toBeInTheDocument();
    expect(gatewayUnderTest.verifyTotp).toHaveBeenCalledWith('123456');
    expect(loadAccessContext).toHaveBeenLastCalledWith();
  });

  it('routes a privileged member without TOTP to self-service enrollment', async () => {
    const gatewayUnderTest = gateway({
      loadAccessContext: vi.fn().mockResolvedValue(context('admin')),
      getMfaAssurance: vi.fn().mockResolvedValue({ currentLevel: 'aal1', nextLevel: 'aal1' }),
    });

    await signIn(gatewayUnderTest);

    expect(
      await screen.findByRole('heading', { name: 'Set up an authenticator' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Begin secure setup' })).toBeInTheDocument();
    expect(gatewayUnderTest.loadMemberMfaStatus).toHaveBeenCalledOnce();
  });

  it('does not show success when membership is revoked while MFA is completing', async () => {
    const loadAccessContext = vi
      .fn()
      .mockResolvedValueOnce(context('instructor_pilot'))
      .mockResolvedValueOnce({
        memberships: [],
        correlationId: '30000000-0000-4000-8000-000000000002',
        decision: 'denied',
        currentAssuranceLevel: 'aal2',
        selectedOrganizationId: null,
        organizationIds: [],
      } satisfies AccessContextResponse);
    const gatewayUnderTest = gateway({ loadAccessContext });
    const user = await signIn(gatewayUnderTest);
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(
      await screen.findByRole('heading', { name: 'Your account is not assigned' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Instructor dashboard' })).not.toBeInTheDocument();
  });

  it('blocks a role that lacks its required permission', async () => {
    const gatewayUnderTest = gateway({
      loadAccessContext: vi.fn().mockResolvedValue(context('admin', [])),
    });

    await signIn(gatewayUnderTest);

    expect(
      await screen.findByRole('heading', { name: 'You cannot enter this workspace' }),
    ).toBeInTheDocument();
  });

  it('shows a conflict for duplicate organization contexts', async () => {
    const duplicateContext = context('student_pilot');
    duplicateContext.memberships.push({
      ...duplicateContext.memberships[0]!,
      membershipId: '10000000-0000-4000-8000-000000000002',
    });
    const gatewayUnderTest = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      loadAccessContext: vi.fn().mockResolvedValue(duplicateContext),
    });

    render(<AuthApp gateway={gatewayUnderTest} />);

    expect(
      await screen.findByRole('heading', { name: 'Administrator review is required' }),
    ).toBeInTheDocument();
  });

  it('fails closed instead of offering multiple school contexts', async () => {
    const multiOrganizationContext = context('student_pilot');
    multiOrganizationContext.memberships.push({
      membershipId: '10000000-0000-4000-8000-000000000002',
      organizationId: '20000000-0000-4000-8000-000000000002',
      organizationName: 'Second Synthetic School',
      role: 'student_pilot',
      roleLabel: 'Student Pilot',
      workspacePermission: 'portal.student.access',
      permissions: ['portal.student.access'],
      membershipVersion: 1,
      requiredAssuranceLevel: 'aal1',
      accessStatus: 'granted',
    });
    multiOrganizationContext.organizationIds.push('20000000-0000-4000-8000-000000000002');
    const gatewayUnderTest = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      loadAccessContext: vi.fn().mockResolvedValue(multiOrganizationContext),
    });
    render(<AuthApp gateway={gatewayUnderTest} />);

    expect(
      await screen.findByRole('heading', { name: 'Administrator review is required' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Second Synthetic School')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Second Synthetic School/i }),
    ).not.toBeInTheDocument();
  });

  it('routes a grant-only account into first-administrator onboarding', async () => {
    const bootstrapGrantId = '30000000-0000-4000-8000-000000000011';
    const organizationId = '20000000-0000-4000-8000-000000000011';
    const startAdminOnboarding = vi.fn().mockResolvedValue({
      decision: 'ready',
      bootstrapGrantId,
      organizationId,
      organizationName: 'Synthetic First Admin School',
      grantVersion: 1,
      replayed: false,
      correlationId: '30000000-0000-4000-8000-000000000012',
      factorState: 'challenge_required',
    });
    const gatewayUnderTest = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      loadAccessContext: vi.fn().mockResolvedValue({
        memberships: [],
        correlationId: '30000000-0000-4000-8000-000000000013',
        decision: 'denied',
        currentAssuranceLevel: 'aal1',
        selectedOrganizationId: null,
        organizationIds: [],
      }),
      loadAdminOnboardingStatus: vi.fn().mockResolvedValue({
        grants: [
          {
            bootstrapGrantId,
            organizationId,
            organizationName: 'Synthetic First Admin School',
            grantVersion: 1,
            expiresAt: '2026-07-28T00:30:00Z',
          },
        ],
        correlationId: '30000000-0000-4000-8000-000000000014',
      }),
      startAdminOnboarding,
      prepareAdminTotp: vi.fn().mockResolvedValue({
        kind: 'challenge',
        factorId: '60000000-0000-4000-8000-000000000011',
      }),
    });

    render(<AuthApp gateway={gatewayUnderTest} />);

    expect(
      await screen.findByRole('heading', { name: 'Verify your authenticator' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Synthetic First Admin School')).toBeInTheDocument();
    expect(startAdminOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({ bootstrapGrantId, organizationId }),
    );
  });

  it('returns to sign in when the session is revoked', async () => {
    let signedOutCallback: (() => void) | undefined;
    const gatewayUnderTest = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      onSignedOut: vi.fn((callback: () => void) => {
        signedOutCallback = callback;
        return () => undefined;
      }),
    });
    render(<AuthApp gateway={gatewayUnderTest} />);
    await screen.findByRole('heading', { name: 'Student dashboard' });

    await act(async () => {
      signedOutCallback?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in to FlyEye' })).toBeInTheDocument();
    });
  });

  it('does not restore success when access loading resolves after sign-out', async () => {
    let resolveAccess: ((value: AccessContextResponse) => void) | undefined;
    let signedOutCallback: (() => void) | undefined;
    const gatewayUnderTest = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      loadAccessContext: vi.fn(
        () => new Promise<AccessContextResponse>((resolve) => (resolveAccess = resolve)),
      ),
      onSignedOut: vi.fn((callback: () => void) => {
        signedOutCallback = callback;
        return () => undefined;
      }),
    });

    render(<AuthApp gateway={gatewayUnderTest} />);
    await screen.findByRole('heading', { name: 'Verifying your session' });
    await act(async () => {
      signedOutCallback?.();
      resolveAccess?.(context('student_pilot'));
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', { name: 'Sign in to FlyEye' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Student dashboard' })).not.toBeInTheDocument();
  });

  it('discards access results after component disposal', async () => {
    let resolveAccess: ((value: AccessContextResponse) => void) | undefined;
    const gatewayUnderTest = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      loadAccessContext: vi.fn(
        () => new Promise<AccessContextResponse>((resolve) => (resolveAccess = resolve)),
      ),
    });
    const rendered = render(<AuthApp gateway={gatewayUnderTest} />);
    await screen.findByRole('heading', { name: 'Verifying your session' });
    rendered.unmount();

    await act(async () => {
      resolveAccess?.(context('student_pilot'));
      await Promise.resolve();
    });

    expect(rendered.container).toBeEmptyDOMElement();
  });

  it('does not restore privileged success when MFA resolves after session revocation', async () => {
    let resolveMfa: (() => void) | undefined;
    let signedOutCallback: (() => void) | undefined;
    const gatewayUnderTest = gateway({
      loadAccessContext: vi.fn().mockResolvedValue(context('admin')),
      verifyTotp: vi.fn(() => new Promise<void>((resolve) => (resolveMfa = resolve))),
      onSignedOut: vi.fn((callback: () => void) => {
        signedOutCallback = callback;
        return () => undefined;
      }),
    });
    const user = await signIn(gatewayUnderTest);
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await act(async () => {
      signedOutCallback?.();
      resolveMfa?.();
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', { name: 'Sign in to FlyEye' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Administration dashboard' }),
    ).not.toBeInTheDocument();
  });
});
