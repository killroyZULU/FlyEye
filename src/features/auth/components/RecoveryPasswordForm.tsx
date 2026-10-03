import type { PasswordRecoveryModel } from './usePasswordRecovery';

export function RecoveryPasswordForm({ recovery }: { recovery: PasswordRecoveryModel }) {
  const {
    state,
    message,
    password,
    setPassword,
    confirmation,
    setConfirmation,
    showPassword,
    setShowPassword,
    fieldErrors,
    headingRef,
    handlePasswordUpdate,
  } = recovery;
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
