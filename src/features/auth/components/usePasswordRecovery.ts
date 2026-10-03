import { type FormEvent, useLayoutEffect, useRef, useState } from 'react';

import { AuthGatewayError, type AuthGateway } from '../services/auth-gateway';
import {
  recoveredPasswordSchema,
  recoveryCredentialFromUrl,
  scrubRecoveryCredential,
} from '../recovery';

type RecoveryState =
  | 'confirmation'
  | 'verifying'
  | 'password'
  | 'updating'
  | 'revoking'
  | 'invalid'
  | 'fail-closed'
  | 'complete';

export type PasswordRecoveryOptions = {
  gateway: AuthGateway;
  isOnline?: () => boolean;
};

function safeMessage(error: unknown): string {
  if (error instanceof AuthGatewayError) return error.message;
  return 'FlyEye could not complete password recovery. Try again.';
}

function safePostChangeMessage(error: unknown): string {
  if (error instanceof AuthGatewayError && error.code === 'revocation_failed') {
    return error.message;
  }
  return 'Your password changed, but session closure could not be confirmed. Sign in again or contact support.';
}

export function usePasswordRecovery({
  gateway,
  isOnline = () => navigator.onLine,
}: PasswordRecoveryOptions) {
  const initialCredential = recoveryCredentialFromUrl(new URL(window.location.href)) ?? undefined;
  const [state, setState] = useState<RecoveryState>(initialCredential ? 'confirmation' : 'invalid');
  const stateRef = useRef<RecoveryState>(initialCredential ? 'confirmation' : 'invalid');
  const [message, setMessage] = useState<string>();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    password?: string;
    confirmation?: string;
  }>({});
  const tokenHashRef = useRef<string | undefined>(initialCredential);
  const operationRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  function operationIsCurrent(operation: number): boolean {
    return operationRef.current === operation;
  }

  function moveTo(nextState: RecoveryState) {
    stateRef.current = nextState;
    setState(nextState);
  }

  useLayoutEffect(() => {
    scrubRecoveryCredential(window.history);
  }, []);

  useLayoutEffect(() => {
    if (
      state === 'confirmation' ||
      state === 'password' ||
      state === 'invalid' ||
      state === 'fail-closed' ||
      state === 'complete'
    ) {
      headingRef.current?.focus();
    }
  }, [state]);

  async function handleVerification() {
    if (stateRef.current !== 'confirmation') return;
    const tokenHash = tokenHashRef.current;
    if (!tokenHash) {
      moveTo('invalid');
      return;
    }
    if (!isOnline()) {
      setMessage('Connect to the internet before continuing.');
      return;
    }

    const operation = ++operationRef.current;
    setMessage(undefined);
    moveTo('verifying');
    try {
      await gateway.verifyRecoveryCredential(tokenHash);
      if (!operationIsCurrent(operation)) return;
      tokenHashRef.current = undefined;
      moveTo('password');
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
      if (error instanceof AuthGatewayError && error.code === 'network_error') {
        setMessage(error.message);
        moveTo('confirmation');
        return;
      }
      tokenHashRef.current = undefined;
      moveTo('invalid');
    }
  }

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stateRef.current !== 'password') return;
    const parsed = recoveredPasswordSchema.safeParse({ password, confirmation });
    if (!parsed.success) {
      const nextErrors: { password?: string; confirmation?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'password') {
          nextErrors.password = 'Use at least 15 characters.';
        }
        if (issue.path[0] === 'confirmation') {
          nextErrors.confirmation = 'Passwords must match.';
        }
      }
      setFieldErrors(nextErrors);
      return;
    }

    if (!isOnline()) {
      setMessage('Connect to the internet before changing your password.');
      return;
    }

    const operation = ++operationRef.current;
    setFieldErrors({});
    setMessage(undefined);
    moveTo('updating');
    try {
      await gateway.updateRecoveredPassword(parsed.data.password);
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
      setPassword('');
      setConfirmation('');
      setMessage(safeMessage(error));
      moveTo('password');
      return;
    }

    try {
      if (!operationIsCurrent(operation)) return;
      setPassword('');
      setConfirmation('');
      moveTo('revoking');
      await gateway.signOutEverywhere();
      if (!operationIsCurrent(operation)) return;
      moveTo('complete');
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
      setPassword('');
      setConfirmation('');
      setMessage(safePostChangeMessage(error));
      moveTo('fail-closed');
    }
  }

  return {
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
    handleVerification,
    handlePasswordUpdate,
  };
}

export type PasswordRecoveryModel = ReturnType<typeof usePasswordRecovery>;
