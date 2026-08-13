import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import '../admin-onboarding.css';
import {
  createMemberMfaIdempotencyKey,
  type MemberMfaStart,
  type MemberMfaStatus,
} from '../member-mfa';
import type { TotpPreparation } from '../admin-onboarding';
import {
  AuthGatewayError,
  type AuthGateway,
  type AuthGatewayErrorCode,
} from '../services/auth-gateway';
import { StatePanel } from './StatePanel';

type Props = {
  gateway: AuthGateway;
  requiredForAccess?: boolean;
  onCompleted: () => void;
  onClose: () => void;
  onRequirePassword: (reason: string) => void;
};

type FlowState =
  | 'loading'
  | 'status'
  | 'starting'
  | 'preparing'
  | 'ready'
  | 'verifying'
  | 'completing'
  | 'completion_failed'
  | 'success'
  | 'failure';

type DisplayPreparation =
  | { kind: 'enrollment'; factorId: string; manualSecret: string }
  | { kind: 'challenge'; factorId: string };

function safeError(error: unknown): { code: AuthGatewayErrorCode; message: string } {
  return error instanceof AuthGatewayError
    ? { code: error.code, message: error.message }
    : { code: 'unknown', message: 'Authenticator setup could not be confirmed. Try again.' };
}

export function MemberMfaEnrollmentFlow({
  gateway,
  requiredForAccess = false,
  onCompleted,
  onClose,
  onRequirePassword,
}: Props) {
  const [state, setState] = useState<FlowState>('loading');
  const [status, setStatus] = useState<MemberMfaStatus>();
  const [start, setStart] = useState<MemberMfaStart>();
  const [preparation, setPreparation] = useState<DisplayPreparation>();
  const [qrUrl, setQrUrl] = useState<string>();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string>();
  const [manualVisible, setManualVisible] = useState(false);
  const startKey = useRef(createMemberMfaIdempotencyKey());
  const bindKey = useRef(createMemberMfaIdempotencyKey());
  const completeKey = useRef(createMemberMfaIdempotencyKey());
  const cancelKey = useRef(createMemberMfaIdempotencyKey());
  const operation = useRef(0);
  const qrRef = useRef<string | undefined>(undefined);
  const factorIdRef = useRef<string | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (
      state === 'status' ||
      state === 'ready' ||
      state === 'completion_failed' ||
      state === 'success' ||
      state === 'failure'
    ) {
      headingRef.current?.focus();
    }
  }, [state]);

  function clearCredential() {
    if (qrRef.current) URL.revokeObjectURL(qrRef.current);
    qrRef.current = undefined;
    setQrUrl(undefined);
    setPreparation(undefined);
    setManualVisible(false);
    setCode('');
  }

  useEffect(() => {
    const current = ++operation.current;
    void gateway
      .loadMemberMfaStatus()
      .then((result) => {
        if (operation.current !== current) return;
        setStatus(result);
        if (result.operationState && result.operationId && result.operationVersion) {
          setStart({
            decision: 'ready',
            operationId: result.operationId,
            organizationId: result.organizationId,
            organizationName: result.organizationName,
            membershipId: result.membershipId,
            operationVersion: result.operationVersion,
            replayed: false,
            factorState:
              result.operationState === 'bound' ? 'challenge_required' : 'enrollment_required',
            correlationId: result.correlationId,
          });
        }
        setState('status');
      })
      .catch((error: unknown) => {
        if (operation.current !== current) return;
        const safe = safeError(error);
        if (safe.code === 'member_mfa_recent_authentication_required') {
          onRequirePassword(safe.message);
          return;
        }
        setMessage(safe.message);
        setState('failure');
      });
    return () => {
      operation.current += 1;
      if (qrRef.current) URL.revokeObjectURL(qrRef.current);
      factorIdRef.current = undefined;
    };
  }, [gateway, onRequirePassword]);

  async function begin() {
    const current = ++operation.current;
    setState('starting');
    setMessage(undefined);
    try {
      const started = await gateway.startMemberMfaEnrollment(startKey.current);
      if (operation.current !== current) return;
      setStart(started);
      setState('preparing');
      const prepared: TotpPreparation = await gateway.prepareMemberTotp(started, bindKey.current);
      if (operation.current !== current) return;
      factorIdRef.current = prepared.factorId;
      if (prepared.kind === 'enrollment') {
        const nextUrl = URL.createObjectURL(
          new Blob([prepared.qrSvg], { type: 'image/svg+xml;charset=utf-8' }),
        );
        qrRef.current = nextUrl;
        setQrUrl(nextUrl);
        setPreparation({
          kind: 'enrollment',
          factorId: prepared.factorId,
          manualSecret: prepared.manualSecret,
        });
      } else {
        setPreparation(prepared);
      }
      setState('ready');
    } catch (error) {
      if (operation.current !== current) return;
      const safe = safeError(error);
      if (safe.code === 'member_mfa_recent_authentication_required') {
        onRequirePassword(safe.message);
        return;
      }
      setMessage(safe.message);
      setState('failure');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!start || !preparation || !/^\d{6}$/.test(code)) {
      setMessage('Enter the six-digit code from your authenticator app.');
      requestAnimationFrame(() => codeRef.current?.focus());
      return;
    }
    const current = ++operation.current;
    setState('verifying');
    setMessage(undefined);
    try {
      await gateway.verifyMemberTotp(preparation.factorId, code);
      if (operation.current !== current) return;
      setState('completing');
      clearCredential();
      await gateway.completeMemberMfaEnrollment(start, completeKey.current);
      if (operation.current !== current) return;
      factorIdRef.current = undefined;
      setState('success');
    } catch (error) {
      if (operation.current !== current) return;
      const safe = safeError(error);
      setMessage(safe.message);
      if (safe.code === 'mfa_invalid') {
        setState('ready');
        requestAnimationFrame(() => codeRef.current?.focus());
      } else if (safe.code === 'member_mfa_recent_authentication_required') {
        clearCredential();
        onRequirePassword(safe.message);
      } else {
        clearCredential();
        setState('completion_failed');
      }
    }
  }

  async function retryCompletion() {
    if (!start) return;
    const current = ++operation.current;
    setState('completing');
    setMessage(undefined);
    try {
      await gateway.completeMemberMfaEnrollment(start, completeKey.current);
      if (operation.current !== current) return;
      factorIdRef.current = undefined;
      setState('success');
    } catch (error) {
      if (operation.current !== current) return;
      const safe = safeError(error);
      if (safe.code === 'member_mfa_recent_authentication_required') {
        onRequirePassword(safe.message);
        return;
      }
      setMessage(safe.message);
      setState('completion_failed');
    }
  }

  async function cancel() {
    operation.current += 1;
    const factorId = factorIdRef.current;
    clearCredential();
    if (!start) {
      onClose();
      return;
    }
    setMessage('Cancelling authenticator setup and signing you out.');
    try {
      await gateway.cancelMemberMfaEnrollment(start, factorId, cancelKey.current);
    } catch (error) {
      setMessage(safeError(error).message);
    } finally {
      factorIdRef.current = undefined;
      onRequirePassword(
        factorId
          ? 'Authenticator setup remains incomplete and was retained safely. Sign in to resume.'
          : 'Authenticator setup was cancelled. Sign in to continue.',
      );
    }
  }

  async function resume() {
    if (!start) return;
    const current = ++operation.current;
    setState('preparing');
    setMessage(undefined);
    try {
      const prepared = await gateway.prepareMemberTotp(start, bindKey.current);
      if (operation.current !== current) return;
      factorIdRef.current = prepared.factorId;
      setPreparation(prepared);
      setState('ready');
    } catch (error) {
      if (operation.current !== current) return;
      setMessage(safeError(error).message);
      setState('failure');
    }
  }

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
