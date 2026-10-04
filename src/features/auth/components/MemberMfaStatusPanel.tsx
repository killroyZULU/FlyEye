import type { useMemberMfaEnrollment } from './useMemberMfaEnrollment';
import { StatePanel } from './StatePanel';

type Props = {
  flow: Pick<
    ReturnType<typeof useMemberMfaEnrollment>,
    'status' | 'headingRef' | 'begin' | 'resume' | 'cancel'
  >;
  requiredForAccess: boolean;
  onCompleted: () => void;
  onClose: () => void;
};

export function MemberMfaStatusPanel({ flow, requiredForAccess, onCompleted, onClose }: Props) {
  const { status, headingRef, begin, resume, cancel } = flow;
  return (
    <StatePanel
      eyebrow="Account security"
      title={
        status?.ready
          ? 'Authenticator is ready'
          : status?.operationState
            ? 'Incomplete authenticator setup'
            : 'Set up an authenticator'
      }
      headingRef={headingRef}
      tone={status?.ready ? 'success' : undefined}
    >
      <p>
        {status?.ready
          ? 'FlyEye has confirmed your current TOTP authenticator.'
          : status?.operationState === 'bound'
            ? 'A previous setup did not finish. Resume it with the authenticator you already scanned.'
            : status?.operationState === 'started'
              ? 'A previous setup stopped before an authenticator was created. Cancel it safely before starting again.'
              : 'Use an authenticator app to add a time-based verification code to your account.'}
      </p>
      <p>This does not change your role or grant additional permissions.</p>
      {status?.ready ? (
        <button className="primary-button" type="button" onClick={onCompleted}>
          Return to workspace
        </button>
      ) : status?.operationState === 'bound' ? (
        <button className="primary-button" type="button" onClick={() => void resume()}>
          Resume secure setup
        </button>
      ) : status?.operationState === 'started' ? (
        <button className="primary-button" type="button" onClick={() => void cancel()}>
          Cancel incomplete setup
        </button>
      ) : (
        <button className="primary-button" type="button" onClick={() => void begin()}>
          Begin secure setup
        </button>
      )}
      {!requiredForAccess ? (
        <button className="text-button" type="button" onClick={onClose}>
          Close
        </button>
      ) : null}
    </StatePanel>
  );
}
