import { render, screen, waitFor } from '@testing-library/react';
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
  });

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
