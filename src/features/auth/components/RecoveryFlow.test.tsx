import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccessContextResponse } from '../../../lib/access-context';
import { AuthGatewayError, type AuthGateway } from '../services/auth-gateway';
import { PasswordRecoveryFlow } from './PasswordRecoveryFlow';
import { RecoveryRequestForm } from './RecoveryRequestForm';

/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies injected gateway mocks. */

const emptyContext: AccessContextResponse = {
  memberships: [],
  correlationId: '30000000-0000-4000-8000-000000000001',
  decision: 'denied',
  currentAssuranceLevel: 'aal1',
  selectedOrganizationId: null,
  organizationIds: [],
};

function gateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    hasSession: vi.fn().mockResolvedValue(false),
    signIn: vi.fn().mockResolvedValue(undefined),
    requestPasswordRecovery: vi.fn().mockResolvedValue(undefined),
    verifyRecoveryCredential: vi.fn().mockResolvedValue(undefined),
    updateRecoveredPassword: vi.fn().mockResolvedValue(undefined),
    signOutEverywhere: vi.fn().mockResolvedValue(undefined),
    loadAccessContext: vi.fn().mockResolvedValue(emptyContext),
    loadAdminOnboardingStatus: vi.fn().mockResolvedValue({
      grants: [],
      correlationId: '30000000-0000-4000-8000-000000000010',
    }),
    startAdminOnboarding: vi.fn(),
    prepareAdminTotp: vi.fn(),
    verifyAdminTotp: vi.fn(),
    completeAdminOnboarding: vi.fn(),
    cancelAdminOnboarding: vi.fn().mockResolvedValue(undefined),
    loadMemberMfaStatus: vi.fn(),
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
    getMfaAssurance: vi.fn().mockResolvedValue({ currentLevel: 'aal1', nextLevel: 'aal1' }),
    verifyTotp: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    onSignedOut: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('FEAT-002 recovery UI', () => {
  it.each([
    ['eligible provider result', vi.fn().mockResolvedValue(undefined)],
    [
      'unknown or failed provider result',
      vi.fn().mockRejectedValue(new Error('provider detail must stay hidden')),
    ],
  ])('shows the same acknowledgement for %s', async (_label, requestPasswordRecovery) => {
    const gatewayUnderTest = gateway({ requestPasswordRecovery });
    const user = userEvent.setup();

    render(<RecoveryRequestForm gateway={gatewayUnderTest} />);
    await user.type(screen.getByLabelText('Email address'), 'USER@EXAMPLE.TEST');
    await user.click(screen.getByRole('button', { name: 'Send recovery instructions' }));

    expect(
      await screen.findByRole('heading', { name: 'Recovery request received' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recovery request received' })).toHaveFocus();
    expect(
      screen.getByText(
        'If an eligible account matches that email, recovery instructions will be sent.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/provider detail/i)).not.toBeInTheDocument();
    expect(requestPasswordRecovery).toHaveBeenCalledWith('user@example.test', undefined);
  });

  it('validates malformed email and blocks offline submission without queueing it', async () => {
    const gatewayUnderTest = gateway();
    const user = userEvent.setup();

    render(<RecoveryRequestForm gateway={gatewayUnderTest} isOnline={() => false} />);
    await user.type(screen.getByLabelText('Email address'), 'invalid');
    await user.click(screen.getByRole('button', { name: 'Send recovery instructions' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Email address'));
    await user.type(screen.getByLabelText('Email address'), 'user@example.test');
    await user.click(screen.getByRole('button', { name: 'Send recovery instructions' }));
    expect(
      screen.getByText('Connect to the internet before requesting password recovery.'),
    ).toBeInTheDocument();
    expect(gatewayUnderTest.requestPasswordRecovery).not.toHaveBeenCalled();
  });

  it('does not consume a recovery credential until explicit confirmation', async () => {
    const gatewayUnderTest = gateway();
    const tokenHash = 'synthetic-token-hash-value-1234567890';
    window.history.replaceState(null, '', `/auth/recovery?token_hash=${tokenHash}`);
    const user = userEvent.setup();

    render(<PasswordRecoveryFlow gateway={gatewayUnderTest} />);

    const confirmationHeading = await screen.findByRole('heading', {
      name: 'Continue password recovery?',
    });
    expect(confirmationHeading).toBeInTheDocument();
    expect(confirmationHeading).toHaveFocus();
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/auth/recovery');
    expect(gatewayUnderTest.verifyRecoveryCredential).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Continue securely' }));
    const passwordHeading = await screen.findByRole('heading', {
      name: 'Protect your account',
    });
    expect(passwordHeading).toBeInTheDocument();
    expect(passwordHeading).toHaveFocus();
    expect(gatewayUnderTest.verifyRecoveryCredential).toHaveBeenCalledWith(tokenHash);
  });

  it('changes the password, globally signs out, and requires fresh sign-in', async () => {
    const gatewayUnderTest = gateway();
    const tokenHash = 'synthetic-token-hash-value-1234567890';
    const password = 'a secure synthetic password';
    window.history.replaceState(null, '', `/auth/recovery?token_hash=${tokenHash}`);
    const user = userEvent.setup();

    render(<PasswordRecoveryFlow gateway={gatewayUnderTest} />);
    await user.click(await screen.findByRole('button', { name: 'Continue securely' }));
    await user.type(screen.getByLabelText('New password'), password);
    await user.type(screen.getByLabelText('Confirm new password'), password);
    await user.click(screen.getByRole('button', { name: 'Change password and end sessions' }));

    const completeHeading = await screen.findByRole('heading', {
      name: 'Your password has changed',
    });
    expect(completeHeading).toBeInTheDocument();
    expect(completeHeading).toHaveFocus();
    expect(gatewayUnderTest.updateRecoveredPassword).toHaveBeenCalledWith(password);
    expect(gatewayUnderTest.signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(gatewayUnderTest.loadAccessContext).not.toHaveBeenCalled();
  });

  it('fails closed and clears recovery state after an unexpected post-change revocation failure', async () => {
    const gatewayUnderTest = gateway({
      signOutEverywhere: vi.fn().mockRejectedValue(new Error('unexpected revocation failure')),
    });
    const password = 'a secure synthetic password';
    window.history.replaceState(
      null,
      '',
      '/auth/recovery?token_hash=synthetic-token-hash-value-1234567890',
    );
    const user = userEvent.setup();

    render(<PasswordRecoveryFlow gateway={gatewayUnderTest} />);
    await user.click(await screen.findByRole('button', { name: 'Continue securely' }));
    await user.type(screen.getByLabelText('New password'), password);
    await user.type(screen.getByLabelText('Confirm new password'), password);
    await user.click(screen.getByRole('button', { name: 'Change password and end sessions' }));

    const failClosedHeading = await screen.findByRole('heading', {
      name: 'Sign in again before continuing',
    });
    expect(failClosedHeading).toBeInTheDocument();
    expect(failClosedHeading).toHaveFocus();
    expect(
      screen.getByText(
        'Your password changed, but session closure could not be confirmed. Sign in again or contact support.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('No FlyEye workspace has been opened.')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Confirm new password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue securely' })).not.toBeInTheDocument();
    expect(gatewayUnderTest.verifyRecoveryCredential).toHaveBeenCalledTimes(1);
    expect(gatewayUnderTest.updateRecoveredPassword).toHaveBeenCalledTimes(1);
    expect(gatewayUnderTest.updateRecoveredPassword).toHaveBeenCalledWith(password);
    expect(gatewayUnderTest.signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(gatewayUnderTest.loadAccessContext).not.toHaveBeenCalled();
    for (const heading of [
      'Student workspace',
      'Instructor workspace',
      'Administration workspace',
    ]) {
      expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    }
  });

  it('uses the same safe invalid state for missing and rejected credentials', async () => {
    window.history.replaceState(null, '', '/auth/recovery');
    const missing = render(<PasswordRecoveryFlow gateway={gateway()} />);
    const missingHeading = await screen.findByRole('heading', {
      name: 'This link cannot be used',
    });
    expect(missingHeading).toBeInTheDocument();
    expect(missingHeading).toHaveFocus();
    missing.unmount();

    window.history.replaceState(
      null,
      '',
      '/auth/recovery?token_hash=synthetic-token-hash-value-1234567890',
    );
    const rejectedGateway = gateway({
      verifyRecoveryCredential: vi
        .fn()
        .mockRejectedValue(new AuthGatewayError('recovery_invalid', 'raw provider detail')),
    });
    const user = userEvent.setup();
    render(<PasswordRecoveryFlow gateway={rejectedGateway} />);
    await user.click(await screen.findByRole('button', { name: 'Continue securely' }));

    const rejectedHeading = await screen.findByRole('heading', {
      name: 'This link cannot be used',
    });
    expect(rejectedHeading).toBeInTheDocument();
    expect(rejectedHeading).toHaveFocus();
    expect(screen.queryByText('raw provider detail')).not.toBeInTheDocument();
  });
});
