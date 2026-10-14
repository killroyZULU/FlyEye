import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fixtureConnectionOptions } from './provider-transport-diagnostics.mjs';

// Production entry-point wiring in Node, not a claim about Deno/Kong outages.
// No listener, production test switch, credential file or dependency replacement.
export async function loadUncertaintyHandlers(configuration) {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const { apiUrl, publishableKey, serviceRoleKey, limiterSecret, origin } = configuration;
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiUrl).hostname));
  const values = {
    SUPABASE_URL: apiUrl,
    SUPABASE_ANON_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    ALLOWED_ORIGIN: origin,
    FEAT003_LIMITER_HMAC_SECRET: limiterSecret,
    FLYEYE_RUNTIME_PROFILE: 'local-synthetic-v1',
    FEAT003_LIMITER_POLICY_VERSION: 'subject-action-v1',
    FEAT003_DATA_CLASSIFICATION: 'synthetic-only',
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
  const handlers = [];
  const server = await createServer({
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    globalThis.Deno = { env: { get: (name) => values[name] }, serve: (fn) => handlers.push(fn) };
    for (const name of ['organization-admin-onboarding', 'auth-bootstrap'])
      await server.ssrLoadModule(`/supabase/functions/${name}/index.ts`);
    assert.equal(handlers.length, 2);
    return handlers;
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Deno', previous);
    else delete globalThis.Deno;
    await server.close();
  }
}

let active = false;
export async function withProviderFault(apiUrl, faultPath, operation) {
  assert.equal(active, false, 'Provider fault scopes must be serialized.');
  assert.ok(
    faultPath === '/auth/v1/user' ||
      /^\/auth\/v1\/admin\/users\/[0-9a-f-]{36}\/factors$/.test(faultPath),
  );
  const origin = new URL(apiUrl).origin;
  const original = globalThis.fetch;
  const requests = [];
  let hits = 0;
  active = true;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      assert.equal(url.origin, origin);
      const method = init.method ?? input.method ?? 'GET';
      requests.push({ method, path: url.pathname });
      if (method === 'GET' && url.pathname === faultPath) {
        hits++;
        return Response.json({ msg: 'Synthetic provider unavailable' }, { status: 503 });
      }
      return original(input, {
        ...fixtureConnectionOptions(input, init, apiUrl),
        signal: init.signal ?? AbortSignal.timeout(15_000),
      });
    };
    const value = await operation();
    return { value, requests, hits };
  } finally {
    globalThis.fetch = original;
    active = false;
  }
}
