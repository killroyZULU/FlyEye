import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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
