import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AccessMembership } from '../../../lib/access-context';
import { workspaceNavigation } from '../workspace-navigation';
import { WorkspaceDashboard } from './WorkspaceDashboard';

function membership(role: AccessMembership['role'], roleLabel: string): AccessMembership {
  const workspacePermission = `portal.${role.replace('_pilot', '')}.access`;
  return {
    membershipId: '10000000-0000-4000-8000-000000000001',
    organizationId: '20000000-0000-4000-8000-000000000001',
    organizationName: 'Synthetic Flight School',
    role,
    roleLabel,
    workspacePermission,
    permissions: [workspacePermission],
    membershipVersion: 1,
    requiredAssuranceLevel: 'aal1',
    accessStatus: 'granted',
  };
}

describe('FEAT-008 role dashboards', () => {
  it.each([
    ['student_pilot', 'Student Pilot', 'Student dashboard'],
    ['instructor_pilot', 'Instructor Pilot', 'Instructor dashboard'],
    ['admin', 'Organization Admin', 'Administration dashboard'],
    ['chief_flight_instructor', 'Chief Flight Instructor', 'Chief Flight Instructor dashboard'],
  ] as const)('renders the designated %s dashboard', (role, roleLabel, heading) => {
    const access = membership(role, roleLabel);
    render(
      <WorkspaceDashboard
        membership={access}
        navigation={workspaceNavigation(access)}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText('Active and verified')).toBeInTheDocument();
  });

  it('navigates from a dashboard destination without inventing unavailable modules', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const access = membership('student_pilot', 'Student Pilot');
    render(
      <WorkspaceDashboard
        membership={access}
        navigation={workspaceNavigation(access)}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.queryByText('Aircraft')).not.toBeInTheDocument();
    expect(screen.queryByText('Dispatch')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /My profile/ }));
    expect(onNavigate).toHaveBeenCalledWith('profile');
  });
});
