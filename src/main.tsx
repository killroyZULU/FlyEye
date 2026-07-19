import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { StatePanel } from './features/auth/components/StatePanel';
import { createBrowserAuthGateway } from './lib/supabase';
import './styles/main.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('FlyEye could not find the application root.');
}

const root = createRoot(rootElement);

try {
  const gateway = createBrowserAuthGateway();
  root.render(
    <StrictMode>
      <App gateway={gateway} />
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
