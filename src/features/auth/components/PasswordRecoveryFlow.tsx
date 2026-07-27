import { type FormEvent, useLayoutEffect, useRef, useState } from 'react';

import { StatePanel } from './StatePanel';
import { AuthGatewayError, type AuthGateway } from '../services/auth-gateway';
import {
  RECOVERY_REQUEST_PATH,
  recoveredPasswordSchema,
  recoveryCredentialFromUrl,
  scrubRecoveryCredential,
} from '../recovery';

type RecoveryState =
  | 'confirmation'
  | 'verifying'
  | 'password'
  | 'updating'
  | 'revoking'
  | 'invalid'
  | 'fail-closed'
  | 'complete';

type PasswordRecoveryFlowProps = {
  gateway: AuthGateway;
  isOnline?: () => boolean;
};

function safeMessage(error: unknown): string {
  if (error instanceof AuthGatewayError) return error.message;
  return 'FlyEye could not complete password recovery. Try again.';
}

function safePostChangeMessage(error: unknown): string {
  if (error instanceof AuthGatewayError && error.code === 'revocation_failed') {
    return error.message;
  }
  return 'Your password changed, but session closure could not be confirmed. Sign in again or contact support.';
}

export function PasswordRecoveryFlow({
  gateway,
  isOnline = () => navigator.onLine,
}: PasswordRecoveryFlowProps) {
  const initialCredential = recoveryCredentialFromUrl(new URL(window.location.href)) ?? undefined;
  const [state, setState] = useState<RecoveryState>(initialCredential ? 'confirmation' : 'invalid');
  const [message, setMessage] = useState<string>();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    password?: string;
    confirmation?: string;
  }>({});
  const tokenHashRef = useRef<string | undefined>(initialCredential);
  const operationRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  function beginOperation(): number {
    operationRef.current += 1;
    return operationRef.current;
  }

  function operationIsCurrent(operation: number): boolean {
    return operationRef.current === operation;
  }

  function moveTo(nextState: RecoveryState) {
    setState(nextState);
  }

  useLayoutEffect(() => {
    scrubRecoveryCredential(window.history);
  }, []);

  useLayoutEffect(() => {
    if (
      state === 'confirmation' ||
      state === 'password' ||
      state === 'invalid' ||
      state === 'fail-closed' ||
      state === 'complete'
    ) {
      headingRef.current?.focus();
    }
  }, [state]);

  async function handleVerification() {
    const tokenHash = tokenHashRef.current;
    if (!tokenHash) {
      moveTo('invalid');
      return;
    }
    if (!isOnline()) {
      setMessage('Connect to the internet before continuing.');
      return;
    }

    const operation = beginOperation();
    setMessage(undefined);
    setState('verifying');
    try {
      await gateway.verifyRecoveryCredential(tokenHash);
      if (!operationIsCurrent(operation)) return;
      tokenHashRef.current = undefined;
      moveTo('password');
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
      if (error instanceof AuthGatewayError && error.code === 'network_error') {
        setMessage(error.message);
        setState('confirmation');
        return;
      }
      tokenHashRef.current = undefined;
      moveTo('invalid');
    }
  }

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = recoveredPasswordSchema.safeParse({ password, confirmation });
    if (!parsed.success) {
      const nextErrors: { password?: string; confirmation?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'password') {
          nextErrors.password = 'Use at least 15 characters.';
        }
        if (issue.path[0] === 'confirmation') {
          nextErrors.confirmation = 'Passwords must match.';
        }
      }
      setFieldErrors(nextErrors);
      return;
    }

    if (!isOnline()) {
      setMessage('Connect to the internet before changing your password.');
      return;
    }

    const operation = beginOperation();
    setFieldErrors({});
    setMessage(undefined);
    setState('updating');
    try {
      await gateway.updateRecoveredPassword(parsed.data.password);
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
      setPassword('');
      setConfirmation('');
      setMessage(safeMessage(error));
      setState('password');
      return;
    }

    try {
      if (!operationIsCurrent(operation)) return;
      setPassword('');
      setConfirmation('');
      setState('revoking');
      await gateway.signOutEverywhere();
      if (!operationIsCurrent(operation)) return;
      moveTo('complete');
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
      setPassword('');
      setConfirmation('');
      setMessage(safePostChangeMessage(error));
      moveTo('fail-closed');
    }
  }

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

  const busy = state === 'updating' || state === 'revoking';
  return (
    <>
      <div className="section-heading">
        <span className="eyebrow">Choose a new password</span>
        <h2 ref={headingRef} tabIndex={-1}>
          Protect your account
        </h2>
        <p>Use at least 15 characters. Spaces, paste, and password managers are supported.</p>
      </div>
      <form className="auth-form" onSubmit={(event) => void handlePasswordUpdate(event)} noValidate>
        <div className="field-group">
          <label htmlFor="new-password">New password</label>
          <div className="password-field">
            <input
              id="new-password"
              name="new-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              aria-invalid={fieldErrors.password ? 'true' : 'false'}
              aria-describedby={fieldErrors.password ? 'new-password-error' : 'password-guidance'}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              className="password-toggle"
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              disabled={busy}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <span id="password-guidance" className="field-guidance">
            Minimum 15 characters; no required uppercase, digit, or symbol pattern.
          </span>
          {fieldErrors.password ? (
            <span id="new-password-error" className="field-error">
              {fieldErrors.password}
            </span>
          ) : null}
        </div>

        <div className="field-group">
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            name="confirm-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmation}
            aria-invalid={fieldErrors.confirmation ? 'true' : 'false'}
            aria-describedby={fieldErrors.confirmation ? 'confirm-password-error' : undefined}
            disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {fieldErrors.confirmation ? (
            <span id="confirm-password-error" className="field-error">
              {fieldErrors.confirmation}
            </span>
          ) : null}
        </div>

        <div className="status-message" role="status" aria-live="polite">
          {state === 'revoking' ? 'Ending refresh-token-backed sessions...' : (message ?? '')}
        </div>

        <button className="primary-button" type="submit" disabled={busy}>
          {state === 'updating' ? 'Changing password...' : 'Change password and end sessions'}
        </button>
      </form>
    </>
  );
}
