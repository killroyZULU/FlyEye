// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { feat003StagingTarget as target } from '../../config/feat-003-staging-target.mjs';
import { RECOVERY_COMPLETE_PATH } from '../../src/features/auth/recovery.ts';
import {
  generateStagingBrowserConfiguration,
  readStagingBrowserConfiguration,
} from './feat-003-staging-browser-package.mjs';

// A synthetic packaging example, not a deployment manifest. The oracle compares
// the browser portion of a package to independently selected build inputs.
const publicKey = 'sb_publishable_synthetic-development-key';
const callback = target.frontendOrigin + RECOVERY_COMPLETE_PATH;
const browserContract = (redirects) =>
  z.strictObject({
    siteUrl: z.literal(target.frontendOrigin),
    corsOrigins: z.tuple([z.literal(target.frontendOrigin)]),
    redirectUrls: redirects,
    frontendEnv: z.strictObject({
      VITE_SUPABASE_URL: z.literal(target.apiOrigin),
      VITE_SUPABASE_PUBLISHABLE_KEY: z.literal(publicKey),
    }),
  });

const noCallbacks = browserContract(z.tuple([]));
const oneCallback = browserContract(z.tuple([z.literal(callback)]));
const example = {
  siteUrl: target.frontendOrigin,
  corsOrigins: [target.frontendOrigin],
  redirectUrls: [],
  frontendEnv: {
    VITE_SUPABASE_URL: target.apiOrigin,
    VITE_SUPABASE_PUBLISHABLE_KEY: publicKey,
  },
};
const emptySelection = { publishableKey: publicKey, callbackPaths: [] };
const recoverySelection = { ...emptySelection, callbackPaths: [RECOVERY_COMPLETE_PATH] };
const read = (input, selection) =>
  readStagingBrowserConfiguration(JSON.stringify(input), selection);
const rejection = 'Invalid staging browser configuration.';

describe('offline staging browser configuration package', () => {
  it('admits only the callback inventory selected for this package', () => {
    const selected = { ...example, redirectUrls: [callback] };
    expect(
      noCallbacks.safeParse(JSON.parse(generateStagingBrowserConfiguration(emptySelection)))
        .success,
    ).toBe(true);
    expect(
      oneCallback.safeParse(JSON.parse(generateStagingBrowserConfiguration(recoverySelection)))
        .success,
    ).toBe(true);
    expect(() => read(example, recoverySelection)).toThrow(rejection);
    expect(() => read(selected, emptySelection)).toThrow(rejection);
    expect(noCallbacks.safeParse(selected).success).toBe(false);
    expect(oneCallback.safeParse(example).success).toBe(false);
  });

  it.each([
    ['substituted Site URL', { siteUrl: 'https://other.example' }],
    ['substituted CORS origin', { corsOrigins: ['https://other.example'] }],
    ['extra CORS origin', { corsOrigins: [target.frontendOrigin, 'https://other.example'] }],
    ['wildcard callback', { redirectUrls: [target.frontendOrigin + '/auth/*'] }],
    ['foreign callback', { redirectUrls: ['https://other.example' + RECOVERY_COMPLETE_PATH] }],
    ['unlisted same-origin callback', { redirectUrls: [target.frontendOrigin + '/other'] }],
    ['callback query', { redirectUrls: [callback + '?next=/other'] }],
    ['additional callback', { redirectUrls: [callback, callback + '/other'] }],
  ])('rejects %s', (_label, change) => {
    expect(() =>
      read({ ...example, redirectUrls: [callback], ...change }, recoverySelection),
    ).toThrow(rejection);
    expect(oneCallback.safeParse({ ...example, redirectUrls: [callback], ...change }).success).toBe(
      false,
    );
  });

  it.each([
    ['substituted API origin', { VITE_SUPABASE_URL: 'https://other.example' }],
    ['server key in the public slot', { VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_fixture' }],
    ['extra privileged variable', { VITE_SERVICE_ROLE_KEY: 'synthetic-only' }],
    ['missing public key', { VITE_SUPABASE_PUBLISHABLE_KEY: undefined }],
  ])('rejects %s in the frontend environment', (_label, change) => {
    const frontendEnv = { ...example.frontendEnv, ...change };
    expect(() => read({ ...example, frontendEnv }, emptySelection)).toThrow(rejection);
    expect(noCallbacks.safeParse({ ...example, frontendEnv }).success).toBe(false);
  });

  it('rejects a self-consistent unsafe selection and a different public key', () => {
    const publishableKey = 'sb_secret_fixture';
    const candidate = {
      ...example,
      frontendEnv: { ...example.frontendEnv, VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey },
    };
    expect(() => read(candidate, { ...emptySelection, publishableKey })).toThrow(rejection);
    expect(() => read(example, { ...emptySelection, publishableKey: publicKey + '2' })).toThrow(
      rejection,
    );
    expect(() =>
      read(
        { ...example, redirectUrls: [target.frontendOrigin + '/*'] },
        { ...emptySelection, callbackPaths: ['/*'] },
      ),
    ).toThrow(rejection);
  });

  it('reads reordered fields and rejects malformed JSON', () => {
    const reordered = Object.fromEntries(Object.entries(example).reverse());
    expect(read(reordered, emptySelection)).toEqual(example);
    expect(() => readStagingBrowserConfiguration('{', emptySelection)).toThrow(rejection);
  });
});
