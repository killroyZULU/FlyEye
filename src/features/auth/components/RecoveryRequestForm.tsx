import { type FormEvent, useLayoutEffect, useRef, useState } from 'react';

import type { AuthGateway } from '../services/auth-gateway';
import { GENERIC_RECOVERY_ACKNOWLEDGEMENT, recoveryRequestSchema } from '../recovery';

type RecoveryRequestFormProps = {
  gateway: AuthGateway;
  captchaToken?: string;
  isOnline?: () => boolean;
};

export function RecoveryRequestForm({
  gateway,
  captchaToken,
  isOnline = () => navigator.onLine,
}: RecoveryRequestFormProps) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [fieldError, setFieldError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    if (acknowledged) headingRef.current?.focus();
  }, [acknowledged]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = recoveryRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError('Enter a valid email address.');
      return;
    }

    if (!isOnline()) {
      setFieldError(undefined);
      setMessage('Connect to the internet before requesting password recovery.');
      return;
    }

    setFieldError(undefined);
    setMessage(undefined);
    setBusy(true);
    try {
      await gateway.requestPasswordRecovery(parsed.data.email, captchaToken);
    } catch {
      // Syntactically valid public requests retain the same non-enumerating acknowledgement.
    } finally {
      setEmail('');
      setBusy(false);
      setAcknowledged(true);
    }
  }

  if (acknowledged) {
    return (
      <section className="state-panel" aria-live="polite">
        <span className="eyebrow">Check your email</span>
        <h2 ref={headingRef} tabIndex={-1}>
          Recovery request received
        </h2>
        <p>{GENERIC_RECOVERY_ACKNOWLEDGEMENT}</p>
        <p className="privacy-copy">
          For your privacy, FlyEye does not confirm whether an account exists.
        </p>
        <a className="text-link" href="/">
          Return to sign in
        </a>
      </section>
    );
  }

  return (
    <>
      <div className="section-heading">
        <span className="eyebrow">Account recovery</span>
        <h2>Forgot your password?</h2>
        <p>Enter the verified email address used for your invited FlyEye account.</p>
      </div>
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="field-group">
          <label htmlFor="recovery-email">Email address</label>
          <input
            id="recovery-email"
            name="recovery-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            aria-invalid={fieldError ? 'true' : 'false'}
            aria-describedby={fieldError ? 'recovery-email-error' : undefined}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
            autoFocus
          />
          {fieldError ? (
            <span id="recovery-email-error" className="field-error">
              {fieldError}
            </span>
          ) : null}
        </div>

        <div className="status-message" role="status" aria-live="polite">
          {message ?? ''}
        </div>

        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Requesting recovery...' : 'Send recovery instructions'}
        </button>
        <a className="text-link" href="/">
          Return to sign in
        </a>
      </form>
    </>
  );
}
