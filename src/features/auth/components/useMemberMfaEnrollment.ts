import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';

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

export type MemberMfaEnrollmentOptions = {
  gateway: AuthGateway;
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

function interruptedStart(status: MemberMfaStatus): MemberMfaStart | undefined {
  if (!status.operationState || !status.operationId || !status.operationVersion) return;
  return {
    decision: 'ready',
    operationId: status.operationId,
    organizationId: status.organizationId,
    organizationName: status.organizationName,
    membershipId: status.membershipId,
    operationVersion: status.operationVersion,
    replayed: false,
    factorState: status.operationState === 'bound' ? 'challenge_required' : 'enrollment_required',
    correlationId: status.correlationId,
  };
}

function useMemberMfaCredential() {
  const [preparation, setPreparation] = useState<DisplayPreparation>();
  const [qrUrl, setQrUrl] = useState<string>();
  const [code, setCode] = useState('');
  const [manualVisible, setManualVisible] = useState(false);
  const qrRef = useRef<string | undefined>(undefined);
  const codeRef = useRef<HTMLInputElement>(null);

  const revokeQr = useCallback(() => {
    if (qrRef.current) URL.revokeObjectURL(qrRef.current);
  }, []);

  function clearCredential() {
    revokeQr();
    qrRef.current = undefined;
    setQrUrl(undefined);
    setPreparation(undefined);
    setManualVisible(false);
    setCode('');
  }

  function showEnrollment(prepared: Extract<TotpPreparation, { kind: 'enrollment' }>) {
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
  }

  return {
    view: { preparation, qrUrl, code, setCode, manualVisible, setManualVisible, codeRef },
    revokeQr,
    clearCredential,
    showEnrollment,
    setPreparation,
  };
}

export function useMemberMfaEnrollment({
  gateway,
  onClose,
  onRequirePassword,
}: MemberMfaEnrollmentOptions) {
  const [state, setState] = useState<FlowState>('loading');
  const [status, setStatus] = useState<MemberMfaStatus>();
  const [start, setStart] = useState<MemberMfaStart>();
  const [message, setMessage] = useState<string>();
  const {
    view: credential,
    revokeQr,
    clearCredential,
    showEnrollment,
    setPreparation,
  } = useMemberMfaCredential();
  const { preparation, code, codeRef } = credential;
  const startKey = useRef(createMemberMfaIdempotencyKey());
  const bindKey = useRef(createMemberMfaIdempotencyKey());
  const completeKey = useRef(createMemberMfaIdempotencyKey());
  const cancelKey = useRef(createMemberMfaIdempotencyKey());
  const operation = useRef(0);
  const factorIdRef = useRef<string | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);

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

  useEffect(() => {
    const current = ++operation.current;
    void gateway
      .loadMemberMfaStatus()
      .then((result) => {
        if (operation.current !== current) return;
        setStatus(result);
        const interrupted = interruptedStart(result);
        if (interrupted) setStart(interrupted);
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
      revokeQr();
      factorIdRef.current = undefined;
    };
  }, [gateway, onRequirePassword, revokeQr]);

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
        showEnrollment(prepared);
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

  return {
    state,
    status,
    start,
    ...credential,
    message,
    headingRef,
    begin,
    submit,
    retryCompletion,
    cancel,
    resume,
  };
}
