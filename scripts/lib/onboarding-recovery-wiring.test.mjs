// @vitest-environment node
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createAdminOnboardingHandler } from '../../supabase/functions/organization-admin-onboarding/handler.ts';
import { waitForOnboardingWorker } from './onboarding-worker-readiness.mjs';
import {
  fixtureConnectionOptions,
  withFactorTransportDiagnostics,
  withPasswordLoginTransportDiagnostics,
} from './provider-transport-diagnostics.mjs';
import { fixtureDiagnostic } from './fixture-diagnostics.mjs';

// Run the actual fixture functions without importing its database/service lifecycle.
const source = readFileSync('scripts/test-feat-003-runtime.mjs', 'utf8');
const extract = (start, end) => {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  if (first < 0 || last <= first) throw new Error('Fixture function boundaries changed.');
  return source.slice(first, last);
};
const build = new Function(
  'context',
  `const { apiUrl, origin, publishableKey, serviceRoleKey, edgeProcess, fetch,
    challengeMode, uncertaintyMode, currentMode, churnMode, providerMode, providerProbe, providerStateMode,
    diagnosticsEnabled, fixtureConnectionOptions, withFactorTransportDiagnostics,
    withPasswordLoginTransportDiagnostics, fixtureDiagnostic, process,
    waitForOnboardingWorker, setTimeout } = context;
   const requestTimeoutMs = 30000, readinessProbeTimeoutMs = 2000;
   ${extract('function boundedFetch(', 'function waitForChildExit(')}
   ${extract('async function waitForEdgeRuntime(', 'async function restartLocalAuth(')}
   return { boundedFetch, waitForEdgeRuntime };`,
);
const origin = 'https://current-synthetic.invalid';
function wiring(overrides = {}) {
  const lines = [];
  const delay = vi.fn(async () => {});
  const context = {
    apiUrl: 'http://127.0.0.1:1',
    origin,
    publishableKey: 'synthetic-public',
    serviceRoleKey: 'synthetic-server',
    edgeProcess: { exitCode: null, signalCode: null },
    fetch: globalThis.fetch,
    challengeMode: false,
    uncertaintyMode: false,
    currentMode: false,
    churnMode: false,
    providerMode: true,
    ...new Function(
      'process',
      `${extract('const providerProbe =', 'const staleProbe =')} return { providerProbe, providerStateMode };`,
    )({
      argv: overrides.args ?? ['--provider-state'],
    }),
    diagnosticsEnabled: true,
    fixtureConnectionOptions,
    withFactorTransportDiagnostics,
    withPasswordLoginTransportDiagnostics,
    fixtureDiagnostic,
    process: { stdout: { write: (line) => lines.push(line) } },
    waitForOnboardingWorker: (options) => waitForOnboardingWorker({ ...options, delay }),
    setTimeout: (callback) => {
      delay();
      callback();
    },
    ...overrides,
  };
  return { ...build(context), lines, delay };
}

describe('provider-state readiness wiring', () => {
  it.each([false, true])(
    'rejects gateway-only readiness (cleanup probe=%s)',
    async (providerProbe) => {
      const fetch = vi.fn(async () =>
        Response.json({ message: 'generic gateway rejection' }, { status: 401 }),
      );
      const h = wiring({
        fetch,
        args: [providerProbe ? '--provider-cleanup-probe' : '--provider-state'],
      });
      await expect(h.waitForEdgeRuntime()).rejects.toThrow(
        'Local Edge Runtime did not become ready.',
      );
      expect(fetch).toHaveBeenCalledTimes(80);
      expect(h.delay).toHaveBeenCalledTimes(79);
    },
  );

  it('requires the exact current-origin handler before declaring readiness', async () => {
    const authenticate = vi.fn(() => {
      throw new Error('Must not authenticate');
    });
    const current = createAdminOnboardingHandler({ allowedOrigin: origin, authenticate });
    const old = createAdminOnboardingHandler({
      allowedOrigin: 'https://old-synthetic.invalid',
      authenticate,
    });
    let calls = 0;
    const fetch = vi.fn(async (input, init) => {
      calls++;
      if (calls === 2) return Response.json({ error: { code: 'wrong' } }, { status: 405 });
      return (calls === 1 ? old : current)(new Request(input, init));
    });
    const h = wiring({ fetch });
    await h.waitForEdgeRuntime();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(authenticate).not.toHaveBeenCalled();
    for (const [, init] of fetch.mock.calls) {
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect(init.headers.origin).toBe(origin);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('preserves the non-provider-mode readiness path', async () => {
    const fetch = vi.fn(async () => Response.json({}, { status: 401 }));
    const h = wiring({ fetch, args: [], providerMode: false });
    await h.waitForEdgeRuntime();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].method).toBe('POST');
    expect(fetch.mock.calls[0][1].body).toBe('{}');
  });
});

// The server closes idle sockets in a separate thread while the caller is blocked,
// like synchronous SQL fixture setup. No real provider or database is used.
const serverSource = `
const { parentPort, workerData } = require('node:worker_threads');
const { createServer } = require('node:http');
const state = new Int32Array(workerData);
const token = [Buffer.from(JSON.stringify({alg:'none'})).toString('base64url'),
  Buffer.from(JSON.stringify({sub:'synthetic',exp:4102444800})).toString('base64url'), 'synthetic'].join('.');
const server = createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    Atomics.add(state, 2, 1);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({access_token:token,refresh_token:'synthetic',expires_in:3600,
      token_type:'bearer',user:{id:'synthetic'}}));
  });
});
server.on('connection', socket => {
  Atomics.add(state, 4, 1);
  socket.on('close', () => Atomics.add(state, 3, 1));
});
server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port));
parentPort.on('message', message => {
  if (message === 'close-idle') {
    server.closeIdleConnections();
    Atomics.store(state, 0, 1);
    Atomics.notify(state, 0);
  }
});`;

function workerPort(worker, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const settle = (error, port) => {
      clearTimeout(timer);
      worker.off('message', ready);
      worker.off('error', failed);
      worker.off('exit', exited);
      if (error) reject(error);
      else resolve(port);
    };
    const ready = (port) =>
      Number.isInteger(port) && port > 0 && port <= 65535
        ? settle(undefined, port)
        : settle(new Error('Synthetic listener returned an invalid port.'));
    const failed = () => settle(new Error('Synthetic listener failed to start.'));
    const exited = () => settle(new Error('Synthetic listener exited before startup.'));
    const timer = setTimeout(
      () => settle(new Error('Synthetic listener startup timed out.')),
      timeoutMs,
    );
    worker.once('message', ready);
    worker.once('error', failed);
    worker.once('exit', exited);
  });
}

describe('synthetic listener startup settlement', () => {
  it.each(['timeout', 'exit', 'error', 'invalid', 'ready'])(
    'settles %s and removes observers',
    async (event) => {
      const worker = new EventEmitter();
      const terminate = vi.fn(async () => {});
      const operation = (async () => {
        try {
          return await workerPort(worker, 10);
        } finally {
          await terminate();
        }
      })();
      if (event === 'ready') worker.emit('message', 12345);
      else if (event === 'invalid') worker.emit('message', 'private');
      else if (event !== 'timeout') worker.emit(event, new Error('private'));
      if (event === 'ready') await expect(operation).resolves.toBe(12345);
      else await expect(operation).rejects.toThrow(/Synthetic listener/);
      expect(terminate).toHaveBeenCalledTimes(1);
      for (const name of ['message', 'error', 'exit']) expect(worker.listenerCount(name)).toBe(0);
    },
  );
});

describe('actual churn password socket characterization', () => {
  it.each(['native', 'sdk'])(
    '%s one-shot password calls across independent idle close',
    async (transport) => {
      const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        for (const closeControl of [false, true]) {
          const state = new Int32Array(new SharedArrayBuffer(20));
          const worker = new Worker(serverSource, { eval: true, workerData: state.buffer });
          try {
            const port = await workerPort(worker);
            const apiUrl = `http://127.0.0.1:${port}`;
            const attempts = [];
            const h = wiring({
              apiUrl,
              churnMode: true,
              args: ['--factor-churn'],
              fetch: (input, init) => {
                attempts.push(new URL(input).pathname);
                return fetch(
                  input,
                  closeControl ? fixtureConnectionOptions(input, init, apiUrl) : init,
                );
              },
            });
            const warm = await h.boundedFetch(`${apiUrl}/auth/v1/health`, {});
            await warm.json();
            const client = createClient(apiUrl, 'synthetic-public', {
              auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
              global: { fetch: h.boundedFetch },
            });
            worker.postMessage('close-idle');
            expect(Atomics.wait(state, 0, 0, 2000)).not.toBe('timed-out');
            // Allow the peer's FIN to arrive without processing the caller's I/O callbacks.
            Atomics.wait(state, 1, 0, 50);
            let status;
            if (transport === 'sdk') {
              const result = await client.auth.signInWithPassword({
                email: 'synthetic@example.test',
                password: 'synthetic',
              });
              status = result.error ? result.error.status : 200;
            } else {
              try {
                const response = await h.boundedFetch(
                  `${apiUrl}/auth/v1/token?grant_type=password`,
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      email: 'synthetic@example.test',
                      password: 'synthetic',
                    }),
                  },
                );
                await response.json();
                status = response.status;
              } catch (error) {
                expect(['UND_ERR_SOCKET', 'ECONNRESET']).toContain(error.cause?.code);
                status = 0;
              }
            }
            expect([0, 200]).toContain(status);
            expect(attempts).toEqual(['/auth/v1/health', '/auth/v1/token']);
            expect(Atomics.load(state, 2)).toBe(status === 200 ? 2 : 1);
            expect(Atomics.load(state, 3)).toBeGreaterThanOrEqual(1);
            if (closeControl) expect(status).toBe(200);
            process.stdout.write(
              `Churn password characterization: ${transport}; close-control=${closeControl}; status=${status}; received=${Atomics.load(state, 2)}; connections=${Atomics.load(state, 4)}.\n`,
            );
          } finally {
            await worker.terminate();
          }
        }
      } finally {
        silence.mockRestore();
      }
    },
  );
});
