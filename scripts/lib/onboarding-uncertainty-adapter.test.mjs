// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { loadUncertaintyHandlers, withProviderFault } from './onboarding-uncertainty-adapter.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('requires disposable CI before loading production wiring', async () => {
  vi.stubEnv('CI', 'false');
  await expect(loadUncertaintyHandlers({})).rejects.toThrow();
});
it('injects exactly the selected GET and restores fetch after failure', async () => {
  const original = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', original);
  const value = await withProviderFault('http://127.0.0.1:1', '/auth/v1/user', async () => {
    expect((await fetch('http://127.0.0.1:1/auth/v1/user')).status).toBe(503);
    await fetch('http://127.0.0.1:1/rest/v1/rpc/synthetic', { method: 'POST' });
    return 'completed';
  });
  expect(value.hits).toBe(1);
  expect(original).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).toBe(original);
  await expect(
    withProviderFault('http://127.0.0.1:1', '/auth/v1/user', async () => {
      throw new Error('synthetic');
    }),
  ).rejects.toThrow('synthetic');
  expect(globalThis.fetch).toBe(original);
});
it('rejects unrelated origins, arbitrary fault paths and overlapping scopes', async () => {
  const original = vi.fn();
  vi.stubGlobal('fetch', original);
  await expect(
    withProviderFault('http://127.0.0.1:1', '/anything', async () => {}),
  ).rejects.toThrow();
  await expect(
    withProviderFault('http://127.0.0.1:1', '/auth/v1/user', () =>
      fetch('https://example.test/auth/v1/user'),
    ),
  ).rejects.toThrow();
  await expect(
    withProviderFault('http://127.0.0.1:1', '/auth/v1/user', () =>
      withProviderFault('http://127.0.0.1:1', '/auth/v1/user', async () => {}),
    ),
  ).rejects.toThrow();
  expect(original).not.toHaveBeenCalled();
  expect(globalThis.fetch).toBe(original);
});
