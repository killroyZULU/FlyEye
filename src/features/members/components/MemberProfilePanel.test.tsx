import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AuthGateway } from '../../auth/services/auth-gateway';
import { MemberProfilePanel } from './MemberProfilePanel';

const profile = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  organizationName: 'Synthetic Flight School',
  membershipId: '20000000-0000-4000-8000-000000000001',
  displayName: null,
  contactNumber: null,
  email: 'member@example.test',
  roleCode: 'student_pilot',
  roleLabel: 'Student Pilot',
  status: 'active' as const,
  version: 1,
  complete: false,
};

function gateway() {
  const loadMyMemberProfile = vi
    .fn<AuthGateway['loadMyMemberProfile']>()
    .mockResolvedValue(profile);
  const updateMyMemberProfile = vi.fn<AuthGateway['updateMyMemberProfile']>().mockResolvedValue({
    ...profile,
    displayName: 'Synthetic Member',
    version: 2,
    complete: true,
  });
  return {
    value: { loadMyMemberProfile, updateMyMemberProfile } as unknown as AuthGateway,
    updateMyMemberProfile,
  };
}

describe('MemberProfilePanel', () => {
  it('shows read-only account context and saves only bounded profile fields', async () => {
    const gatewayUnderTest = gateway();
    const user = userEvent.setup();
    render(
      <MemberProfilePanel
        gateway={gatewayUnderTest.value}
        membershipId={profile.membershipId}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('member@example.test')).toBeInTheDocument();
    expect(
      screen.getByText('Complete your display name to finish this profile.'),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Display name'), 'Synthetic Member');
    await user.type(screen.getByLabelText('Contact number (optional)'), '+63 2 555 0100');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() =>
      expect(gatewayUnderTest.updateMyMemberProfile).toHaveBeenCalledWith({
        membershipId: profile.membershipId,
        displayName: 'Synthetic Member',
        contactNumber: '+63 2 555 0100',
        expectedVersion: 1,
      }),
    );
    expect(await screen.findByText('Your organization profile was saved.')).toBeInTheDocument();
  });

  it('keeps invalid values in memory and does not send them', async () => {
    const gatewayUnderTest = gateway();
    const user = userEvent.setup();
    render(
      <MemberProfilePanel
        gateway={gatewayUnderTest.value}
        membershipId={profile.membershipId}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('member@example.test');
    await user.type(screen.getByLabelText('Display name'), 'X');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    const validationError = await screen.findByText('Enter 2 to 80 characters.');
    expect(validationError).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByLabelText('Display name')).toHaveValue('X');
    expect(gatewayUnderTest.updateMyMemberProfile).not.toHaveBeenCalled();
  });
});
