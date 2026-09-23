import type { AccessMembership } from '../../lib/access-context';

export type WorkspaceView =
  'home' | 'aircraft' | 'documents' | 'invitations' | 'members' | 'profile' | 'security';

export type WorkspaceNavigationItem = {
  view: WorkspaceView;
  label: string;
  description: string;
};

type WorkspaceNavigationOptions = {
  aircraftAvailable?: boolean;
  aircraftDocumentsAvailable?: boolean;
};

export function workspaceNavigation(
  membership: AccessMembership,
  options: WorkspaceNavigationOptions = {},
): WorkspaceNavigationItem[] {
  const items: WorkspaceNavigationItem[] = [
    { view: 'home', label: 'Home', description: 'Return to your dashboard.' },
  ];

  if (options.aircraftAvailable && membership.permissions.includes('aircraft.record.read')) {
    items.push({
      view: 'aircraft',
      label: 'Aircraft',
      description: 'Open the administrative aircraft identity registry.',
    });
  }

  if (
    options.aircraftDocumentsAvailable &&
    membership.permissions.includes('aircraft.document.status.read')
  ) {
    items.push({
      view: 'documents',
      label: 'Aircraft documents',
      description: 'View configured aircraft document status and permitted records.',
    });
  }

  if (membership.permissions.includes('membership.invitation.manage')) {
    items.push({
      view: 'invitations',
      label: 'Invitations',
      description: 'Create and manage invited school access.',
    });
  }

  if (membership.permissions.includes('membership.member.review')) {
    items.push({
      view: 'members',
      label: 'People',
      description: 'Review members, access status, and approved roles.',
    });
  }

  items.push(
    {
      view: 'profile',
      label: 'My profile',
      description: 'Review and maintain your basic member profile.',
    },
    {
      view: 'security',
      label: 'Account security',
      description: 'Review your authenticator readiness and security.',
    },
  );

  return items;
}
