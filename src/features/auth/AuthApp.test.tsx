import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccessContextResponse, RoleCode } from '../../lib/access-context';
import { AircraftDocumentError, type AircraftDocumentGateway } from '../aircraft';
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
  permissions: string[] = [
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

  it.each([false, true])(
    'ignores late MFA-assurance rejection after sign-out (new session: %s)',
    async (newSession) => {
      let rejectAssurance: ((reason: Error) => void) | undefined;
      let signedOutCallback: (() => void) | undefined;
      const loadAccessContext = vi
        .fn()
        .mockResolvedValueOnce(context('admin'))
        .mockResolvedValue(context('student_pilot'));
      const subject = gateway({
        hasSession: vi.fn().mockResolvedValue(true),
        loadAccessContext,
        getMfaAssurance: vi.fn<AuthGateway['getMfaAssurance']>(
          () =>
            new Promise((_resolve, reject) => {
              rejectAssurance = reject;
            }),
        ),
        onSignedOut: vi.fn((callback: () => void) => {
          signedOutCallback = callback;
          return () => undefined;
        }),
      });
      render(<AuthApp gateway={subject} />);
      await waitFor(() => expect(subject.getMfaAssurance).toHaveBeenCalledTimes(1));
      await act(async () => {
        signedOutCallback?.();
        await Promise.resolve();
      });
      await screen.findByRole('heading', { name: 'Sign in to FlyEye' });
      if (newSession) {
        const user = userEvent.setup();
        await user.type(screen.getByLabelText('Email address'), 'student@example.test');
        await user.type(screen.getByLabelText('Password'), 'NotARealPassword1!');
        await user.click(screen.getByRole('button', { name: 'Sign in securely' }));
        await screen.findByRole('heading', { name: 'Student dashboard' });
      }
      await act(async () => {
        rejectAssurance?.(new Error('Synthetic late assurance failure'));
        await Promise.resolve();
      });
      expect(
        screen.getByRole('heading', {
          name: newSession ? 'Student dashboard' : 'Sign in to FlyEye',
        }),
      ).toBeInTheDocument();
      expect(screen.queryByText('Synthetic late assurance failure')).not.toBeInTheDocument();
    },
  );

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

  it('revalidates access and removes the shell when aircraft document access is revoked', async () => {
    const user = userEvent.setup();
    const access = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      loadAccessContext: vi
        .fn()
        .mockResolvedValueOnce(
          context('student_pilot', ['portal.student.access', 'aircraft.document.status.read']),
        )
        .mockResolvedValue(context('student_pilot', ['portal.student.access'], 'denied')),
    });
    const documents: AircraftDocumentGateway = {
      listAircraft: vi
        .fn()
        .mockRejectedValue(new AircraftDocumentError('unauthorized', 'Access revoked.')),
      listStatus: vi.fn(),
      detail: vi.fn(),
      history: vi.fn(),
      create: vi.fn(),
      renew: vi.fn(),
      correct: vi.fn(),
      suspend: vi.fn(),
      restore: vi.fn(),
      createCategory: vi.fn(),
      renameCategory: vi.fn(),
      assignCategory: vi.fn(),
      removeCategory: vi.fn(),
      archiveCategory: vi.fn(),
      listNotifications: vi.fn(),
      openNotification: vi.fn(),
      upload: vi.fn(),
      download: vi.fn(),
    };
    render(<AuthApp gateway={access} aircraftDocumentGateway={documents} />);
    const navigation = await screen.findByRole('navigation', { name: 'Primary navigation' });
    expect(
      within(navigation).queryByRole('button', { name: /^Aircraft$/ }),
    ).not.toBeInTheDocument();
    await user.click(within(navigation).getByRole('button', { name: 'Aircraft documents' }));
    expect(
      await screen.findByRole('heading', { name: 'You cannot enter this workspace' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Primary navigation' }),
    ).not.toBeInTheDocument();
    expect(access.loadAccessContext).toHaveBeenCalledTimes(2);
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function emptyContext(): AccessContextResponse {
  return { ...context('student_pilot'), memberships: [], organizationIds: [], decision: 'denied' };
}

const bootstrapGrant = {
  bootstrapGrantId: '30000000-0000-4000-8000-000000000011',
  organizationId: '20000000-0000-4000-8000-000000000011',
  organizationName: 'Synthetic First Admin School',
  grantVersion: 1,
  expiresAt: '2026-07-28T00:30:00Z',
};

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('AuthApp orchestration compatibility', () => {
  it.each(['/auth/forgot-password', '/auth/recovery', '/auth/invitation'])(
    'does not bootstrap workspace access on %s',
    async (path) => {
      window.history.replaceState(null, '', path);
      const subject = gateway();
      render(<AuthApp gateway={subject} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByLabelText('Account access')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Sign in to FlyEye' })).not.toBeInTheDocument();
      expect(subject.loadAccessContext).not.toHaveBeenCalled();
      expect(subject.loadAdminOnboardingStatus).not.toHaveBeenCalled();
      expect(subject.onSignedOut).not.toHaveBeenCalled();
    },
  );

  it('keeps session restoration pending and uses sign-in for an unknown route', async () => {
    window.history.replaceState(null, '', '/unknown');
    const session = deferred<boolean>();
    const subject = gateway({ hasSession: vi.fn(() => session.promise) });
    render(<AuthApp gateway={subject} />);
    expect(screen.getByRole('heading', { name: 'Verifying your session' })).toBeInTheDocument();
    expect(subject.loadAccessContext).not.toHaveBeenCalled();
    await act(async () => {
      session.resolve(false);
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Sign in to FlyEye' })).toBeInTheDocument();
  });

  it.each(['restore', 'access'] as const)(
    'sanitizes %s failure and retries access',
    async (stage) => {
      const subject = gateway({
        hasSession:
          stage === 'restore'
            ? vi.fn().mockRejectedValue(new Error('Private provider detail'))
            : vi.fn().mockResolvedValue(true),
        loadAccessContext:
          stage === 'access'
            ? vi
                .fn()
                .mockRejectedValueOnce(new Error('Private provider detail'))
                .mockResolvedValue(context('student_pilot'))
            : vi.fn().mockResolvedValue(context('student_pilot')),
      });
      render(<AuthApp gateway={subject} />);
      await screen.findByRole('heading', { name: 'Access could not be verified' });
      expect(
        screen.getByText('FlyEye could not verify your access. Try again.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Private provider detail')).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByRole('heading', { name: 'Student dashboard' });
    },
  );

  it('allows an existing membership when onboarding discovery fails', async () => {
    const subject = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      loadAdminOnboardingStatus: vi.fn().mockRejectedValue(new Error('Private discovery detail')),
    });
    render(<AuthApp gateway={subject} />);
    await screen.findByRole('heading', { name: 'Student dashboard' });
    expect(subject.startAdminOnboarding).not.toHaveBeenCalled();
    expect(screen.queryByText('Private discovery detail')).not.toBeInTheDocument();
  });

  it('rejects a membership plus a bootstrap grant as ambiguous', async () => {
    const subject = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      loadAdminOnboardingStatus: vi.fn().mockResolvedValue({ grants: [bootstrapGrant] }),
    });
    render(<AuthApp gateway={subject} />);
    await screen.findByRole('heading', { name: 'Administrator review is required' });
    expect(subject.startAdminOnboarding).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it.each(['admin_onboarding_conflict', 'admin_onboarding_not_available', 'unknown'] as const)(
    'preserves grant-only discovery failure %s',
    async (code) => {
      const subject = gateway({
        hasSession: vi.fn().mockResolvedValue(true),
        loadAccessContext: vi.fn().mockResolvedValue(emptyContext()),
        loadAdminOnboardingStatus: vi
          .fn()
          .mockRejectedValue(new AuthGatewayError(code, 'Safe onboarding failure.')),
      });
      render(<AuthApp gateway={subject} />);
      await screen.findByRole('heading', {
        name:
          code === 'unknown' ? 'Access could not be verified' : 'Administrator review is required',
      });
      expect(screen.getByText('Safe onboarding failure.')).toBeInTheDocument();
      expect(subject.startAdminOnboarding).not.toHaveBeenCalled();
    },
  );

  it.each(['discovery', 'start'] as const)(
    'requires password again when onboarding %s rejects recent authentication',
    async (stage) => {
      const recent = new AuthGatewayError(
        'admin_onboarding_recent_authentication_required',
        'Sign in again for onboarding.',
      );
      const subject = gateway({
        hasSession: vi.fn().mockResolvedValue(true),
        loadAccessContext: vi.fn().mockResolvedValue(emptyContext()),
        loadAdminOnboardingStatus:
          stage === 'discovery'
            ? vi.fn().mockRejectedValue(recent)
            : vi.fn().mockResolvedValue({ grants: [bootstrapGrant] }),
        startAdminOnboarding: vi.fn().mockRejectedValue(recent),
      });
      render(<AuthApp gateway={subject} />);
      await screen.findByRole('heading', { name: 'Sign in to FlyEye' });
      expect(screen.getByText('Sign in again for onboarding.')).toBeInTheDocument();
      expect(subject.signOut).toHaveBeenCalledOnce();
      if (stage === 'start')
        expect(subject.startAdminOnboarding).toHaveBeenCalledWith(bootstrapGrant);
    },
  );

  it.each(['denied', 'mfa_required'] as const)(
    'does not grant student access for %s',
    async (status) => {
      const subject = gateway({
        hasSession: vi.fn().mockResolvedValue(true),
        loadAccessContext: vi
          .fn()
          .mockResolvedValue(context('student_pilot', ['portal.student.access'], status)),
      });
      render(<AuthApp gateway={subject} />);
      await screen.findByRole('heading', {
        name:
          status === 'denied'
            ? 'You cannot enter this workspace'
            : 'Administrator review is required',
      });
      expect(subject.getMfaAssurance).not.toHaveBeenCalled();
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'ignores obsolete restoration %s after gateway replacement and unsubscribes',
    async (outcome) => {
      const session = deferred<boolean>();
      const unsubscribe = vi.fn();
      const oldGateway = gateway({
        hasSession: vi.fn(() => session.promise),
        onSignedOut: vi.fn(() => unsubscribe),
      });
      const freshGateway = gateway({ hasSession: vi.fn().mockResolvedValue(true) });
      const rendered = render(<AuthApp gateway={oldGateway} />);
      rendered.rerender(<AuthApp gateway={freshGateway} />);
      await screen.findByRole('heading', { name: 'Student dashboard' });
      expect(unsubscribe).toHaveBeenCalledOnce();
      await act(async () => {
        if (outcome === 'resolve') session.resolve(true);
        else session.reject(new Error('Obsolete restoration'));
        await Promise.resolve();
      });
      expect(oldGateway.loadAccessContext).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: 'Student dashboard' })).toBeInTheDocument();
      expect(screen.queryByText('Obsolete restoration')).not.toBeInTheDocument();
    },
  );

  it('ignores onboarding start completion after session revocation', async () => {
    const start = deferred<Awaited<ReturnType<AuthGateway['startAdminOnboarding']>>>();
    let signedOut: (() => void) | undefined;
    const subject = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      loadAccessContext: vi.fn().mockResolvedValue(emptyContext()),
      loadAdminOnboardingStatus: vi.fn().mockResolvedValue({ grants: [bootstrapGrant] }),
      startAdminOnboarding: vi.fn(() => start.promise),
      onSignedOut: vi.fn((callback: () => void) => {
        signedOut = callback;
        return () => undefined;
      }),
    });
    render(<AuthApp gateway={subject} />);
    await waitFor(() => expect(subject.startAdminOnboarding).toHaveBeenCalledOnce());
    await act(async () => {
      signedOut?.();
      start.resolve({
        ...bootstrapGrant,
        decision: 'ready',
        replayed: false,
        correlationId: '30000000-0000-4000-8000-000000000012',
        factorState: 'challenge_required',
      });
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Sign in to FlyEye' })).toBeInTheDocument();
    expect(subject.prepareAdminTotp).not.toHaveBeenCalled();
  });

  it('preserves profile navigation, explicit sign-out and subscription cleanup', async () => {
    const unsubscribe = vi.fn();
    const subject = gateway({
      hasSession: vi.fn().mockResolvedValue(true),
      onSignedOut: vi.fn(() => unsubscribe),
      loadMyMemberProfile: vi.fn().mockResolvedValue({
        membershipId: '10000000-0000-4000-8000-000000000001',
        displayName: 'Synthetic Student',
        contactNumber: null,
        profileComplete: true,
        membershipVersion: 1,
      }),
    });
    const rendered = render(<AuthApp gateway={subject} />);
    const navigation = await screen.findByRole('navigation', { name: 'Primary navigation' });
    const user = userEvent.setup();
    await user.click(within(navigation).getByRole('button', { name: 'My profile' }));
    await screen.findByDisplayValue('Synthetic Student');
    expect(within(navigation).getByRole('button', { name: 'My profile' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(screen.getByRole('button', { name: 'Back to workspace' }));
    await screen.findByRole('heading', { name: 'Student dashboard' });
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in to FlyEye' });
    expect(subject.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    rendered.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
