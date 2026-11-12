// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localJson } from './no-send-runtime-client.mjs';
import { createNoSendRegressionDiagnostic } from './no-send-regression-diagnostic.mjs';

const url = 'http://127.0.0.1:58321/auth/v1/factors';
const privateValue = 'synthetic-qr-token-authenticator-secret-never-report';
afterEach(() => vi.restoreAllMocks());
function observer() {
  const result = createNoSendRegressionDiagnostic();
  result.start();
  result.mark('enroll-request');
  return result;
}
describe('enrollment response-read observations', () => {
  it.each([262143, 262144, 262145])(
    'keeps the ordinary 256 KiB boundary at %i bytes',
    async (size) => {
      const body = JSON.stringify('x'.repeat(size - 2));
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
      const operation = localJson('http://127.0.0.1:58321/auth/v1/settings');
      if (size > 262144) await expect(operation).rejects.toMatchObject({ code: 'ERR_ASSERTION' });
      else expect((await operation).body.length).toBe(size - 2);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    [url, { method: 'GET', body: '{"factor_type":"totp"}' }],
    [url, { method: 'post', body: '{"factor_type":"totp"}' }],
    [url, { method: 'POST', body: '{"factor_type":"phone"}' }],
    [url, { method: 'POST', body: '{"factor_type":"webauthn"}' }],
    [url, { method: 'POST', body: '{"factor_type":"TOTP"}' }],
    [url, { method: 'POST', body: '{}' }],
    [url, { method: 'POST', body: 'null' }],
    [url, { method: 'POST', body: '{"nested":{"factor_type":"totp"}}' }],
    [url, { method: 'POST', body: privateValue }],
    [url, { method: 'POST' }],
    [url, { method: 'POST', body: { factor_type: 'totp' } }],
    [`${url}/`, { method: 'POST', body: '{"factor_type":"totp"}' }],
    [`${url}?extra=1`, { method: 'POST', body: '{"factor_type":"totp"}' }],
    [
      `${url}/00000000-0000-0000-0000-000000000001/verify`,
      { method: 'POST', body: '{"factor_type":"totp"}' },
    ],
    ['http://127.0.0.1:58324/api/v1/messages', {}],
  ])('does not widen the cap for a near-match request (%#)', async (target, options) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x'.repeat(262145)));
    const observe = vi.fn();
    await expect(localJson(target, options, observe)).rejects.toMatchObject({
      code: 'ERR_ASSERTION',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls.some(([step]) => step === 'enrollment-body-limit')).toBe(false);
    expect(JSON.stringify(observe.mock.calls)).not.toContain(privateValue);
  });
  it('counts accumulated response bytes and cancels once at the enrollment bound', async () => {
    const chunks = [Buffer.alloc(524288), Buffer.alloc(524289)];
    const read = vi.fn(async () => ({ done: false, value: chunks.shift() }));
    const cancel = vi.fn(async () => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      body: { getReader: () => ({ read, cancel }) },
    });
    const diagnostic = observer();
    await expect(
      localJson(url, { method: 'POST', body: '{"factor_type":"totp"}' }, diagnostic.transport),
    ).rejects.toMatchObject({ code: 'ERR_ASSERTION' });
    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(diagnostic.snapshot().enrollmentRead.bodyLimit).toBe('exceeded');
  });
  it.each([262143, 262144, 262145, 1048575, 1048576, 1048577])(
    'preserves the exact response limit at %i bytes',
    async (size) => {
      const prefix = `{"private":"${privateValue}","padding":"`;
      const body = prefix + 'x'.repeat(size - prefix.length - 2) + '"}';
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      const diagnostic = observer();
      const observations = [];
      const observe = (...args) => {
        observations.push(args);
        diagnostic.transport(...args);
      };
      const options = {
        method: 'POST',
        headers: { Authorization: privateValue },
        body: '{"factor_type":"totp"}',
      };
      const operation = localJson(url, options, observe);
      if (size > 1048576) {
        await expect(operation).rejects.toMatchObject({ code: 'ERR_ASSERTION' });
        expect(diagnostic.snapshot().enrollmentRead).toEqual({
          phase: 'body-reading',
          httpStatus: 200,
          bodyLimit: 'exceeded',
        });
      } else {
        expect((await operation).body.private).toBe(privateValue);
        expect(diagnostic.snapshot().enrollmentRead).toEqual({
          phase: 'json-parsed',
          httpStatus: 200,
          bodyLimit: 'within-limit',
        });
      }
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledWith(10000);
      expect(fetch.mock.calls[0][1]).toMatchObject({ ...options, redirect: 'error' });
      expect(JSON.stringify([observations, diagnostic.snapshot()])).not.toContain(privateValue);
    },
  );
  it('retains header status and distinguishes JSON failure from a body-limit failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(privateValue, { status: 400 }));
    const diagnostic = observer();
    await expect(localJson(url, { method: 'POST' }, diagnostic.transport)).rejects.toBeInstanceOf(
      SyntaxError,
    );
    expect(diagnostic.snapshot().enrollmentRead).toEqual({
      phase: 'json-parsing',
      httpStatus: 400,
      bodyLimit: 'within-limit',
    });
    expect(JSON.stringify(diagnostic.snapshot())).not.toContain(privateValue);
  });
  it('preserves reader errors and cancellation without inventing an exceeded limit', async () => {
    const error = new Error(privateValue);
    const cancel = vi.fn(async () => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            throw error;
          },
          cancel,
        }),
      },
    });
    const diagnostic = observer();
    await expect(localJson(url, { method: 'POST' }, diagnostic.transport)).rejects.toBe(error);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(diagnostic.snapshot().enrollmentRead).toEqual({
      phase: 'body-reading',
      httpStatus: 200,
      bodyLimit: 'unknown',
    });
  });
  it('retains limit evidence even if the existing finally cancellation throws', async () => {
    const error = new Error(privateValue);
    const cancel = vi.fn(async () => {
      throw error;
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: Buffer.alloc(1048577) }),
          cancel,
        }),
      },
    });
    const diagnostic = observer();
    await expect(
      localJson(url, { method: 'POST', body: '{"factor_type":"totp"}' }, diagnostic.transport),
    ).rejects.toBe(error);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(diagnostic.snapshot().enrollmentRead.bodyLimit).toBe('exceeded');
  });
  it('does not emit an enrollment limit event for other routes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x'.repeat(262145)));
    const observe = vi.fn();
    await expect(
      localJson('http://127.0.0.1:58321/auth/v1/settings', {}, observe),
    ).rejects.toMatchObject({ code: 'ERR_ASSERTION' });
    expect(observe.mock.calls.some(([step]) => step === 'enrollment-body-limit')).toBe(false);
  });
  it('rejects private or malformed observations and resets attribution for another request', () => {
    const diagnostic = observer();
    diagnostic.transport('sink-request', 'passed', privateValue);
    diagnostic.transport(privateValue, privateValue, 200);
    expect(diagnostic.snapshot().enrollmentRead).toEqual({
      phase: 'unknown',
      httpStatus: null,
      bodyLimit: 'unknown',
    });
    diagnostic.transport('enrollment-body-limit', 'exceeded');
    diagnostic.mark('enroll-request');
    expect(diagnostic.snapshot().enrollmentRead).toEqual({
      phase: 'unobserved',
      httpStatus: null,
      bodyLimit: 'unknown',
    });
    diagnostic.mark('login-request');
    diagnostic.transport('enrollment-body-limit', 'exceeded');
    expect(diagnostic.snapshot()).not.toHaveProperty('enrollmentRead');
    diagnostic.stop();
    expect(diagnostic.snapshot()).toEqual({});
  });
});
