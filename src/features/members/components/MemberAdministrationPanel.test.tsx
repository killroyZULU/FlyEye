import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AuthGateway } from '../../auth/services/auth-gateway';
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
  return {
    value: {
      loadOrganizationMembers,
      loadOrganizationMember,
      changeOrganizationMemberStatus,
    } as unknown as AuthGateway,
    loadOrganizationMembers,
    changeOrganizationMemberStatus,
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
