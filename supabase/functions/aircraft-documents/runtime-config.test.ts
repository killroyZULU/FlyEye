import { describe, expect, it } from 'vitest';

import { readAircraftDocumentRuntimeConfiguration } from './runtime-config';

function jwt(role: string): string {
  return `header.${btoa(JSON.stringify({ role })).replaceAll('=', '')}.signature`;
}

const environment = {
  SUPABASE_URL: 'http://kong:8000',
  SUPABASE_ANON_KEY: jwt('anon'),
  SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'),
  ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
  FLYEYE_RUNTIME_PROFILE: 'local-synthetic-v1',
  FEAT007B_LIMITER_POLICY_VERSION: 'aircraft-documents-v1',
  FEAT007B_DATA_CLASSIFICATION: 'synthetic-only',
  FEAT007B_SCANNER_MODE: 'deterministic-local-v1',
  FEAT007B_LIMITER_HMAC_SECRET: 'dedicated-aircraft-document-secret-with-32-bytes',
  FEAT007B_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
};

const reader = (values: Record<string, string>) => (name: string) => values[name];

describe('aircraft document runtime configuration', () => {
  it('accepts the exact local synthetic and deterministic scanner profile', () => {
    expect(readAircraftDocumentRuntimeConfiguration(reader(environment))).toMatchObject({
      runtimeProfile: 'local-synthetic-v1',
      policyVersion: 'aircraft-documents-v1',
      scannerMode: 'deterministic-local-v1',
      publicSupabaseUrl: 'http://127.0.0.1:55321',
    });
  });

  it.each([
    ['hosted target', { ...environment, SUPABASE_URL: 'https://project.supabase.co' }],
    ['real data', { ...environment, FEAT007B_DATA_CLASSIFICATION: 'real' }],
    ['provider scanner', { ...environment, FEAT007B_SCANNER_MODE: 'provider' }],
    [
      'missing browser URL for internal gateway',
      { ...environment, FEAT007B_PUBLIC_SUPABASE_URL: '' },
    ],
    [
      'placeholder secret',
      { ...environment, FEAT007B_LIMITER_HMAC_SECRET: 'replace-me-with-a-secret-value-123456' },
    ],
  ])('rejects %s', (_label, values) => {
    expect(() => readAircraftDocumentRuntimeConfiguration(reader(values))).toThrow(
      'FEAT-007B runtime configuration is invalid',
    );
  });
});
