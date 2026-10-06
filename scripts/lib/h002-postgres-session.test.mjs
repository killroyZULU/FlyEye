import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { failureDetail, H002SqlError, postgresSession } from './h002-postgres-session.mjs';

vi.mock('node:child_process', () => {
  const spawn = vi.fn();
  return { spawn, default: { spawn } };
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  child.stdin.on('finish', () => child.emit('close', 0));
  return child;
}
let child;
beforeEach(() => {
  child = fakeChild();
  vi.mocked(spawn).mockReturnValue(child);
});

describe('H002 SQL session diagnostics and recovery', () => {
  it('uses the fixed disposable container with server deadlines and SQLSTATE-only errors', async () => {
    const session = postgresSession('h002_observer');
    expect(spawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining([
        'supabase_db_flyeye',
        'VERBOSITY=sqlstate',
        'PGOPTIONS=-c statement_timeout=15000 -c idle_in_transaction_session_timeout=15000',
      ]),
      expect.any(Object),
    );
    const result = session.query('select 1;');
    child.stdout.write('1\nh002_done_1\n');
    await expect(result).resolves.toBe('1');
    await session.close();
  });

  it('captures a split SQLSTATE without exposing SQL, payloads or server messages', async () => {
    const session = postgresSession('h002_observer');
    const result = session.query('select missing_column;').catch((error) => error);
    child.stderr.write('ERROR: 42');
    child.stderr.write('703\nSynthetic private payload must not escape\n');
    child.emit('close', 3);
    const error = await result;
    expect(error).toBeInstanceOf(H002SqlError);
    expect(failureDetail(error)).toBe('sqlstate-42703');
    expect(error.message).toBe('H002 SQL session closed');
    await expect(session.query('select 1;')).rejects.toBeInstanceOf(H002SqlError);
    await session.close();
  });

  it('does not let an unapproved code or raw error message become a diagnostic', async () => {
    const session = postgresSession('h002_observer');
    const result = session.query('select 1;').catch((error) => error);
    child.stderr.write('ERROR: ABCDE sensitive-message\n');
    child.emit('close', 3);
    expect(failureDetail(await result)).toBe('sqlstate-unknown');
    expect(failureDetail(new Error('private value'))).toBe('internal');
    expect(failureDetail({ code: 'ERR_ASSERTION', message: 'private value' })).toBe('assertion');
    await session.close();
  });

  it('handles stdin failure immediately and permits a separate replacement session', async () => {
    const failed = postgresSession('h002_observer');
    const result = failed.query('select 1;').catch((error) => error);
    child.stdin.emit('error', new Error('EPIPE private detail'));
    expect(failureDetail(await result)).toBe('sqlstate-unknown');
    await failed.close();
    child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child);
    const replacement = postgresSession('h002_cleanup');
    const query = replacement.query('select 0;');
    child.stdout.write('0\nh002_done_1\n');
    await expect(query).resolves.toBe('0');
    await replacement.close();
  });

  it('bounds a missing query response and prevents reuse after timeout', async () => {
    vi.useFakeTimers();
    try {
      const session = postgresSession('h002_observer');
      const result = session.query('select 1;').catch((error) => error);
      await vi.advanceTimersByTimeAsync(20_000);
      expect((await result).message).toBe('H002 SQL session timeout');
      await expect(session.query('select 1;')).rejects.toBeInstanceOf(H002SqlError);
      await session.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a stuck client close and reports failure instead of claiming cleanup', async () => {
    vi.useFakeTimers();
    try {
      child.stdin.removeAllListeners('finish');
      const session = postgresSession('h002_observer');
      const result = session.close().catch((error) => error);
      await vi.advanceTimersByTimeAsync(25_000);
      expect((await result).message).toBe('H002 SQL session close-timeout');
      expect(child.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
