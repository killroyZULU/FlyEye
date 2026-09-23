import { describe, expect, it } from 'vitest';

import { readAircraftRegistryRuntimeConfiguration } from './runtime-config';

function jwt(role: string): string {
  return `header.${btoa(JSON.stringify({ role })).replaceAll('=', '')}.signature`;
}

const environment = {
  SUPABASE_URL: 'http://kong:8000',
  SUPABASE_ANON_KEY: jwt('anon'),
  SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'),
  ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
  FLYEYE_RUNTIME_PROFILE: 'local-synthetic-v1',
  FEAT007_LIMITER_POLICY_VERSION: 'aircraft-registry-v1',
  FEAT007_DATA_CLASSIFICATION: 'synthetic-only',
  FEAT007_LIMITER_HMAC_SECRET: 'dedicated-aircraft-registry-secret-with-32-bytes',
};

const reader = (values: Record<string, string>) => (name: string) => values[name];

describe('aircraft registry runtime configuration', () => {
  it('accepts the exact local synthetic profile', () => {
    expect(readAircraftRegistryRuntimeConfiguration(reader(environment))).toMatchObject({
      supabaseUrl: 'http://kong:8000',
      policyVersion: 'aircraft-registry-v1',
      runtimeProfile: 'local-synthetic-v1',
    });
  });

  it.each([
    ['hosted target', { ...environment, SUPABASE_URL: 'https://project.supabase.co' }],
    ['wrong policy', { ...environment, FEAT007_LIMITER_POLICY_VERSION: 'wider-v2' }],
    ['real data', { ...environment, FEAT007_DATA_CLASSIFICATION: 'real' }],
    [
      'placeholder secret',
      { ...environment, FEAT007_LIMITER_HMAC_SECRET: 'replace-me-with-secret-value-123456789' },
    ],
  ])('rejects %s', (_label, values) => {
    expect(() => readAircraftRegistryRuntimeConfiguration(reader(values))).toThrow(
      'FEAT-007 runtime configuration is invalid',
    );
  });
});
