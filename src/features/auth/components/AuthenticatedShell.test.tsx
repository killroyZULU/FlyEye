import { fireEvent, render, screen } from '@testing-library/react';
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
    'aircraft.document.status.read',
  ],
  membershipVersion: 1,
  requiredAssuranceLevel: 'aal2',
  accessStatus: 'granted',
};

describe('FEAT-008 authenticated shell', () => {
  it('reveals a clipped focused item horizontally without navigating', () => {
    const onNavigate = vi.fn();
    render(
      <AuthenticatedShell
        membership={membership}
        currentView="home"
        navigation={workspaceNavigation(membership)}
        onNavigate={onNavigate}
        onSignOut={vi.fn()}
      >
        <h1>Home</h1>
      </AuthenticatedShell>,
    );
    const item = screen.getByRole('button', { name: 'My profile' });
    const container = item.parentElement!;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 56));
    const bounds = vi.spyOn(item, 'getBoundingClientRect');
    bounds.mockReturnValue(new DOMRect(80, 0, 80, 56));
    fireEvent.focus(item);
    expect(container.scrollLeft).toBe(60);
    bounds.mockReturnValue(new DOMRect(-20, 0, 80, 56));
    fireEvent.focus(item);
    expect(container.scrollLeft).toBe(40);
    bounds.mockReturnValue(new DOMRect(0, 0, 80, 56));
    fireEvent.focus(item);
    expect(container.scrollLeft).toBe(40);
    expect(onNavigate).not.toHaveBeenCalled();
  });
  it.each([
    ['student_pilot', ['portal.student.access'], ['home', 'profile', 'security']],
    [
      'instructor_pilot',
      ['portal.instructor.access', 'aircraft.document.status.read'],
      ['home', 'documents', 'profile', 'security'],
    ],
    [
      'admin',
      membership.permissions,
      ['home', 'aircraft', 'documents', 'invitations', 'members', 'profile', 'security'],
    ],
  ])('preserves the exact available destination order for %s', (role, permissions, expected) => {
    expect(
      workspaceNavigation(
        { ...membership, role, permissions },
        {
          aircraftAvailable: true,
          aircraftDocumentsAvailable: true,
        },
      ).map((item) => item.view),
    ).toEqual(expected);
  });

  it('preserves the main element and view-change focus while updating current-page semantics', () => {
    const props = {
      membership,
      navigation: workspaceNavigation(membership),
      onNavigate: vi.fn(),
      onSignOut: vi.fn(),
    };
    const { rerender } = render(
      <AuthenticatedShell {...props} currentView="home">
        <h1>Home</h1>
      </AuthenticatedShell>,
    );
    const main = screen.getByRole('main');
    expect(main).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Skip to workspace content' })).toHaveAttribute(
      'href',
      '#workspace-main',
    );
    rerender(
      <AuthenticatedShell {...props} currentView="profile">
        <h1>Profile</h1>
      </AuthenticatedShell>,
    );
    expect(screen.getByRole('main')).toBe(main);
    expect(main).toHaveFocus();
    expect(screen.getByRole('button', { name: 'My profile' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

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
      workspaceNavigation(membership, { aircraftDocumentsAvailable: true }).map(
        (item) => item.label,
      ),
    ).toContain('Aircraft documents');
    expect(
      workspaceNavigation(
        { ...membership, permissions: ['portal.admin.access'] },
        {
          aircraftAvailable: true,
          aircraftDocumentsAvailable: true,
        },
      ).map((item) => item.label),
    ).toEqual(['Home', 'My profile', 'Account security']);
  });

  it('gives status-only access a document destination without registry access', () => {
    expect(
      workspaceNavigation(
        { ...membership, permissions: ['portal.student.access', 'aircraft.document.status.read'] },
        { aircraftAvailable: true, aircraftDocumentsAvailable: true },
      ).map((item) => item.view),
    ).toEqual(['home', 'documents', 'profile', 'security']);
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
