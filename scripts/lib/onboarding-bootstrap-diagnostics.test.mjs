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
    expect(h.lines[0]).toContain('detail=kong-response.');
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
      'bootstrap-response-unreadable',
    ],
    [{ body: async () => Buffer.from(secret) }, 'bootstrap-response-unreadable'],
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
    expect(before[0]).toContain('bootstrap-response-unreadable');
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
      ['gateway-log', 'worker-log'].map((stage) =>
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
    expect(report).toHaveBeenCalledTimes(3);
    const injected = harness({ collect: () => [{ stage: 'gateway-log', details: [secret] }] });
    await injected.run();
    expect(injected.lines.join('\n')).not.toContain(secret);
    expect(() =>
      fixtureDiagnostic('FEAT-003', 'gateway-log', 'response', 'bootstrap-limiter-unavailable'),
    ).toThrow();
  });
});
