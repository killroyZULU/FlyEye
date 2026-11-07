// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChurnPasswordObserver } from './churn-password-observer.mjs';
import { fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

const apiUrl = 'http://127.0.0.1:54321';
const path = '/auth/v1/token?grant_type=password';
const target = { input: apiUrl + path, method: 'POST' };
const privateText = 'SYNTHETIC_PRIVATE_HEADER_BODY_ADDRESS';
const disposals = [];
afterEach(() => disposals.splice(0).forEach((dispose) => dispose()));

function harness(overrides = {}) {
  const channels = new Map();
  const lines = [];
  let time = 0;
  const collect = vi.fn(() => []);
  const observer = createChurnPasswordObserver({
    apiUrl,
    projectId: 'flyeye',
    mode: 'factor-churn',
    enabled: true,
    ci: 'true',
    githubActions: 'true',
    now: () => time,
    collect,
    report: (stage, event, detail) =>
      lines.push(fixtureDiagnostic('FEAT-003', stage, event, detail)),
    getChannel: (name) => {
      const listeners = new Set();
      channels.set(name, listeners);
      return { subscribe: (fn) => listeners.add(fn), unsubscribe: (fn) => listeners.delete(fn) };
    },
    ...overrides,
  });
  disposals.push(observer.dispose);
  const emit = (name, message) => channels.get('undici:' + name)?.forEach((fn) => fn(message));
  const request = () => ({
    origin: apiUrl,
    path,
    method: 'POST',
    get headers() {
      throw new Error(privateText);
    },
    get body() {
      throw new Error(privateText);
    },
  });
  const socket = () => ({
    bytesWritten: 0,
    bytesRead: 0,
    get remoteAddress() {
      throw new Error(privateText);
    },
  });
  const connected = (value) =>
    emit('client:connected', {
      socket: value,
      connectParams: { protocol: 'http:', host: '127.0.0.1:54321' },
    });
  const dispatch = (req, value) => {
    emit('request:create', { request: req });
    emit('client:sendHeaders', {
      request: req,
      socket: value,
      get headers() {
        throw new Error(privateText);
      },
    });
  };
  const finish = (req, value) => {
    value.bytesWritten += 40;
    value.bytesRead += 80;
    emit('request:headers', {
      request: req,
      get response() {
        throw new Error(privateText);
      },
    });
    emit('request:trailers', {
      request: req,
      get trailers() {
        throw new Error(privateText);
      },
    });
  };
  return {
    observer,
    lines,
    collect,
    channels,
    emit,
    request,
    socket,
    connected,
    dispatch,
    finish,
    time: (value) => {
      time = value;
    },
  };
}

describe('churn password connection observer', () => {
  it.each(['churn-cleanup-probe', 'factor-churn'])(
    'preserves the one-shot %s error and records a proved new socket',
    async (mode) => {
      const h = harness({ mode });
      const socket = h.socket();
      const req = h.request();
      const error = new TypeError(privateText, { cause: { code: 'UND_ERR_SOCKET' } });
      const operation = vi.fn(() => {
        h.connected(socket);
        h.dispatch(req, socket);
        h.emit('request:error', { request: req, error });
        throw error;
      });
      await expect(h.observer.observe(operation, target)).rejects.toBe(error);
      expect(operation).toHaveBeenCalledOnce();
      expect(h.lines.join('\n')).toContain('password-socket-new');
      expect(h.lines.join('\n')).toContain('password-dispatch-observed');
      expect(h.lines.join('\n')).toContain('password-response-headers-unknown');
      expect(h.collect).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          projectId: 'flyeye',
          services: ['kong', 'auth'],
          ci: 'true',
          githubActions: 'true',
        }),
      );
      expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', h.lines.join('\n'))).toEqual(
        h.lines,
      );
      expect(h.lines.join('\n')).not.toContain(privateText);
      expect(h.lines.join('\n')).not.toContain(apiUrl);
    },
  );

  it.each([
    [500, 'under-second'],
    [1200, 'under-five-seconds'],
    [6000, 'five-seconds-or-more'],
  ])(
    'observes reuse after a completed password request with interval %i',
    async (elapsed, category) => {
      const h = harness();
      const socket = h.socket();
      const response = new Response(privateText);
      const first = h.request();
      const second = h.request();
      const error = new Error(privateText);
      await expect(
        h.observer.observe(() => {
          h.connected(socket);
          h.dispatch(first, socket);
          return response;
        }, target),
      ).resolves.toBe(response);
      // Completion may arrive after fetch resolves, while its caller consumes the response.
      h.finish(first, socket);
      h.time(elapsed);
      await expect(
        h.observer.observe(() => {
          h.dispatch(second, socket);
          throw error;
        }, target),
      ).rejects.toBe(error);
      expect(response.bodyUsed).toBe(false);
      expect(h.lines.join('\n')).toContain('password-socket-reused');
      expect(h.lines.join('\n')).toContain('password-idle-' + category);
    },
  );

  it.each(['unseen', 'prior-writes', 'intervening', 'out-of-order', 'duplicate', 'missing'])(
    'reports %s evidence as unknown',
    async (kind) => {
      const h = harness();
      const socket = h.socket();
      const error = new Error(privateText);
      if (kind === 'intervening') {
        await h.observer.observe(() => {
          const req = h.request();
          h.connected(socket);
          h.dispatch(req, socket);
          h.finish(req, socket);
        }, target);
        socket.bytesWritten++;
      }
      await expect(
        h.observer.observe(() => {
          const req = h.request();
          if (kind === 'missing') throw error;
          if (kind === 'prior-writes') {
            h.connected(socket);
            socket.bytesWritten = 40;
          }
          h.emit('request:create', { request: req });
          if (kind === 'out-of-order') h.emit('request:headers', { request: req });
          if (kind === 'duplicate') h.emit('request:create', { request: h.request() });
          h.emit('client:sendHeaders', { request: req, socket });
          throw error;
        }, target),
      ).rejects.toBe(error);
      expect(h.lines.join('\n')).toContain('password-socket-unknown');
      expect(h.lines.join('\n')).toContain('password-idle-unknown');
      expect(h.lines.join('\n')).not.toContain('password-socket-new');
    },
  );

  it.each([{ origin: 'http://127.0.0.1:9999' }, { path: '/redirected' }])(
    'marks redirect-shaped observations unknown %j',
    async (redirect) => {
      const h = harness();
      const error = new Error(privateText);
      const operation = vi.fn(() => {
        const socket = h.socket();
        const password = h.request();
        h.connected(socket);
        h.dispatch(password, socket);
        h.emit('request:headers', { request: password });
        const redirected = Object.assign(h.request(), redirect, { method: 'GET' });
        h.emit('request:create', { request: redirected });
        h.emit('request:error', { request: redirected, error });
        throw error;
      });
      await expect(h.observer.observe(operation, target)).rejects.toBe(error);
      expect(operation).toHaveBeenCalledOnce();
      const observations = h.lines.filter((line) => line.includes('password-connection'));
      expect(observations).toHaveLength(4);
      expect(observations.every((line) => line.includes('-unknown.'))).toBe(true);
      expect(h.lines.join('\n')).not.toContain(privateText);
    },
  );

  it.each([
    { enabled: false },
    { mode: 'stale-factors' },
    { ci: 'false' },
    { githubActions: 'false' },
    { apiUrl: 'https://foreign.invalid' },
    { apiUrl: apiUrl + '/nested' },
    { apiUrl: 'http://user:secret@localhost:54321' },
  ])('does not activate outside the approved fixture scope %j', async (override) => {
    const h = harness(override);
    const error = new Error(privateText);
    const op = vi.fn(() => {
      throw error;
    });
    await expect(async () => h.observer.observe(op, target)).rejects.toBe(error);
    expect(op).toHaveBeenCalledOnce();
    expect(h.channels.size).toBe(0);
    expect(h.lines).toEqual([]);
    expect(h.collect).not.toHaveBeenCalled();
  });

  it.each([
    { method: 'GET' },
    { input: apiUrl + '/auth/v1/token?grant_type=refresh_token' },
    { input: 'http://127.0.0.1:9999' + path },
    { input: apiUrl + path + '&grant_type=password' },
  ])('ignores non-target requests %j', async (override) => {
    const h = harness();
    const error = new Error(privateText);
    const op = vi.fn(() => {
      throw error;
    });
    await expect(h.observer.observe(op, { ...target, ...override })).rejects.toBe(error);
    expect(op).toHaveBeenCalledOnce();
    expect(h.lines).toEqual([]);
    expect(h.collect).not.toHaveBeenCalled();
  });

  it('preserves operation options, HTTP response/body and cleanup when diagnostics throw', async () => {
    const h = harness({
      collect: () => {
        throw new Error(privateText);
      },
    });
    const options = Object.freeze({
      method: 'POST',
      headers: Object.freeze({ authorization: privateText }),
      body: privateText,
      signal: new AbortController().signal,
    });
    const response = new Response(privateText, { status: 503 });
    const fetch = vi.fn(() => response);
    await expect(h.observer.observe(() => fetch(target.input, options), target)).resolves.toBe(
      response,
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith(target.input, options);
    expect(response.bodyUsed).toBe(false);
    expect(h.lines).toEqual([]);
    const error = new Error(privateText);
    const cleanup = vi.fn();
    await expect(
      (async () => {
        try {
          await h.observer.observe(() => {
            throw error;
          }, target);
        } finally {
          h.observer.dispose();
          cleanup();
        }
      })(),
    ).rejects.toBe(error);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(h.lines.filter((x) => x.includes('diagnostic-unavailable'))).toHaveLength(2);
    expect([...h.channels.values()].every((x) => x.size === 0)).toBe(true);
  });

  it('bounds and sanitizes provider categories and survives reporter failure', async () => {
    const h = harness({
      collect: () => [
        { stage: 'gateway-log', details: Array(30).fill('upstream-reset').concat(privateText) },
        { stage: 'provider-log', details: [privateText] },
      ],
    });
    const error = new Error(privateText);
    await expect(
      h.observer.observe(() => {
        throw error;
      }, target),
    ).rejects.toBe(error);
    expect(h.lines.length).toBeLessThanOrEqual(20);
    expect(h.lines.join('\n')).not.toContain(privateText);
    const throwing = harness({
      report: () => {
        throw error;
      },
    });
    await expect(
      throwing.observer.observe(() => {
        throw error;
      }, target),
    ).rejects.toBe(error);
  });

  it('marks overlapping password operations unknown without attributing them to each other', async () => {
    const h = harness();
    let release;
    const error = new Error(privateText);
    const first = h.observer.observe(async () => {
      const socket = h.socket();
      h.connected(socket);
      h.dispatch(h.request(), socket);
      await new Promise((resolve) => {
        release = resolve;
      });
      throw error;
    }, target);
    const rejected = expect(first).rejects.toBe(error);
    await expect(
      h.observer.observe(() => {
        h.dispatch(h.request(), h.socket());
        throw error;
      }, target),
    ).rejects.toBe(error);
    release();
    await rejected;
    expect(h.lines.filter((x) => x.includes('password-socket-unknown'))).toHaveLength(2);
    expect(h.lines.join('\n')).not.toContain('password-socket-new');
  });

  it('reports unavailable channels as unknown and disposal prevents later collection', async () => {
    const h = harness({
      getChannel: () => {
        throw new Error(privateText);
      },
    });
    const error = new Error(privateText);
    await expect(
      h.observer.observe(() => {
        throw error;
      }, target),
    ).rejects.toBe(error);
    expect(h.lines.join('\n')).toContain('password-socket-unknown');
    h.observer.dispose();
    const count = h.lines.length;
    await expect(
      h.observer.observe(() => {
        throw error;
      }, target),
    ).rejects.toBe(error);
    expect(h.lines).toHaveLength(count);
  });
});
