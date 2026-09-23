import { readCommonEdgeRuntimeConfiguration } from '../_shared/edge-runtime-configuration.ts';

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost', 'kong']);
const placeholderPattern = /(change[-_ ]?me|example|placeholder|replace[-_ ]?me|your[-_ ])/i;

export function readAircraftRegistryRuntimeConfiguration(
  read: (name: string) => string | undefined,
) {
  const common = readCommonEdgeRuntimeConfiguration(read);
  const runtimeProfile = read('FLYEYE_RUNTIME_PROFILE');
  const policyVersion = read('FEAT007_LIMITER_POLICY_VERSION');
  const dataClassification = read('FEAT007_DATA_CLASSIFICATION');
  const limiterSecret = read('FEAT007_LIMITER_HMAC_SECRET') ?? '';
  if (
    runtimeProfile !== 'local-synthetic-v1' ||
    policyVersion !== 'aircraft-registry-v1' ||
    dataClassification !== 'synthetic-only' ||
    !loopbackHosts.has(new URL(common.supabaseUrl).hostname) ||
    new TextEncoder().encode(limiterSecret).byteLength < 32 ||
    placeholderPattern.test(limiterSecret) ||
    limiterSecret === common.supabasePublishableKey ||
    limiterSecret === common.supabaseServiceRoleKey
  ) {
    throw new Error('The FEAT-007 runtime configuration is invalid.');
  }
  return { ...common, runtimeProfile, policyVersion, limiterSecret } as const;
}
