import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  collectGatewayDiagnostics,
  gatewayResponseDetails,
} from './onboarding-gateway-diagnostics.mjs';
import { fixtureDiagnostic, fixtureDiagnosticLines } from './fixture-diagnostics.mjs';

// Execute the fixture's actual request function without importing its database lifecycle.
const source = readFileSync('scripts/test-feat-003-runtime.mjs', 'utf8');
const invoke = source.slice(
  source.indexOf('async function invokeFunction('),
  source.indexOf('async function invokeWithTransientRecovery('),
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction(
  'dependencies',
  'pathname',
  'token',
  'body',
  `const { boundedFetch, apiUrl, publishableKey, origin, churnMode, providerMode, diagnosticsEnabled, projectId, process, gatewayResponseDetails, collectGatewayDiagnostics, fixtureDiagnostic } = dependencies; ${invoke}\nreturn invokeFunction(pathname, token, body);`,
);
const secret = 'synthetic-private-token-email-url';

function harness({
  status = 502,
  payload = {
    message: 'An invalid response was received from the upstream server',
    private: secret,
  },
  jsonError,
  fetchError,
  modes = {},
  unavailable = false,
} = {}) {
  const lines = [];
  const json = vi.fn(jsonError ? () => Promise.reject(jsonError) : async () => payload);
  const response = {
    status,
    json,
    headers: new Headers({ server: 'kong/2.8.1', 'retry-after': '7' }),
  };
  const boundedFetch = vi.fn(fetchError ? () => Promise.reject(fetchError) : async () => response);
  const docker = vi.fn((_command, args) => {
    if (unavailable) throw new Error(secret);
    return args[0] === 'inspect'
      ? { status: 0, stdout: '{"com.supabase.cli.project":"synthetic_ci"}' }
      : { status: 0, stdout: `upstream prematurely closed connection ${secret}`, stderr: secret };
  });
  const collect = vi.fn((options) => collectGatewayDiagnostics({ ...options, execute: docker }));
  const dependencies = {
    boundedFetch,
    apiUrl: 'http://127.0.0.1:54321',
    publishableKey: 'synthetic-public',
    origin: 'http://127.0.0.1:4173',
    churnMode: false,
    providerMode: true,
    diagnosticsEnabled: true,
    projectId: 'synthetic_ci',
    process: {
      env: { CI: 'true', GITHUB_ACTIONS: 'true' },
      stdout: { write: (line) => lines.push(line.trimEnd()) },
    },
    gatewayResponseDetails,
    collectGatewayDiagnostics: collect,
    fixtureDiagnostic,
    ...modes,
  };
  return {
    run: (
      pathname = 'organization-admin-onboarding',
      body = { action: 'start', private: secret },
    ) => execute(dependencies, pathname, secret, body),
    boundedFetch,
    json,
    collect,
    docker,
    lines,
    payload,
  };
}

describe('provider START failure diagnostics', () => {
  it.each([500, 502, 503, 504])(
    'preserves the single request and HTTP %s result',
    async (status) => {
      const h = harness({ status });
      const result = await h.run();
      expect(result).toEqual({ status, payload: h.payload, retryAfter: '7' });
      expect(result.payload).toBe(h.payload);
      expect(h.boundedFetch).toHaveBeenCalledExactlyOnceWith(
        'http://127.0.0.1:54321/functions/v1/organization-admin-onboarding',
        {
          method: 'POST',
          headers: {
            apikey: 'synthetic-public',
            authorization: `Bearer ${secret}`,
            'content-type': 'application/json',
            origin: 'http://127.0.0.1:4173',
          },
          body: JSON.stringify({ action: 'start', private: secret }),
        },
      );
      expect(h.json).toHaveBeenCalledTimes(1);
      expect(h.collect).toHaveBeenCalledTimes(1);
      expect(h.docker).toHaveBeenCalledTimes(4);
      expect(h.lines).toEqual([
        fixtureDiagnostic('FEAT-003', 'gateway-response', 'response', 'kong-response'),
        fixtureDiagnostic('FEAT-003', 'gateway-response', 'response', 'upstream-invalid-response'),
        fixtureDiagnostic('FEAT-003', 'gateway-log', 'response', 'upstream-reset'),
        fixtureDiagnostic('FEAT-003', 'worker-log', 'response', 'upstream-reset'),
      ]);
      expect(fixtureDiagnosticLines('FEAT-003', h.lines.join('\n'))).toEqual(h.lines);
      expect(h.lines.join('\n')).not.toContain(secret);
    },
  );

  it.each([200, 400, 401, 403, 409, 429, 499])('does not collect on HTTP %s', async (status) => {
    const h = harness({ status });
    expect(await h.run()).toEqual({ status, payload: h.payload, retryAfter: '7' });
    expect(h.boundedFetch).toHaveBeenCalledTimes(1);
    expect(h.json).toHaveBeenCalledTimes(1);
    expect(h.collect).not.toHaveBeenCalled();
    expect(h.lines).toEqual([]);
  });

  it.each([
    ['organization-admin-onboarding', { action: 'status' }, {}],
    ['organization-admin-onboarding', { action: 'complete' }, {}],
    ['organization-admin-onboarding', { action: 'cancel' }, {}],
    ['organization-admin-onboarding', null, {}],
    ['auth-bootstrap', { action: 'start' }, {}],
    ['organization-admin-onboarding', { action: 'start' }, { providerMode: false }],
    ['organization-admin-onboarding', { action: 'start' }, { diagnosticsEnabled: false }],
  ])('does not widen collection to %s %j %j', async (pathname, body, modes) => {
    const h = harness({ modes });
    expect((await h.run(pathname, body)).status).toBe(502);
    expect(h.boundedFetch).toHaveBeenCalledTimes(1);
    expect(h.json).toHaveBeenCalledTimes(1);
    expect(h.collect).not.toHaveBeenCalled();
    expect(h.lines).toEqual([]);
  });

  it('retains existing churn diagnostics for other requests', async () => {
    const h = harness({ modes: { churnMode: true } });
    expect((await h.run('auth-bootstrap', {})).status).toBe(502);
    expect(h.collect).toHaveBeenCalledTimes(1);
    expect(h.boundedFetch).toHaveBeenCalledTimes(1);
  });

  it('preserves transport rejection without diagnostics or retry', async () => {
    const error = new Error(secret);
    const h = harness({ fetchError: error });
    await expect(h.run()).rejects.toBe(error);
    expect(h.boundedFetch).toHaveBeenCalledTimes(1);
    expect(h.json).not.toHaveBeenCalled();
    expect(h.collect).not.toHaveBeenCalled();
    expect(h.lines).toEqual([]);
  });

  it('keeps the non-JSON failure while emitting only fixed server categories', async () => {
    const h = harness({ jsonError: new Error(secret) });
    await expect(h.run()).rejects.toThrow('Local Edge Function returned a non-JSON contract.');
    expect(h.boundedFetch).toHaveBeenCalledTimes(1);
    expect(h.json).toHaveBeenCalledTimes(1);
    expect(h.lines).toHaveLength(3);
    expect(h.lines.join('\n')).not.toContain(secret);
  });

  it('keeps the response when diagnostic collection is unavailable', async () => {
    const h = harness({ unavailable: true });
    expect(await h.run()).toEqual({ status: 502, payload: h.payload, retryAfter: '7' });
    expect(h.boundedFetch).toHaveBeenCalledTimes(1);
    expect(h.json).toHaveBeenCalledTimes(1);
    expect(h.docker).toHaveBeenCalledTimes(2);
    expect(h.lines.filter((line) => line.includes('diagnostic-unavailable'))).toHaveLength(2);
    expect(h.lines.join('\n')).not.toContain(secret);
  });
});
