import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchLocalEdge } from './local-edge-request.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local Edge request recovery', () => {
  it('retries the local proxy name-resolution response with the exact request', async () => {
    const recovered = new Response('{}', { status: 200 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"message":"name resolution failed"}', { status: 503 }))
      .mockResolvedValueOnce(recovered);
    vi.stubGlobal('fetch', fetchMock);
    const init = { method: 'POST', body: '{"idempotencyKey":"same"}' };

    await expect(fetchLocalEdge('http://127.0.0.1/functions/v1/test', init)).resolves.toBe(
      recovered,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1/functions/v1/test', init);
  });

  it('does not retry an application service-unavailable response', async () => {
    const unavailable = new Response('{"error":{"code":"service_unavailable"}}', {
      status: 503,
    });
    const fetchMock = vi.fn().mockResolvedValue(unavailable);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLocalEdge('http://127.0.0.1/functions/v1/test', {})).resolves.toBe(
      unavailable,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after three local proxy failures without changing the request', async () => {
    const unavailable = new Response('{"message":"name resolution failed"}', { status: 503 });
    const fetchMock = vi.fn().mockResolvedValue(unavailable);
    vi.stubGlobal('fetch', fetchMock);
    const init = { method: 'POST', body: '{"idempotencyKey":"same"}' };

    await expect(fetchLocalEdge('http://127.0.0.1/functions/v1/test', init)).resolves.toBe(
      unavailable,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) expect(call[1]).toBe(init);
  });

  it.each([401, 403, 409, 429, 500])(
    'does not retry HTTP %i application failures',
    async (status) => {
      const denied = new Response('{"error":{"code":"denied"}}', { status });
      const fetchMock = vi.fn().mockResolvedValue(denied);
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchLocalEdge('http://127.0.0.1/functions/v1/test', {})).resolves.toBe(denied);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
