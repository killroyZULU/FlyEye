import '../admin-onboarding.css';
import { StatePanel } from './StatePanel';
import { useAdminOnboarding, type AdminOnboardingOptions } from './useAdminOnboarding';

export function AdminOnboardingFlow(props: AdminOnboardingOptions) {
  const { start } = props;
  const {
    state,
    preparation,
    qrImageUrl,
    code,
    setCode,
    message,
    manualSecretVisible,
    setManualSecretVisible,
    headingRef,
    codeRef,
    handleSubmit,
    handleCancel,
  } = useAdminOnboarding(props);

  if (state === 'preparing') {
    return (
      <StatePanel eyebrow="Administrator onboarding" title="Checking authenticator state">
        <p role="status" aria-live="polite">
          Confirming the current factor inventory before onboarding continues.
        </p>
      </StatePanel>
    );
  }

  if (state === 'failure' || state === 'rate-limited') {
    return (
      <StatePanel
        eyebrow="Administrator onboarding"
        title={state === 'rate-limited' ? 'Wait before trying again' : 'Onboarding is blocked'}
        headingRef={headingRef}
      >
        <p role="alert">{message}</p>
        <p>
          No membership or administrative authority has been created. Factor replacement,
          lost-device recovery, and support bypass are not available in this local outcome.
        </p>
        <button type="button" className="secondary-button" onClick={() => void handleCancel()}>
          Cancel and sign out
        </button>
      </StatePanel>
    );
  }

  return (
    <StatePanel
      eyebrow="Administrator onboarding"
      title={
        preparation?.kind === 'enrollment'
          ? 'Set up your authenticator'
          : 'Verify your authenticator'
      }
      headingRef={headingRef}
    >
      <p>
        Organization: <strong>{start.organizationName}</strong>. This creates only the first
        Organization Admin membership and grants no operational or aviation authority.
      </p>

      {preparation?.kind === 'enrollment' && qrImageUrl ? (
        <div className="admin-enrollment-credential">
          <p>Scan this code with your authenticator app, or use the manual setup option.</p>
          <img className="admin-enrollment-qr" src={qrImageUrl} alt="Authenticator setup QR code" />
          <button
            type="button"
            className="secondary-button"
            onClick={() => setManualSecretVisible((visible) => !visible)}
            aria-expanded={manualSecretVisible}
          >
            {manualSecretVisible ? 'Hide manual setup key' : 'Show manual setup key'}
          </button>
          {manualSecretVisible ? (
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
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        {message ? (
          <div className="form-error" role="alert">
            {message}
          </div>
        ) : null}
        <div className="field-group">
          <label htmlFor="admin-totp-code">Verification code</label>
          <input
            ref={codeRef}
            className="code-input"
            id="admin-totp-code"
            name="admin-totp-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            aria-describedby="admin-totp-guidance"
            disabled={state === 'verifying' || state === 'completing'}
          />
          <p id="admin-totp-guidance" className="field-guidance">
            Codes contain six digits. If a valid code is rejected, check that the authenticator
            device time is synchronized.
          </p>
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
                ? 'Creating administrator…'
                : 'Verify and create administrator'}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={state === 'verifying' || state === 'completing'}
            onClick={() => void handleCancel()}
          >
            Cancel and sign out
          </button>
        </div>
        <p role="status" aria-live="polite">
          {state === 'verifying'
            ? 'The authenticator code is being verified.'
            : state === 'completing'
              ? 'The first administrator transaction is being completed.'
              : ''}
        </p>
      </form>
    </StatePanel>
  );
}
