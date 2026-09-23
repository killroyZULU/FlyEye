// @vitest-environment node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stopLocalEdge, waitForLocalEdge } from './local-edge-lifecycle.mjs';

const url = 'http://127.0.0.1:55321/functions/v1/member-mfa';
const origin = 'https://synthetic-fixture.localhost';
const runningChild = () => ({ exitCode: null, signalCode: null });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fixture-specific Edge readiness', () => {
  it('rejects the old worker response before accepting the fixture environment', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
          headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
          headers: { 'access-control-allow-origin': origin },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const ready = waitForLocalEdge(url, origin, runningChild());
    await vi.runAllTimersAsync();
    await ready;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, init]) => init.headers.origin === origin)).toBe(true);
  });

  it('bounds retries when only a stale worker is available', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const failed = expect(waitForLocalEdge(url, origin, runningChild())).rejects.toThrow(
      'did not become ready',
    );
    await vi.runAllTimersAsync();
    await failed;
    expect(fetchMock).toHaveBeenCalledTimes(80);
  });

  it('fails before probing an exited worker or a remote endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(waitForLocalEdge(url, origin, { exitCode: 1, signalCode: null })).rejects.toThrow(
      'exited',
    );
    await expect(
      waitForLocalEdge('https://remote.example.test', origin, runningChild()),
    ).rejects.toThrow('loopback');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('owned Edge process shutdown', () => {
  it('waits for the owned process tree to exit', async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `require('node:child_process').execFileSync(process.execPath,
        ['-e', "process.stdout.write('ready'); setInterval(() => {}, 1000);"],
        { stdio: 'inherit' });`,
      ],
      {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
    try {
      await once(child.stdout, 'data');
      await stopLocalEdge(child);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      child.stdout.destroy();
    }
  }, 15_000);

  it('refuses to signal an unknown process identity', async () => {
    await expect(stopLocalEdge({ pid: undefined })).rejects.toThrow('identity');
    await expect(stopLocalEdge({ pid: 0 })).rejects.toThrow('identity');
    await stopLocalEdge(undefined);
  });

  it.runIf(process.platform === 'win32')(
    'does not infer descendant exit from an exited wrapper',
    async () => {
      await expect(stopLocalEdge({ pid: 12345, exitCode: 1, signalCode: null })).rejects.toThrow(
        'uncertain',
      );
    },
  );
});
