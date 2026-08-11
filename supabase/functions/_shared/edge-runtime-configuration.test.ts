import { describe, expect, it } from 'vitest';

import {
  readAdminOnboardingRuntimeConfiguration,
  readCommonEdgeRuntimeConfiguration,
  readMemberAdministrationRuntimeConfiguration,
  readMemberInvitationRuntimeConfiguration,
} from './edge-runtime-configuration';

function jwt(role: string): string {
  return `header.${btoa(JSON.stringify({ role })).replaceAll('=', '')}.signature`;
}

const localEnvironment = {
  SUPABASE_URL: 'http://kong:8000',
  SUPABASE_ANON_KEY: jwt('anon'),
  SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'),
  ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
  FLYEYE_RUNTIME_PROFILE: 'local-synthetic-v1',
  FEAT003_LIMITER_POLICY_VERSION: 'subject-action-v1',
  FEAT003_DATA_CLASSIFICATION: 'synthetic-only',
  FEAT003_LIMITER_HMAC_SECRET: 'local-test-value-with-at-least-32-bytes',
  FEAT004_LIMITER_POLICY_VERSION: 'invitation-subject-scope-v1',
  FEAT004_DATA_CLASSIFICATION: 'synthetic-only',
  FEAT004_LIMITER_HMAC_SECRET: 'separate-invitation-test-secret-at-least-32-bytes',
  FEAT004_INVITATION_REDIRECT_URL: 'http://127.0.0.1:5173/auth/invitation',
  FEAT005_LIMITER_POLICY_VERSION: 'member-administration-subject-scope-v1',
  FEAT005_DATA_CLASSIFICATION: 'synthetic-only',
  FEAT005_LIMITER_HMAC_SECRET: 'separate-member-admin-test-secret-at-least-32-bytes',
} as const;

function reader(environment: Record<string, string>) {
  return (name: string) => environment[name];
}

describe('shared Edge runtime configuration', () => {
  it('accepts exact local synthetic configuration', () => {
    expect(readAdminOnboardingRuntimeConfiguration(reader(localEnvironment))).toMatchObject({
      supabaseUrl: 'http://kong:8000',
      allowedOrigin: 'http://127.0.0.1:5173',
      runtimeProfile: 'local-synthetic-v1',
      limiterPolicyVersion: 'subject-action-v1',
    });
  });

  it('accepts the exact local invitation callback and dedicated limiter policy', () => {
    expect(readMemberInvitationRuntimeConfiguration(reader(localEnvironment))).toMatchObject({
      invitationRedirectUrl: 'http://127.0.0.1:5173/auth/invitation',
      limiterPolicyVersion: 'invitation-subject-scope-v1',
      runtimeProfile: 'local-synthetic-v1',
    });
  });

  it('accepts the dedicated local member-administration limiter policy', () => {
    expect(readMemberAdministrationRuntimeConfiguration(reader(localEnvironment))).toMatchObject({
      limiterPolicyVersion: 'member-administration-subject-scope-v1',
      runtimeProfile: 'local-synthetic-v1',
      allowedOrigin: 'http://127.0.0.1:5173',
    });
  });

  it.each([
    ['a reused secret', localEnvironment.SUPABASE_SERVICE_ROLE_KEY],
    ['a placeholder secret', 'replace-me-with-a-member-admin-secret'],
  ])('rejects %s for member administration', (_label, limiterSecret) => {
    expect(() =>
      readMemberAdministrationRuntimeConfiguration(
        reader({ ...localEnvironment, FEAT005_LIMITER_HMAC_SECRET: limiterSecret }),
      ),
    ).toThrow('limiter secret');
  });

  it.each([
    ['a foreign callback', 'https://example.test/auth/invitation'],
    ['a recovery callback', 'http://127.0.0.1:5173/auth/recovery'],
    ['a callback query', 'http://127.0.0.1:5173/auth/invitation?fallback=true'],
    ['a callback fragment', 'http://127.0.0.1:5173/auth/invitation#token'],
  ])('rejects %s for invitations', (_label, invitationRedirect) => {
    expect(() =>
      readMemberInvitationRuntimeConfiguration(
        reader({ ...localEnvironment, FEAT004_INVITATION_REDIRECT_URL: invitationRedirect }),
      ),
    ).toThrow('invitation redirect');
  });

  it('rejects a reused or placeholder invitation limiter secret', () => {
    expect(() =>
      readMemberInvitationRuntimeConfiguration(
        reader({
          ...localEnvironment,
          FEAT004_LIMITER_HMAC_SECRET: localEnvironment.SUPABASE_SERVICE_ROLE_KEY,
        }),
      ),
    ).toThrow('limiter secret');
  });

  it.each([
    ['a missing origin', { ...localEnvironment, ALLOWED_ORIGIN: '' }],
    ['a wildcard origin', { ...localEnvironment, ALLOWED_ORIGIN: '*' }],
    ['a null origin', { ...localEnvironment, ALLOWED_ORIGIN: 'null' }],
    [
      'a non-loopback HTTP origin',
      { ...localEnvironment, ALLOWED_ORIGIN: 'http://flyeye.example' },
    ],
    ['an origin path', { ...localEnvironment, ALLOWED_ORIGIN: 'https://flyeye.example/app' }],
    ['an origin query', { ...localEnvironment, ALLOWED_ORIGIN: 'https://flyeye.example?x=1' }],
    ['origin credentials', { ...localEnvironment, ALLOWED_ORIGIN: 'https://user@flyeye.example' }],
    [
      'a service key in the public slot',
      { ...localEnvironment, SUPABASE_ANON_KEY: jwt('service_role') },
    ],
    [
      'an anon key in the service slot',
      { ...localEnvironment, SUPABASE_SERVICE_ROLE_KEY: jwt('anon') },
    ],
    ['the same key in both slots', { ...localEnvironment, SUPABASE_SERVICE_ROLE_KEY: jwt('anon') }],
    [
      'a placeholder limiter secret',
      {
        ...localEnvironment,
        FEAT003_LIMITER_HMAC_SECRET: 'replace-me-with-a-32-byte-secret-value',
      },
    ],
    [
      'the publishable key reused as the limiter secret',
      { ...localEnvironment, FEAT003_LIMITER_HMAC_SECRET: localEnvironment.SUPABASE_ANON_KEY },
    ],
    [
      'the service-role key reused as the limiter secret',
      {
        ...localEnvironment,
        FEAT003_LIMITER_HMAC_SECRET: localEnvironment.SUPABASE_SERVICE_ROLE_KEY,
      },
    ],
    [
      'an unknown limiter policy',
      { ...localEnvironment, FEAT003_LIMITER_POLICY_VERSION: 'wider-v2' },
    ],
    [
      'a non-synthetic classification',
      { ...localEnvironment, FEAT003_DATA_CLASSIFICATION: 'anonymized' },
    ],
  ])('rejects %s', (_label, environment) => {
    expect(() => readAdminOnboardingRuntimeConfiguration(reader(environment))).toThrow();
  });

  it.each([
    'https://abcdefghijklmnopqrst.supabase.co',
    'https://remote.example',
    'https://supabase.staging.example',
  ])('rejects remote URL %s under the local profile', (supabaseUrl) => {
    expect(() =>
      readAdminOnboardingRuntimeConfiguration(
        reader({
          ...localEnvironment,
          SUPABASE_URL: supabaseUrl,
          ALLOWED_ORIGIN: 'https://staging.flyeye.example',
        }),
      ),
    ).toThrow('local FEAT-003 profile');
  });

  it('rejects staging while the committed build guard remains disabled', () => {
    expect(() =>
      readAdminOnboardingRuntimeConfiguration(
        reader({
          ...localEnvironment,
          SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
          ALLOWED_ORIGIN: 'https://staging.flyeye.example',
          FLYEYE_RUNTIME_PROFILE: 'staging-synthetic-v1',
          FEAT003_STAGING_PROJECT_REF: 'abcdefghijklmnopqrst',
        }),
      ),
    ).toThrow('disabled in this build');
  });

  it('has no option that can enable a syntactically valid staging target', () => {
    expect(() =>
      readAdminOnboardingRuntimeConfiguration(
        reader({
          ...localEnvironment,
          SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
          ALLOWED_ORIGIN: 'https://staging.flyeye.example',
          FLYEYE_RUNTIME_PROFILE: 'staging-synthetic-v1',
          FEAT003_STAGING_PROJECT_REF: 'abcdefghijklmnopqrst',
        }),
      ),
    ).toThrow('disabled in this build');
  });

  it('uses generic errors that do not echo provider hostnames or keys', () => {
    expect(() =>
      readCommonEdgeRuntimeConfiguration(
        reader({ ...localEnvironment, SUPABASE_URL: 'https://secret-host.invalid/path' }),
      ),
    ).toThrow('Supabase runtime configuration is invalid.');
  });
});
