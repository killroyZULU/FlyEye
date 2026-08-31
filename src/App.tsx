import { AuthApp } from './features/auth/AuthApp';
import type { AuthGateway } from './features/auth/services/auth-gateway';
import type { AircraftRegistryGateway } from './features/aircraft';

type AppProps = {
  gateway: AuthGateway;
  aircraftGateway?: AircraftRegistryGateway;
};

export function App({ gateway, aircraftGateway }: AppProps) {
  return <AuthApp gateway={gateway} aircraftGateway={aircraftGateway} />;
}
