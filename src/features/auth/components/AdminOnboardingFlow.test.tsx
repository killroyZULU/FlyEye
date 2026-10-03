import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AdminOnboardingComplete,
  AdminOnboardingStart,
  TotpPreparation,
} from '../admin-onboarding';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, deny) => {
    resolve = accept;
    reject = deny;
  });
  return { promise, resolve, reject };
}

const enrollment: TotpPreparation = {
  kind: 'enrollment',
  factorId: '60000000-0000-4000-8000-000000000001',
  qrSvg: syntheticQrSvg,
  manualSecret: syntheticManualSecret,
};

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

  it.each(['rate-limit', 'unknown'] as const)(
    'maps %s preparation failure to safe, focused guidance',
    async (kind) => {
      const error =
        kind === 'rate-limit'
          ? new AuthGatewayError('rate_limited', 'Wait before trying again.')
          : new Error('private-provider-details');
      const api = gateway({ prepareAdminTotp: vi.fn().mockRejectedValue(error) });
      render(
        <AdminOnboardingFlow
          gateway={api}
          start={start}
          onCompleted={vi.fn()}
          onCancelled={vi.fn()}
        />,
      );
      const heading = await screen.findByRole('heading', {
        name: kind === 'rate-limit' ? 'Wait before trying again' : 'Onboarding is blocked',
      });
      await waitFor(() => expect(heading).toHaveFocus());
      expect(document.body.textContent).not.toContain('private-provider-details');
      expect(api.completeAdminOnboarding).not.toHaveBeenCalled();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the QR image cannot be created', async () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      throw new Error('private-image-error');
    });
    const api = gateway();
    render(
      <AdminOnboardingFlow
        gateway={api}
        start={start}
        onCompleted={vi.fn()}
        onCancelled={vi.fn()}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Authenticator enrollment could not be prepared safely.',
    );
    expect(document.body.textContent).not.toContain(syntheticManualSecret);
    expect(document.body.textContent).not.toContain('private-image-error');
    expect(api.verifyAdminTotp).not.toHaveBeenCalled();
    expect(api.completeAdminOnboarding).not.toHaveBeenCalled();
  });

  it('validates the six-digit input before contacting the gateway and permits a valid retry', async () => {
    const api = gateway({
      verifyAdminTotp: vi
        .fn()
        .mockRejectedValueOnce(new AuthGatewayError('mfa_invalid', 'Try another code.'))
        .mockResolvedValue(undefined),
    });
    const onCompleted = vi.fn();
    const user = userEvent.setup();
    render(
      <AdminOnboardingFlow
        gateway={api}
        start={start}
        onCompleted={onCompleted}
        onCancelled={vi.fn()}
      />,
    );
    const code = await screen.findByLabelText('Verification code');
    await user.type(code, '12');
    await user.click(screen.getByRole('button', { name: 'Verify and create administrator' }));
    await waitFor(() => expect(code).toHaveFocus());
    expect(api.verifyAdminTotp).not.toHaveBeenCalled();
    await user.type(code, 'a34567');
    expect(code).toHaveValue('123456');
    await user.click(screen.getByRole('button', { name: 'Verify and create administrator' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try another code.');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(api.completeAdminOnboarding).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Verify and create administrator' }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(complete));
    expect(api.prepareAdminTotp).toHaveBeenCalledOnce();
    expect(api.verifyAdminTotp).toHaveBeenNthCalledWith(2, enrollment.factorId, '123456');
    expect(api.completeAdminOnboarding).toHaveBeenCalledWith(
      start,
      expect.stringMatching(/^[0-9a-f]{32}$/),
    );
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores preparation %s after unmount without creating a credential URL',
    async (outcome) => {
      const pending = deferred<TotpPreparation>();
      const api = gateway({ prepareAdminTotp: vi.fn().mockReturnValue(pending.promise) });
      const onCompleted = vi.fn();
      const view = render(
        <AdminOnboardingFlow
          gateway={api}
          start={start}
          onCompleted={onCompleted}
          onCancelled={vi.fn()}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        'Confirming the current factor inventory',
      );
      view.unmount();
      await act(async () => {
        if (outcome === 'resolve') pending.resolve(enrollment);
        else pending.reject(new Error('private-provider-details'));
        await pending.promise.catch(() => undefined);
      });
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(api.completeAdminOnboarding).not.toHaveBeenCalled();
      expect(onCompleted).not.toHaveBeenCalled();
    },
  );

  it('ignores a superseded enrollment response after switching to a verified-factor challenge', async () => {
    const pending = deferred<TotpPreparation>();
    const api = gateway({
      prepareAdminTotp: vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce({ kind: 'challenge', factorId: 'verified-factor' }),
    });
    const props = { gateway: api, start, onCompleted: vi.fn(), onCancelled: vi.fn() };
    const view = render(<AdminOnboardingFlow {...props} />);
    view.rerender(
      <AdminOnboardingFlow {...props} start={{ ...start, factorState: 'challenge_required' }} />,
    );
    await screen.findByRole('heading', { name: 'Verify your authenticator' });
    await act(async () => {
      pending.resolve(enrollment);
      await pending.promise;
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByAltText('Authenticator setup QR code')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and create administrator' }));
    await waitFor(() =>
      expect(api.verifyAdminTotp).toHaveBeenCalledWith('verified-factor', '123456'),
    );
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores verification %s after unmount',
    async (outcome) => {
      const pending = deferred<void>();
      const api = gateway({ verifyAdminTotp: vi.fn().mockReturnValue(pending.promise) });
      const onCompleted = vi.fn();
      const user = userEvent.setup();
      const view = render(
        <AdminOnboardingFlow
          gateway={api}
          start={start}
          onCompleted={onCompleted}
          onCancelled={vi.fn()}
        />,
      );
      await user.type(await screen.findByLabelText('Verification code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify and create administrator' }));
      expect(screen.getByRole('button', { name: 'Verifying code…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel and sign out' })).toBeDisabled();
      expect(screen.getByLabelText('Verification code')).toBeDisabled();
      view.unmount();
      await act(async () => {
        if (outcome === 'resolve') pending.resolve();
        else pending.reject(new Error('private-provider-details'));
        await pending.promise.catch(() => undefined);
      });
      expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
      expect(api.completeAdminOnboarding).not.toHaveBeenCalled();
      expect(onCompleted).not.toHaveBeenCalled();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'ignores completion %s after unmount',
    async (outcome) => {
      const pending = deferred<AdminOnboardingComplete>();
      const api = gateway({ completeAdminOnboarding: vi.fn().mockReturnValue(pending.promise) });
      const onCompleted = vi.fn();
      const user = userEvent.setup();
      const view = render(
        <AdminOnboardingFlow
          gateway={api}
          start={start}
          onCompleted={onCompleted}
          onCancelled={vi.fn()}
        />,
      );
      await user.type(await screen.findByLabelText('Verification code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify and create administrator' }));
      await screen.findByRole('button', { name: 'Creating administrator…' });
      expect(screen.queryByAltText('Authenticator setup QR code')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Verification code')).toHaveValue('');
      view.unmount();
      await act(async () => {
        if (outcome === 'resolve') pending.resolve(complete);
        else pending.reject(new Error('private-provider-details'));
        await pending.promise.catch(() => undefined);
      });
      expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
      expect(onCompleted).not.toHaveBeenCalled();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'clears credentials before cancellation settles by %s',
    async (outcome) => {
      const pending = deferred<void>();
      const api = gateway({ cancelAdminOnboarding: vi.fn().mockReturnValue(pending.promise) });
      const onCancelled = vi.fn();
      const onCompleted = vi.fn();
      const user = userEvent.setup();
      render(
        <AdminOnboardingFlow
          gateway={api}
          start={start}
          onCompleted={onCompleted}
          onCancelled={onCancelled}
        />,
      );
      await user.click(await screen.findByRole('button', { name: 'Show manual setup key' }));
      await user.type(screen.getByLabelText('Verification code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Cancel and sign out' }));
      expect(onCancelled).not.toHaveBeenCalled();
      expect(screen.queryByText(syntheticManualSecret)).not.toBeInTheDocument();
      expect(screen.queryByAltText('Authenticator setup QR code')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Verification code')).toHaveValue('');
      expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
      await act(async () => {
        if (outcome === 'resolve') pending.resolve();
        else pending.reject(new Error('private-provider-details'));
        await pending.promise.catch(() => undefined);
      });
      expect(onCancelled).toHaveBeenCalledOnce();
      expect(onCompleted).not.toHaveBeenCalled();
      expect(api.completeAdminOnboarding).not.toHaveBeenCalled();
    },
  );
});
