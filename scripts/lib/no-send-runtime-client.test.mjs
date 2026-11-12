// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentTotp,
  incorrectTotp,
  localJson,
  validateNoSendRequest,
} from './no-send-runtime-client.mjs';

afterEach(() => vi.restoreAllMocks());
describe('disposable no-send request boundary', () => {
  it('accepts only the fixed local Auth routes and synthetic recipients', () => {
    expect(() =>
      validateNoSendRequest('http://127.0.0.1:58321', 'POST', '/recover', {
        email: 'synthetic-1@example.invalid',
      }),
    ).not.toThrow();
    for (const [origin, method, route, body] of [
      ['https://example.com', 'POST', '/recover', {}],
      ['http://127.0.0.1:54321', 'POST', '/recover', {}],
      ['http://127.0.0.1:58321', 'POST', '//example.com', {}],
      ['http://127.0.0.1:58321', 'DELETE', '/user', {}],
      ['http://127.0.0.1:58321', 'POST', '/recover', { email: 'owner@example.com' }],
      ['http://127.0.0.1:58321', 'POST', '/recover', { nested: { email: 'owner@example.com' } }],
    ])
      expect(() => validateNoSendRequest(origin, method, route, body)).toThrow();
  });
  it('rejects nonlocal, credential-bearing and sink-write URLs before fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not run'));
    for (const [url, options] of [
      ['https://example.com', {}],
      ['http://127.0.0.1:54321/auth/v1/settings', {}],
      ['http://user:secret@127.0.0.1:58321/auth/v1/settings', {}],
      ['http://127.0.0.1:58324/api/v1/messages', { method: 'POST' }],
    ])
      await expect(localJson(url, options)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
  it('forces redirect rejection and a bounded request without retrying', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"total":0}', { status: 200 }));
    expect(
      await localJson('http://127.0.0.1:58324/api/v1/messages', { redirect: 'follow' }),
    ).toEqual({ status: 200, body: { total: 0 } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1].redirect).toBe('error');
    expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('bounds response size and propagates errors without logging response contents', async () => {
    const output = vi.spyOn(console, 'log');
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('private-canary'.repeat(30000)));
    await expect(localJson('http://127.0.0.1:58324/api/v1/messages')).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(output).not.toHaveBeenCalled();
  });
  it('matches the six-digit RFC 6238 SHA1 vector', () => {
    expect(currentTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000)).toBe('287082');
  });
  it('generates a wrong six-digit code outside all adjacent accepted windows', () => {
    const secret = 'A'.repeat(32);
    const now = 1234567890000;
    const code = incorrectTotp(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    for (const step of [-2, -1, 0, 1, 2])
      expect(code).not.toBe(currentTotp(secret, now + step * 30000));
  });
});
