import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGatewayError, type AuthGateway } from '../services/auth-gateway';
import { MemberMfaEnrollmentFlow } from './MemberMfaEnrollmentFlow';

/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies injected gateway mocks. */

const status = {
  decision: 'available' as const,
  organizationId: '20000000-0000-4000-8000-000000000001',
  organizationName: 'Synthetic Flight School',
  membershipId: '10000000-0000-4000-8000-000000000001',
  ready: false,
  factorState: 'enrollment_required' as const,
  correlationId: '30000000-0000-4000-8000-000000000001',
};

const start = {
  decision: 'ready' as const,
  operationId: '40000000-0000-4000-8000-000000000001',
  organizationId: status.organizationId,
  organizationName: status.organizationName,
  membershipId: status.membershipId,
  operationVersion: 1,
  replayed: false,
  factorState: 'enrollment_required' as const,
  correlationId: '30000000-0000-4000-8000-000000000002',
};

function gateway(overrides: Partial<AuthGateway> = {}) {
  return {
    loadMemberMfaStatus: vi.fn().mockResolvedValue(status),
    startMemberMfaEnrollment: vi.fn().mockResolvedValue({ ...start }),
    prepareMemberTotp: vi.fn().mockImplementation((started: typeof start) => {
      started.operationVersion = 2;
      return Promise.resolve({
        kind: 'enrollment',
        factorId: '50000000-0000-4000-8000-000000000001',
        qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
        manualSecret: 'AAAAAAAAAAAAAAAA',
      });
    }),
    verifyMemberTotp: vi.fn().mockResolvedValue(undefined),
    completeMemberMfaEnrollment: vi.fn().mockResolvedValue({
      decision: 'completed',
      organizationId: status.organizationId,
      membershipId: status.membershipId,
      readinessVersion: 1,
      replayed: false,
      correlationId: '30000000-0000-4000-8000-000000000003',
    }),
    cancelMemberMfaEnrollment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AuthGateway;
}

function renderFlow(gatewayUnderTest: AuthGateway, requiredForAccess = false) {
  const callbacks = { onCompleted: vi.fn(), onClose: vi.fn(), onRequirePassword: vi.fn() };
  return {
    ...render(
      <MemberMfaEnrollmentFlow
        gateway={gatewayUnderTest}
        requiredForAccess={requiredForAccess}
        {...callbacks}
      />,
    ),
    ...callbacks,
  };
}

async function enterEnrollment() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Begin secure setup' }));
  await screen.findByLabelText('Verification code');
  return user;
}

const resumedStatus = {
  ...status,
  operationState: 'bound' as const,
  factorState: 'resume_required' as const,
  operationId: start.operationId,
  operationVersion: 2,
};

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('FEAT-006A member TOTP enrollment UI', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-member-qr');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('enrolls, verifies, clears credentials, and reports readiness without a role change', async () => {
    const user = userEvent.setup();
    const gatewayUnderTest = gateway();
    const completed = vi.fn();
    render(
      <MemberMfaEnrollmentFlow
        gateway={gatewayUnderTest}
        onCompleted={completed}
        onClose={vi.fn()}
        onRequirePassword={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Begin secure setup' }));
    expect(await screen.findByAltText('Authenticator setup QR code')).toHaveAttribute(
      'src',
      'blob:synthetic-member-qr',
    );
    expect(screen.queryByLabelText('Manual authenticator setup key')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify authenticator' }));

    expect(
      await screen.findByRole('heading', { name: 'Authenticator is ready' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not change your role or permissions/i)).toBeInTheDocument();
    expect(gatewayUnderTest.verifyMemberTotp).toHaveBeenCalledWith(
      '50000000-0000-4000-8000-000000000001',
      '123456',
    );
    expect(gatewayUnderTest.completeMemberMfaEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ operationVersion: 2 }),
      expect.stringMatching(/^[0-9a-f]{32}$/),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-member-qr');
  });

  it('cancels the bound factor through the protected gateway and signs out', async () => {
    const user = userEvent.setup();
    const gatewayUnderTest = gateway();
    const requirePassword = vi.fn();
    render(
      <MemberMfaEnrollmentFlow
        gateway={gatewayUnderTest}
        requiredForAccess
        onCompleted={vi.fn()}
        onClose={vi.fn()}
        onRequirePassword={requirePassword}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Begin secure setup' }));
    await screen.findByAltText('Authenticator setup QR code');
    await user.click(screen.getByRole('button', { name: 'Cancel and sign out' }));

    await waitFor(() => {
      expect(gatewayUnderTest.cancelMemberMfaEnrollment).toHaveBeenCalledWith(
        expect.objectContaining({ operationVersion: 2 }),
        '50000000-0000-4000-8000-000000000001',
        expect.stringMatching(/^[0-9a-f]{32}$/),
      );
    });
    expect(requirePassword).toHaveBeenCalledWith(expect.stringMatching(/retained safely/i));
  });

  it('resumes an interrupted bound operation after refresh', async () => {
    const user = userEvent.setup();
    const gatewayUnderTest = gateway({
      loadMemberMfaStatus: vi.fn().mockResolvedValue({
        ...status,
        operationState: 'bound',
        factorState: 'resume_required',
        operationId: start.operationId,
        operationVersion: 2,
      }),
    });
    const requirePassword = vi.fn();
    render(
      <MemberMfaEnrollmentFlow
        gateway={gatewayUnderTest}
        requiredForAccess
        onCompleted={vi.fn()}
        onClose={vi.fn()}
        onRequirePassword={requirePassword}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Resume secure setup' }));

    await waitFor(() => {
      expect(gatewayUnderTest.prepareMemberTotp).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: start.operationId, operationVersion: 2 }),
        expect.stringMatching(/^[0-9a-f]{32}$/),
      );
    });
    expect(await screen.findByLabelText('Verification code')).toBeVisible();
    expect(requirePassword).not.toHaveBeenCalled();
  });

  it('cancels an interrupted operation that stopped before provider enrollment', async () => {
    const user = userEvent.setup();
    const gatewayUnderTest = gateway({
      loadMemberMfaStatus: vi.fn().mockResolvedValue({
        ...status,
        operationState: 'started',
        factorState: 'cancellation_required',
        operationId: start.operationId,
        operationVersion: 1,
      }),
    });
    const requirePassword = vi.fn();
    render(
      <MemberMfaEnrollmentFlow
        gateway={gatewayUnderTest}
        requiredForAccess
        onCompleted={vi.fn()}
        onClose={vi.fn()}
        onRequirePassword={requirePassword}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Cancel incomplete setup' }));

    await waitFor(() => {
      expect(gatewayUnderTest.cancelMemberMfaEnrollment).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: start.operationId, operationVersion: 1 }),
        undefined,
        expect.stringMatching(/^[0-9a-f]{32}$/),
      );
    });
  });

  it('retries database completion with the same bounded operation after a transient failure', async () => {
    const user = userEvent.setup();
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new AuthGatewayError('member_mfa_unavailable', 'Try again.'))
      .mockResolvedValueOnce({
        decision: 'completed',
        organizationId: status.organizationId,
        membershipId: status.membershipId,
        readinessVersion: 1,
        replayed: false,
        correlationId: '30000000-0000-4000-8000-000000000003',
      });
    const gatewayUnderTest = gateway({ completeMemberMfaEnrollment: complete });
    render(
      <MemberMfaEnrollmentFlow
        gateway={gatewayUnderTest}
        onCompleted={vi.fn()}
        onClose={vi.fn()}
        onRequirePassword={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Begin secure setup' }));
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify authenticator' }));
    await user.click(await screen.findByRole('button', { name: 'Retry confirmation' }));

    expect(await screen.findByRole('heading', { name: 'Authenticator is ready' })).toBeVisible();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]).toEqual(complete.mock.calls[0]);
    expect(gatewayUnderTest.verifyMemberTotp).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText('Authenticator setup QR code')).not.toBeInTheDocument();
  });

  it.each([false, true])(
    'preserves ready status and optional close when required=%s',
    async (required) => {
      const client = gateway({
        loadMemberMfaStatus: vi.fn().mockResolvedValue({ ...status, ready: true }),
      });
      const callbacks = renderFlow(client, required);
      expect(await screen.findByRole('heading', { name: 'Authenticator is ready' })).toHaveFocus();
      expect(Boolean(screen.queryByRole('button', { name: 'Close' }))).toBe(!required);
      expect(callbacks.onCompleted).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Return to workspace' }));
      expect(callbacks.onCompleted).toHaveBeenCalledOnce();
      expect(client.startMemberMfaEnrollment).not.toHaveBeenCalled();
    },
  );

  it('keeps the credential and refocuses the code after local or provider validation failure', async () => {
    const client = gateway({
      verifyMemberTotp: vi
        .fn()
        .mockRejectedValueOnce(new AuthGatewayError('mfa_invalid', 'Invalid code.'))
        .mockResolvedValue(undefined),
    });
    const callbacks = renderFlow(client, true);
    const user = await enterEnrollment();
    await user.click(screen.getByRole('button', { name: 'Show manual setup key' }));
    await user.type(screen.getByLabelText('Verification code'), '12a');
    expect(screen.getByLabelText('Verification code')).toHaveValue('12');
    await user.click(screen.getByRole('button', { name: 'Verify authenticator' }));
    expect(client.verifyMemberTotp).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Verification code')).toHaveFocus());
    await user.type(screen.getByLabelText('Verification code'), '3456');
    await user.click(screen.getByRole('button', { name: 'Verify authenticator' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code.');
    await waitFor(() => expect(screen.getByLabelText('Verification code')).toHaveFocus());
    expect(screen.getByLabelText('Manual authenticator setup key')).toHaveTextContent(
      'AAAAAAAAAAAAAAAA',
    );
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(client.completeMemberMfaEnrollment).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Verify authenticator' }));
    await screen.findByRole('heading', { name: 'Authenticator is ready' });
    expect(callbacks.onCompleted).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue to workspace' }));
    expect(callbacks.onCompleted).toHaveBeenCalledOnce();
  });

  it('clears QR and manual credentials before a pending completion and disables repeated commands', async () => {
    const pending = deferred();
    const client = gateway({
      completeMemberMfaEnrollment: vi.fn().mockReturnValue(pending.promise),
    });
    renderFlow(client);
    const user = await enterEnrollment();
    await user.click(screen.getByRole('button', { name: 'Show manual setup key' }));
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify authenticator' }));
    expect(
      await screen.findByRole('heading', { name: 'Confirm authenticator readiness' }),
    ).toBeVisible();
    expect(screen.queryByLabelText('Manual authenticator setup key')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Authenticator setup QR code')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-member-qr');
    expect(screen.getByRole('button', { name: 'Confirming readiness…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel and sign out' })).toBeDisabled();
    await act(async () => {
      pending.reject(new Error('private provider diagnostic'));
      await pending.promise.catch(() => undefined);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Authenticator setup could not be confirmed. Try again.',
    );
    expect(screen.queryByText('private provider diagnostic')).not.toBeInTheDocument();
  });

  it.each(['loadMemberMfaStatus', 'startMemberMfaEnrollment', 'prepareMemberTotp'] as const)(
    'shows safe failure and preserves cancellation scope when %s fails',
    async (method) => {
      const client = gateway({
        [method]: vi.fn().mockRejectedValue(new Error('private provider diagnostic')),
      });
      const callbacks = renderFlow(client);
      if (method !== 'loadMemberMfaStatus') {
        await userEvent.click(await screen.findByRole('button', { name: 'Begin secure setup' }));
      }
      expect(
        await screen.findByRole('heading', { name: 'Authenticator setup is blocked' }),
      ).toHaveFocus();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Authenticator setup could not be confirmed. Try again.',
      );
      await userEvent.click(
        screen.getByRole('button', {
          name: method === 'prepareMemberTotp' ? 'Cancel and sign out' : 'Close',
        }),
      );
      if (method === 'prepareMemberTotp') {
        expect(client.cancelMemberMfaEnrollment).toHaveBeenCalledWith(
          expect.objectContaining({ operationId: start.operationId }),
          undefined,
          expect.any(String),
        );
        expect(callbacks.onRequirePassword).toHaveBeenCalledWith(
          expect.stringContaining('cancelled'),
        );
      } else {
        expect(callbacks.onClose).toHaveBeenCalledOnce();
        expect(client.cancelMemberMfaEnrollment).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    'loadMemberMfaStatus',
    'startMemberMfaEnrollment',
    'prepareMemberTotp',
    'verifyMemberTotp',
    'completeMemberMfaEnrollment',
  ] as const)('requires password reauthentication when %s expires', async (method) => {
    const client = gateway({
      [method]: vi
        .fn()
        .mockRejectedValue(
          new AuthGatewayError('member_mfa_recent_authentication_required', 'Sign in again.'),
        ),
    });
    const callbacks = renderFlow(client);
    if (method !== 'loadMemberMfaStatus') {
      await userEvent.click(await screen.findByRole('button', { name: 'Begin secure setup' }));
    }
    if (method === 'verifyMemberTotp' || method === 'completeMemberMfaEnrollment') {
      await userEvent.type(await screen.findByLabelText('Verification code'), '123456');
      await userEvent.click(screen.getByRole('button', { name: 'Verify authenticator' }));
    }
    await waitFor(() => expect(callbacks.onRequirePassword).toHaveBeenCalledWith('Sign in again.'));
    expect(callbacks.onCompleted).not.toHaveBeenCalled();
    expect(screen.queryByAltText('Authenticator setup QR code')).not.toBeInTheDocument();
  });

  it('resumes a bound factor as a challenge without starting a new enrollment', async () => {
    const client = gateway({
      loadMemberMfaStatus: vi.fn().mockResolvedValue(resumedStatus),
      prepareMemberTotp: vi.fn().mockResolvedValue({ kind: 'challenge', factorId: 'bound-factor' }),
    });
    renderFlow(client);
    await userEvent.click(await screen.findByRole('button', { name: 'Resume secure setup' }));
    expect(await screen.findByRole('heading', { name: 'Verify your authenticator' })).toHaveFocus();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(client.startMemberMfaEnrollment).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify authenticator' }));
    await screen.findByRole('heading', { name: 'Authenticator is ready' });
    expect(client.verifyMemberTotp).toHaveBeenCalledWith('bound-factor', '123456');
    expect(client.completeMemberMfaEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: start.operationId,
        operationVersion: 2,
        factorState: 'challenge_required',
      }),
      expect.any(String),
    );
  });

  it('clears credentials immediately and requires sign-in even when bound cancellation fails', async () => {
    const pending = deferred();
    const client = gateway({ cancelMemberMfaEnrollment: vi.fn().mockReturnValue(pending.promise) });
    const callbacks = renderFlow(client);
    const user = await enterEnrollment();
    await user.click(screen.getByRole('button', { name: 'Show manual setup key' }));
    await user.click(screen.getByRole('button', { name: 'Cancel and sign out' }));
    expect(screen.queryByLabelText('Manual authenticator setup key')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Authenticator setup QR code')).not.toBeInTheDocument();
    expect(callbacks.onRequirePassword).not.toHaveBeenCalled();
    await act(async () => {
      pending.reject(new Error('private cancellation error'));
      await pending.promise.catch(() => undefined);
    });
    expect(callbacks.onRequirePassword).toHaveBeenCalledWith(
      'Authenticator setup remains incomplete and was retained safely. Sign in to resume.',
    );
    expect(callbacks.onCompleted).not.toHaveBeenCalled();
  });

  it.each(['status', 'start', 'prepare', 'verify', 'complete', 'retry', 'resume'] as const)(
    'ignores a late %s response after unmount',
    async (stage) => {
      const pending = deferred();
      const method = {
        status: 'loadMemberMfaStatus',
        start: 'startMemberMfaEnrollment',
        prepare: 'prepareMemberTotp',
        verify: 'verifyMemberTotp',
        complete: 'completeMemberMfaEnrollment',
        retry: 'completeMemberMfaEnrollment',
        resume: 'prepareMemberTotp',
      } as const;
      const delayed = vi.fn().mockReturnValue(pending.promise);
      if (stage === 'retry')
        delayed.mockRejectedValueOnce(new AuthGatewayError('member_mfa_unavailable', 'Retry.'));
      const client = gateway({
        ...(stage === 'resume'
          ? { loadMemberMfaStatus: vi.fn().mockResolvedValue(resumedStatus) }
          : {}),
        [method[stage]]: delayed,
      });
      const callbacks = renderFlow(client);
      if (stage !== 'status') {
        await userEvent.click(
          await screen.findByRole('button', {
            name: stage === 'resume' ? 'Resume secure setup' : 'Begin secure setup',
          }),
        );
      }
      if (stage === 'verify' || stage === 'complete' || stage === 'retry') {
        await userEvent.type(await screen.findByLabelText('Verification code'), '123456');
        await userEvent.click(screen.getByRole('button', { name: 'Verify authenticator' }));
      }
      if (stage === 'retry')
        await userEvent.click(await screen.findByRole('button', { name: 'Retry confirmation' }));
      expect(delayed).toHaveBeenCalledTimes(stage === 'retry' ? 2 : 1);
      const prepareCalls = vi.mocked(client.prepareMemberTotp).mock.calls.length;
      const completeCalls = vi.mocked(client.completeMemberMfaEnrollment).mock.calls.length;
      const qrCalls = vi.mocked(URL.createObjectURL).mock.calls.length;
      callbacks.unmount();
      await act(async () => {
        pending.resolve({
          ...status,
          ...start,
          kind: 'enrollment',
          factorId: 'late-factor',
          manualSecret: 'AAAAAAAAAAAAAAAA',
          qrSvg: '<svg/>',
        });
        await pending.promise;
      });
      expect(client.prepareMemberTotp).toHaveBeenCalledTimes(prepareCalls);
      expect(client.completeMemberMfaEnrollment).toHaveBeenCalledTimes(completeCalls);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(qrCalls);
      expect(callbacks.onCompleted).not.toHaveBeenCalled();
      expect(callbacks.onRequirePassword).not.toHaveBeenCalled();
    },
  );

  it('focuses the recovery heading when readiness confirmation needs a retry', async () => {
    const user = userEvent.setup();
    const gatewayUnderTest = gateway({
      completeMemberMfaEnrollment: vi
        .fn()
        .mockRejectedValue(new AuthGatewayError('member_mfa_unavailable', 'Try again.')),
    });
    render(
      <MemberMfaEnrollmentFlow
        gateway={gatewayUnderTest}
        onCompleted={vi.fn()}
        onClose={vi.fn()}
        onRequirePassword={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Begin secure setup' }));
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify authenticator' }));

    expect(
      await screen.findByRole('heading', { name: 'Confirm authenticator readiness' }),
    ).toHaveFocus();
  });
});
