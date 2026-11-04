import { describe, expect, it, vi } from 'vitest';
import { feat003StagingTarget as target } from '../../../config/feat-003-staging-target.mjs';
import {
  readAdminOnboardingRuntimeConfiguration,
  readAuthBootstrapRuntimeConfiguration,
  readCommonEdgeRuntimeConfiguration,
  readMemberAdministrationRuntimeConfiguration,
  readMemberInvitationRuntimeConfiguration,
  readMemberMfaRuntimeConfiguration,
} from './edge-runtime-configuration.ts';
import { readRuntimeProfile, runtimeActionAllowed } from './staging-runtime-policy.ts';

const jwt = (role: string) => `header.${btoa(JSON.stringify({ role }))}.signature`;
const environment: Record<string, string> = {
  SUPABASE_URL: target.apiOrigin,
  ALLOWED_ORIGIN: target.frontendOrigin,
  SUPABASE_ANON_KEY: jwt('anon'),
  SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'),
  FLYEYE_RUNTIME_PROFILE: 'staging-synthetic-v1',
  FEAT003_STAGING_PROJECT_REF: target.projectRef,
  FLYEYE_STAGING_ACTION_POLICY_VERSION: 'minimum-actions-v1',
  FEAT001_DATA_CLASSIFICATION: 'synthetic-only',
  FEAT001_LIMITER_POLICY_VERSION: 'auth-bootstrap-subject-v1',
};
const configurations = [
  ['auth-bootstrap', 'FEAT001', readAuthBootstrapRuntimeConfiguration, 'auth-bootstrap-subject-v1'],
  [
    'organization-admin-onboarding',
    'FEAT003',
    readAdminOnboardingRuntimeConfiguration,
    'subject-action-v1',
  ],
  [
    'member-administration',
    'FEAT005',
    readMemberAdministrationRuntimeConfiguration,
    'member-administration-subject-scope-v1',
  ],
  ['member-mfa', 'FEAT006', readMemberMfaRuntimeConfiguration, 'member-mfa-subject-action-v1'],
] as const;
for (const [, prefix, , policy] of configurations) {
  environment[`${prefix}_DATA_CLASSIFICATION`] = 'synthetic-only';
  environment[`${prefix}_LIMITER_POLICY_VERSION`] = policy;
  if (prefix !== 'FEAT001')
    environment[`${prefix}_LIMITER_HMAC_SECRET`] =
      `synthetic-${prefix}-limiter-material-at-least-32-bytes`;
}

describe.each(configurations)('P3c %s configuration', (_name, prefix, readConfiguration) => {
  it('accepts only the canonical P2 binding without performing IO', () => {
    expect(readConfiguration((key) => environment[key])).toMatchObject({
      supabaseUrl: target.apiOrigin,
      allowedOrigin: target.frontendOrigin,
    });
  });

  it.each([
    ['SUPABASE_URL', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co'],
    ['SUPABASE_URL', `${target.apiOrigin}/`],
    ['SUPABASE_URL', `https://user@${target.projectRef}.supabase.co`],
    ['SUPABASE_URL', 'http://kong:8000'],
    ['ALLOWED_ORIGIN', 'https://preview.flyeye-staging.pages.dev'],
    ['ALLOWED_ORIGIN', `${target.frontendOrigin}/path`],
    ['ALLOWED_ORIGIN', 'http://127.0.0.1:5173'],
    ['FEAT003_STAGING_PROJECT_REF', 'aaaaaaaaaaaaaaaaaaaa'],
    ['FLYEYE_STAGING_ACTION_POLICY_VERSION', 'minimum-actions-v2'],
    ...[
      'SUPABASE_URL',
      'ALLOWED_ORIGIN',
      'FEAT003_STAGING_PROJECT_REF',
      'FLYEYE_STAGING_ACTION_POLICY_VERSION',
      'FLYEYE_RUNTIME_PROFILE',
    ].map((key) => [key, '']),
    ['FLYEYE_RUNTIME_PROFILE', 'production'],
    ['FLYEYE_RUNTIME_PROFILE', 'local-synthetic-v1'],
  ])('rejects %s=%s before reading any keys', (key, value) => {
    const changed: Record<string, string | undefined> = { ...environment, [key]: value };
    const secretAccess = vi.fn();
    expect(() =>
      readConfiguration((name) => {
        if (name.includes('KEY') || name.includes('SECRET')) secretAccess();
        return changed[name];
      }),
    ).toThrow();
    expect(secretAccess).not.toHaveBeenCalled();
  });

  it.each(['DATA_CLASSIFICATION', 'LIMITER_POLICY_VERSION'])(
    'rejects missing or conflicting %s',
    (suffix) => {
      for (const value of ['', 'unreviewed']) {
        expect(() =>
          readConfiguration((key) => (key === `${prefix}_${suffix}` ? value : environment[key])),
        ).toThrow();
      }
    },
  );

  it('rejects a coherent substituted project rather than trusting environment claims', () => {
    const changed: Record<string, string | undefined> = {
      ...environment,
      SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
      FEAT003_STAGING_PROJECT_REF: 'aaaaaaaaaaaaaaaaaaaa',
    };
    expect(() => readConfiguration((key) => changed[key])).toThrow('staging runtime binding');
  });
});

describe('P3c minimum action policy', () => {
  const allowed = {
    'auth-bootstrap': ['resolve_access'],
    'organization-admin-onboarding': ['status', 'start', 'complete', 'cancel'],
    'member-mfa': ['status', 'start', 'bind_factor', 'complete', 'cancel'],
    'member-administration': ['get_profile'],
  };
  it('permits the complete reviewed inventory and rejects additions', () => {
    for (const [functionName, names] of Object.entries(allowed)) {
      for (const action of names)
        expect(runtimeActionAllowed('staging-synthetic-v1', functionName, action)).toBe(true);
      expect(runtimeActionAllowed('staging-synthetic-v1', functionName, 'future_action')).toBe(
        false,
      );
    }
    for (const action of [
      'list',
      'detail',
      'update_profile',
      'suspend',
      'reactivate',
      'revoke',
      'assign_role',
    ]) {
      expect(runtimeActionAllowed('staging-synthetic-v1', 'member-administration', action)).toBe(
        false,
      );
      expect(runtimeActionAllowed('local-synthetic-v1', 'member-administration', action)).toBe(
        true,
      );
    }
  });
  it.each([
    'member-invitations',
    'aircraft-registry',
    'aircraft-documents',
    'constructor',
    '__proto__',
    'unknown',
  ])('denies unselected function %s', (name) => {
    expect(() => readRuntimeProfile((key) => environment[key], name)).toThrow();
    expect(runtimeActionAllowed('staging-synthetic-v1', name, 'get_profile')).toBe(false);
  });
  it('keeps generic and invitation configuration unavailable in staging', () => {
    for (const read of [
      readCommonEdgeRuntimeConfiguration,
      readMemberInvitationRuntimeConfiguration,
    ]) {
      expect(() => read((key) => environment[key])).toThrow('unavailable in staging');
    }
  });
  it('preserves bootstrap local configuration without a new mandatory setting', () => {
    expect(
      readAuthBootstrapRuntimeConfiguration(
        (key) =>
          ({
            ...environment,
            SUPABASE_URL: 'http://kong:8000',
            ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
            FLYEYE_RUNTIME_PROFILE: undefined,
          })[key],
      ),
    ).toMatchObject({ supabaseUrl: 'http://kong:8000' });
  });
});
