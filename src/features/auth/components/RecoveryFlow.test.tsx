import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
    changeOrganizationMemberRole: vi.fn(),
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
      'Student dashboard',
      'Instructor dashboard',
      'Administration dashboard',
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

function deferredOperation() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function recoveryUrl() {
  window.history.replaceState(
    null,
    '',
    '/auth/recovery?token_hash=synthetic-transition-token-1234567890',
  );
}

function fillRecoveredPassword() {
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'synthetic recovery password' },
  });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'synthetic recovery password' },
  });
  return screen.getByRole('button', { name: 'Change password and end sessions' }).closest('form')!;
}

describe('FEAT-002 recovery transitions', () => {
  it.each(['resolve', 'reject'] as const)(
    'sends one recovery request for concurrent submissions and retains generic acknowledgement on %s',
    async (outcome) => {
      const pending = deferredOperation();
      const request = vi.fn().mockReturnValue(pending.promise);
      render(<RecoveryRequestForm gateway={gateway({ requestPasswordRecovery: request })} />);
      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: 'synthetic@example.test' },
      });
      const form = screen
        .getByRole('button', { name: 'Send recovery instructions' })
        .closest('form')!;
      act(() => {
        fireEvent.submit(form);
        fireEvent.submit(form);
      });
      expect(request).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Email address')).toBeDisabled();
      await act(async () => {
        pending[outcome](new Error('private provider error'));
        await pending.promise.catch(() => undefined);
      });
      expect(screen.getByRole('heading', { name: 'Recovery request received' })).toHaveFocus();
      expect(screen.queryByText('private provider error')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    },
  );

  it('verifies once when confirmation is activated twice before rendering', async () => {
    recoveryUrl();
    const pending = deferredOperation();
    const verify = vi.fn().mockReturnValue(pending.promise);
    render(
      <StrictMode>
        <PasswordRecoveryFlow gateway={gateway({ verifyRecoveryCredential: verify })} />
      </StrictMode>,
    );
    const button = screen.getByRole('button', { name: 'Continue securely' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(screen.getByRole('heading', { name: 'Protect your account' })).toHaveFocus();
  });

  it('submits one password update and cannot restart it while revocation is pending', async () => {
    recoveryUrl();
    const update = deferredOperation();
    const revoke = deferredOperation();
    const gatewayUnderTest = gateway({
      updateRecoveredPassword: vi.fn().mockReturnValue(update.promise),
      signOutEverywhere: vi.fn().mockReturnValue(revoke.promise),
    });
    render(<PasswordRecoveryFlow gateway={gatewayUnderTest} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue securely' }));
    await screen.findByRole('heading', { name: 'Protect your account' });
    const form = fillRecoveredPassword();
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(gatewayUnderTest.updateRecoveredPassword).toHaveBeenCalledTimes(1);
    expect(gatewayUnderTest.signOutEverywhere).not.toHaveBeenCalled();
    await act(async () => {
      update.resolve();
      await update.promise;
    });
    expect(gatewayUnderTest.signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
    fireEvent.submit(form);
    expect(screen.queryByText('Use at least 15 characters.')).not.toBeInTheDocument();
    expect(gatewayUnderTest.updateRecoveredPassword).toHaveBeenCalledTimes(1);
    await act(async () => {
      revoke.resolve();
      await revoke.promise;
    });
    expect(screen.getByRole('heading', { name: 'Your password has changed' })).toHaveFocus();
    expect(gatewayUnderTest.loadAccessContext).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('retries a network verification failure only after another explicit confirmation', async () => {
    recoveryUrl();
    const verify = vi
      .fn()
      .mockRejectedValueOnce(new AuthGatewayError('network_error', 'Connect and retry.'))
      .mockResolvedValueOnce(undefined);
    render(<PasswordRecoveryFlow gateway={gateway({ verifyRecoveryCredential: verify })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue securely' }));
    await screen.findByText('Connect and retry.');
    expect(verify).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Continue securely' }));
    await screen.findByRole('heading', { name: 'Protect your account' });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls[1]).toEqual(verify.mock.calls[0]);
  });

  it('clears rejected password input and permits one explicit corrected retry', async () => {
    recoveryUrl();
    const update = vi
      .fn()
      .mockRejectedValueOnce(new AuthGatewayError('weak_password', 'Choose a stronger password.'))
      .mockResolvedValueOnce(undefined);
    const gatewayUnderTest = gateway({ updateRecoveredPassword: update });
    render(<PasswordRecoveryFlow gateway={gatewayUnderTest} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue securely' }));
    await screen.findByRole('heading', { name: 'Protect your account' });
    fireEvent.submit(fillRecoveredPassword());
    await screen.findByText('Choose a stronger password.');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
    expect(gatewayUnderTest.signOutEverywhere).not.toHaveBeenCalled();
    fireEvent.submit(fillRecoveredPassword());
    await screen.findByRole('heading', { name: 'Your password has changed' });
    expect(update).toHaveBeenCalledTimes(2);
    expect(gatewayUnderTest.signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(gatewayUnderTest.loadAccessContext).not.toHaveBeenCalled();
  });

  it('does not queue offline password updates or automatically submit on reconnection', async () => {
    recoveryUrl();
    let online = true;
    const gatewayUnderTest = gateway();
    const props = { gateway: gatewayUnderTest, isOnline: () => online };
    const view = render(<PasswordRecoveryFlow {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue securely' }));
    await screen.findByRole('heading', { name: 'Protect your account' });
    online = false;
    const form = fillRecoveredPassword();
    fireEvent.submit(form);
    expect(
      screen.getByText('Connect to the internet before changing your password.'),
    ).toBeInTheDocument();
    expect(gatewayUnderTest.updateRecoveredPassword).not.toHaveBeenCalled();
    online = true;
    view.rerender(<PasswordRecoveryFlow {...props} />);
    expect(gatewayUnderTest.updateRecoveredPassword).not.toHaveBeenCalled();
    fireEvent.submit(form);
    await screen.findByRole('heading', { name: 'Your password has changed' });
    expect(gatewayUnderTest.updateRecoveredPassword).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)(
    'does not let a disposed verification %s alter a newer recovery instance',
    async (outcome) => {
      recoveryUrl();
      const pending = deferredOperation();
      const oldGateway = gateway({
        verifyRecoveryCredential: vi
          .fn()
          .mockReturnValueOnce(pending.promise)
          .mockResolvedValueOnce(undefined),
      });
      const old = render(<PasswordRecoveryFlow gateway={oldGateway} />);
      fireEvent.click(screen.getByRole('button', { name: 'Continue securely' }));
      old.unmount();
      recoveryUrl();
      render(<PasswordRecoveryFlow gateway={oldGateway} />);
      fireEvent.click(screen.getByRole('button', { name: 'Continue securely' }));
      await screen.findByRole('heading', { name: 'Protect your account' });
      fillRecoveredPassword();
      await act(async () => {
        pending[outcome](new Error('old verification failed'));
        await pending.promise.catch(() => undefined);
      });
      expect(screen.getByRole('heading', { name: 'Protect your account' })).toBeInTheDocument();
      expect(screen.getByLabelText('New password')).toHaveValue('synthetic recovery password');
      expect(oldGateway.verifyRecoveryCredential).toHaveBeenCalledTimes(2);
      expect(oldGateway.updateRecoveredPassword).not.toHaveBeenCalled();
      expect(oldGateway.loadAccessContext).not.toHaveBeenCalled();
    },
  );

  it('finishes required revocation for an issued password update without changing a newer recovery screen', async () => {
    recoveryUrl();
    const pending = deferredOperation();
    const oldGateway = gateway({
      updateRecoveredPassword: vi.fn().mockReturnValue(pending.promise),
    });
    const old = render(<PasswordRecoveryFlow gateway={oldGateway} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue securely' }));
    await screen.findByRole('heading', { name: 'Protect your account' });
    fireEvent.submit(fillRecoveredPassword());
    old.unmount();
    recoveryUrl();
    render(<PasswordRecoveryFlow gateway={oldGateway} />);
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(oldGateway.signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Continue password recovery?' })).toHaveFocus();
    expect(oldGateway.updateRecoveredPassword).toHaveBeenCalledTimes(1);
    expect(oldGateway.verifyRecoveryCredential).toHaveBeenCalledTimes(1);
    expect(oldGateway.loadAccessContext).not.toHaveBeenCalled();
  });
});
