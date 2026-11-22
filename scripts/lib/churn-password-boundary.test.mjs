// @vitest-environment node
import { channel } from 'node:diagnostics_channel';
import { describe, expect, it, vi } from 'vitest';
import { churnPasswordBoundary } from './churn-password-boundary.mjs';
import { fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

const origin = 'http://127.0.0.1:55321';
const user = 'synthetic-private-user';
const path = '/auth/v1/token?grant_type=password';
const request = () => ({ method: 'POST', origin, path });
const sdkReply = { data: { session: { user: { id: user } } } };
const publish = (event, request, response) =>
  channel('undici:' + event).publish({ request, response });
function wire(req, headers = ['via', '1.1 kong/2.8.1']) {
  publish('request:create', req);
  publish('client:sendHeaders', req);
  publish('request:headers', req, { headers: headers.map((value) => Buffer.from(value)) });
}
function read(observer, count = vi.fn()) {
  const signals = {};
  observer.report(count, (stage, event, detail) => {
    const line = fixtureDiagnostic('FEAT-003', stage, event, detail);
    expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', line)).toEqual([line]);
    signals[stage.replace('churn-', '')] = detail;
  });
  return [
    signals['client-dispatch'],
    signals['client-headers'],
    signals['gateway-receipt'],
    signals['auth-completion'],
  ];
}
const yes = 'observed',
  unknown = 'unknown';
describe('CI churn password request attribution', () => {
  it('preserves the exact SDK response and emits only fixed labels for a correlated response', async () => {
    const observer = churnPasswordBoundary(origin);
    const login = vi.fn(() => {
      wire(request(), ['authorization', 'synthetic-private-header', 'server', 'kong/2.8.1']);
      return sdkReply;
    });
    expect(await observer.observe(user, login)).toBe(sdkReply);
    const lookup = vi.fn();
    expect(read(observer, lookup)).toEqual([yes, yes, yes, yes]);
    expect(login).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([
    ['1', yes],
    ['0', unknown],
    ['2', unknown],
  ])('keeps lost headers independent of server readback %s', async (count, auth) => {
    const observer = churnPasswordBoundary(origin),
      err = new Error('private-transport-detail');
    const login = vi.fn(() => {
      const r = request();
      publish('request:create', r);
      publish('client:sendHeaders', r);
      throw err;
    });
    await expect(observer.observe(user, login)).rejects.toBe(err);
    const lookup = vi.fn(() => count);
    expect(lookup).not.toHaveBeenCalled();
    expect(read(observer, lookup)).toEqual([yes, unknown, unknown, auth]);
    expect(lookup.mock.calls).toEqual([[user]]);
    expect(login).toHaveBeenCalledTimes(1);
  });
  it('does not equate another handler or an error response with gateway receipt or password completion', async () => {
    const observer = churnPasswordBoundary(origin);
    const reply = { data: { session: null }, error: new Error('private-identifier') };
    expect(
      await observer.observe(user, () => {
        wire(request(), ['via', 'other', 'authorization', user]);
        return reply;
      }),
    ).toBe(reply);
    expect(
      read(observer, () => {
        throw Error(user);
      }),
    ).toEqual([yes, yes, unknown, unknown]);
  });
  it('ignores same-route events created outside the exact SDK invocation', async () => {
    const observer = churnPasswordBoundary(origin);
    let finish;
    const pending = observer.observe(
      user,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    wire(request());
    finish(sdkReply);
    await pending;
    expect(read(observer)).toEqual(Array(4).fill(unknown));
  });
  it.each([
    'other origin',
    'other method',
    'other path',
    'two requests',
    'repeat send',
    'reused subject',
  ])('leaves %s unattributed', async (kind) => {
    const observer = churnPasswordBoundary(origin);
    await observer.observe(user, () => {
      const r = request();
      if (kind === 'other origin') r.origin = 'http://127.0.0.1:3333';
      if (kind === 'other method') r.method = 'GET';
      if (kind === 'other path') r.path += '&other=1';
      wire(r);
      if (kind === 'two requests') wire(request());
      if (kind === 'repeat send') publish('client:sendHeaders', r);
      return sdkReply;
    });
    if (kind === 'reused subject')
      await observer.observe(user, () => {
        wire(request());
        return sdkReply;
      });
    const lookup = vi.fn();
    expect(read(observer, lookup)).toEqual(Array(4).fill(unknown));
    expect(lookup).not.toHaveBeenCalled();
  });
  it('requires matching SDK subject or committed server evidence', async () => {
    const observer = churnPasswordBoundary(origin);
    await observer.observe(user, () => {
      wire(request());
      return { data: { session: { user: { id: 'other' } } } };
    });
    expect(read(observer, () => '0')).toEqual([yes, yes, yes, unknown]);
  });
  it('rejects raw fields and identifier suffixes at the parent sanitizer', () => {
    for (const stage of [
      'churn-client-dispatch',
      'churn-client-headers',
      'churn-gateway-receipt',
      'churn-auth-completion',
    ]) {
      expect(() => fixtureDiagnostic('FEAT-003', stage, 'response', user)).toThrow();
      const line = fixtureDiagnostic('FEAT-003', stage, 'response', unknown);
      expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', line + ' ' + user)).toEqual([]);
    }
  });
});
