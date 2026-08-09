import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminOnboardingComplete, AdminOnboardingStart } from '../admin-onboarding';
import { AuthGatewayError, type AuthGateway } from '../services/auth-gateway';
import { AdminOnboardingFlow } from './AdminOnboardingFlow';

/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies injected gateway mocks. */

const start: AdminOnboardingStart = {
  decision: 'ready',
  bootstrapGrantId: '30000000-0000-4000-8000-000000000001',
  organizationId: '40000000-0000-4000-8000-000000000001',
  organizationName: 'Synthetic Flight School',
  grantVersion: 1,
  replayed: false,
  correlationId: '70000000-0000-4000-8000-000000000001',
  factorState: 'enrollment_required',
};

const complete: AdminOnboardingComplete = {
  decision: 'completed',
  bootstrapGrantId: start.bootstrapGrantId,
  organizationId: start.organizationId,
  organizationName: start.organizationName,
  membershipId: '50000000-0000-4000-8000-000000000001',
  grantVersion: 2,
  correlationId: '70000000-0000-4000-8000-000000000002',
};

const syntheticManualSecret = 'A'.repeat(16);
const syntheticQrSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect x="0" y="0" width="1" height="1"/></svg>';

function gateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    hasSession: vi.fn().mockResolvedValue(true),
    signIn: vi.fn().mockResolvedValue(undefined),
    requestPasswordRecovery: vi.fn().mockResolvedValue(undefined),
    verifyRecoveryCredential: vi.fn().mockResolvedValue(undefined),
    updateRecoveredPassword: vi.fn().mockResolvedValue(undefined),
    signOutEverywhere: vi.fn().mockResolvedValue(undefined),
    loadAccessContext: vi.fn(),
    loadAdminOnboardingStatus: vi.fn(),
    startAdminOnboarding: vi.fn(),
    prepareAdminTotp: vi.fn().mockResolvedValue({
      kind: 'enrollment',
      factorId: '60000000-0000-4000-8000-000000000001',
      qrSvg: syntheticQrSvg,
      manualSecret: syntheticManualSecret,
    }),
    verifyAdminTotp: vi.fn().mockResolvedValue(undefined),
    completeAdminOnboarding: vi.fn().mockResolvedValue(complete),
    cancelAdminOnboarding: vi.fn().mockResolvedValue(undefined),
    loadMemberInvitations: vi.fn(),
    createMemberInvitation: vi.fn(),
    resendMemberInvitation: vi.fn(),
    revokeMemberInvitation: vi.fn(),
    prepareInvitationCredential: vi.fn(),
    acceptMemberInvitation: vi.fn(),
    getMfaAssurance: vi.fn(),
    verifyTotp: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    onSignedOut: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

describe('FEAT-003 administrator onboarding UI', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:flyeye-synthetic-qr');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('supports keyboard-accessible secret reveal, paste, verification, and completion', async () => {
    let resolveCompletion!: (result: AdminOnboardingComplete) => void;
    const completion = new Promise<AdminOnboardingComplete>((resolve) => {
      resolveCompletion = resolve;
    });
    const gatewayUnderTest = gateway({
      completeAdminOnboarding: vi.fn().mockReturnValue(completion),
    });
    const onCompleted = vi.fn();
    const user = userEvent.setup();

    render(
      <StrictMode>
        <AdminOnboardingFlow
          gateway={gatewayUnderTest}
          start={start}
          onCompleted={onCompleted}
          onCancelled={vi.fn()}
        />
      </StrictMode>,
    );

    const heading = await screen.findByRole('heading', { name: 'Set up your authenticator' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(gatewayUnderTest.prepareAdminTotp).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText('Authenticator setup QR code')).toHaveAttribute(
      'src',
      'blob:flyeye-synthetic-qr',
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    const qrBlob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0];
    expect(qrBlob).toBeInstanceOf(Blob);
    expect((qrBlob as Blob).type).toBe('image/svg+xml;charset=utf-8');
    expect(document.body.innerHTML).not.toContain(syntheticQrSvg);
    expect(screen.queryByText(syntheticManualSecret)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show manual setup key' }));
    expect(screen.getByText(syntheticManualSecret)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Verification code'));
    await user.paste('123456');
    await user.click(screen.getByRole('button', { name: 'Verify and create administrator' }));

    await waitFor(() => expect(gatewayUnderTest.verifyAdminTotp).toHaveBeenCalled());
    expect(screen.queryByText(syntheticManualSecret)).not.toBeInTheDocument();
    expect(
      screen.getByText('The first administrator transaction is being completed.'),
    ).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:flyeye-synthetic-qr');

    resolveCompletion(complete);
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(complete));
  });

  it('keeps invalid TOTP retryable without completing authority', async () => {
    const gatewayUnderTest = gateway({
      prepareAdminTotp: vi.fn().mockResolvedValue({
        kind: 'challenge',
        factorId: '60000000-0000-4000-8000-000000000001',
      }),
      verifyAdminTotp: vi
        .fn()
        .mockRejectedValue(new AuthGatewayError('mfa_invalid', 'The code is invalid.')),
    });
    const user = userEvent.setup();
    render(
      <AdminOnboardingFlow
        gateway={gatewayUnderTest}
        start={{ ...start, factorState: 'challenge_required' }}
        onCompleted={vi.fn()}
        onCancelled={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and create administrator' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The code is invalid.');
    await waitFor(() => expect(screen.getByLabelText('Verification code')).toHaveFocus());
    expect(gatewayUnderTest.completeAdminOnboarding).not.toHaveBeenCalled();
  });

  it('uses safe cancellation and always returns control to the signed-out route', async () => {
    const gatewayUnderTest = gateway({
      cancelAdminOnboarding: vi
        .fn()
        .mockRejectedValue(
          new AuthGatewayError(
            'admin_onboarding_limiter_unavailable',
            'Server cancellation could not be confirmed.',
          ),
        ),
    });
    const onCancelled = vi.fn();
    const user = userEvent.setup();
    render(
      <AdminOnboardingFlow
        gateway={gatewayUnderTest}
        start={start}
        onCompleted={vi.fn()}
        onCancelled={onCancelled}
      />,
    );

    await screen.findByRole('heading', { name: 'Set up your authenticator' });
    await user.click(screen.getByRole('button', { name: 'Cancel and sign out' }));

    await waitFor(() => expect(onCancelled).toHaveBeenCalledOnce());
    expect(gatewayUnderTest.cancelAdminOnboarding).toHaveBeenCalledWith(
      start.bootstrapGrantId,
      expect.stringMatching(/^[0-9a-f]{32}$/),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:flyeye-synthetic-qr');
  });

  it('revokes the QR image URL on terminal failure and unmount', async () => {
    const terminalGateway = gateway({
      verifyAdminTotp: vi
        .fn()
        .mockRejectedValue(
          new AuthGatewayError(
            'admin_onboarding_provider_unavailable',
            'Authenticator verification is unavailable.',
          ),
        ),
    });
    const user = userEvent.setup();
    const rendered = render(
      <AdminOnboardingFlow
        gateway={terminalGateway}
        start={start}
        onCompleted={vi.fn()}
        onCancelled={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and create administrator' }));

    expect(
      await screen.findByRole('heading', { name: 'Onboarding is blocked' }),
    ).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:flyeye-synthetic-qr');

    vi.mocked(URL.revokeObjectURL).mockClear();
    rendered.unmount();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('revokes an active QR image URL when the flow unmounts', async () => {
    const rendered = render(
      <AdminOnboardingFlow
        gateway={gateway()}
        start={start}
        onCompleted={vi.fn()}
        onCancelled={vi.fn()}
      />,
    );

    await screen.findByRole('heading', { name: 'Set up your authenticator' });
    rendered.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:flyeye-synthetic-qr');
  });
});
