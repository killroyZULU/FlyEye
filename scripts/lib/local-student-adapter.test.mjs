// @vitest-environment node
import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { connect } from 'node:net';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { stopLocalEdge } from './local-edge-lifecycle.mjs';
import { withLocalStudentAdapter } from './local-student-adapter.mjs';
import { studentOrigin, studentGateway } from './local-student-router.mjs';
vi.mock('node:child_process', () => ({ fork: vi.fn() }));
vi.mock('node:net', () => ({ connect: vi.fn() }));
vi.mock('./local-edge-lifecycle.mjs', () => ({ stopLocalEdge: vi.fn() }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const version = Object.getOwnPropertyDescriptor(process, 'version');
const user = '00000000-0000-4000-8000-000000000010';
const key = (role) =>
  ['fixture', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'fixture'].join('.');
const target = {
  API_URL: studentGateway,
  ANON_KEY: key('anon'),
  SERVICE_ROLE_KEY: key('service_role'),
};
const coded = (code) => Object.assign(new Error('synthetic'), { code });
let child, load, browser, kill;
function reply(message, callback) {
  queueMicrotask(() => {
    callback();
    if (message === 'stop') {
      child.emit('message', 'closed');
      child.exitCode = 0;
      child.connected = false;
      child.emit('exit', 0, null);
    } else child.emit('message', message.anon ? 'built' : 'ready');
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  Object.defineProperty(process, 'version', { ...version, value: 'v24.14.0' });
  load = vi.fn(() => target);
  browser = vi.fn(() => 'checked');
  child = Object.assign(new EventEmitter(), {
    pid: 14999,
    connected: true,
    exitCode: null,
    signalCode: null,
    send: vi.fn(reply),
  });
  fork.mockImplementation(() => {
    queueMicrotask(() => child.emit('message', 'online'));
    return child;
  });
  kill = vi.spyOn(process, 'kill').mockImplementation(() => {
    throw coded('ESRCH');
  });
  connect.mockImplementation(() => {
    const socket = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn() });
    queueMicrotask(() => socket.emit('error', coded('ECONNREFUSED')));
    return socket;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', platform);
  Object.defineProperty(process, 'version', version);
});
it('keeps privileged inputs out of argv, environment, public build and browser; proves closure', async () => {
  await expect(withLocalStudentAdapter(load, user, browser)).resolves.toBe('checked');
  expect(load).toHaveBeenCalledTimes(2);
  const [, argv, opts] = fork.mock.calls[0];
  expect(argv).toEqual([]);
  expect(opts.execArgv).toEqual([]);
  expect(opts.detached).toBe(true);
  expect(opts.env).toEqual({ PATH: '/usr/bin:/bin', NODE_ENV: 'production' });
  expect(opts.stdio).toEqual(['ignore', 'ignore', 'ignore', 'ipc']);
  const messages = child.send.mock.calls.map(([message]) => message);
  expect(messages).toEqual([
    { anon: target.ANON_KEY },
    {
      userId: user,
      service: target.SERVICE_ROLE_KEY,
      limiter: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
    'stop',
  ]);
  expect(browser).toHaveBeenCalledExactlyOnceWith({
    origin: studentOrigin,
    publishableKey: target.ANON_KEY,
  });
  expect(kill).toHaveBeenCalledExactlyOnceWith(-child.pid, 0);
  expect(connect).toHaveBeenCalledExactlyOnceWith({ host: '127.0.0.1', port: 58329 });
});
it('rejects invalid target before fork, or drift before handing off any privilege', async () => {
  load.mockReturnValueOnce({ ...target, API_URL: 'https://foreign.invalid' });
  await expect(withLocalStudentAdapter(load, user, browser)).rejects.toThrow();
  expect(fork).not.toHaveBeenCalled();
  load
    .mockReturnValueOnce(target)
    .mockReturnValueOnce({ ...target, SERVICE_ROLE_KEY: 'different' });
  await expect(withLocalStudentAdapter(load, user, browser)).rejects.toThrow();
  expect(browser).not.toHaveBeenCalled();
  expect(child.send.mock.calls.map(([m]) => m)).toEqual([{ anon: target.ANON_KEY }]);
  expect(stopLocalEdge).toHaveBeenCalledWith(child);
});
it('closes even when the browser operation fails', async () => {
  browser.mockRejectedValue(new Error('synthetic browser failure'));
  await expect(withLocalStudentAdapter(load, user, browser)).rejects.toThrow(
    'synthetic browser failure',
  );
  expect(connect).toHaveBeenCalledOnce();
});
it.each([
  'bad-ack',
  'premature-exit',
  'exit-failure',
  'remaining-group',
  'permission-unknown',
  'port-open',
  'port-unknown',
])('rejects uncertain shutdown: %s', async (mode) => {
  if (['bad-ack', 'premature-exit', 'exit-failure'].includes(mode))
    child.send.mockImplementation((message, cb) => {
      if (message !== 'stop') return reply(message, cb);
      queueMicrotask(() => {
        cb();
        if (mode === 'bad-ack') child.emit('message', 'unexpected');
        else {
          if (mode === 'exit-failure') child.emit('message', 'closed');
          child.exitCode = 1;
          child.emit('exit', 1, null);
        }
      });
    });
  if (mode === 'remaining-group') kill.mockReturnValue(true);
  if (mode === 'permission-unknown')
    kill.mockImplementation(() => {
      throw coded('EPERM');
    });
  if (mode.startsWith('port-'))
    connect.mockImplementation(() => {
      const s = Object.assign(new EventEmitter(), { destroy: vi.fn(), setTimeout: vi.fn() });
      queueMicrotask(() =>
        mode === 'port-open' ? s.emit('connect') : s.emit('error', coded('ECONNRESET')),
      );
      return s;
    });
  await expect(withLocalStudentAdapter(load, user, browser)).rejects.toThrow();
  expect(browser).toHaveBeenCalledOnce();
});
it('bounds a missing shutdown acknowledgment and keeps the fixture failed', async () => {
  vi.useFakeTimers();
  try {
    child.send.mockImplementation((message, cb) => {
      if (message !== 'stop') reply(message, cb);
      else cb();
    });
    const check = expect(withLocalStudentAdapter(load, user, browser)).rejects.toThrow(
      'did not complete',
    );
    await vi.advanceTimersByTimeAsync(10001);
    await check;
    expect(stopLocalEdge).toHaveBeenCalledWith(child);
  } finally {
    vi.useRealTimers();
  }
});
