import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthGatewayError, type AuthGateway } from '../../auth/services/auth-gateway';
import { MemberAdministrationPanel } from './MemberAdministrationPanel';

const organizationId = '10000000-0000-4000-8000-000000000001';
const currentMembershipId = '20000000-0000-4000-8000-000000000001';
const targetMembershipId = '20000000-0000-4000-8000-000000000002';
const summary = {
  membershipId: targetMembershipId,
  displayName: 'Synthetic Student',
  email: 'student@example.test',
  roleCode: 'student_pilot',
  roleLabel: 'Student Pilot',
  status: 'active' as const,
  membershipVersion: 1,
  profileVersion: 1,
  profileComplete: true,
  createdAt: '2026-08-11T00:00:00Z',
};

const statusReasonOptions = [
  { action: 'suspend' as const, code: 'temporary_access_hold', label: 'Temporary access hold' },
  { action: 'suspend' as const, code: 'administrative_review', label: 'Administrative review' },
  { action: 'revoke' as const, code: 'membership_ended', label: 'Membership ended' },
  {
    action: 'revoke' as const,
    code: 'membership_created_in_error',
    label: 'Membership created in error',
  },
];
const roleOptions = [
  { code: 'instructor_pilot', label: 'Instructor Pilot', requiresMfa: true },
  { code: 'admin', label: 'Organization Admin', requiresMfa: true },
];
const roleReasonOptions = [
  {
    code: 'responsibility_changed' as const,
    label: 'Responsibility changed',
  },
  { code: 'assignment_corrected' as const, label: 'Assignment corrected' },
];

function gateway() {
  const loadOrganizationMembers = vi
    .fn<AuthGateway['loadOrganizationMembers']>()
    .mockResolvedValue({
      decision: 'listed',
      organizationId,
      members: [summary],
      correlationId: '30000000-0000-4000-8000-000000000001',
    });
  const loadOrganizationMember = vi.fn<AuthGateway['loadOrganizationMember']>().mockResolvedValue({
    ...summary,
    contactNumber: null,
    statusReasonOptions,
    roleOptions,
    roleReasonOptions,
    updatedAt: '2026-08-11T00:00:00Z',
  });
  const changeOrganizationMemberStatus = vi
    .fn<AuthGateway['changeOrganizationMemberStatus']>()
    .mockResolvedValue({
      decision: 'suspended',
      organizationId,
      membershipId: targetMembershipId,
      status: 'suspended',
      roleCode: 'student_pilot',
      roleLabel: 'Student Pilot',
      version: 2,
      replayed: false,
      correlationId: '30000000-0000-4000-8000-000000000002',
    });
  const changeOrganizationMemberRole = vi
    .fn<AuthGateway['changeOrganizationMemberRole']>()
    .mockResolvedValue({
      decision: 'changed',
      organizationId,
      membershipId: targetMembershipId,
      roleCode: 'instructor_pilot',
      roleLabel: 'Instructor Pilot',
      version: 2,
      replayed: false,
      correlationId: '30000000-0000-4000-8000-000000000003',
    });
  return {
    value: {
      loadOrganizationMembers,
      loadOrganizationMember,
      changeOrganizationMemberStatus,
      changeOrganizationMemberRole,
    } as unknown as AuthGateway,
    loadOrganizationMembers,
    loadOrganizationMember,
    changeOrganizationMemberStatus,
    changeOrganizationMemberRole,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderMembers(gatewayUnderTest = gateway(), actorId = currentMembershipId) {
  const props = {
    gateway: gatewayUnderTest.value,
    organizationId,
    organizationName: 'Synthetic Flight School',
    currentMembershipId: actorId,
    onClose: vi.fn(),
    onRequirePassword: vi.fn(),
  };
  return { ...render(<MemberAdministrationPanel {...props} />), props };
}

async function openConfirmation(kind: 'status' | 'role') {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Synthetic Student/ }));
  await user.click(
    await screen.findByRole('button', {
      name: kind === 'status' ? 'suspend membership' : 'Change FlyEye role',
    }),
  );
  return user;
}

afterEach(() => vi.restoreAllMocks());

describe('MemberAdministrationPanel compatibility', () => {
  it('disables directory controls during the exact initial read and shows an empty result', async () => {
    const gatewayUnderTest = gateway();
    const pending = deferred<Awaited<ReturnType<AuthGateway['loadOrganizationMembers']>>>();
    gatewayUnderTest.loadOrganizationMembers.mockReturnValue(pending.promise);
    const { props } = renderMembers(gatewayUnderTest);
    expect(await screen.findByRole('status', { name: 'Loading members' })).toBeInTheDocument();
    expect(screen.getByLabelText('Membership status')).toBeDisabled();
    expect(screen.getByLabelText('Search display name or email')).toBeDisabled();
    expect(gatewayUnderTest.loadOrganizationMembers).toHaveBeenCalledExactlyOnceWith({
      organizationId,
      status: 'active',
      search: undefined,
      cursor: undefined,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Back to workspace' }));
    expect(props.onClose).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve({
        decision: 'listed',
        organizationId,
        members: [],
        correlationId: '30000000-0000-4000-8000-000000000001',
      });
      await pending.promise;
    });
    expect(
      screen.getByText('No members match this bounded organization view.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Membership status')).toBeEnabled();
  });

  it.each(['list', 'detail'] as const)(
    'shows safe %s failures without exposing provider diagnostics',
    async (operation) => {
      const gatewayUnderTest = gateway();
      if (operation === 'list')
        gatewayUnderTest.loadOrganizationMembers.mockRejectedValue(
          new Error('private-provider-detail'),
        );
      else
        gatewayUnderTest.loadOrganizationMember.mockRejectedValue(
          new Error('private-provider-detail'),
        );
      renderMembers(gatewayUnderTest);
      if (operation === 'detail')
        await userEvent.click(await screen.findByRole('button', { name: /Synthetic Student/ }));
      expect(
        await screen.findByText('Member administration is temporarily unavailable. Try again.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('private-provider-detail')).not.toBeInTheDocument();
      expect(
        screen.queryByText('No members match this bounded organization view.'),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Synthetic Student' })).not.toBeInTheDocument();
    },
  );

  it('normalizes search, sends all-status without a filter, appends cursor results and clears search', async () => {
    const gatewayUnderTest = gateway();
    const cursor = 'synthetic-cursor-for-the-next-page';
    gatewayUnderTest.loadOrganizationMembers.mockResolvedValue({
      decision: 'listed',
      organizationId,
      members: [summary],
      nextCursor: cursor,
      correlationId: '30000000-0000-4000-8000-000000000001',
    });
    renderMembers(gatewayUnderTest);
    const user = userEvent.setup();
    await screen.findByText(summary.email);
    await user.type(screen.getByLabelText('Search display name or email'), '  Synthetic  ');
    expect(gatewayUnderTest.loadOrganizationMembers).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(gatewayUnderTest.loadOrganizationMembers).toHaveBeenLastCalledWith({
        organizationId,
        status: 'active',
        search: 'Synthetic',
        cursor: undefined,
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Membership status')).toBeEnabled());
    await user.selectOptions(screen.getByLabelText('Membership status'), 'all');
    await waitFor(() =>
      expect(gatewayUnderTest.loadOrganizationMembers).toHaveBeenLastCalledWith({
        organizationId,
        status: undefined,
        search: 'Synthetic',
        cursor: undefined,
      }),
    );
    gatewayUnderTest.loadOrganizationMembers.mockResolvedValueOnce({
      decision: 'listed',
      organizationId,
      members: [
        {
          ...summary,
          membershipId: '20000000-0000-4000-8000-000000000003',
          displayName: 'Second Member',
          email: 'second@example.test',
        },
      ],
      correlationId: '30000000-0000-4000-8000-000000000001',
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Load more members' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Load more members' }));
    expect(await screen.findByText('second@example.test')).toBeInTheDocument();
    expect(screen.getByText(summary.email)).toBeInTheDocument();
    expect(gatewayUnderTest.loadOrganizationMembers).toHaveBeenLastCalledWith({
      organizationId,
      status: undefined,
      search: 'Synthetic',
      cursor,
    });
    expect(screen.queryByRole('button', { name: 'Load more members' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search for “Synthetic”' }));
    await waitFor(() =>
      expect(gatewayUnderTest.loadOrganizationMembers).toHaveBeenLastCalledWith({
        organizationId,
        status: undefined,
        search: undefined,
        cursor: undefined,
      }),
    );
    expect(screen.getByLabelText('Search display name or email')).toHaveValue('');
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores an obsolete directory %s after the gateway changes',
    async (outcome) => {
      const gatewayUnderTest = gateway();
      const pending = deferred<Awaited<ReturnType<AuthGateway['loadOrganizationMembers']>>>();
      gatewayUnderTest.loadOrganizationMembers.mockReturnValue(pending.promise);
      const { rerender, props } = renderMembers(gatewayUnderTest);
      await screen.findByRole('status', { name: 'Loading members' });
      const fresh = gateway();
      rerender(<MemberAdministrationPanel {...props} gateway={fresh.value} />);
      await screen.findByText(summary.email);
      await act(async () => {
        if (outcome === 'resolve')
          pending.resolve({
            decision: 'listed',
            organizationId,
            members: [],
            correlationId: '30000000-0000-4000-8000-000000000001',
          });
        else pending.reject(new Error('obsolete failure'));
        await pending.promise.catch(() => undefined);
      });
      expect(screen.getByText(summary.email)).toBeInTheDocument();
      expect(
        screen.queryByText('Member administration is temporarily unavailable. Try again.'),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
    },
  );

  it('hides self status and role commands even when detail includes server options', async () => {
    renderMembers(gateway(), targetMembershipId);
    await userEvent.click(await screen.findByRole('button', { name: /Synthetic Student/ }));
    expect(
      await screen.findByText('This is your membership. Self-status actions are not available.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'suspend membership' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change FlyEye role' })).not.toBeInTheDocument();
  });

  it('offers only returned actions and refuses role confirmation without a returned reason', async () => {
    const gatewayUnderTest = gateway();
    gatewayUnderTest.loadOrganizationMember.mockResolvedValue({
      ...summary,
      contactNumber: null,
      statusReasonOptions: [],
      roleOptions,
      roleReasonOptions: [],
      updatedAt: '2026-08-11T00:00:00Z',
    });
    renderMembers(gatewayUnderTest);
    await userEvent.click(await screen.findByRole('button', { name: /Synthetic Student/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Change FlyEye role' }));
    expect(
      screen.getByText('Role assignment is no longer available. Refresh and try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm role change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'suspend membership' })).not.toBeInTheDocument();
    expect(gatewayUnderTest.changeOrganizationMemberRole).not.toHaveBeenCalled();
  });

  it('preserves terminal revocation wording and the selected server reason in its payload', async () => {
    const gatewayUnderTest = gateway();
    renderMembers(gatewayUnderTest);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Synthetic Student/ }));
    await user.click(await screen.findByRole('button', { name: 'Revoke membership' }));
    expect(
      screen.getByRole('heading', { name: 'Permanently revoke this membership?' }),
    ).toHaveFocus();
    expect(screen.getByText(/Revocation is terminal/)).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText('Reason category'),
      'membership_created_in_error',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    const request = gatewayUnderTest.changeOrganizationMemberStatus.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      organizationId,
      membershipId: targetMembershipId,
      action: 'revoke',
      reasonCode: 'membership_created_in_error',
      expectedVersion: 1,
    });
    expect(request?.idempotencyKey).toMatch(/^[0-9a-f]{32}$/);
    expect(await screen.findByText('Membership revoked successfully.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Organization members' })).toHaveFocus(),
    );
  });

  it('does not dispatch or queue an offline status change', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const gatewayUnderTest = gateway();
    renderMembers(gatewayUnderTest);
    const user = await openConfirmation('status');
    await user.click(screen.getByRole('button', { name: 'Confirm suspend' }));
    expect(
      screen.getByText(
        'You are offline. Membership changes are not queued; reconnect and try again.',
      ),
    ).toBeInTheDocument();
    expect(gatewayUnderTest.changeOrganizationMemberStatus).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    await act(() => window.dispatchEvent(new Event('online')));
    expect(gatewayUnderTest.changeOrganizationMemberStatus).not.toHaveBeenCalled();
  });

  it('routes status recent-password errors without resending or refreshing the command', async () => {
    const gatewayUnderTest = gateway();
    gatewayUnderTest.changeOrganizationMemberStatus.mockRejectedValue(
      new AuthGatewayError(
        'member_administration_recent_authentication_required',
        'Sign in again.',
      ),
    );
    const { props } = renderMembers(gatewayUnderTest);
    const user = await openConfirmation('status');
    await user.click(screen.getByRole('button', { name: 'Confirm suspend' }));
    await waitFor(() =>
      expect(props.onRequirePassword).toHaveBeenCalledExactlyOnceWith('Sign in again.'),
    );
    expect(gatewayUnderTest.loadOrganizationMembers).toHaveBeenCalledOnce();
    expect(gatewayUnderTest.changeOrganizationMemberStatus).toHaveBeenCalledOnce();
  });

  it.each(['status', 'role'] as const)(
    'preserves the %s confirmation and key after conflict for a manual retry',
    async (kind) => {
      const gatewayUnderTest = gateway();
      const command =
        kind === 'status'
          ? gatewayUnderTest.changeOrganizationMemberStatus
          : gatewayUnderTest.changeOrganizationMemberRole;
      command.mockRejectedValueOnce(
        new AuthGatewayError(
          'member_administration_state_conflict',
          'Refresh before trying again.',
        ),
      );
      renderMembers(gatewayUnderTest);
      const user = await openConfirmation(kind);
      const label = kind === 'status' ? 'Confirm suspend' : 'Confirm role change';
      await user.click(screen.getByRole('button', { name: label }));
      expect(await screen.findByText('Refresh before trying again.')).toBeInTheDocument();
      expect(command).toHaveBeenCalledOnce();
      expect(gatewayUnderTest.loadOrganizationMembers).toHaveBeenCalledOnce();
      const request = command.mock.calls[0]?.[0];
      await user.click(screen.getByRole('button', { name: label }));
      expect(command).toHaveBeenCalledTimes(2);
      expect(command.mock.calls[1]?.[0]).toEqual(request);
    },
  );

  it.each(['status', 'role'] as const)(
    'keeps %s controls disabled while pending and reports committed success if refresh fails',
    async (kind) => {
      const gatewayUnderTest = gateway();
      const statusPending =
        deferred<Awaited<ReturnType<AuthGateway['changeOrganizationMemberStatus']>>>();
      const rolePending =
        deferred<Awaited<ReturnType<AuthGateway['changeOrganizationMemberRole']>>>();
      if (kind === 'status')
        gatewayUnderTest.changeOrganizationMemberStatus.mockReturnValue(statusPending.promise);
      else gatewayUnderTest.changeOrganizationMemberRole.mockReturnValue(rolePending.promise);
      renderMembers(gatewayUnderTest);
      const user = await openConfirmation(kind);
      gatewayUnderTest.loadOrganizationMembers.mockRejectedValueOnce(
        new Error('private-refresh-failure'),
      );
      await user.click(
        screen.getByRole('button', {
          name: kind === 'status' ? 'Confirm suspend' : 'Confirm role change',
        }),
      );
      expect(screen.getByRole('button', { name: 'Applying change' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(screen.getByLabelText('Reason category')).toBeDisabled();
      if (kind === 'role') expect(screen.getByLabelText('New FlyEye role')).toBeDisabled();
      await act(async () => {
        const result = {
          organizationId,
          membershipId: targetMembershipId,
          roleCode: 'student_pilot',
          roleLabel: 'Student Pilot',
          version: 2,
          replayed: false,
          correlationId: '30000000-0000-4000-8000-000000000002',
        };
        if (kind === 'status') {
          statusPending.resolve({ ...result, decision: 'suspended', status: 'suspended' });
          await statusPending.promise;
        } else {
          rolePending.resolve({ ...result, decision: 'changed' });
          await rolePending.promise;
        }
      });
      const message =
        kind === 'status'
          ? 'Membership suspended successfully.'
          : 'Role changed to Student Pilot successfully.';
      expect(
        await screen.findByText(
          `${message} The refreshed member list is unavailable; retry the list before another action.`,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
      expect(
        kind === 'status'
          ? gatewayUnderTest.changeOrganizationMemberStatus
          : gatewayUnderTest.changeOrganizationMemberRole,
      ).toHaveBeenCalledOnce();
    },
  );
});

describe('MemberAdministrationPanel', () => {
  it('reviews a member and applies an exact confirmed status action', async () => {
    const gatewayUnderTest = gateway();
    const user = userEvent.setup();
    render(
      <MemberAdministrationPanel
        gateway={gatewayUnderTest.value}
        organizationId={organizationId}
        organizationName="Synthetic Flight School"
        currentMembershipId={currentMembershipId}
        onClose={vi.fn()}
        onRequirePassword={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /Synthetic Student/ }));
    expect(await screen.findByRole('heading', { name: 'Synthetic Student' })).toBeInTheDocument();
    const suspendButton = screen.getByRole('button', { name: 'suspend membership' });
    await user.click(suspendButton);
    expect(screen.getByText('Preserved role')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'suspend this membership?' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to workspace' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const restoredSuspendButton = screen.getByRole('button', { name: 'suspend membership' });
    await waitFor(() => expect(restoredSuspendButton).toHaveFocus());
    await user.click(restoredSuspendButton);
    await user.click(screen.getByRole('button', { name: 'Confirm suspend' }));

    await waitFor(() => expect(gatewayUnderTest.changeOrganizationMemberStatus).toHaveBeenCalled());
    const statusRequest = gatewayUnderTest.changeOrganizationMemberStatus.mock.calls[0]?.[0];
    expect(statusRequest).toMatchObject({
      organizationId,
      membershipId: targetMembershipId,
      action: 'suspend',
      reasonCode: 'temporary_access_hold',
      expectedVersion: 1,
    });
    expect(statusRequest?.idempotencyKey).toMatch(/^[0-9a-f]{32}$/);
  });

  it('reports a successful mutation when the post-action list refresh fails', async () => {
    const gatewayUnderTest = gateway();
    const user = userEvent.setup();
    render(
      <MemberAdministrationPanel
        gateway={gatewayUnderTest.value}
        organizationId={organizationId}
        organizationName="Synthetic Flight School"
        currentMembershipId={currentMembershipId}
        onClose={vi.fn()}
        onRequirePassword={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /Synthetic Student/ }));
    await screen.findByRole('heading', { name: 'Synthetic Student' });
    gatewayUnderTest.loadOrganizationMembers.mockRejectedValueOnce(new Error('refresh failed'));
    await user.click(screen.getByRole('button', { name: 'suspend membership' }));
    await user.click(screen.getByRole('button', { name: 'Confirm suspend' }));

    expect(
      await screen.findByText(
        'Membership suspended successfully. The refreshed member list is unavailable; retry the list before another action.',
      ),
    ).toBeInTheDocument();
  });

  it('confirms a permission-scoped role change and preserves keyboard focus on cancel', async () => {
    const gatewayUnderTest = gateway();
    const user = userEvent.setup();
    render(
      <MemberAdministrationPanel
        gateway={gatewayUnderTest.value}
        organizationId={organizationId}
        organizationName="Synthetic Flight School"
        currentMembershipId={currentMembershipId}
        onClose={vi.fn()}
        onRequirePassword={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /Synthetic Student/ }));
    const changeRoleButton = await screen.findByRole('button', { name: 'Change FlyEye role' });
    await user.click(changeRoleButton);
    expect(
      screen.getByRole('heading', { name: "Replace this member's FlyEye role?" }),
    ).toHaveFocus();
    expect(screen.getByText(/does not verify aviation qualification/)).toBeInTheDocument();
    expect(
      screen.getByText(/requires the member's current verified authenticator/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change FlyEye role' })).toHaveFocus(),
    );

    await user.click(screen.getByRole('button', { name: 'Change FlyEye role' }));
    await user.selectOptions(screen.getByLabelText('New FlyEye role'), 'admin');
    await user.selectOptions(screen.getByLabelText('Reason category'), 'assignment_corrected');
    await user.click(screen.getByRole('button', { name: 'Confirm role change' }));

    await waitFor(() => expect(gatewayUnderTest.changeOrganizationMemberRole).toHaveBeenCalled());
    const roleRequest = gatewayUnderTest.changeOrganizationMemberRole.mock.calls[0]?.[0];
    expect(roleRequest).toMatchObject({
      organizationId,
      membershipId: targetMembershipId,
      roleCode: 'admin',
      reasonCode: 'assignment_corrected',
      expectedVersion: 1,
    });
    expect(roleRequest?.idempotencyKey).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not queue a role change while offline', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const gatewayUnderTest = gateway();
    const user = userEvent.setup();
    render(
      <MemberAdministrationPanel
        gateway={gatewayUnderTest.value}
        organizationId={organizationId}
        organizationName="Synthetic Flight School"
        currentMembershipId={currentMembershipId}
        onClose={vi.fn()}
        onRequirePassword={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /Synthetic Student/ }));
    await user.click(screen.getByRole('button', { name: 'Change FlyEye role' }));
    await user.click(screen.getByRole('button', { name: 'Confirm role change' }));

    expect(await screen.findByText(/Role changes are not queued/)).toBeInTheDocument();
    expect(gatewayUnderTest.changeOrganizationMemberRole).not.toHaveBeenCalled();
    online.mockRestore();
  });

  it('routes a role-change recent-password requirement to reauthentication', async () => {
    const gatewayUnderTest = gateway();
    gatewayUnderTest.changeOrganizationMemberRole.mockRejectedValueOnce(
      new AuthGatewayError(
        'member_administration_recent_authentication_required',
        'Sign in with your password again to continue.',
      ),
    );
    const onRequirePassword = vi.fn();
    const user = userEvent.setup();
    render(
      <MemberAdministrationPanel
        gateway={gatewayUnderTest.value}
        organizationId={organizationId}
        organizationName="Synthetic Flight School"
        currentMembershipId={currentMembershipId}
        onClose={vi.fn()}
        onRequirePassword={onRequirePassword}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /Synthetic Student/ }));
    await user.click(screen.getByRole('button', { name: 'Change FlyEye role' }));
    await user.click(screen.getByRole('button', { name: 'Confirm role change' }));

    await waitFor(() =>
      expect(onRequirePassword).toHaveBeenCalledWith(
        'Sign in with your password again to continue.',
      ),
    );
  });

  it.each([
    [
      'target MFA readiness',
      'member_administration_target_mfa_not_ready' as const,
      'The selected privileged role requires the member to verify an authenticator first.',
    ],
    [
      'last-administrator protection',
      'member_administration_last_administrator' as const,
      'At least one active Organization Admin must remain.',
    ],
    [
      'a stale membership version',
      'member_administration_state_conflict' as const,
      'The member information changed. Refresh and try again.',
    ],
    ['rate limiting', 'rate_limited' as const, 'Wait 10 seconds before trying again.'],
    [
      'service failure',
      'member_administration_unavailable' as const,
      'Member administration is temporarily unavailable.',
    ],
  ])('announces %s role-change failures safely', async (_label, code, message) => {
    const gatewayUnderTest = gateway();
    gatewayUnderTest.changeOrganizationMemberRole.mockRejectedValueOnce(
      new AuthGatewayError(code, message),
    );
    const user = userEvent.setup();
    render(
      <MemberAdministrationPanel
        gateway={gatewayUnderTest.value}
        organizationId={organizationId}
        organizationName="Synthetic Flight School"
        currentMembershipId={currentMembershipId}
        onClose={vi.fn()}
        onRequirePassword={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /Synthetic Student/ }));
    await user.click(screen.getByRole('button', { name: 'Change FlyEye role' }));
    await user.click(screen.getByRole('button', { name: 'Confirm role change' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('validates search before requesting directory data', async () => {
    const gatewayUnderTest = gateway();
    const user = userEvent.setup();
    render(
      <MemberAdministrationPanel
        gateway={gatewayUnderTest.value}
        organizationId={organizationId}
        organizationName="Synthetic Flight School"
        currentMembershipId={currentMembershipId}
        onClose={vi.fn()}
        onRequirePassword={vi.fn()}
      />,
    );
    await screen.findByText('student@example.test');
    await user.type(screen.getByLabelText('Search display name or email'), 'x');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(
      await screen.findByText('Search requires 2 to 80 characters, or leave it empty.'),
    ).toBeInTheDocument();
    expect(gatewayUnderTest.loadOrganizationMembers).toHaveBeenCalledTimes(1);
  });
});
