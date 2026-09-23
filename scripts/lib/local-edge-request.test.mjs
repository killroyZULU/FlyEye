import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchLocalEdge } from './local-edge-request.mjs';

const url = 'http://127.0.0.1:55321/functions/v1/member-mfa';
const init = {
  method: 'POST',
  body: JSON.stringify({ action: 'bind_factor', idempotencyKey: 'synthetic-stable-key' }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('bounded local Edge proxy recovery', () => {
  it('retries gateway and DNS failures using the identical request', async () => {
    vi.useFakeTimers();
    const success = Response.json({ decision: 'bound' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
      .mockResolvedValueOnce(Response.json({ message: 'name resolution failed' }, { status: 503 }))
      .mockResolvedValueOnce(success);
    vi.stubGlobal('fetch', fetchMock);
    const onRetry = vi.fn();
    const pending = fetchLocalEdge(url, init, onRetry);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(success);
    expect(fetchMock.mock.calls).toEqual([
      [url, init],
      [url, init],
      [url, init],
    ]);
    expect(fetchMock.mock.calls.every(([, request]) => request === init)).toBe(true);
    expect(onRetry.mock.calls).toEqual([[502], [503]]);
  });

  it('returns persistent proxy failure after three attempts', async () => {
    vi.useFakeTimers();
    const response = new Response('Bad Gateway', { status: 502 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    const pending = fetchLocalEdge(url, init);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 403, 409, 422, 429, 500, 503])(
    'does not retry an application failure with HTTP %i',
    async (status) => {
      const response = Response.json({ error: { code: 'member_mfa.unavailable' } }, { status });
      const fetchMock = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('fetch', fetchMock);
      const onRetry = vi.fn();
      expect(await fetchLocalEdge(url, init, onRetry)).toBe(response);
      expect(await response.json()).toEqual({ error: { code: 'member_mfa.unavailable' } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    },
  );

  it('does not retry unknown 503 payloads or transport exceptions', async () => {
    const response = new Response('unrecognized response', { status: 503 });
    const fetchMock = vi.fn().mockResolvedValueOnce(response).mockRejectedValueOnce(new Error());
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchLocalEdge(url, init)).toBe(response);
    await expect(fetchLocalEdge(url, init)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects hosted destinations before sending a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchLocalEdge('https://example.test/functions/v1/member-mfa', init),
    ).rejects.toThrow('loopback');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
