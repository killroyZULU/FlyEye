import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthGateway } from '../services/auth-gateway';
import { InvitationAcceptanceFlow } from './InvitationAcceptanceFlow';

const INVITATION_ID = '40000000-0000-4000-8000-000000000001';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('FEAT-004 invitation acceptance', () => {
  it('requires password reauthentication and explicit acceptance', async () => {
    window.history.replaceState(
      null,
      '',
      `/auth/invitation?invitation=${INVITATION_ID}&version=2#access_token=synthetic`,
    );
    const prepareInvitationCredential = vi.fn().mockResolvedValue(undefined);
    const acceptMemberInvitation = vi.fn().mockResolvedValue({
      decision: 'accepted',
      invitationId: INVITATION_ID,
      organizationId: '20000000-0000-4000-8000-000000000001',
      membershipId: '50000000-0000-4000-8000-000000000001',
      version: 3,
      correlationId: '60000000-0000-4000-8000-000000000001',
    });
    const gateway = {
      hasSession: vi.fn().mockResolvedValue(true),
      prepareInvitationCredential,
      acceptMemberInvitation,
    } as unknown as AuthGateway;
    const user = userEvent.setup();
    render(<InvitationAcceptanceFlow gateway={gateway} />);

    await waitFor(() => expect(window.location.search).toBe(''));
    await user.type(screen.getByLabelText('FlyEye password'), 'Synthetic-password-004!');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));

    expect(prepareInvitationCredential).toHaveBeenCalledWith('Synthetic-password-004!', {
      invitationId: INVITATION_ID,
      expectedVersion: 2,
    });
    expect(acceptMemberInvitation).toHaveBeenCalledWith({
      invitationId: INVITATION_ID,
      expectedVersion: 2,
      // Vitest asymmetric matchers are intentionally typed as any.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      idempotencyKey: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(
      await screen.findByRole('heading', { name: 'Your membership is ready' }),
    ).toBeInTheDocument();
  });

  it('does not expose acceptance for an incomplete callback', async () => {
    window.history.replaceState(null, '', '/auth/invitation');
    const acceptMemberInvitation = vi.fn();
    const gateway = {
      hasSession: vi.fn().mockResolvedValue(true),
      prepareInvitationCredential: vi.fn(),
      acceptMemberInvitation,
    } as unknown as AuthGateway;
    render(<InvitationAcceptanceFlow gateway={gateway} />);
    expect(
      await screen.findByRole('heading', { name: 'Invitation link unavailable' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('FlyEye password')).not.toBeInTheDocument();
    expect(acceptMemberInvitation).not.toHaveBeenCalled();
  });

  it('keeps callback tokens until Supabase reports an authenticated session', async () => {
    window.history.replaceState(
      null,
      '',
      `/auth/invitation?invitation=${INVITATION_ID}&version=2#access_token=synthetic`,
    );
    let resolveSession!: (hasSession: boolean) => void;
    const hasSession = vi.fn().mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveSession = resolve;
      }),
    );
    const gateway = { hasSession } as unknown as AuthGateway;

    render(<InvitationAcceptanceFlow gateway={gateway} />);

    expect(
      screen.getByRole('heading', { name: 'Verifying your invitation session' }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('#access_token=synthetic');
    resolveSession(false);
    expect(
      await screen.findByRole('heading', { name: 'Invitation link unavailable' }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('#access_token=synthetic');
  });
});
