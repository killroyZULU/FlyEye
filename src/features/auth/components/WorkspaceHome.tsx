import { landingLabel, type AccessMembership } from '../../../lib/access-context';
import { StatePanel } from './StatePanel';

export type WorkspaceView =
  'home' | 'invitations' | 'members' | 'profile' | 'security' | 'aircraft' | 'documents';

type WorkspaceHomeProps = {
  membership: AccessMembership;
  aircraftAvailable: boolean;
  aircraftDocumentsAvailable: boolean;
  onNavigate: (view: WorkspaceView) => void;
  onSignOut: () => void;
};

export function WorkspaceHome({
  membership,
  aircraftAvailable,
  aircraftDocumentsAvailable,
  onNavigate,
  onSignOut,
}: WorkspaceHomeProps) {
  return (
    <StatePanel
      eyebrow="Access verified"
      title={landingLabel(membership.role, membership.roleLabel)}
      tone="success"
    >
      <p>
        Signed in to <strong>{membership.organizationName}</strong>. Your available modules are
        based on server-approved permissions.
      </p>
      <div className="permission-summary">
        <span>Current role</span>
        <strong>{membership.role.replaceAll('_', ' ')}</strong>
      </div>
      {aircraftAvailable && membership.permissions.includes('aircraft.record.read') ? (
        <button className="primary-button" type="button" onClick={() => onNavigate('aircraft')}>
          Open aircraft registry
        </button>
      ) : null}
      {aircraftDocumentsAvailable &&
      membership.permissions.includes('aircraft.document.status.read') ? (
        <button className="primary-button" type="button" onClick={() => onNavigate('documents')}>
          Open aircraft documents
        </button>
      ) : null}
      {membership.permissions.includes('membership.invitation.manage') ? (
        <button className="primary-button" type="button" onClick={() => onNavigate('invitations')}>
          Manage member invitations
        </button>
      ) : null}
      {membership.permissions.includes('membership.member.review') ? (
        <button className="primary-button" type="button" onClick={() => onNavigate('members')}>
          Manage organization members
        </button>
      ) : null}
      <button className="primary-button" type="button" onClick={() => onNavigate('profile')}>
        View my basic profile
      </button>
      <button className="primary-button" type="button" onClick={() => onNavigate('security')}>
        Manage authenticator security
      </button>
      <button className="text-button" type="button" onClick={onSignOut}>
        Sign out
      </button>
    </StatePanel>
  );
}
