import { lazy } from 'react';
import type { AircraftDocumentGateway, AircraftRegistryGateway } from '../aircraft';
import type { AuthGateway } from './services/auth-gateway';
import { currentAuthRoute } from './auth-app-state';
import { useAuthSession } from './useAuthSession';
import { DeferredScreen } from './components/DeferredScreen';
import { AuthEntryView } from './components/AuthEntryView';

const AuthenticatedWorkspace = lazy(() =>
  import('./components/AuthenticatedWorkspace').then((module) => ({
    default: module.AuthenticatedWorkspace,
  })),
);
type AuthAppProps = {
  gateway: AuthGateway;
  aircraftGateway?: AircraftRegistryGateway;
  aircraftDocumentGateway?: AircraftDocumentGateway;
};
export function AuthApp({ gateway, aircraftGateway, aircraftDocumentGateway }: AuthAppProps) {
  const route = currentAuthRoute(window.location.pathname);
  const session = useAuthSession(gateway, route);
  if (route === 'sign-in' && session.state === 'success' && session.activeMembership) {
    return (
      <DeferredScreen onLeave={() => void session.handleSignOut()} leaveLabel="Sign out">
        <AuthenticatedWorkspace
          gateway={gateway}
          aircraftGateway={aircraftGateway}
          aircraftDocumentGateway={aircraftDocumentGateway}
          activeMembership={session.activeMembership}
          session={session}
        />
      </DeferredScreen>
    );
  }
  return <AuthEntryView gateway={gateway} route={route} session={session} />;
}
