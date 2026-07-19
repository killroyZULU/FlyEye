import { type FormEvent, useState } from 'react';

type MfaFormProps = {
  busy: boolean;
  message?: string;
  onSubmit: (code: string) => Promise<void>;
  onCancel: () => Promise<void>;
};

export function MfaForm({ busy, message, onSubmit, onCancel }: MfaFormProps) {
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setFieldError('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setFieldError(undefined);
    await onSubmit(code);
  }

  return (
    <form className="auth-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <div className="section-heading">
        <span className="eyebrow">Second step</span>
        <h2>Verify your identity</h2>
        <p>Enter the current code from your registered authenticator.</p>
      </div>

      <div className="field-group">
        <label htmlFor="verification-code">Verification code</label>
        <input
          id="verification-code"
          className="code-input"
          name="verification-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          aria-invalid={fieldError ? 'true' : 'false'}
          aria-describedby={fieldError ? 'verification-error' : undefined}
          disabled={busy}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          autoFocus
        />
        {fieldError ? (
          <span id="verification-error" className="field-error">
            {fieldError}
          </span>
        ) : null}
      </div>

      <div className="status-message" role="status" aria-live="polite">
        {message ?? ''}
      </div>

      <button className="primary-button" type="submit" disabled={busy}>
        {busy ? 'Verifying…' : 'Verify and continue'}
      </button>
      <button className="text-button" type="button" disabled={busy} onClick={() => void onCancel()}>
        Sign out
      </button>
    </form>
  );
}
