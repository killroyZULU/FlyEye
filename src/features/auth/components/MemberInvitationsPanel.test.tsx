import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AuthGateway } from '../services/auth-gateway';
import { AuthGatewayError } from '../services/auth-gateway';
import { MemberInvitationsPanel } from './MemberInvitationsPanel';

const ORGANIZATION_ID = '20000000-0000-4000-8000-000000000001';
const list = {
  decision: 'listed' as const,
  organizationId: ORGANIZATION_ID,
  invitations: [],
  roles: [
    { code: 'student_pilot', label: 'Student Pilot' },
    { code: 'instructor_pilot', label: 'Instructor Pilot' },
    { code: 'admin', label: 'Organization Admin' },
  ],
  correlationId: '30000000-0000-4000-8000-000000000001',
};

describe('FEAT-004 member invitation administration', () => {
  it('confirms organization, email, and role before sending one bounded invitation', async () => {
    const createMemberInvitation = vi.fn().mockResolvedValue({
      decision: 'pending',
      invitationId: '40000000-0000-4000-8000-000000000001',
      version: 2,
      correlationId: '30000000-0000-4000-8000-000000000002',
    });
    const gateway = {
      loadMemberInvitations: vi.fn().mockResolvedValue(list),
      createMemberInvitation,
    } as unknown as AuthGateway;
    const user = userEvent.setup();
    render(
      <MemberInvitationsPanel
        gateway={gateway}
        organizationId={ORGANIZATION_ID}
        organizationName="Synthetic Flight School"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole('option', { name: 'Organization Admin' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email address'), 'Pilot+Tag@Example.Test');
    await user.selectOptions(screen.getByLabelText('Initial role'), 'instructor_pilot');
    await user.click(screen.getByRole('button', { name: 'Review invitation' }));

    expect(createMemberInvitation).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('heading', {
      name: 'Check before sending',
    }).parentElement;
    expect(confirmation).not.toBeNull();
    const confirmationQueries = within(confirmation!);
    expect(confirmationQueries.getByText('Synthetic Flight School')).toBeInTheDocument();
    expect(confirmationQueries.getByText('pilot+tag@example.test')).toBeInTheDocument();
    expect(confirmationQueries.getByText('Instructor Pilot')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }));

    expect(createMemberInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        email: 'pilot+tag@example.test',
        roleCode: 'instructor_pilot',
        // Vitest asymmetric matchers are intentionally typed as any.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        idempotencyKey: expect.stringMatching(/^[0-9a-f]{32}$/),
      }),
    );
    expect(await screen.findByText(/provider accepted/i)).toBeInTheDocument();
    expect(screen.getByText(/inbox delivery is not confirmed/i)).toBeInTheDocument();
  });

  it('does not offer an unapproved role invented by the browser', async () => {
    const gateway = {
      loadMemberInvitations: vi.fn().mockResolvedValue(list),
    } as unknown as AuthGateway;
    render(
      <MemberInvitationsPanel
        gateway={gateway}
        organizationId={ORGANIZATION_ID}
        organizationName="Synthetic Flight School"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole('option', { name: 'Student Pilot' });
    expect(screen.queryByRole('option', { name: /dispatcher/i })).not.toBeInTheDocument();
  });

  it('reloads persisted invitation state after a delivery failure', async () => {
    const failedList = {
      ...list,
      invitations: [
        {
          invitationId: '40000000-0000-4000-8000-000000000001',
          email: 'student@example.test',
          roleCode: 'student_pilot',
          roleLabel: 'Student Pilot',
          status: 'delivery_failed' as const,
          version: 2,
          issuedAt: '2026-08-09T00:00:00Z',
          expiresAt: '2026-08-09T01:00:00Z',
        },
      ],
    };
    const loadMemberInvitations = vi
      .fn()
      .mockResolvedValueOnce(list)
      .mockResolvedValueOnce(failedList);
    const gateway = {
      loadMemberInvitations,
      createMemberInvitation: vi
        .fn()
        .mockRejectedValue(
          new AuthGatewayError(
            'member_invitation_delivery_failed',
            'The invitation could not be sent. It may be retried safely.',
          ),
        ),
    } as unknown as AuthGateway;
    const user = userEvent.setup();
    render(
      <MemberInvitationsPanel
        gateway={gateway}
        organizationId={ORGANIZATION_ID}
        organizationName="Synthetic Flight School"
        onClose={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText('Email address'), 'student@example.test');
    await user.click(screen.getByRole('button', { name: 'Review invitation' }));
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }));

    expect(await screen.findByText(/could not be sent/i)).toBeInTheDocument();
    expect(screen.getByText(/delivery failed/i)).toBeInTheDocument();
    expect(loadMemberInvitations).toHaveBeenCalledTimes(2);
  });

  it('does not offer resend for an expired row superseded by newer active email state', async () => {
    const invitations = [
      {
        invitationId: '40000000-0000-4000-8000-000000000001',
        email: 'student@example.test',
        roleCode: 'student_pilot',
        roleLabel: 'Student Pilot',
        status: 'expired' as const,
        version: 2,
        issuedAt: '2026-08-09T00:00:00Z',
        expiresAt: '2026-08-09T01:00:00Z',
      },
      {
        invitationId: '40000000-0000-4000-8000-000000000002',
        email: 'STUDENT@example.test',
        roleCode: 'student_pilot',
        roleLabel: 'Student Pilot',
        status: 'pending' as const,
        version: 2,
        issuedAt: '2026-08-09T02:00:00Z',
        expiresAt: '2026-08-09T03:00:00Z',
      },
    ];
    const gateway = {
      loadMemberInvitations: vi.fn().mockResolvedValue({ ...list, invitations }),
    } as unknown as AuthGateway;

    render(
      <MemberInvitationsPanel
        gateway={gateway}
        organizationId={ORGANIZATION_ID}
        organizationName="Synthetic Flight School"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findAllByRole('button', { name: 'Resend' })).toHaveLength(1);
  });
});
