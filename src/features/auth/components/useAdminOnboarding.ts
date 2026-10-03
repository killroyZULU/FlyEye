import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

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

export type AdminOnboardingOptions = {
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

export function useAdminOnboarding({
  gateway,
  start,
  onCompleted,
  onCancelled,
}: AdminOnboardingOptions) {
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

  return {
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
  };
}
