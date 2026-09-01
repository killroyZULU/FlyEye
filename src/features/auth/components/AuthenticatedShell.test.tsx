import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AccessMembership } from '../../../lib/access-context';
import { workspaceNavigation } from '../workspace-navigation';
import { AuthenticatedShell } from './AuthenticatedShell';

const membership: AccessMembership = {
  membershipId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000001',
  organizationName: 'Synthetic Flight School',
  role: 'admin',
  roleLabel: 'Organization Admin',
  workspacePermission: 'portal.admin.access',
  permissions: [
    'portal.admin.access',
    'membership.invitation.manage',
    'membership.member.review',
    'aircraft.record.read',
  ],
  membershipVersion: 1,
  requiredAssuranceLevel: 'aal2',
  accessStatus: 'granted',
};

describe('FEAT-008 authenticated shell', () => {
  it('builds navigation only from available modules and approved permissions', () => {
    expect(workspaceNavigation(membership).map((item) => item.label)).toEqual([
      'Home',
      'Invitations',
      'People',
      'My profile',
      'Account security',
    ]);
    expect(
      workspaceNavigation(membership, { aircraftAvailable: true }).map((item) => item.label),
    ).toContain('Aircraft');
    expect(
      workspaceNavigation(
        { ...membership, permissions: ['portal.admin.access'] },
        {
          aircraftAvailable: true,
        },
      ).map((item) => item.label),
    ).toEqual(['Home', 'My profile', 'Account security']);
  });

  it('keeps navigation visible, marks the current view, and exposes sign out', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onSignOut = vi.fn();
    const navigation = workspaceNavigation(membership);

    render(
      <AuthenticatedShell
        membership={membership}
        currentView="members"
        navigation={navigation}
        onNavigate={onNavigate}
        onSignOut={onSignOut}
      >
        <h1>Organization members</h1>
      </AuthenticatedShell>,
    );

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'People' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Synthetic Flight School')).toBeInTheDocument();
    expect(screen.getByText('Organization Admin')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(onNavigate).toHaveBeenCalledWith('home');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
