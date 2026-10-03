import { StatePanel } from './StatePanel';
import { RecoveryPasswordForm } from './RecoveryPasswordForm';
import { usePasswordRecovery, type PasswordRecoveryOptions } from './usePasswordRecovery';
import { RECOVERY_REQUEST_PATH } from '../recovery';

export function PasswordRecoveryFlow(props: PasswordRecoveryOptions) {
  const recovery = usePasswordRecovery(props);
  const { state, message, headingRef, handleVerification } = recovery;

  if (state === 'invalid') {
    return (
      <StatePanel
        eyebrow="Recovery unavailable"
        title="This link cannot be used"
        tone="warning"
        headingRef={headingRef}
      >
        <p>The recovery link is missing, invalid, expired, used, or superseded.</p>
        <a className="primary-link" href={RECOVERY_REQUEST_PATH}>
          Request a new recovery link
        </a>
        <a className="text-link" href="/">
          Return to sign in
        </a>
      </StatePanel>
    );
  }

  if (state === 'fail-closed') {
    return (
      <StatePanel
        eyebrow="Session check incomplete"
        title="Sign in again before continuing"
        tone="warning"
        headingRef={headingRef}
      >
        <p>{message}</p>
        <p>No FlyEye workspace has been opened.</p>
        <a className="primary-link" href="/">
          Return to sign in
        </a>
      </StatePanel>
    );
  }

  if (state === 'complete') {
    return (
      <StatePanel
        eyebrow="Recovery complete"
        title="Your password has changed"
        tone="success"
        headingRef={headingRef}
      >
        <p>Your refresh-token-backed sessions were ended. Sign in again with your new password.</p>
        <a className="primary-link" href="/">
          Continue to sign in
        </a>
      </StatePanel>
    );
  }

  if (state === 'confirmation' || state === 'verifying') {
    return (
      <section className="state-panel" aria-live="polite">
        <span className="eyebrow">Explicit confirmation</span>
        <h2 ref={headingRef} tabIndex={-1}>
          Continue password recovery?
        </h2>
        <p>The link is not used until you choose to continue securely.</p>
        <div className="status-message" role="status" aria-live="polite">
          {message ?? ''}
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={state === 'verifying'}
          onClick={() => void handleVerification()}
        >
          {state === 'verifying' ? 'Verifying securely...' : 'Continue securely'}
        </button>
        <a className="text-link" href="/">
          Cancel and return to sign in
        </a>
      </section>
    );
  }

  return <RecoveryPasswordForm recovery={recovery} />;
}
