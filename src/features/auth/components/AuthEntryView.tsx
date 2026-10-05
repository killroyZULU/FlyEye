import { InvitationAcceptanceFlow } from './InvitationAcceptanceFlow';
import { PasswordRecoveryFlow } from './PasswordRecoveryFlow';
import { lazy } from 'react';
import { DeferredScreen } from './DeferredScreen';
import type { AuthGateway } from '../services/auth-gateway';
import type { AuthSession } from '../useAuthSession';
import type { AuthRoute } from '../auth-app-state';
import { AuthSignInView } from './AuthSignInView';

const RecoveryRequestForm = lazy(() =>
  import('./RecoveryRequestForm').then((module) => ({ default: module.RecoveryRequestForm })),
);
type AuthEntryViewProps = { gateway: AuthGateway; route: AuthRoute; session: AuthSession };
export function AuthEntryView({ gateway, route, session }: AuthEntryViewProps) {
  return (
    <main className="auth-shell">
      <section className="brand-panel" aria-label="FlyEye introduction">
        <div className="brand-mark" aria-hidden="true">
          <span>F</span>
        </div>
        <div>
          <p className="brand-name">FlyEye</p>
          <p className="brand-tagline">Training clarity. Operational discipline.</p>
        </div>
        <div className="brand-copy">
          <span className="eyebrow eyebrow--light">Secure school access</span>
          <h1>One trusted entry point for every training role.</h1>
          <p>
            Sign in with your invited account. Your school membership and permissions are verified
            by the server before any workspace opens.
          </p>
        </div>
        <p className="safety-note">FlyEye supports authorized people—it does not replace them.</p>
      </section>

      <section className="auth-panel" aria-label="Account access">
        <div className="auth-card">
          <DeferredScreen key={route}>
            {route === 'recovery-request' ? <RecoveryRequestForm gateway={gateway} /> : null}

            {route === 'recovery-complete' ? <PasswordRecoveryFlow gateway={gateway} /> : null}

            {route === 'invitation' ? <InvitationAcceptanceFlow gateway={gateway} /> : null}

            {route === 'sign-in' ? <AuthSignInView gateway={gateway} session={session} /> : null}
          </DeferredScreen>
        </div>
        <footer>
          <span>Private flight-school system</span>
          <span aria-hidden="true">•</span>
          <span>Authorized users only</span>
        </footer>
      </section>
    </main>
  );
}
