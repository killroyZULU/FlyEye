import type { useMemberMfaEnrollment } from './useMemberMfaEnrollment';
import { StatePanel } from './StatePanel';

export function MemberMfaVerificationForm({
  flow,
}: {
  flow: ReturnType<typeof useMemberMfaEnrollment>;
}) {
  const {
    state,
    start,
    preparation,
    qrUrl,
    code,
    setCode,
    message,
    manualVisible,
    setManualVisible,
    headingRef,
    codeRef,
    submit,
    cancel,
  } = flow;
  return (
    <StatePanel
      eyebrow="Account security"
      title={
        preparation?.kind === 'enrollment'
          ? 'Set up your authenticator'
          : 'Verify your authenticator'
      }
      headingRef={headingRef}
    >
      <p>
        Organization: <strong>{start?.organizationName}</strong>.
      </p>
      {preparation?.kind === 'enrollment' && qrUrl ? (
        <div className="admin-enrollment-credential">
          <p>Scan this code with your authenticator app, or use the manual setup option.</p>
          <img className="admin-enrollment-qr" src={qrUrl} alt="Authenticator setup QR code" />
          <button
            type="button"
            className="secondary-button"
            onClick={() => setManualVisible((value) => !value)}
            aria-expanded={manualVisible}
          >
            {manualVisible ? 'Hide manual setup key' : 'Show manual setup key'}
          </button>
          {manualVisible ? (
            <p className="manual-secret" aria-label="Manual authenticator setup key">
              {preparation.manualSecret}
            </p>
          ) : null}
        </div>
      ) : (
        <p>Enter the current code from the verified authenticator already on your account.</p>
      )}
      <form
        className="auth-form admin-onboarding-form"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        {message ? (
          <div className="form-error" role="alert">
            {message}
          </div>
        ) : null}
        <div className="field-group">
          <label htmlFor="member-totp-code">Verification code</label>
          <input
            ref={codeRef}
            className="code-input"
            id="member-totp-code"
            name="member-totp-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            disabled={state === 'verifying' || state === 'completing'}
          />
        </div>
        <div className="button-row">
          <button
            className="primary-button"
            type="submit"
            disabled={state === 'verifying' || state === 'completing'}
          >
            {state === 'verifying'
              ? 'Verifying code…'
              : state === 'completing'
                ? 'Confirming readiness…'
                : 'Verify authenticator'}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={state === 'verifying' || state === 'completing'}
            onClick={() => void cancel()}
          >
            Cancel and sign out
          </button>
        </div>
        <p role="status" aria-live="polite">
          {state === 'verifying'
            ? 'The code is being verified.'
            : state === 'completing'
              ? 'FlyEye is confirming authenticator readiness.'
              : ''}
        </p>
      </form>
    </StatePanel>
  );
}
