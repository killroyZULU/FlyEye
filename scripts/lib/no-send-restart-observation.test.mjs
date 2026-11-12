// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeNoSendRestart, restartErrorCategory } from './no-send-restart-observation.mjs';
import { localJson } from './no-send-runtime-client.mjs';

afterEach(() => vi.restoreAllMocks());
const secret = 'synthetic-secret-never-output';
function fixture() {
  const events = [];
  const project = {
    start: vi.fn(),
    enableHook: vi.fn(),
    close: vi.fn(),
    logsContain: vi.fn(() => false),
    status: vi.fn((observe) => {
      for (const step of ['status-command', 'status-json', 'status-origin']) {
        observe(step, 'entered');
        observe(step, 'passed');
      }
      return { ANON_KEY: secret, SERVICE_ROLE_KEY: secret };
    }),
  };
  const readJson = vi.fn(async (_url, _options, observe) => {
    observe('sink-request', 'entered');
    observe('sink-request', 'passed', 200);
    observe('sink-body', 'entered');
    observe('sink-body', 'passed');
    observe('sink-json', 'entered');
    observe('sink-json', 'passed');
    return { status: 200, body: { total: 0 } };
  });
  const clients = [];
  const makeClient = vi.fn(() => {
    const client = { request: readJson, close: vi.fn(async () => {}) };
    clients.push(client);
    return client;
  });
  return {
    project,
    readJson,
    clients,
    makeClient,
    events,
    options: { makeProject: () => project, makeClient, emit: (event) => events.push(event) },
  };
}

describe('bounded restart observation', () => {
  it('performs exactly one transition and two fixed sink reads, then cleans up', async () => {
    const f = fixture();
    expect(await observeNoSendRestart(f.options)).toEqual({ passed: true, cleanupPassed: true });
    expect(f.project.start.mock.calls).toEqual([[false]]);
    expect(f.project.enableHook).toHaveBeenCalledTimes(1);
    expect(f.project.status).toHaveBeenCalledTimes(2);
    expect(f.readJson).toHaveBeenCalledTimes(2);
    for (const call of f.readJson.mock.calls) {
      expect(call[0]).toBe('http://127.0.0.1:58324/api/v1/messages');
      expect(call[1]).toEqual({});
    }
    expect(f.project.close).toHaveBeenCalledTimes(1);
    expect(f.makeClient).toHaveBeenCalledTimes(2);
    for (const client of f.clients) expect(client.close).toHaveBeenCalledTimes(1);
    expect(f.clients[0].close.mock.invocationCallOrder[0]).toBeLessThan(
      f.project.enableHook.mock.invocationCallOrder[0],
    );
    expect(f.clients[1].close.mock.invocationCallOrder[0]).toBeLessThan(
      f.project.close.mock.invocationCallOrder[0],
    );
    expect(JSON.stringify(f.events)).not.toContain(secret);
  });
  it('does not restart until the first client exit is confirmed', async () => {
    const f = fixture();
    let exit;
    const pendingExit = new Promise((resolve) => {
      exit = resolve;
    });
    f.makeClient.mockImplementationOnce(() => ({ request: f.readJson, close: () => pendingExit }));
    const result = observeNoSendRestart(f.options);
    await vi.waitFor(() =>
      expect(f.events).toContainEqual(
        expect.objectContaining({ step: 'client-close', outcome: 'entered' }),
      ),
    );
    expect(f.project.enableHook).not.toHaveBeenCalled();
    exit();
    expect(await result).toEqual({ passed: true, cleanupPassed: true });
  });
  it('stops on client shutdown failure while still cleaning the owned project', async () => {
    const f = fixture();
    f.makeClient.mockImplementationOnce(() => ({
      request: f.readJson,
      close: () => Promise.reject(new Error(secret)),
    }));
    expect(await observeNoSendRestart(f.options)).toEqual({ passed: false, cleanupPassed: false });
    expect(f.project.enableHook).not.toHaveBeenCalled();
    expect(f.project.close).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.events)).not.toContain(secret);
  });
  for (const step of ['status-command', 'status-json', 'status-origin']) {
    it(`identifies ${step} failure after restart without retaining prior measurements`, async () => {
      const f = fixture();
      f.project.status
        .mockImplementationOnce(f.project.status.getMockImplementation())
        .mockImplementationOnce((observe) => {
          observe(step, 'entered');
          throw new SyntaxError(secret);
        });
      expect(await observeNoSendRestart(f.options)).toEqual({ passed: false, cleanupPassed: true });
      const failure = f.events.find((event) => event.outcome === 'failed');
      expect(failure).toMatchObject({
        phase: 'after-restart',
        step,
        httpStatus: null,
        mailCount: null,
        name: 'SyntaxError',
      });
      expect(f.readJson).toHaveBeenCalledTimes(1);
      expect(f.project.close).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(f.events)).not.toContain(secret);
    });
  }
  it('classifies a socket error without retrying or dumping its message/cause', async () => {
    const f = fixture();
    f.readJson
      .mockImplementationOnce(f.readJson.getMockImplementation())
      .mockImplementationOnce(async (_url, _opts, observe) => {
        observe('sink-request', 'entered');
        throw new TypeError(secret, {
          cause: { code: 'UND_ERR_SOCKET', message: secret, socket: { localAddress: secret } },
        });
      });
    expect(await observeNoSendRestart(f.options)).toEqual({ passed: false, cleanupPassed: true });
    expect(f.events.find((event) => event.outcome === 'failed')).toMatchObject({
      step: 'sink-request',
      name: 'TypeError',
      causeCode: 'UND_ERR_SOCKET',
      httpStatus: null,
    });
    expect(f.readJson).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.events)).not.toContain(secret);
  });
  it('fails on any captured message and still cleans up', async () => {
    const f = fixture();
    f.readJson.mockResolvedValue({ status: 200, body: { total: 1 } });
    expect(await observeNoSendRestart(f.options)).toEqual({ passed: false, cleanupPassed: true });
    expect(f.project.enableHook).not.toHaveBeenCalled();
    expect(f.events.find((event) => event.outcome === 'failed')).toMatchObject({
      step: 'sink-count',
      mailCount: 1,
    });
  });
  it('does not skip cleanup after a privacy-inspection failure', async () => {
    const f = fixture();
    f.project.logsContain.mockImplementation(() => {
      throw new Error(secret);
    });
    expect(await observeNoSendRestart(f.options)).toEqual({ passed: false, cleanupPassed: true });
    expect(f.project.close).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.events)).not.toContain(secret);
  });
  it('reports uncertain cleanup as failure', async () => {
    const f = fixture();
    f.project.close.mockImplementation(() => {
      throw new Error(secret);
    });
    expect(await observeNoSendRestart(f.options)).toEqual({ passed: false, cleanupPassed: false });
    expect(JSON.stringify(f.events)).not.toContain(secret);
  });
  it('allowlists error fields and rejects arbitrary secret-bearing properties', () => {
    expect(
      restartErrorCategory({
        name: secret,
        code: secret,
        message: secret,
        cause: { code: secret },
      }),
    ).toEqual({
      name: 'unknown',
      code: 'unknown',
      causeCode: 'unknown',
      commandCategory: 'not-classified',
    });
    expect(
      restartErrorCategory(new Error('No-send disposable command failed: health.')).commandCategory,
    ).toBe('health');
    expect(
      restartErrorCategory(new Error(`No-send disposable command failed: ${secret}.`))
        .commandCategory,
    ).toBe('not-classified');
  });
});

describe('passive sink request stages', () => {
  it('preserves request options, result and single-fetch behavior', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"total":0}'));
    const observe = vi.fn();
    expect(await localJson('http://127.0.0.1:58324/api/v1/messages', {}, observe)).toEqual({
      status: 200,
      body: { total: 0 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(observe.mock.calls).toEqual([
      ['sink-request', 'entered'],
      ['sink-request', 'passed', 200],
      ['sink-body', 'entered'],
      ['sink-body', 'passed'],
      ['sink-json', 'entered'],
      ['sink-json', 'passed'],
    ]);
  });
  it('preserves the original request error object', async () => {
    const error = new TypeError(secret, { cause: { code: 'ECONNRESET' } });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(error);
    const observe = vi.fn();
    await expect(localJson('http://127.0.0.1:58324/api/v1/messages', {}, observe)).rejects.toBe(
      error,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls).toEqual([['sink-request', 'entered']]);
  });
  it('distinguishes body-read failure from JSON parsing without logging content', async () => {
    const error = new TypeError(secret);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      body: { getReader: () => ({ read: () => Promise.reject(error), cancel: vi.fn() }) },
    });
    const observe = vi.fn();
    await expect(localJson('http://127.0.0.1:58324/api/v1/messages', {}, observe)).rejects.toBe(
      error,
    );
    expect(observe.mock.lastCall).toEqual(['sink-body', 'entered']);
    expect(JSON.stringify(observe.mock.calls)).not.toContain(secret);
  });
  it('identifies invalid JSON and retains no response text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(secret));
    const observe = vi.fn();
    await expect(
      localJson('http://127.0.0.1:58324/api/v1/messages', {}, observe),
    ).rejects.toBeInstanceOf(SyntaxError);
    expect(observe.mock.lastCall).toEqual(['sink-json', 'entered']);
    expect(JSON.stringify(observe.mock.calls)).not.toContain(secret);
  });
});
