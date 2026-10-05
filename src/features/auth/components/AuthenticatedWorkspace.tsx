import { lazy } from 'react';
import { DeferredScreen } from './DeferredScreen';
import type { AccessMembership } from '../../../lib/access-context';
import {
  AircraftDocumentsPanel,
  AircraftRegistryPanel,
  aircraftDocumentCapabilities,
  type AircraftDocumentGateway,
  type AircraftRegistryGateway,
} from '../../aircraft';
import type { AuthGateway } from '../services/auth-gateway';
import type { AuthSession } from '../useAuthSession';
import { workspaceNavigation } from '../workspace-navigation';
import { AuthenticatedShell } from './AuthenticatedShell';
import { WorkspaceDashboard } from './WorkspaceDashboard';

const MemberAdministrationPanel = lazy(() =>
  import('../../members/components/MemberAdministrationPanel').then((module) => ({
    default: module.MemberAdministrationPanel,
  })),
);
const MemberProfilePanel = lazy(() =>
  import('../../members/components/MemberProfilePanel').then((module) => ({
    default: module.MemberProfilePanel,
  })),
);
const MemberInvitationsPanel = lazy(() =>
  import('./MemberInvitationsPanel').then((module) => ({ default: module.MemberInvitationsPanel })),
);
const MemberMfaEnrollmentFlow = lazy(() =>
  import('./MemberMfaEnrollmentFlow').then((module) => ({
    default: module.MemberMfaEnrollmentFlow,
  })),
);
type AuthenticatedWorkspaceProps = {
  gateway: AuthGateway;
  aircraftGateway?: AircraftRegistryGateway;
  aircraftDocumentGateway?: AircraftDocumentGateway;
  activeMembership: AccessMembership;
  session: AuthSession;
};
export function AuthenticatedWorkspace({
  gateway,
  aircraftGateway,
  aircraftDocumentGateway,
  activeMembership,
  session,
}: AuthenticatedWorkspaceProps) {
  const {
    workspaceView,
    setWorkspaceView,
    handleSignOut,
    returnToPassword,
    handleAircraftAccessRevoked,
  } = session;
  const navigation = workspaceNavigation(activeMembership, {
    aircraftAvailable: Boolean(aircraftGateway),
    aircraftDocumentsAvailable: Boolean(aircraftDocumentGateway),
  });
  return (
    <AuthenticatedShell
      membership={activeMembership}
      currentView={workspaceView}
      navigation={navigation}
      onNavigate={setWorkspaceView}
      onSignOut={() => void handleSignOut()}
    >
      <DeferredScreen key={workspaceView} onLeave={() => setWorkspaceView('home')}>
        {workspaceView === 'invitations' ? (
          <MemberInvitationsPanel
            gateway={gateway}
            organizationId={activeMembership.organizationId}
            organizationName={activeMembership.organizationName}
            onClose={() => setWorkspaceView('home')}
          />
        ) : null}

        {workspaceView === 'members' ? (
          <MemberAdministrationPanel
            gateway={gateway}
            organizationId={activeMembership.organizationId}
            organizationName={activeMembership.organizationName}
            currentMembershipId={activeMembership.membershipId}
            onClose={() => setWorkspaceView('home')}
            onRequirePassword={(reason) => void returnToPassword(reason)}
          />
        ) : null}

        {workspaceView === 'profile' ? (
          <MemberProfilePanel
            gateway={gateway}
            membershipId={activeMembership.membershipId}
            onClose={() => setWorkspaceView('home')}
          />
        ) : null}

        {workspaceView === 'security' ? (
          <MemberMfaEnrollmentFlow
            gateway={gateway}
            onCompleted={() => setWorkspaceView('home')}
            onClose={() => setWorkspaceView('home')}
            onRequirePassword={(reason) => void returnToPassword(reason)}
          />
        ) : null}

        {workspaceView === 'aircraft' && aircraftGateway ? (
          <AircraftRegistryPanel
            gateway={aircraftGateway}
            organizationName={activeMembership.organizationName}
            canManage={activeMembership.permissions.includes('aircraft.record.manage')}
            onClose={() => setWorkspaceView('home')}
            onAccessRevoked={handleAircraftAccessRevoked}
          />
        ) : null}

        {workspaceView === 'documents' && aircraftDocumentGateway ? (
          <AircraftDocumentsPanel
            gateway={aircraftDocumentGateway}
            {...aircraftDocumentCapabilities(activeMembership.permissions)}
            onClose={() => setWorkspaceView('home')}
            onAccessRevoked={handleAircraftAccessRevoked}
            onRequirePassword={(reason) => void returnToPassword(reason)}
          />
        ) : null}

        {workspaceView === 'home' ? (
          <WorkspaceDashboard
            membership={activeMembership}
            navigation={navigation}
            onNavigate={setWorkspaceView}
          />
        ) : null}
      </DeferredScreen>
    </AuthenticatedShell>
  );
}
