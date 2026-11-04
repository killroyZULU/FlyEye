// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { feat003StagingTarget as target } from '../../../config/feat-003-staging-target.mjs';

const client = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('@supabase/supabase-js', () => ({ createClient: client }));
const entries = [
  ['auth-bootstrap', () => import('../auth-bootstrap/index.ts'), 'FEAT001'],
  [
    'organization-admin-onboarding',
    () => import('../organization-admin-onboarding/index.ts'),
    'FEAT003',
  ],
  ['member-administration', () => import('../member-administration/index.ts'), 'FEAT005'],
  ['member-mfa', () => import('../member-mfa/index.ts'), 'FEAT006'],
];
const jwt = (role) => `header.${btoa(JSON.stringify({ role }))}.signature`;
const environment = {
  SUPABASE_URL: target.apiOrigin,
  ALLOWED_ORIGIN: target.frontendOrigin,
  SUPABASE_ANON_KEY: jwt('anon'),
  SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'),
  FLYEYE_RUNTIME_PROFILE: 'staging-synthetic-v1',
  FEAT003_STAGING_PROJECT_REF: target.projectRef,
  FLYEYE_STAGING_ACTION_POLICY_VERSION: 'minimum-actions-v1',
};
for (const [prefix, policy] of [
  ['FEAT001', 'auth-bootstrap-subject-v1'],
  ['FEAT003', 'subject-action-v1'],
  ['FEAT005', 'member-administration-subject-scope-v1'],
  ['FEAT006', 'member-mfa-subject-action-v1'],
]) {
  environment[`${prefix}_DATA_CLASSIFICATION`] = 'synthetic-only';
  environment[`${prefix}_LIMITER_POLICY_VERSION`] = policy;
  environment[`${prefix}_LIMITER_HMAC_SECRET`] = `synthetic-${prefix}-limiter-at-least-32-bytes`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe.each(entries)('P3c %s startup', (_name, load, prefix) => {
  it.each([
    'SUPABASE_URL',
    'ALLOWED_ORIGIN',
    'FLYEYE_RUNTIME_PROFILE',
    'FEAT003_STAGING_PROJECT_REF',
    'FLYEYE_STAGING_ACTION_POLICY_VERSION',
    `${prefix}_DATA_CLASSIFICATION`,
    `${prefix}_LIMITER_POLICY_VERSION`,
    'SUPABASE_SERVICE_ROLE_KEY',
  ])('rejects invalid %s before client creation, serve or network', async (key) => {
    vi.resetModules();
    const serve = vi.fn();
    const fetch = vi.fn(() => {
      throw new Error('Unexpected network');
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('Deno', {
      env: { get: (name) => (name === key ? 'invalid' : environment[name]) },
      serve,
    });
    await expect(load()).rejects.toThrow();
    expect(client).not.toHaveBeenCalled();
    expect(serve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('constructs the selected handler with valid synthetic configuration without network', async () => {
    vi.resetModules();
    const serve = vi.fn();
    const fetch = vi.fn(() => {
      throw new Error('Unexpected network');
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('Deno', { env: { get: (name) => environment[name] }, serve });
    await load();
    expect(client).toHaveBeenCalledTimes(2);
    expect(client).toHaveBeenNthCalledWith(
      2,
      target.apiOrigin,
      environment.SUPABASE_SERVICE_ROLE_KEY,
      expect.any(Object),
    );
    expect(serve).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
    expect(fetch).not.toHaveBeenCalled();
  });
});
