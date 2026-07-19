import { useEffect, useRef, useState } from 'react';

import {
  landingLabel,
  requiresMfa,
  type AccessMembership,
  type LoginRequest,
} from '../../lib/access-context';
import { LoginForm } from './components/LoginForm';
import { MfaForm } from './components/MfaForm';
import { StatePanel } from './components/StatePanel';
import {
  AuthGatewayError,
  type AuthGateway,
  type AuthGatewayErrorCode,
} from './services/auth-gateway';

type AuthState =
  | 'checking-session'
  | 'signed-out'
  | 'signing-in'
  | 'loading-access'
  | 'selecting-organization'
  | 'mfa-required'
  | 'verifying-mfa'
  | 'empty'
  | 'unauthorized'
  | 'conflict'
  | 'error'
  | 'success';

const permissionForRole = {
  student_pilot: 'portal.student.access',
  instructor_pilot: 'portal.instructor.access',
  admin: 'portal.admin.access',
} as const;

type AuthAppProps = {
  gateway: AuthGateway;
};

function safeError(error: unknown): { code: AuthGatewayErrorCode; message: string } {
  if (error instanceof AuthGatewayError) {
    return { code: error.code, message: error.message };
  }

  return { code: 'unknown', message: 'FlyEye could not verify your access. Try again.' };
}

export function AuthApp({ gateway }: AuthAppProps) {
  const [state, setState] = useState<AuthState>('checking-session');
  const [message, setMessage] = useState<string>();
  const [memberships, setMemberships] = useState<AccessMembership[]>([]);
  const [activeMembership, setActiveMembership] = useState<AccessMembership>();
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

  useEffect(() => {
    mountedRef.current = true;

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
        setMemberships([]);
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
  }, [gateway]);

  async function loadAccess(selectedOrganizationId?: string) {
    const operation = beginOperation();
    setState('loading-access');
    setMessage(undefined);

    try {
      const response = await gateway.loadAccessContext(selectedOrganizationId);
      if (!operationIsCurrent(operation)) return;
      const organizationIds = response.memberships.map((membership) => membership.organizationId);
      if (new Set(organizationIds).size !== organizationIds.length) {
        setMessage('Duplicate organization access was detected. Contact your administrator.');
        setState('conflict');
        return;
      }

      if (response.memberships.length === 0) {
        setState('empty');
        return;
      }

      setMemberships(response.memberships);
      if (!selectedOrganizationId && response.memberships.length > 1) {
        setState('selecting-organization');
        return;
      }

      const membership = response.memberships[0];
      if (!membership) {
        setState('empty');
        return;
      }
      if (
        selectedOrganizationId &&
        (response.selectedOrganizationId !== selectedOrganizationId ||
          membership.organizationId !== selectedOrganizationId)
      ) {
        setMessage('The selected organization could not be revalidated.');
        setState('unauthorized');
        return;
      }
      await authorizeMembership(membership, operation);
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
      const safe = safeError(error);
      setMessage(safe.message);
      setState(safe.code === 'access_context_conflict' ? 'conflict' : 'error');
    }
  }

  async function authorizeMembership(membership: AccessMembership, operation: number) {
    if (!operationIsCurrent(operation)) return;
    setActiveMembership(membership);
    const requiredPermission = permissionForRole[membership.role];
    if (!membership.permissions.includes(requiredPermission)) {
      setMessage('Your assigned role does not include access to its FlyEye workspace.');
      setState('unauthorized');
      return;
    }

    if (membership.accessStatus === 'denied') {
      setMessage('Your assigned role does not include access to its FlyEye workspace.');
      setState('unauthorized');
      return;
    }

    if (membership.accessStatus === 'granted') {
      if (requiresMfa(membership.role) && membership.requiredAssuranceLevel !== 'aal2') {
        setMessage('Privileged access returned an invalid assurance requirement.');
        setState('conflict');
        return;
      }
      setState('success');
      return;
    }

    if (!requiresMfa(membership.role) || membership.requiredAssuranceLevel !== 'aal2') {
      setMessage('Your access information needs administrator review.');
      setState('conflict');
      return;
    }

    try {
      const assurance = await gateway.getMfaAssurance();
      if (!operationIsCurrent(operation)) return;

      if (assurance.nextLevel !== 'aal2') {
        setMessage('A verified authenticator is required. Contact your administrator.');
        setState('unauthorized');
        return;
      }

      setState('mfa-required');
    } catch (error) {
      const safe = safeError(error);
      setMessage(safe.message);
      setState('error');
    }
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
      const selectedOrganizationId = activeMembership?.organizationId;
      if (!selectedOrganizationId) {
        setMessage('Your selected organization is no longer available.');
        setState('unauthorized');
        return;
      }
      await loadAccess(selectedOrganizationId);
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
        setMemberships([]);
        setMessage(undefined);
        setState('signed-out');
      }
    }
  }

  return (
    <main className="auth-shell">
      <section className="brand-panel" aria-label="FlyEye introduction">
        <div className="brand-mark" aria-hidden="true">
          <span>F</span>
        </div>
        <div>
          <p className="brand-name">FlyEye</p>
          <p className="brand-tagline">Training clarity. Operational discipline.</p>
        </div>
        <div className="brand-copy">
          <span className="eyebrow eyebrow--light">Secure school access</span>
          <h1>One trusted entry point for every training role.</h1>
          <p>
            Sign in with your invited account. Your school membership and permissions are verified
            by the server before any workspace opens.
          </p>
        </div>
        <p className="safety-note">FlyEye supports authorized people—it does not replace them.</p>
      </section>

      <section className="auth-panel" aria-label="Account access">
        <div className="auth-card">
          {state === 'checking-session' || state === 'loading-access' ? (
            <StatePanel eyebrow="Secure access" title="Verifying your session">
              <div className="loading-line" aria-hidden="true" />
              <p>Please wait while FlyEye checks your account and school access.</p>
            </StatePanel>
          ) : null}

          {state === 'signed-out' || state === 'signing-in' ? (
            <>
              <div className="section-heading">
                <span className="eyebrow">Welcome back</span>
                <h2>Sign in to FlyEye</h2>
                <p>Use the email address from your school invitation.</p>
              </div>
              <LoginForm busy={state === 'signing-in'} message={message} onSubmit={handleSignIn} />
              <p className="support-copy">
                Accounts are invitation-only. Contact your school administrator if you need access.
              </p>
            </>
          ) : null}

          {state === 'selecting-organization' ? (
            <StatePanel eyebrow="School access" title="Choose your organization">
              <p>Your account has access to more than one FlyEye organization.</p>
              <div className="organization-list">
                {memberships.map((membership) => (
                  <button
                    className="organization-option"
                    type="button"
                    key={membership.membershipId}
                    onClick={() => void loadAccess(membership.organizationId)}
                  >
                    <strong>{membership.organizationName}</strong>
                    <span>{landingLabel(membership.role)}</span>
                  </button>
                ))}
              </div>
              <button className="text-button" type="button" onClick={() => void handleSignOut()}>
                Sign out
              </button>
            </StatePanel>
          ) : null}

          {state === 'mfa-required' || state === 'verifying-mfa' ? (
            <MfaForm
              busy={state === 'verifying-mfa'}
              message={message}
              onSubmit={handleMfa}
              onCancel={handleSignOut}
            />
          ) : null}

          {state === 'empty' ? (
            <StatePanel
              eyebrow="No active access"
              title="Your account is not assigned"
              tone="warning"
            >
              <p>
                Authentication succeeded, but no active FlyEye school membership was found. Contact
                your school administrator.
              </p>
              <button className="text-button" type="button" onClick={() => void handleSignOut()}>
                Return to sign in
              </button>
            </StatePanel>
          ) : null}

          {state === 'unauthorized' ? (
            <StatePanel
              eyebrow="Access unavailable"
              title="You cannot enter this workspace"
              tone="warning"
            >
              <p>{message}</p>
              <button className="text-button" type="button" onClick={() => void handleSignOut()}>
                Return to sign in
              </button>
            </StatePanel>
          ) : null}

          {state === 'conflict' ? (
            <StatePanel
              eyebrow="Access conflict"
              title="Administrator review is required"
              tone="warning"
            >
              <p>{message}</p>
              <button className="text-button" type="button" onClick={() => void handleSignOut()}>
                Return to sign in
              </button>
            </StatePanel>
          ) : null}

          {state === 'error' ? (
            <StatePanel
              eyebrow="Connection problem"
              title="Access could not be verified"
              tone="warning"
            >
              <p>{message}</p>
              <button className="primary-button" type="button" onClick={() => void loadAccess()}>
                Try again
              </button>
              <button className="text-button" type="button" onClick={() => void handleSignOut()}>
                Sign out
              </button>
            </StatePanel>
          ) : null}

          {state === 'success' && activeMembership ? (
            <StatePanel
              eyebrow="Access verified"
              title={landingLabel(activeMembership.role)}
              tone="success"
            >
              <p>
                Signed in to <strong>{activeMembership.organizationName}</strong>. Your available
                modules will be based on server-approved permissions.
              </p>
              <div className="permission-summary">
                <span>Current role</span>
                <strong>{activeMembership.role.replaceAll('_', ' ')}</strong>
              </div>
              <p className="placeholder-note">
                Workspace features are intentionally outside FEAT-001.
              </p>
              <button className="text-button" type="button" onClick={() => void handleSignOut()}>
                Sign out
              </button>
            </StatePanel>
          ) : null}
        </div>
        <footer>
          <span>Private flight-school system</span>
          <span aria-hidden="true">•</span>
          <span>Authorized users only</span>
        </footer>
      </section>
    </main>
  );
}
