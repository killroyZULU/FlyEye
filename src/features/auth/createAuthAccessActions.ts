import { requiresMfa, type AccessMembership } from '../../lib/access-context';
import type { AdminBootstrapGrant, AdminOnboardingStart } from './admin-onboarding';
import type { AuthGateway } from './services/auth-gateway';
import { safeError, type AuthState } from './auth-app-state';
type AuthAccessOptions = {
  gateway: AuthGateway;
  beginOperation: () => number;
  operationIsCurrent: (operation: number) => boolean;
  setState: (state: AuthState) => void;
  setMessage: (message: string | undefined) => void;
  setActiveMembership: (membership: AccessMembership | undefined) => void;
  setAdminOnboardingStart: (start: AdminOnboardingStart | undefined) => void;
  returnToPassword: (reason: string) => Promise<void>;
};

export function createAuthAccessActions({
  gateway,
  beginOperation,
  operationIsCurrent,
  setState,
  setMessage,
  setActiveMembership,
  setAdminOnboardingStart,
  returnToPassword,
}: AuthAccessOptions) {
  async function loadAccess() {
    const operation = beginOperation();
    setState('loading-access');
    setMessage(undefined);

    try {
      const response = await gateway.loadAccessContext();
      if (!operationIsCurrent(operation)) return;
      const organizationIds = response.memberships.map((membership) => membership.organizationId);
      if (
        response.memberships.length > 1 ||
        new Set(organizationIds).size !== organizationIds.length
      ) {
        setMessage('More than one school access context was detected. Contact your administrator.');
        setState('conflict');
        return;
      }

      let grants: AdminBootstrapGrant[] = [];
      try {
        const onboardingStatus = await gateway.loadAdminOnboardingStatus();
        if (!operationIsCurrent(operation)) return;
        grants = onboardingStatus.grants;
      } catch (error) {
        if (!operationIsCurrent(operation)) return;
        if (response.memberships.length === 0) {
          const safe = safeError(error);
          if (safe.code === 'admin_onboarding_recent_authentication_required') {
            await returnToPassword(safe.message);
            return;
          }
          setMessage(safe.message);
          setState(
            safe.code === 'admin_onboarding_conflict' ||
              safe.code === 'admin_onboarding_not_available'
              ? 'conflict'
              : 'error',
          );
          return;
        }

        // Onboarding discovery fails closed without blocking an existing membership.
        grants = [];
      }

      if (response.memberships.length + grants.length > 1) {
        setMessage('More than one school access context was detected. Contact your administrator.');
        setState('conflict');
        return;
      }

      if (response.memberships.length === 0) {
        const grant = grants[0];
        if (grant) {
          await beginAdminOnboarding(grant, operation);
          return;
        }
        setState('empty');
        return;
      }

      const membership = response.memberships[0];
      if (!membership) {
        setState('empty');
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

  async function beginAdminOnboarding(grant: AdminBootstrapGrant, operation?: number) {
    const currentOperation = operation ?? beginOperation();
    if (!operationIsCurrent(currentOperation)) return;
    setState('starting-admin-onboarding');
    setMessage(undefined);

    try {
      const start = await gateway.startAdminOnboarding(grant);
      if (!operationIsCurrent(currentOperation)) return;
      setAdminOnboardingStart(start);
      setState('admin-onboarding');
    } catch (error) {
      if (!operationIsCurrent(currentOperation)) return;
      const safe = safeError(error);
      if (safe.code === 'admin_onboarding_recent_authentication_required') {
        await returnToPassword(safe.message);
        return;
      }
      setMessage(safe.message);
      setState(
        safe.code === 'admin_onboarding_conflict' || safe.code === 'admin_onboarding_not_available'
          ? 'conflict'
          : 'error',
      );
    }
  }

  async function authorizeMembership(membership: AccessMembership, operation: number) {
    if (!operationIsCurrent(operation)) return;
    setActiveMembership(membership);
    const requiredPermission = membership.workspacePermission;
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
      setState('success');
      return;
    }

    if (!requiresMfa(membership)) {
      setMessage('Your access information needs administrator review.');
      setState('conflict');
      return;
    }

    try {
      const assurance = await gateway.getMfaAssurance();
      if (!operationIsCurrent(operation)) return;

      if (assurance.nextLevel !== 'aal2') {
        setMessage(undefined);
        setState('member-mfa-enrollment');
        return;
      }

      setState('mfa-required');
    } catch (error) {
      if (!operationIsCurrent(operation)) return;
      const safe = safeError(error);
      setMessage(safe.message);
      setState('error');
    }
  }

  return { loadAccess };
}
