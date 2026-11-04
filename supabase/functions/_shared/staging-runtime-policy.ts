import { feat003StagingTarget } from './feat-003-staging-target.mjs';

export type RuntimeProfile = 'local-synthetic-v1' | 'staging-synthetic-v1';
type EnvironmentReader = (name: string) => string | undefined;

// Repository capability only. Hosted execution still needs the reviewed P4 package.
export const stagingActionPolicyVersion = 'minimum-actions-v1';
const actions: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'auth-bootstrap': Object.freeze(['resolve_access']),
  'organization-admin-onboarding': Object.freeze(['status', 'start', 'complete', 'cancel']),
  'member-mfa': Object.freeze(['status', 'start', 'bind_factor', 'complete', 'cancel']),
  'member-administration': Object.freeze(['get_profile']),
});

export function runtimeActionAllowed(
  profile: RuntimeProfile,
  functionName: string,
  action: string,
): boolean {
  if (profile === 'local-synthetic-v1') return true;
  return (
    profile === 'staging-synthetic-v1' &&
    Object.hasOwn(actions, functionName) &&
    actions[functionName]!.includes(action)
  );
}

export function readRuntimeProfile(read: EnvironmentReader, functionName: string): RuntimeProfile {
  const profile = read('FLYEYE_RUNTIME_PROFILE');
  if (profile === 'staging-synthetic-v1') {
    if (
      !Object.hasOwn(actions, functionName) ||
      read('SUPABASE_URL') !== feat003StagingTarget.apiOrigin ||
      read('ALLOWED_ORIGIN') !== feat003StagingTarget.frontendOrigin ||
      read('FEAT003_STAGING_PROJECT_REF') !== feat003StagingTarget.projectRef ||
      read('FLYEYE_STAGING_ACTION_POLICY_VERSION') !== stagingActionPolicyVersion
    ) {
      throw new Error('The staging runtime binding is invalid.');
    }
    return profile;
  }

  // Bootstrap historically has no explicit local profile setting.
  if (profile !== 'local-synthetic-v1' && !(functionName === 'auth-bootstrap' && !profile)) {
    throw new Error('The runtime profile is unsupported.');
  }
  let hostname: string;
  try {
    hostname = new URL(read('SUPABASE_URL') ?? '').hostname;
  } catch {
    throw new Error('The local runtime target is invalid.');
  }
  if (!['127.0.0.1', '::1', 'localhost', 'kong'].includes(hostname)) {
    throw new Error('The local runtime profile cannot target a hosted project.');
  }
  return 'local-synthetic-v1';
}
