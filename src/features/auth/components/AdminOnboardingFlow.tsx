import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import '../admin-onboarding.css';
import {
  createOpaqueIdempotencyKey,
  type AdminOnboardingComplete,
  type AdminOnboardingStart,
  type TotpPreparation,
} from '../admin-onboarding';
import {
  AuthGatewayError,
  type AuthGateway,
  type AuthGatewayErrorCode,
} from '../services/auth-gateway';
import { StatePanel } from './StatePanel';

type AdminOnboardingFlowProps = {
  gateway: AuthGateway;
  start: AdminOnboardingStart;
  onCompleted: (result: AdminOnboardingComplete) => void;
  onCancelled: () => void;
};

type FlowState = 'preparing' | 'ready' | 'verifying' | 'completing' | 'rate-limited' | 'failure';

type DisplayPreparation =
  | {
      kind: 'enrollment';
      factorId: string;
      manualSecret: string;
    }
  | {
      kind: 'challenge';
      factorId: string;
    };

function safeError(error: unknown): { code: AuthGatewayErrorCode; message: string } {
  if (error instanceof AuthGatewayError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'unknown',
    message: 'Administrator onboarding could not be verified. Try again.',
  };
}

export function AdminOnboardingFlow({
  gateway,
  start,
  onCompleted,
  onCancelled,
}: AdminOnboardingFlowProps) {
  const [state, setState] = useState<FlowState>('preparing');
  const [preparation, setPreparation] = useState<DisplayPreparation>();
  const [qrImageUrl, setQrImageUrl] = useState<string>();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string>();
  const [manualSecretVisible, setManualSecretVisible] = useState(false);
  const completeKeyRef = useRef(createOpaqueIdempotencyKey());
  const cancelKeyRef = useRef(createOpaqueIdempotencyKey());
  const preparationRequestRef = useRef<
    | {
        factorState: AdminOnboardingStart['factorState'];
        request: Promise<TotpPreparation>;
      }
    | undefined
  >(undefined);
  const qrImageUrlRef = useRef<string | undefined>(undefined);
  const operationRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (state === 'ready' || state === 'failure' || state === 'rate-limited') {
      headingRef.current?.focus();
    }
  }, [state]);

  useEffect(() => {
    const operation = ++operationRef.current;

    if (preparationRequestRef.current?.factorState !== start.factorState) {
      preparationRequestRef.current = {
        factorState: start.factorState,
        request: gateway.prepareAdminTotp(start.factorState),
      };
    }

    void preparationRequestRef.current.request
      .then((prepared) => {
        if (operationRef.current !== operation) return;
        preparationRequestRef.current = undefined;

        if (prepared.kind === 'enrollment') {
          let nextQrImageUrl: string;
          try {
            nextQrImageUrl = URL.createObjectURL(
              new Blob([prepared.qrSvg], { type: 'image/svg+xml;charset=utf-8' }),
            );
          } catch {
            setMessage('Authenticator enrollment could not be prepared safely.');
            setState('failure');
            return;
          }

          if (operationRef.current !== operation) {
            URL.revokeObjectURL(nextQrImageUrl);
            return;
          }
          if (qrImageUrlRef.current) {
            URL.revokeObjectURL(qrImageUrlRef.current);
          }
          qrImageUrlRef.current = nextQrImageUrl;
          setQrImageUrl(nextQrImageUrl);
          setPreparation({
            kind: 'enrollment',
            factorId: prepared.factorId,
            manualSecret: prepared.manualSecret,
          });
        } else {
          setPreparation(prepared);
        }
        setState('ready');
      })
      .catch((error: unknown) => {
        if (operationRef.current !== operation) return;
        preparationRequestRef.current = undefined;
        const safe = safeError(error);
        setMessage(safe.message);
        setState(safe.code === 'rate_limited' ? 'rate-limited' : 'failure');
      });

    return () => {
      operationRef.current += 1;
      if (qrImageUrlRef.current) {
        URL.revokeObjectURL(qrImageUrlRef.current);
        qrImageUrlRef.current = undefined;
      }
      setPreparation(undefined);
      setQrImageUrl(undefined);
      setManualSecretVisible(false);
    };
  }, [gateway, start.factorState]);

  function clearEnrollmentCredential() {
    if (qrImageUrlRef.current) {
      URL.revokeObjectURL(qrImageUrlRef.current);
      qrImageUrlRef.current = undefined;
    }
    setPreparation(undefined);
    setQrImageUrl(undefined);
    setManualSecretVisible(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preparation || !/^\d{6}$/.test(code)) {
      setMessage('Enter the six-digit code from your authenticator app.');
      requestAnimationFrame(() => codeRef.current?.focus());
      return;
    }

    const operation = ++operationRef.current;
    setState('verifying');
    setMessage(undefined);
    try {
      await gateway.verifyAdminTotp(preparation.factorId, code);
      if (operationRef.current !== operation) return;
      setState('completing');
      clearEnrollmentCredential();
      setCode('');
      const result = await gateway.completeAdminOnboarding(start, completeKeyRef.current);
      if (operationRef.current !== operation) return;
      onCompleted(result);
    } catch (error) {
      if (operationRef.current !== operation) return;
      const safe = safeError(error);
      setMessage(safe.message);
      if (safe.code === 'mfa_invalid') {
        setState('ready');
        requestAnimationFrame(() => codeRef.current?.focus());
      } else {
        clearEnrollmentCredential();
        setCode('');
        setState(safe.code === 'rate_limited' ? 'rate-limited' : 'failure');
      }
    }
  }

  async function handleCancel() {
    operationRef.current += 1;
    clearEnrollmentCredential();
    setCode('');
    setMessage('Cancelling onboarding and signing you out.');
    try {
      await gateway.cancelAdminOnboarding(start.bootstrapGrantId, cancelKeyRef.current);
    } catch {
      // Local state is still cleared and the user is signed out when cancellation is uncertain.
    } finally {
      onCancelled();
    }
  }

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
