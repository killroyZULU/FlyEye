import { readRuntimeProfile, type RuntimeProfile } from './staging-runtime-policy.ts';

export type EdgeEnvironmentReader = (name: string) => string | undefined;

export type CommonEdgeRuntimeConfiguration = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseServiceRoleKey: string;
  allowedOrigin: string;
};

export type AdminOnboardingRuntimeConfiguration = CommonEdgeRuntimeConfiguration & {
  limiterSecret: string;
  limiterPolicyVersion: 'subject-action-v1';
  runtimeProfile: RuntimeProfile;
};

export type MemberInvitationRuntimeConfiguration = CommonEdgeRuntimeConfiguration & {
  limiterSecret: string;
  limiterPolicyVersion: 'invitation-subject-scope-v1';
  runtimeProfile: 'local-synthetic-v1';
  invitationRedirectUrl: string;
};

export type MemberAdministrationRuntimeConfiguration = CommonEdgeRuntimeConfiguration & {
  limiterSecret: string;
  limiterPolicyVersion: 'member-administration-subject-scope-v1';
  runtimeProfile: RuntimeProfile;
};

export type MemberMfaRuntimeConfiguration = CommonEdgeRuntimeConfiguration & {
  limiterSecret: string;
  limiterPolicyVersion: 'member-mfa-subject-action-v1';
  runtimeProfile: RuntimeProfile;
};

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const placeholderPattern = /(change[-_ ]?me|example|placeholder|replace[-_ ]?me|your[-_ ])/i;

function required(read: EdgeEnvironmentReader, name: string): string {
  const value = read(name);
  if (!value) throw new Error('Required Edge Function configuration is unavailable.');
  return value;
}

function parseExactOrigin(value: string, allowLocalHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Edge Function origin configuration is invalid.');
  }

  const exactOrigin =
    url.origin === value &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash;
  const safeScheme =
    url.protocol === 'https:' ||
    (allowLocalHttp && url.protocol === 'http:' && loopbackHosts.has(url.hostname));

  if (!exactOrigin || !safeScheme || value === 'null' || value.includes('*')) {
    throw new Error('Edge Function origin configuration is invalid.');
  }
  return url;
}

function parseSupabaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Supabase runtime configuration is invalid.');
  }

  const localRuntimeHost = loopbackHosts.has(url.hostname) || url.hostname === 'kong';
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && localRuntimeHost))
  ) {
    throw new Error('Supabase runtime configuration is invalid.');
  }
  return url;
}

function jwtRole(value: string): string | undefined {
  try {
    const segment = value.split('.')[1];
    if (!segment) return undefined;
    const normalized = segment.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

function validateKeys(publishableKey: string, serviceRoleKey: string): void {
  const publishableIsSecret =
    publishableKey.toLowerCase().startsWith('sb_secret_') ||
    jwtRole(publishableKey) === 'service_role';
  const serviceIsPrivileged =
    serviceRoleKey.toLowerCase().startsWith('sb_secret_') ||
    jwtRole(serviceRoleKey) === 'service_role';

  if (
    publishableIsSecret ||
    !serviceIsPrivileged ||
    publishableKey === serviceRoleKey ||
    placeholderPattern.test(publishableKey) ||
    placeholderPattern.test(serviceRoleKey)
  ) {
    throw new Error('Supabase key configuration is invalid.');
  }
}

function readCommonConfiguration(read: EdgeEnvironmentReader): CommonEdgeRuntimeConfiguration {
  const supabaseUrl = parseSupabaseUrl(required(read, 'SUPABASE_URL')).origin;
  const supabasePublishableKey = required(read, 'SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = required(read, 'SUPABASE_SERVICE_ROLE_KEY');
  const allowedOrigin = parseExactOrigin(required(read, 'ALLOWED_ORIGIN'), true).origin;
  validateKeys(supabasePublishableKey, supabaseServiceRoleKey);

  return { supabaseUrl, supabasePublishableKey, supabaseServiceRoleKey, allowedOrigin };
}

export function readCommonEdgeRuntimeConfiguration(
  read: EdgeEnvironmentReader,
): CommonEdgeRuntimeConfiguration {
  if (read('FLYEYE_RUNTIME_PROFILE') === 'staging-synthetic-v1') {
    throw new Error('This function is unavailable in staging.');
  }
  return readCommonConfiguration(read);
}

export function readAuthBootstrapRuntimeConfiguration(
  read: EdgeEnvironmentReader,
): CommonEdgeRuntimeConfiguration {
  const profile = readRuntimeProfile(read, 'auth-bootstrap');
  if (
    profile === 'staging-synthetic-v1' &&
    (read('FEAT001_DATA_CLASSIFICATION') !== 'synthetic-only' ||
      read('FEAT001_LIMITER_POLICY_VERSION') !== 'auth-bootstrap-subject-v1')
  ) {
    throw new Error('The bootstrap staging policy is invalid.');
  }
  return readCommonConfiguration(read);
}

export function readAdminOnboardingRuntimeConfiguration(
  read: EdgeEnvironmentReader,
): AdminOnboardingRuntimeConfiguration {
  const runtimeProfile = readRuntimeProfile(read, 'organization-admin-onboarding');
  const common = readCommonConfiguration(read);
  const limiterPolicyVersion = required(read, 'FEAT003_LIMITER_POLICY_VERSION');
  const dataClassification = required(read, 'FEAT003_DATA_CLASSIFICATION');
  const limiterSecret = required(read, 'FEAT003_LIMITER_HMAC_SECRET');

  if (limiterPolicyVersion !== 'subject-action-v1') {
    throw new Error('The FEAT-003 limiter policy is unsupported.');
  }
  if (dataClassification !== 'synthetic-only') {
    throw new Error('FEAT-003 hosted hardening permits synthetic data only.');
  }
  if (
    new TextEncoder().encode(limiterSecret).byteLength < 32 ||
    placeholderPattern.test(limiterSecret) ||
    limiterSecret === common.supabasePublishableKey ||
    limiterSecret === common.supabaseServiceRoleKey
  ) {
    throw new Error('The FEAT-003 limiter secret is invalid.');
  }

  return { ...common, limiterSecret, limiterPolicyVersion, runtimeProfile };
}

export function readMemberInvitationRuntimeConfiguration(
  read: EdgeEnvironmentReader,
): MemberInvitationRuntimeConfiguration {
  const common = readCommonEdgeRuntimeConfiguration(read);
  const runtimeProfile = required(read, 'FLYEYE_RUNTIME_PROFILE');
  const limiterPolicyVersion = required(read, 'FEAT004_LIMITER_POLICY_VERSION');
  const dataClassification = required(read, 'FEAT004_DATA_CLASSIFICATION');
  const limiterSecret = required(read, 'FEAT004_LIMITER_HMAC_SECRET');
  const configuredRedirect = required(read, 'FEAT004_INVITATION_REDIRECT_URL');
  const invitationRedirect = new URL(configuredRedirect);

  if (limiterPolicyVersion !== 'invitation-subject-scope-v1') {
    throw new Error('The FEAT-004 limiter policy is unsupported.');
  }
  if (dataClassification !== 'synthetic-only') {
    throw new Error('FEAT-004 local delivery permits synthetic data only.');
  }
  if (
    new TextEncoder().encode(limiterSecret).byteLength < 32 ||
    placeholderPattern.test(limiterSecret) ||
    limiterSecret === common.supabasePublishableKey ||
    limiterSecret === common.supabaseServiceRoleKey
  ) {
    throw new Error('The FEAT-004 limiter secret is invalid.');
  }
  if (
    invitationRedirect.origin !== common.allowedOrigin ||
    invitationRedirect.pathname !== '/auth/invitation' ||
    invitationRedirect.search ||
    invitationRedirect.hash ||
    invitationRedirect.username ||
    invitationRedirect.password
  ) {
    throw new Error('The FEAT-004 invitation redirect is invalid.');
  }

  const supabaseHostname = new URL(common.supabaseUrl).hostname;
  if (
    runtimeProfile !== 'local-synthetic-v1' ||
    (!loopbackHosts.has(supabaseHostname) && supabaseHostname !== 'kong')
  ) {
    throw new Error('The FEAT-004 runtime profile is unsupported.');
  }

  return {
    ...common,
    limiterSecret,
    limiterPolicyVersion,
    runtimeProfile,
    invitationRedirectUrl: invitationRedirect.href,
  };
}

export function readMemberAdministrationRuntimeConfiguration(
  read: EdgeEnvironmentReader,
): MemberAdministrationRuntimeConfiguration {
  const runtimeProfile = readRuntimeProfile(read, 'member-administration');
  const common = readCommonConfiguration(read);
  const limiterPolicyVersion = required(read, 'FEAT005_LIMITER_POLICY_VERSION');
  const dataClassification = required(read, 'FEAT005_DATA_CLASSIFICATION');
  const limiterSecret = required(read, 'FEAT005_LIMITER_HMAC_SECRET');

  if (limiterPolicyVersion !== 'member-administration-subject-scope-v1') {
    throw new Error('The FEAT-005 limiter policy is unsupported.');
  }
  if (dataClassification !== 'synthetic-only') {
    throw new Error('FEAT-005 local delivery permits synthetic data only.');
  }
  if (
    new TextEncoder().encode(limiterSecret).byteLength < 32 ||
    placeholderPattern.test(limiterSecret) ||
    limiterSecret === common.supabasePublishableKey ||
    limiterSecret === common.supabaseServiceRoleKey
  ) {
    throw new Error('The FEAT-005 limiter secret is invalid.');
  }

  return { ...common, limiterSecret, limiterPolicyVersion, runtimeProfile };
}

export function readMemberMfaRuntimeConfiguration(
  read: EdgeEnvironmentReader,
): MemberMfaRuntimeConfiguration {
  const runtimeProfile = readRuntimeProfile(read, 'member-mfa');
  const common = readCommonConfiguration(read);
  const limiterPolicyVersion = required(read, 'FEAT006_LIMITER_POLICY_VERSION');
  const dataClassification = required(read, 'FEAT006_DATA_CLASSIFICATION');
  const limiterSecret = required(read, 'FEAT006_LIMITER_HMAC_SECRET');

  if (limiterPolicyVersion !== 'member-mfa-subject-action-v1') {
    throw new Error('The FEAT-006 limiter policy is unsupported.');
  }
  if (dataClassification !== 'synthetic-only') {
    throw new Error('FEAT-006 local delivery permits synthetic data only.');
  }
  if (
    new TextEncoder().encode(limiterSecret).byteLength < 32 ||
    placeholderPattern.test(limiterSecret) ||
    limiterSecret === common.supabasePublishableKey ||
    limiterSecret === common.supabaseServiceRoleKey
  ) {
    throw new Error('The FEAT-006 limiter secret is invalid.');
  }

  return { ...common, limiterSecret, limiterPolicyVersion, runtimeProfile };
}
