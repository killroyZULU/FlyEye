import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { observeOnboardingLogin } from './onboarding-login-diagnostics.mjs';
import { fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

function harness() {
  const page = new EventEmitter();
  const lines = [];
  const observer = observeOnboardingLogin(
    page,
    (...args) => lines.push(fixtureDiagnostic('FEAT-003', ...args)),
    'http://127.0.0.1:54321',
  );
  return { page, lines, observer };
}
function request(path = '/auth/v1/token?grant_type=password', action) {
  return {
    url: () => `http://127.0.0.1:54321${path}&private=synthetic-private`,
    method: () => 'POST',
    postDataJSON: vi.fn(() => ({
      action,
      password: 'synthetic-private',
      token: 'synthetic-private',
      email: 'private@example.test',
    })),
    failure: vi.fn(() => ({ errorText: 'synthetic-private' })),
  };
}
const response = (request, status) => ({
  request: () => request,
  status: () => status,
  json: vi.fn(() => {
    throw new Error('Must not read response body');
  }),
});
describe('passive stale-onboarding login diagnostics', () => {
  it.each([200, 201, 204, 400, 401, 403, 404, 405, 409, 422, 429, 500, 502, 503, 504, 302, 418])(
    'reports only the fixed category for HTTP %s',
    (status) => {
      const { page, lines, observer } = harness();
      const req = request();
      const res = response(req, status);
      observer.begin();
      page.emit('request', req);
      page.emit('response', res);
      observer.finish();
      expect(lines[0]).toContain(
        `detail=${status < 300 ? 'http-2xx' : [302, 418].includes(status) ? 'http-other' : `http-${status}`}.`,
      );
      expect(req.postDataJSON).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(lines.join('\n')).not.toMatch(/synthetic-private|private@example|127\.0|grant_type/);
      expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', lines.join('\n'))).toEqual(lines);
      observer.dispose();
    },
  );
  it('distinguishes absent, pending, transport-failed and returned requests', () => {
    const { page, lines, observer } = harness();
    observer.begin();
    const password = request();
    page.emit('request', password);
    page.emit('requestfailed', password);
    const bootstrap = request('/functions/v1/auth-bootstrap?');
    page.emit('request', bootstrap);
    const status = request('/functions/v1/organization-admin-onboarding?', 'status');
    page.emit('request', status);
    page.emit('response', response(status, 200));
    page.emit('requestfinished', status);
    observer.finish();
    expect(lines).toEqual([
      fixtureDiagnostic('FEAT-003', 'stale-network-password', 'response', 'transport-failed'),
      fixtureDiagnostic('FEAT-003', 'stale-network-bootstrap', 'response', 'request-pending'),
      fixtureDiagnostic('FEAT-003', 'stale-network-status', 'response', 'http-2xx'),
      fixtureDiagnostic('FEAT-003', 'stale-network-status', 'response', 'request-finished'),
      fixtureDiagnostic('FEAT-003', 'stale-network-start', 'response', 'request-not-observed'),
    ]);
    expect(password.failure).not.toHaveBeenCalled();
    observer.dispose();
  });
  it('retains multiple distinct outcomes without concealing another pending request', () => {
    const { page, lines, observer } = harness();
    observer.begin();
    const requests = [request(), request(), request()];
    requests.forEach((req) => page.emit('request', req));
    page.emit('response', response(requests[0], 200));
    page.emit('response', response(requests[1], 429));
    observer.finish();
    expect(lines.filter((line) => line.includes('stale-network-password'))).toHaveLength(3);
    expect(lines.join('\n')).toContain('detail=request-pending');
    observer.dispose();
  });
  it('ignores unrelated actions/methods and malformed data; resets between login attempts', () => {
    const { page, lines, observer } = harness();
    const old = request();
    observer.begin();
    page.emit('request', old);
    observer.finish();
    lines.length = 0;
    observer.begin();
    page.emit('response', response(old, 500));
    for (const req of [
      request('/unrelated?'),
      request('/auth/v1/token?grant_type=refresh_token'),
      request('/auth/v1/token?grant_type=password&grant_type=password'),
      { ...request(), url: () => 'https://foreign.example/auth/v1/token?grant_type=password' },
      request('/functions/v1/organization-admin-onboarding?', 'cancel'),
      { ...request(), method: () => 'GET' },
      { ...request(), url: () => 'invalid' },
      {
        ...request('/functions/v1/organization-admin-onboarding?'),
        postDataJSON: () => {
          throw new Error('synthetic-private');
        },
      },
    ])
      page.emit('request', req);
    observer.finish();
    expect(lines).toHaveLength(4);
    expect(lines.every((line) => line.includes('request-not-observed'))).toBe(true);
    observer.dispose();
    for (const event of ['request', 'response', 'requestfailed', 'requestfinished'])
      expect(page.listenerCount(event)).toBe(0);
  });
  it('observes start without emitting its private body and is inactive outside login', () => {
    const { page, lines, observer } = harness();
    const req = request('/functions/v1/organization-admin-onboarding?', 'start');
    page.emit('request', req);
    observer.begin();
    page.emit('request', req);
    page.emit('response', response(req, 409));
    observer.finish();
    expect(lines).toContain(
      fixtureDiagnostic('FEAT-003', 'stale-network-start', 'response', 'http-409'),
    );
    expect(lines).toContain(
      fixtureDiagnostic('FEAT-003', 'stale-network-start', 'response', 'request-pending'),
    );
    const count = lines.length;
    observer.finish();
    page.emit('requestfailed', req);
    expect(lines).toHaveLength(count);
    expect(lines.join('\n')).not.toContain('synthetic-private');
    observer.dispose();
  });
  it('rejects arbitrary details and limits new observation vocabulary to its stages', () => {
    expect(() =>
      fixtureDiagnostic('FEAT-003', 'stale-network-password', 'response', 'synthetic-private'),
    ).toThrow();
    expect(() =>
      fixtureDiagnostic('FEAT-003', 'provider-password', 'response', 'request-pending'),
    ).toThrow();
    expect(
      runtimeDiagnosticLines(
        'test-feat-003-runtime.mjs',
        'FEAT-003 runtime diagnostic: stage=stale-network-password event=response detail=synthetic-private.',
      ),
    ).toEqual([]);
  });
  it.each(['requestfailed', 'pending', 'requestfinished'])(
    'preserves response headers and subsequent %s state',
    (event) => {
      const { page, lines, observer } = harness();
      const req = request();
      observer.begin();
      page.emit('request', req);
      page.emit('response', response(req, 200));
      if (event !== 'pending') page.emit(event, req);
      observer.finish();
      expect(lines).toContain(
        fixtureDiagnostic('FEAT-003', 'stale-network-password', 'response', 'http-2xx'),
      );
      const detail =
        event === 'requestfailed'
          ? 'transport-failed'
          : event === 'pending'
            ? 'request-pending'
            : 'request-finished';
      expect(lines).toContain(
        fixtureDiagnostic('FEAT-003', 'stale-network-password', 'response', detail),
      );
      observer.dispose();
    },
  );
  it('reporter failures cannot mask the original browser error or skip later categories', () => {
    const page = new EventEmitter();
    const report = vi.fn(() => {
      throw new Error('reporter');
    });
    const observer = observeOnboardingLogin(page, report, 'http://127.0.0.1:54321');
    const original = new Error('original browser timeout');
    expect(() => {
      observer.begin();
      try {
        throw original;
      } finally {
        observer.finish();
      }
    }).toThrow(original);
    expect(report).toHaveBeenCalledTimes(4);
    observer.dispose();
  });
});
