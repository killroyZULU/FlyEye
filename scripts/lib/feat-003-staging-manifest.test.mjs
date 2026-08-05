import { describe, expect, it } from 'vitest';

import {
  parseFeat003StagingManifest,
  validateFeat003RepositoryConfiguration,
} from './feat-003-staging-manifest.mjs';

const disabledManifest = {
  schemaVersion: 1,
  enabled: false,
  environment: 'staging',
  projectRef: null,
  apiOrigin: null,
  databaseHost: null,
  frontendOrigin: null,
  dataClassification: 'synthetic-only',
  limiterPolicyVersion: 'subject-action-v1',
};

const enabledManifest = {
  ...disabledManifest,
  enabled: true,
  projectRef: 'abcdefghijklmnopqrst',
  apiOrigin: 'https://abcdefghijklmnopqrst.supabase.co',
  databaseHost: 'db.abcdefghijklmnopqrst.supabase.co',
  frontendOrigin: 'https://staging.flyeye.example',
};

describe('FEAT-003 staging manifest', () => {
  it('accepts the disabled target-free repository default', () => {
    expect(parseFeat003StagingManifest(disabledManifest)).toEqual({ enabled: false });
  });

  it.each([
    [
      'a provider target while disabled',
      { ...disabledManifest, projectRef: enabledManifest.projectRef },
    ],
    ['an unknown field', { ...disabledManifest, productionProjectRef: 'unexpected' }],
    ['a production label', { ...disabledManifest, environment: 'production' }],
    ['a non-synthetic classification', { ...disabledManifest, dataClassification: 'anonymized' }],
    ['an unknown limiter policy', { ...disabledManifest, limiterPolicyVersion: 'wider-v2' }],
    ['an HTTP frontend', { ...enabledManifest, frontendOrigin: 'http://staging.flyeye.example' }],
    [
      'a frontend path',
      { ...enabledManifest, frontendOrigin: 'https://staging.flyeye.example/app' },
    ],
    [
      'a mismatched project API origin',
      { ...enabledManifest, apiOrigin: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' },
    ],
    [
      'a mismatched database host',
      { ...enabledManifest, databaseHost: 'db.zzzzzzzzzzzzzzzzzzzz.supabase.co' },
    ],
    [
      'a Supabase API used as the frontend',
      { ...enabledManifest, frontendOrigin: enabledManifest.apiOrigin },
    ],
  ])('rejects %s', (_label, manifest) => {
    expect(() => parseFeat003StagingManifest(manifest)).toThrow();
  });

  it('accepts one exact enabled staging target for separate review', () => {
    expect(parseFeat003StagingManifest(enabledManifest)).toMatchObject({
      enabled: true,
      projectRef: enabledManifest.projectRef,
      dataClassification: 'synthetic-only',
      limiterPolicyVersion: 'subject-action-v1',
    });
  });
});

describe('FEAT-003 protected function configuration', () => {
  const config = `[functions.auth-bootstrap]
enabled = true
verify_jwt = true

[functions.organization-admin-onboarding]
enabled = true
verify_jwt = true
`;
  const edgeEnvironmentExample = `ALLOWED_ORIGIN=http://127.0.0.1:5173
FLYEYE_RUNTIME_PROFILE=local-synthetic-v1
FEAT003_LIMITER_POLICY_VERSION=subject-action-v1
FEAT003_DATA_CLASSIFICATION=synthetic-only
`;

  it('requires explicit JWT verification and the reviewed local profile example', () => {
    expect(() =>
      validateFeat003RepositoryConfiguration(config, edgeEnvironmentExample),
    ).not.toThrow();
  });

  it.each([
    [
      'missing onboarding JWT verification',
      config.replace(
        '[functions.organization-admin-onboarding]\nenabled = true\nverify_jwt = true',
        '[functions.organization-admin-onboarding]\nenabled = true',
      ),
    ],
    [
      'disabled onboarding JWT verification',
      config.replace(
        '[functions.organization-admin-onboarding]\nenabled = true\nverify_jwt = true',
        '[functions.organization-admin-onboarding]\nenabled = true\nverify_jwt = false',
      ),
    ],
  ])('rejects %s', (_label, invalidConfig) => {
    expect(() =>
      validateFeat003RepositoryConfiguration(invalidConfig, edgeEnvironmentExample),
    ).toThrow();
  });

  it('rejects a missing runtime-profile declaration', () => {
    expect(() =>
      validateFeat003RepositoryConfiguration(
        config,
        edgeEnvironmentExample.replace('FLYEYE_RUNTIME_PROFILE=local-synthetic-v1\n', ''),
      ),
    ).toThrow();
  });
});
