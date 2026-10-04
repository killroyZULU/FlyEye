import '../admin-onboarding.css';
import { useMemberMfaEnrollment, type MemberMfaEnrollmentOptions } from './useMemberMfaEnrollment';
import { MemberMfaStatusPanel } from './MemberMfaStatusPanel';
import { MemberMfaVerificationForm } from './MemberMfaVerificationForm';
import { StatePanel } from './StatePanel';

type Props = MemberMfaEnrollmentOptions & {
  requiredForAccess?: boolean;
  onCompleted: () => void;
};

export function MemberMfaEnrollmentFlow({
  gateway,
  requiredForAccess = false,
  onCompleted,
  onClose,
  onRequirePassword,
}: Props) {
  const flow = useMemberMfaEnrollment({ gateway, onClose, onRequirePassword });
  const { state, start, preparation, message, headingRef, cancel, retryCompletion } = flow;
  if (state === 'loading' || state === 'starting' || state === 'preparing') {
    return (
      <StatePanel eyebrow="Account security" title="Checking authenticator state">
        <div className="loading-line" aria-hidden="true" />
        <p role="status" aria-live="polite">
          FlyEye is verifying your membership and current authenticator inventory.
        </p>
      </StatePanel>
    );
  }

  if (state === 'failure') {
    return (
      <StatePanel
        eyebrow="Account security"
        title="Authenticator setup is blocked"
        headingRef={headingRef}
        tone="warning"
      >
        <p role="alert">{message}</p>
        <p>No role or permission was changed. Contact support if the problem continues.</p>
        <button className="secondary-button" type="button" onClick={() => void cancel()}>
          {start ? 'Cancel and sign out' : 'Close'}
        </button>
      </StatePanel>
    );
  }

  if (state === 'success') {
    return (
      <StatePanel
        eyebrow="Account security"
        title="Authenticator is ready"
        headingRef={headingRef}
        tone="success"
      >
        <p>
          Your TOTP authenticator was verified. This readiness does not change your role or
          permissions.
        </p>
        <button className="primary-button" type="button" onClick={onCompleted}>
          {requiredForAccess ? 'Continue to workspace' : 'Return to workspace'}
        </button>
      </StatePanel>
    );
  }

  if (state === 'completion_failed' || (state === 'completing' && !preparation)) {
    return (
      <StatePanel
        eyebrow="Account security"
        title="Confirm authenticator readiness"
        headingRef={headingRef}
        tone={state === 'completion_failed' ? 'warning' : undefined}
      >
        <p role={message ? 'alert' : 'status'}>
          {message ?? 'FlyEye is confirming authenticator readiness.'}
        </p>
        <p>Your authenticator code was verified. No role or permission was changed.</p>
        <div className="button-row">
          <button
            className="primary-button"
            type="button"
            disabled={state === 'completing'}
            onClick={() => void retryCompletion()}
          >
            {state === 'completing' ? 'Confirming readiness…' : 'Retry confirmation'}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={state === 'completing'}
            onClick={() => void cancel()}
          >
            Cancel and sign out
          </button>
        </div>
      </StatePanel>
    );
  }

  if (state === 'status') {
    return (
      <MemberMfaStatusPanel
        flow={flow}
        requiredForAccess={requiredForAccess}
        onCompleted={onCompleted}
        onClose={onClose}
      />
    );
  }
  return <MemberMfaVerificationForm flow={flow} />;
}
