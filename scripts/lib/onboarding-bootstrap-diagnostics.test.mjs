import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportBootstrapFailure } from './onboarding-bootstrap-diagnostics.mjs';
import { fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

const secret = 'synthetic-private-token-email-body';
const config = {
  projectId: 'synthetic_ci',
  since: '2026-11-02T00:00:00.000Z',
  ci: 'true',
  githubActions: 'true',
};
const response = (payload, server = secret) => ({
  body: vi.fn(async () => Buffer.from(JSON.stringify(payload))),
  headers: () => ({ server, authorization: secret }),
});
function harness(override = {}) {
  const lines = [];
  const collect = vi.fn(() => [
    { stage: 'gateway-log', details: ['upstream-reset'] },
    { stage: 'worker-log', details: ['no-recognized-log-signature'] },
  ]);
  const options = {
    ...config,
    collect,
    report: (stage, event, detail) =>
      lines.push(fixtureDiagnostic('FEAT-003', stage, event, detail)),
    ...override,
  };
  return { lines, collect, run: () => reportBootstrapFailure(options) };
}
afterEach(() => vi.useRealTimers());

describe('bounded bootstrap failure evidence', () => {
  it.each([
    ['auth.limiter_unavailable', 'bootstrap-limiter-unavailable'],
    ['auth.factor_inventory_unavailable', 'bootstrap-factor-inventory-unavailable'],
    ['auth.audit_unavailable', 'bootstrap-audit-unavailable'],
    ['auth.access_context_unavailable', 'bootstrap-access-context-unavailable'],
  ])(
    'classifies application code %s without retaining private payload fields',
    async (code, detail) => {
      const h = harness({
        response: response({ error: { code, message: secret }, token: secret }),
      });
      await h.run();
      expect(h.lines[0]).toBe(
        fixtureDiagnostic('FEAT-003', 'bootstrap-response', 'response', detail),
      );
      expect(h.lines.join('\n')).not.toContain(secret);
      expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', h.lines.join('\n'))).toEqual(
        h.lines,
      );
      expect(h.collect).toHaveBeenCalledExactlyOnceWith(config);
    },
  );
  it.each([
    [{ code: 'BOOT_ERROR', message: secret }, 'worker-boot-error'],
    [{ code: 'WORKER_ERROR' }, 'worker-error'],
    [{ code: 'WORKER_LIMIT' }, 'worker-limit'],
    [{ message: 'name resolution failed' }, 'proxy-name-resolution'],
    [
      { message: 'An invalid response was received from the upstream server' },
      'upstream-invalid-response',
    ],
    [{ error: { code: secret }, message: secret }, 'unknown-server-response'],
    [null, 'unknown-server-response'],
    [{ code: '__proto__' }, 'unknown-server-response'],
  ])('reuses fixed gateway categories for %j', async (payload, detail) => {
    const h = harness({ response: response(payload) });
    await h.run();
    expect(h.lines[0]).toContain(`detail=${detail}.`);
    expect(h.lines.join('\n')).not.toContain(secret);
  });
  it('records only the allowlisted server category', async () => {
    const h = harness({ response: response({}, 'kong/2.8.1') });
    await h.run();
    expect(h.lines[0]).toContain('detail=unknown-server-response.');
    expect(h.lines[1]).toContain('detail=kong-response.');
    expect(h.lines.join('\n')).not.toMatch(/2\.8\.1|synthetic-private/);
  });
  it.each([
    [undefined, 'bootstrap-response-missing'],
    [
      {
        body: async () => {
          throw new Error(secret);
        },
      },
      'bootstrap-body-read-rejected',
    ],
    [{ body: async () => Buffer.from(secret) }, 'bootstrap-body-invalid-json'],
    [{ body: async () => Buffer.alloc(8193) }, 'bootstrap-response-oversize'],
  ])('reports missing, unreadable or oversized evidence explicitly', async (value, detail) => {
    const h = harness({ response: value });
    await h.run();
    expect(h.lines[0]).toContain(`detail=${detail}.`);
    expect(h.collect).toHaveBeenCalledTimes(1);
    expect(h.lines.join('\n')).not.toContain(secret);
  });
  it('bounds a stuck body read to one diagnostic second and ignores late completion', async () => {
    vi.useFakeTimers();
    let resolve;
    const h = harness({
      response: {
        body: () =>
          new Promise((done) => {
            resolve = done;
          }),
      },
    });
    const pending = h.run();
    await vi.advanceTimersByTimeAsync(999);
    expect(h.collect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    const before = [...h.lines];
    expect(before[0]).toContain('bootstrap-body-read-expired');
    resolve(Buffer.from(JSON.stringify({ error: { code: 'auth.limiter_unavailable' } })));
    await Promise.resolve();
    expect(h.lines).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([{ ci: 'false' }, { githubActions: 'false' }])(
    'does no evidence reads outside disposable CI',
    async (override) => {
      const value = response({ message: secret });
      const h = harness({ ...override, response: value });
      await h.run();
      expect(value.body).not.toHaveBeenCalled();
      expect(h.collect).not.toHaveBeenCalled();
      expect(h.lines).toEqual([]);
    },
  );
  it.each([
    () => [],
    () => {
      throw new Error(secret);
    },
  ])('records unavailable gateway and worker evidence', async (collect) => {
    const h = harness({ collect });
    await h.run();
    expect(h.lines.slice(1)).toEqual(
      ['bootstrap-cli-log', 'gateway-log', 'worker-log'].map((stage) =>
        fixtureDiagnostic('FEAT-003', stage, 'response', 'diagnostic-unavailable'),
      ),
    );
  });
  it('rejects unallowlisted output and survives reporter errors', async () => {
    const report = vi.fn(() => {
      throw new Error(secret);
    });
    const h = harness({ report });
    await expect(h.run()).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledTimes(4);
    const injected = harness({ collect: () => [{ stage: 'gateway-log', details: [secret] }] });
    await injected.run();
    expect(injected.lines.join('\n')).not.toContain(secret);
    expect(() =>
      fixtureDiagnostic('FEAT-003', 'gateway-log', 'response', 'bootstrap-limiter-unavailable'),
    ).toThrow();
  });
  it.each([
    ['application/json; charset=utf-8', 'bootstrap-content-json'],
    ['text/html', 'bootstrap-content-html'],
    ['text/plain', 'bootstrap-content-other'],
    [undefined, 'bootstrap-content-missing'],
  ])('retains independent safe headers when body reading rejects (%s)', async (type, detail) => {
    const value = {
      headers: vi.fn(() => ({ server: 'kong/2.8.1', 'content-type': type, authorization: secret })),
      body: vi.fn(async () => {
        throw new Error(secret);
      }),
    };
    const h = harness({ response: value });
    await h.run();
    expect(h.lines.slice(0, 3)).toEqual(
      ['bootstrap-body-read-rejected', 'kong-response', detail].map((category) =>
        fixtureDiagnostic('FEAT-003', 'bootstrap-response', 'response', category),
      ),
    );
    expect(value.body).toHaveBeenCalledTimes(1);
    expect(value.headers).toHaveBeenCalledTimes(1);
    expect(h.lines.join('\n')).not.toMatch(/2\.8\.1|synthetic-private/);
    expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', h.lines.join('\n'))).toEqual(
      h.lines,
    );
  });
  it('classifies body even when headers are unavailable and clears its timer', async () => {
    vi.useFakeTimers();
    const h = harness({
      response: {
        ...response({ code: 'BOOT_ERROR' }),
        headers: () => {
          throw new Error(secret);
        },
      },
    });
    await h.run();
    expect(h.lines[0]).toContain('worker-boot-error');
    expect(h.lines[1]).toContain('bootstrap-headers-unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains headers across a read expiry and tolerates a late rejection', async () => {
    vi.useFakeTimers();
    let reject;
    const h = harness({
      response: {
        headers: () => ({ server: 'kong/2.8.1', 'content-type': 'text/html' }),
        body: () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      },
    });
    const pending = h.run();
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    const before = [...h.lines];
    expect(before.slice(0, 3).map((line) => line.split('detail=')[1])).toEqual([
      'bootstrap-body-read-expired.',
      'kong-response.',
      'bootstrap-content-html.',
    ]);
    reject(new Error(secret));
    await Promise.resolve();
    expect(h.lines).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the exact 8 KiB parsing boundary', async () => {
    const payload = JSON.stringify({ error: { code: 'auth.audit_unavailable' } });
    const h = harness({
      response: { ...response({}), body: async () => Buffer.from(payload.padEnd(8192)) },
    });
    await h.run();
    expect(h.lines[0]).toContain('bootstrap-audit-unavailable');
  });
  it('sanitizes CLI categories and rejects new vocabulary on unrelated stages', async () => {
    const h = harness({ cliDetails: ['worker-boot-error', 'cli-window-truncated', secret] });
    await h.run();
    expect(h.lines).toContain(
      fixtureDiagnostic('FEAT-003', 'bootstrap-cli-log', 'response', 'cli-window-truncated'),
    );
    expect(h.lines.join('\n')).not.toContain(secret);
    expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', h.lines.join('\n'))).toEqual(
      h.lines,
    );
    for (const detail of [
      'cli-window-truncated',
      'bootstrap-body-read-expired',
      'bootstrap-content-html',
    ]) {
      expect(() => fixtureDiagnostic('FEAT-003', 'gateway-log', 'response', detail)).toThrow();
    }
  });
});
