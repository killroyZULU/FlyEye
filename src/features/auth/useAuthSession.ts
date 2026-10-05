import { useEffect, useRef, useState } from 'react';
import type { AccessMembership, LoginRequest } from '../../lib/access-context';
import type { AdminOnboardingStart } from './admin-onboarding';
import type { AuthGateway } from './services/auth-gateway';
import type { WorkspaceView } from './workspace-navigation';
import { safeError, type AuthState, type AuthRoute } from './auth-app-state';
import { createAuthAccessActions } from './createAuthAccessActions';

export function useAuthSession(gateway: AuthGateway, route: AuthRoute) {
  const [state, setState] = useState<AuthState>('checking-session');
  const [message, setMessage] = useState<string>();
  const [adminOnboardingStart, setAdminOnboardingStart] = useState<AdminOnboardingStart>();
  const [activeMembership, setActiveMembership] = useState<AccessMembership>();
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('home');
  const mountedRef = useRef(true);
  const operationRef = useRef(0);

  function beginOperation(): number {
    operationRef.current += 1;
    return operationRef.current;
  }

  function operationIsCurrent(operation: number): boolean {
    return mountedRef.current && operationRef.current === operation;
  }

  function invalidateOperations() {
    operationRef.current += 1;
  }

  function loadAccess() {
    return createAuthAccessActions({
      gateway,
      beginOperation,
      operationIsCurrent,
      setState,
      setMessage,
      setActiveMembership,
      setAdminOnboardingStart,
      returnToPassword,
    }).loadAccess();
  }

  useEffect(() => {
    mountedRef.current = true;
    if (route !== 'sign-in') {
      return () => {
        mountedRef.current = false;
        invalidateOperations();
      };
    }

    async function restoreSession() {
      const operation = beginOperation();
      try {
        const hasSession = await gateway.hasSession();
        if (!operationIsCurrent(operation)) return;
        if (!hasSession) {
          setState('signed-out');
          return;
        }
        await loadAccess();
      } catch (error) {
        if (!operationIsCurrent(operation)) return;
        const safe = safeError(error);
        setMessage(safe.message);
        setState('error');
      }
    }

    const unsubscribe = gateway.onSignedOut(() => {
      invalidateOperations();
      if (mountedRef.current) {
        setActiveMembership(undefined);
        setAdminOnboardingStart(undefined);
        setWorkspaceView('home');
        setMessage('Your session ended. Sign in to continue.');
        setState('signed-out');
      }
    });

    void restoreSession();
    return () => {
      mountedRef.current = false;
      invalidateOperations();
      unsubscribe();
    };
    // The gateway is an application-lifetime dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, route]);

  async function returnToPassword(reason: string) {
    invalidateOperations();
    try {
      await gateway.signOut();
    } finally {
      if (mountedRef.current) {
        setActiveMembership(undefined);
        setAdminOnboardingStart(undefined);
        setWorkspaceView('home');
        setMessage(reason);
        setState('signed-out');
      }
    }
  }

  function handleAdminOnboardingCompleted() {
    setAdminOnboardingStart(undefined);
    void loadAccess();
  }

  function handleAdminOnboardingCancelled() {
    invalidateOperations();
    setActiveMembership(undefined);
    setAdminOnboardingStart(undefined);
    setWorkspaceView('home');
    setMessage('Administrator onboarding was cancelled. Sign in to begin again.');
    setState('signed-out');
  }

  async function handleSignIn(request: LoginRequest) {
    const operation = beginOperation();
    setState('signing-in');
    setMessage(undefined);
    try {
      await gateway.signIn(request);
      if (!operationIsCurrent(operation)) return;
      await loadAccess();
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
      const safe = safeError(error);
      setMessage(safe.message);
      setState('signed-out');
    }
  }

  async function handleMfa(code: string) {
    const operation = beginOperation();
    setState('verifying-mfa');
    setMessage(undefined);
    try {
      await gateway.verifyTotp(code);
      if (!operationIsCurrent(operation)) return;
      if (!activeMembership?.organizationId) {
        setMessage('Your school access is no longer available.');
        setState('unauthorized');
        return;
      }
      await loadAccess();
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
      const safe = safeError(error);
      setMessage(safe.message);
      setState(safe.code === 'mfa_enrollment_required' ? 'unauthorized' : 'mfa-required');
    }
  }

  async function handleSignOut() {
    invalidateOperations();
    try {
      await gateway.signOut();
    } finally {
      if (mountedRef.current) {
        setActiveMembership(undefined);
        setAdminOnboardingStart(undefined);
        setWorkspaceView('home');
        setMessage(undefined);
        setState('signed-out');
      }
    }
  }

  function handleAircraftAccessRevoked() {
    setActiveMembership(undefined);
    setWorkspaceView('home');
    void loadAccess();
  }

  return {
    state,
    message,
    adminOnboardingStart,
    activeMembership,
    workspaceView,
    setWorkspaceView,
    loadAccess,
    returnToPassword,
    handleSignIn,
    handleMfa,
    handleSignOut,
    handleAdminOnboardingCompleted,
    handleAdminOnboardingCancelled,
    handleAircraftAccessRevoked,
  };
}

export type AuthSession = ReturnType<typeof useAuthSession>;
