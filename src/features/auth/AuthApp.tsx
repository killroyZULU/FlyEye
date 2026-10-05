import type { AircraftDocumentGateway, AircraftRegistryGateway } from '../aircraft';
import type { AuthGateway } from './services/auth-gateway';
import { currentAuthRoute } from './auth-app-state';
import { useAuthSession } from './useAuthSession';
import { AuthenticatedWorkspace } from './components/AuthenticatedWorkspace';
import { AuthEntryView } from './components/AuthEntryView';
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
      <AuthenticatedWorkspace
        gateway={gateway}
        aircraftGateway={aircraftGateway}
        aircraftDocumentGateway={aircraftDocumentGateway}
        activeMembership={session.activeMembership}
        session={session}
      />
    );
  }
  return <AuthEntryView gateway={gateway} route={route} session={session} />;
}
