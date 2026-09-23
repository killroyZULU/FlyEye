import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import {
  SupabaseAircraftDocumentGateway,
  SupabaseAircraftRegistryGateway,
} from './features/aircraft';
import { StatePanel } from './features/auth/components/StatePanel';
import { SupabaseAuthGateway } from './features/auth/services/auth-gateway';
import { createBrowserSupabaseClient } from './lib/supabase';
import './styles/main.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('FlyEye could not find the application root.');
}

const root = createRoot(rootElement);

try {
  const client = createBrowserSupabaseClient();
  root.render(
    <StrictMode>
      <App
        gateway={new SupabaseAuthGateway(client)}
        aircraftGateway={new SupabaseAircraftRegistryGateway(client)}
        aircraftDocumentGateway={new SupabaseAircraftDocumentGateway(client)}
      />
    </StrictMode>,
  );
} catch {
  root.render(
    <main className="configuration-shell">
      <StatePanel eyebrow="Configuration required" title="FlyEye cannot start" tone="warning">
        <p>Authentication is not configured for this environment. Contact the technical owner.</p>
      </StatePanel>
    </main>,
  );
}
