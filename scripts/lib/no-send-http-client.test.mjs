// @vitest-environment node
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';
import { createNoSendHttpClient } from './no-send-http-client.mjs';

function fixture() {
  const worker = new EventEmitter();
  worker.postMessage = vi.fn();
  worker.terminate = vi.fn(async () => 1);
  worker.stdout = { resume: vi.fn() };
  worker.stderr = { resume: vi.fn() };
  return { worker, client: createNoSendHttpClient(() => worker) };
}
describe('owned disposable HTTP client', () => {
  it('forwards one request unchanged and preserves responses/observations in memory', async () => {
    const { client, worker } = fixture();
    const observe = vi.fn();
    const options = { method: 'GET', headers: { test: 'synthetic-private-header' } };
    const request = client.request('http://127.0.0.1:58324/api/v1/messages', options, observe);
    expect(worker.postMessage.mock.calls).toEqual([
      [{ url: 'http://127.0.0.1:58324/api/v1/messages', options }],
    ]);
    worker.emit('message', { type: 'observation', arguments: ['sink-request', 'passed', 200] });
    worker.emit('message', { type: 'result', result: { status: 200, body: { total: 0 } } });
    expect(await request).toEqual({ status: 200, body: { total: 0 } });
    expect(observe.mock.calls).toEqual([['sink-request', 'passed', 200]]);
    expect(worker.stdout.resume).toHaveBeenCalledTimes(1);
    expect(worker.stderr.resume).toHaveBeenCalledTimes(1);
    await client.close();
  });
  it('rejects concurrent requests, then refuses all requests after close', async () => {
    const { client, worker } = fixture();
    const request = client.request('http://127.0.0.1:58324/api/v1/messages');
    const rejected = expect(request).rejects.toThrow('closed');
    await expect(client.request('http://127.0.0.1:58324/api/v1/messages')).rejects.toThrow(
      'unavailable',
    );
    await client.close();
    await rejected;
    await expect(client.request('http://127.0.0.1:58324/api/v1/messages')).rejects.toThrow(
      'unavailable',
    );
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });
  it('awaits exit and terminates exactly once, including repeated close calls', async () => {
    const { client, worker } = fixture();
    let exit;
    worker.terminate.mockImplementation(
      () =>
        new Promise((resolve) => {
          exit = resolve;
        }),
    );
    const closing = client.close();
    expect(client.close()).toBe(closing);
    let settled = false;
    closing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    exit(1);
    await closing;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('does not retry a failed termination', async () => {
    const { client, worker } = fixture();
    worker.terminate.mockRejectedValue(new Error('synthetic failure'));
    await expect(client.close()).rejects.toThrow('synthetic failure');
    await expect(client.close()).rejects.toThrow('synthetic failure');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('preserves cloned error type and nested transport code without retry', async () => {
    const { client, worker } = fixture();
    const error = new TypeError('synthetic private error', {
      cause: new Error('synthetic private cause'),
    });
    const request = client.request('http://127.0.0.1:58324/api/v1/messages');
    worker.emit('message', { type: 'error', error, causeCode: 'ECONNRESET' });
    await expect(request).rejects.toMatchObject({
      name: 'TypeError',
      cause: { code: 'ECONNRESET' },
    });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    await client.close();
  });
  for (const event of ['error', 'messageerror', 'exit']) {
    it(`fails closed on worker ${event} and still permits cleanup`, async () => {
      const { client, worker } = fixture();
      const request = client.request('http://127.0.0.1:58324/api/v1/messages');
      worker.emit(event, new Error('synthetic private error'));
      await expect(request).rejects.toBeInstanceOf(Error);
      await expect(client.request('http://127.0.0.1:58324/api/v1/messages')).rejects.toThrow(
        'unavailable',
      );
      await client.close();
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
  }
  it('starts and closes a real worker while rejecting a forbidden origin before network access', async () => {
    const client = createNoSendHttpClient();
    try {
      await expect(client.request('https://example.invalid/')).rejects.toMatchObject({
        code: 'ERR_ASSERTION',
      });
    } finally {
      await client.close();
    }
  });
  for (const name of ['TimeoutError', 'AbortError']) {
    it(`preserves ${name} through actual worker structured cloning without network access`, async () => {
      const source = `
        const { parentPort, workerData } = require('node:worker_threads');
        parentPort.on('message', () => {
          const error = new DOMException('synthetic-private-message', workerData);
          parentPort.postMessage({ type: 'error', error, errorName: error.name, errorMessage: error.message, code: error.code });
        });
      `;
      const client = createNoSendHttpClient(
        () =>
          new Worker(source, {
            eval: true,
            workerData: name,
            stdout: true,
            stderr: true,
            execArgv: [],
          }),
      );
      try {
        await expect(
          client.request('http://127.0.0.1:58324/api/v1/messages'),
        ).rejects.toMatchObject({ name, message: 'synthetic-private-message' });
      } finally {
        await client.close();
      }
    });
  }
  for (const fault of ['observer', 'protocol']) {
    it(`closes the client after ${fault} failure so stale responses cannot satisfy new requests`, async () => {
      const { client, worker } = fixture();
      const request = client.request('http://127.0.0.1:58324/api/v1/messages', {}, () => {
        throw new Error('synthetic observer failure');
      });
      worker.emit(
        'message',
        fault === 'observer'
          ? { type: 'observation', arguments: ['sink-request', 'entered'] }
          : { type: 'invalid' },
      );
      await expect(request).rejects.toBeInstanceOf(Error);
      await expect(client.request('http://127.0.0.1:58324/api/v1/messages')).rejects.toThrow(
        'unavailable',
      );
      worker.emit('message', { type: 'result', result: { status: 200, body: { total: 0 } } });
      expect(worker.postMessage).toHaveBeenCalledTimes(1);
      await client.close();
    });
  }
});
