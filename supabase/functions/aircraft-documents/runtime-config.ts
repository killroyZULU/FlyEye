import { readCommonEdgeRuntimeConfiguration } from '../_shared/edge-runtime-configuration.ts';

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost', 'kong']);
const browserLoopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const placeholderPattern = /(change[-_ ]?me|example|placeholder|replace[-_ ]?me|your[-_ ])/i;

function publicSupabaseOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new URL(value);
  if (
    parsed.origin !== value ||
    parsed.protocol !== 'http:' ||
    !browserLoopbackHosts.has(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('The FEAT-007B public Supabase URL is invalid.');
  }
  return parsed.origin;
}

export function readAircraftDocumentRuntimeConfiguration(
  read: (name: string) => string | undefined,
) {
  const common = readCommonEdgeRuntimeConfiguration(read);
  const runtimeProfile = read('FLYEYE_RUNTIME_PROFILE');
  const policyVersion = read('FEAT007B_LIMITER_POLICY_VERSION');
  const dataClassification = read('FEAT007B_DATA_CLASSIFICATION');
  const scannerMode = read('FEAT007B_SCANNER_MODE');
  const limiterSecret = read('FEAT007B_LIMITER_HMAC_SECRET') ?? '';
  const publicSupabaseUrl = publicSupabaseOrigin(read('FEAT007B_PUBLIC_SUPABASE_URL'));
  const supabaseHost = new URL(common.supabaseUrl).hostname;
  if (
    runtimeProfile !== 'local-synthetic-v1' ||
    policyVersion !== 'aircraft-documents-v1' ||
    dataClassification !== 'synthetic-only' ||
    scannerMode !== 'deterministic-local-v1' ||
    !loopbackHosts.has(supabaseHost) ||
    (supabaseHost === 'kong' && !publicSupabaseUrl) ||
    new TextEncoder().encode(limiterSecret).byteLength < 32 ||
    placeholderPattern.test(limiterSecret) ||
    limiterSecret === common.supabasePublishableKey ||
    limiterSecret === common.supabaseServiceRoleKey
  ) {
    throw new Error('The FEAT-007B runtime configuration is invalid.');
  }
  return {
    ...common,
    runtimeProfile,
    policyVersion,
    scannerMode,
    limiterSecret,
    publicSupabaseUrl: publicSupabaseUrl ?? common.supabaseUrl,
  } as const;
}
