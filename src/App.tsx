import { AuthApp } from './features/auth/AuthApp';
import type { AuthGateway } from './features/auth/services/auth-gateway';
import type { AircraftDocumentGateway, AircraftRegistryGateway } from './features/aircraft';

type AppProps = {
  gateway: AuthGateway;
  aircraftGateway?: AircraftRegistryGateway;
  aircraftDocumentGateway?: AircraftDocumentGateway;
};

export function App({ gateway, aircraftGateway, aircraftDocumentGateway }: AppProps) {
  return (
    <AuthApp
      gateway={gateway}
      aircraftGateway={aircraftGateway}
      aircraftDocumentGateway={aircraftDocumentGateway}
    />
  );
}
