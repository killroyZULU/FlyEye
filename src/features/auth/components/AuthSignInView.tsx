import { lazy } from 'react';
import { DeferredScreen } from './DeferredScreen';
import type { AuthGateway } from '../services/auth-gateway';
import type { AuthSession } from '../useAuthSession';
import { RECOVERY_REQUEST_PATH } from '../recovery';
import { LoginForm } from './LoginForm';
import { MfaForm } from './MfaForm';
import { StatePanel } from './StatePanel';

const AdminOnboardingFlow = lazy(() =>
  import('./AdminOnboardingFlow').then((module) => ({ default: module.AdminOnboardingFlow })),
);
const MemberMfaEnrollmentFlow = lazy(() =>
  import('./MemberMfaEnrollmentFlow').then((module) => ({
    default: module.MemberMfaEnrollmentFlow,
  })),
);
type AuthSignInViewProps = { gateway: AuthGateway; session: AuthSession };
export function AuthSignInView({ gateway, session }: AuthSignInViewProps) {
  const {
    state,
    message,
    adminOnboardingStart,
    handleSignIn,
    handleAdminOnboardingCompleted,
    handleAdminOnboardingCancelled,
    loadAccess,
    handleSignOut,
    returnToPassword,
    handleMfa,
  } = session;
  return (
    <>
      {state === 'checking-session' ||
      state === 'loading-access' ||
      state === 'starting-admin-onboarding' ? (
        <StatePanel eyebrow="Secure access" title="Verifying your session">
          <div className="loading-line" aria-hidden="true" />
          <p>
            Please wait while FlyEye checks your account, school access, and eligible onboarding
            context.
          </p>
        </StatePanel>
      ) : null}

      {state === 'signed-out' || state === 'signing-in' ? (
        <>
          <div className="section-heading">
            <span className="eyebrow">Welcome back</span>
            <h2>Sign in to FlyEye</h2>
            <p>Use the email address from your school invitation.</p>
          </div>
          <LoginForm busy={state === 'signing-in'} message={message} onSubmit={handleSignIn} />
          <a className="text-link" href={RECOVERY_REQUEST_PATH}>
            Forgot password?
          </a>
          <p className="support-copy">
            Accounts are invitation-only. Contact your school administrator if you need access.
          </p>
        </>
      ) : null}

      {state === 'admin-onboarding' && adminOnboardingStart ? (
        <DeferredScreen
          key="admin-onboarding"
          onLeave={() => void handleSignOut()}
          leaveLabel="Sign out"
        >
          <AdminOnboardingFlow
            gateway={gateway}
            start={adminOnboardingStart}
            onCompleted={handleAdminOnboardingCompleted}
            onCancelled={handleAdminOnboardingCancelled}
          />
        </DeferredScreen>
      ) : null}

      {state === 'member-mfa-enrollment' ? (
        <DeferredScreen key="member-mfa" onLeave={() => void handleSignOut()} leaveLabel="Sign out">
          <MemberMfaEnrollmentFlow
            gateway={gateway}
            requiredForAccess
            onCompleted={() => void loadAccess()}
            onClose={() => void handleSignOut()}
            onRequirePassword={(reason) => void returnToPassword(reason)}
          />
        </DeferredScreen>
      ) : null}

      {state === 'mfa-required' || state === 'verifying-mfa' ? (
        <MfaForm
          busy={state === 'verifying-mfa'}
          message={message}
          onSubmit={handleMfa}
          onCancel={handleSignOut}
        />
      ) : null}

      {state === 'empty' ? (
        <StatePanel eyebrow="No active access" title="Your account is not assigned" tone="warning">
          <p>
            Authentication succeeded, but no active FlyEye school membership was found. Contact your
            school administrator.
          </p>
          <button className="text-button" type="button" onClick={() => void handleSignOut()}>
            Return to sign in
          </button>
        </StatePanel>
      ) : null}

      {state === 'unauthorized' ? (
        <StatePanel
          eyebrow="Access unavailable"
          title="You cannot enter this workspace"
          tone="warning"
        >
          <p>{message}</p>
          <button className="text-button" type="button" onClick={() => void handleSignOut()}>
            Return to sign in
          </button>
        </StatePanel>
      ) : null}

      {state === 'conflict' ? (
        <StatePanel
          eyebrow="Access conflict"
          title="Administrator review is required"
          tone="warning"
        >
          <p>{message}</p>
          <button className="text-button" type="button" onClick={() => void handleSignOut()}>
            Return to sign in
          </button>
        </StatePanel>
      ) : null}

      {state === 'error' ? (
        <StatePanel
          eyebrow="Connection problem"
          title="Access could not be verified"
          tone="warning"
        >
          <p>{message}</p>
          <button className="primary-button" type="button" onClick={() => void loadAccess()}>
            Try again
          </button>
          <button className="text-button" type="button" onClick={() => void handleSignOut()}>
            Sign out
          </button>
        </StatePanel>
      ) : null}
    </>
  );
}
