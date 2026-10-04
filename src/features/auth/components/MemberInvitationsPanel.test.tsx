import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthGateway } from '../services/auth-gateway';
import { AuthGatewayError } from '../services/auth-gateway';
import { MemberInvitationsPanel } from './MemberInvitationsPanel';
import type { MemberInvitation } from '../member-invitations';

/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies injected gateway mocks. */

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

const invitation: MemberInvitation = {
  invitationId: '40000000-0000-4000-8000-000000000001',
  email: 'student@example.test',
  roleCode: 'student_pilot',
  roleLabel: 'Student Pilot',
  status: 'pending',
  version: 4,
  issuedAt: '2026-08-09T00:00:00Z',
  expiresAt: '2026-08-09T01:00:00Z',
};

function gateway(overrides: Partial<AuthGateway> = {}) {
  return {
    loadMemberInvitations: vi.fn().mockResolvedValue(list),
    createMemberInvitation: vi.fn().mockResolvedValue({}),
    resendMemberInvitation: vi.fn().mockResolvedValue({}),
    revokeMemberInvitation: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as AuthGateway;
}

function renderPanel(client: AuthGateway) {
  const onClose = vi.fn();
  return {
    ...render(
      <MemberInvitationsPanel
        gateway={client}
        organizationId={ORGANIZATION_ID}
        organizationName="Synthetic Flight School"
        onClose={onClose}
      />,
    ),
    onClose,
  };
}

async function reviewInvitation() {
  const user = userEvent.setup();
  await screen.findByRole('option', { name: 'Student Pilot' });
  await user.type(screen.getByLabelText('Email address'), 'student@example.test');
  await user.click(screen.getByRole('button', { name: 'Review invitation' }));
  return user;
}

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('FEAT-004 member invitation administration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('focuses the heading and disables actions until the initial list arrives', async () => {
    const pending = deferred();
    const client = gateway({ loadMemberInvitations: vi.fn().mockReturnValue(pending.promise) });
    const { onClose } = renderPanel(client);
    expect(screen.getByRole('heading', { name: 'Member invitations' })).toHaveFocus();
    expect(screen.getByLabelText('Loading invitations')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeDisabled();
    expect(screen.getByLabelText('Initial role')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review invitation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Return to workspace' })).toBeDisabled();
    await act(async () => {
      pending.resolve(list);
      await pending.promise;
    });
    expect(
      screen.getByText('No invitations have been created for this organization.'),
    ).toBeVisible();
    expect(screen.getByLabelText('Initial role')).toHaveValue('student_pilot');
    await userEvent.click(screen.getByRole('button', { name: 'Return to workspace' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    [
      new Error('private provider body'),
      'The invitation action could not be completed. Refresh and try again.',
    ],
    [new AuthGatewayError('member_invitation_not_available', 'Access denied.'), 'Access denied.'],
  ])(
    'reports a safe initial read error and leaves creation unavailable: %s',
    async (error, message) => {
      renderPanel(gateway({ loadMemberInvitations: vi.fn().mockRejectedValue(error) }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(String(message)));
      expect(screen.getByRole('button', { name: 'Review invitation' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Return to workspace' })).toBeEnabled();
      expect(screen.queryByText('private provider body')).not.toBeInTheDocument();
    },
  );

  it.each(['not-an-email', 'pilót@example.test'])(
    'rejects invalid or non-ASCII email %s before confirmation',
    async (email) => {
      const client = gateway();
      renderPanel(client);
      await screen.findByRole('option', { name: 'Student Pilot' });
      await userEvent.type(screen.getByLabelText('Email address'), email);
      await userEvent.click(screen.getByRole('button', { name: 'Review invitation' }));
      expect(screen.getByRole('status')).toHaveTextContent(
        'Enter a valid ASCII email address and select an available initial role.',
      );
      expect(screen.queryByRole('button', { name: 'Confirm and send' })).not.toBeInTheDocument();
      expect(client.createMemberInvitation).not.toHaveBeenCalled();
    },
  );

  it('rejects a browser-injected role absent from the server-approved list', async () => {
    const client = gateway();
    renderPanel(client);
    await screen.findByRole('option', { name: 'Student Pilot' });
    await userEvent.type(screen.getByLabelText('Email address'), 'student@example.test');
    const select = screen.getByLabelText('Initial role');
    const option = document.createElement('option');
    option.value = 'dispatcher';
    option.textContent = 'Unapproved role';
    select.append(option);
    fireEvent.change(select, { target: { value: 'dispatcher' } });
    await userEvent.click(screen.getByRole('button', { name: 'Review invitation' }));
    expect(screen.getByRole('status')).toHaveTextContent('select an available initial role');
    expect(client.createMemberInvitation).not.toHaveBeenCalled();
  });

  it('preserves entered values when editing a confirmation without sending', async () => {
    const client = gateway();
    renderPanel(client);
    const user = await reviewInvitation();
    await user.click(screen.getByRole('button', { name: 'Edit invitation' }));
    expect(screen.getByLabelText('Email address')).toHaveValue('student@example.test');
    expect(screen.getByLabelText('Initial role')).toHaveValue('student_pilot');
    expect(client.createMemberInvitation).not.toHaveBeenCalled();
  });

  it('keeps confirmation controls disabled through creation and the resulting list refresh', async () => {
    const creating = deferred();
    const refreshing = deferred();
    const load = vi.fn().mockResolvedValueOnce(list).mockReturnValueOnce(refreshing.promise);
    const client = gateway({
      loadMemberInvitations: load,
      createMemberInvitation: vi.fn().mockReturnValue(creating.promise),
    });
    renderPanel(client);
    const user = await reviewInvitation();
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }));
    expect(screen.getByRole('button', { name: 'Confirm and send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit invitation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Return to workspace' })).toBeDisabled();
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      creating.resolve({});
      await creating.promise;
    });
    expect(screen.getByLabelText('Email address')).toHaveValue('');
    expect(screen.getByLabelText('Email address')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Inbox delivery is not confirmed.');
    await act(async () => {
      refreshing.resolve({ ...list, invitations: [invitation] });
      await refreshing.promise;
    });
    expect(screen.getByRole('list')).toHaveTextContent('student@example.test');
    expect(screen.getByLabelText('Email address')).toBeEnabled();
    expect(client.createMemberInvitation).toHaveBeenCalledOnce();
  });

  it('retains the original create failure when refreshing persisted state also fails', async () => {
    const client = gateway({
      loadMemberInvitations: vi
        .fn()
        .mockResolvedValueOnce(list)
        .mockRejectedValueOnce(new Error('private refresh failure')),
      createMemberInvitation: vi
        .fn()
        .mockRejectedValue(
          new AuthGatewayError('member_invitation_delivery_failed', 'Delivery failed safely.'),
        ),
    });
    renderPanel(client);
    const user = await reviewInvitation();
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Delivery failed safely.'),
    );
    expect(screen.getByRole('button', { name: 'Confirm and send' })).toBeEnabled();
    expect(screen.queryByText('private refresh failure')).not.toBeInTheDocument();
    expect(client.loadMemberInvitations).toHaveBeenCalledTimes(2);
  });

  it('reconciles a failed post-create list read without repeating the create command', async () => {
    const client = gateway({
      loadMemberInvitations: vi
        .fn()
        .mockResolvedValueOnce(list)
        .mockRejectedValueOnce(
          new AuthGatewayError('member_invitation_unavailable', 'Refresh failed.'),
        )
        .mockResolvedValueOnce({ ...list, invitations: [invitation] }),
    });
    renderPanel(client);
    const user = await reviewInvitation();
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Refresh failed.'));
    expect(screen.getByRole('list')).toHaveTextContent('student@example.test');
    expect(client.createMemberInvitation).toHaveBeenCalledOnce();
    expect(client.loadMemberInvitations).toHaveBeenCalledTimes(3);
  });

  it.each(['resend', 'revoke'] as const)(
    'propagates the exact %s version and key, then refreshes the list',
    async (kind) => {
      const pending = deferred();
      const command = vi.fn().mockReturnValue(pending.promise);
      const client = gateway({
        loadMemberInvitations: vi
          .fn()
          .mockResolvedValueOnce({ ...list, invitations: [invitation] })
          .mockResolvedValueOnce(list),
        [kind === 'resend' ? 'resendMemberInvitation' : 'revokeMemberInvitation']: command,
      });
      renderPanel(client);
      await userEvent.click(
        await screen.findByRole('button', { name: kind === 'resend' ? 'Resend' : 'Revoke' }),
      );
      expect(command).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        invitationId: invitation.invitationId,
        expectedVersion: 4,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matcher.
        idempotencyKey: expect.stringMatching(/^[0-9a-f]{32}$/),
      });
      expect(screen.getByRole('button', { name: 'Resend' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled();
      await act(async () => {
        pending.resolve({});
        await pending.promise;
      });
      expect(screen.getByRole('status')).toHaveTextContent(
        kind === 'resend'
          ? 'A replacement invitation request was accepted.'
          : 'The invitation was revoked.',
      );
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      expect(client.loadMemberInvitations).toHaveBeenCalledTimes(2);
      expect(command).toHaveBeenCalledOnce();
    },
  );

  it.each(['resend', 'revoke'] as const)(
    'refreshes after %s fails while retaining its safe error',
    async (kind) => {
      const command = vi
        .fn()
        .mockRejectedValue(
          new AuthGatewayError('member_invitation_conflict', 'Refresh and try again.'),
        );
      const client = gateway({
        loadMemberInvitations: vi
          .fn()
          .mockResolvedValueOnce({ ...list, invitations: [invitation] })
          .mockResolvedValueOnce({ ...list, invitations: [{ ...invitation, status: 'accepted' }] }),
        [kind === 'resend' ? 'resendMemberInvitation' : 'revokeMemberInvitation']: command,
      });
      renderPanel(client);
      await userEvent.click(
        await screen.findByRole('button', { name: kind === 'resend' ? 'Resend' : 'Revoke' }),
      );
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Refresh and try again.'),
      );
      expect(screen.getByRole('list')).toHaveTextContent('accepted');
      expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    },
  );

  it.each([
    ['pending', 0, true, true],
    ['delivery_failed', 0, true, true],
    ['delivery_uncertain', 0, true, true],
    ['expired', 0, true, false],
    ['accepted', 0, false, false],
    ['superseded', 0, false, false],
    ['revoked', 0, false, false],
    ['issuing', 59_999, false, false],
    ['issuing', 60_000, true, true],
  ] satisfies [MemberInvitation['status'], number, boolean, boolean][])(
    'preserves action eligibility for %s at age %sms',
    async (status, age, resend, revoke) => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse(invitation.issuedAt) + age);
      renderPanel(
        gateway({
          loadMemberInvitations: vi
            .fn()
            .mockResolvedValue({ ...list, invitations: [{ ...invitation, status }] }),
        }),
      );
      await screen.findByRole('list');
      expect(Boolean(screen.queryByRole('button', { name: 'Resend' }))).toBe(resend);
      expect(Boolean(screen.queryByRole('button', { name: 'Revoke' }))).toBe(revoke);
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'ignores an obsolete initial read that later %ss after a gateway change',
    async (outcome) => {
      const pending = deferred();
      const oldClient = gateway({
        loadMemberInvitations: vi.fn().mockReturnValue(pending.promise),
      });
      const { rerender, onClose } = renderPanel(oldClient);
      const newClient = gateway({
        loadMemberInvitations: vi.fn().mockResolvedValue({ ...list, invitations: [invitation] }),
      });
      rerender(
        <MemberInvitationsPanel
          gateway={newClient}
          organizationId={ORGANIZATION_ID}
          organizationName="Synthetic Flight School"
          onClose={onClose}
        />,
      );
      await screen.findByRole('list');
      await act(async () => {
        if (outcome === 'resolve') pending.resolve(list);
        else
          pending.reject(
            new AuthGatewayError('member_invitation_not_available', 'Obsolete denial.'),
          );
        await pending.promise.catch(() => undefined);
      });
      expect(screen.getByRole('list')).toHaveTextContent('student@example.test');
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    },
  );
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
