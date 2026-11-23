import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { authorizedMetadata, observePasswordPost } from './credential-chromium-checkpoint.mjs';
import { publicLine, requireStatus } from './credential-checkpoint-log.mjs';
import { storagePullResult } from './credential-checkpoint-pull.mjs';

const origin = 'http://127.0.0.1:58321';
const passwordUrl = origin + '/auth/v1/token?grant_type=password';
function request(url = passwordUrl, method = 'POST') {
  return { method: () => method, url: () => url };
}
function observation() {
  const page = new EventEmitter();
  const pending = Promise.withResolvers();
  let matches;
  page.waitForResponse = (predicate) => {
    matches = predicate;
    return pending.promise;
  };
  const markers = [];
  return {
    page,
    markers,
    run: (click) =>
      observePasswordPost(
        page,
        origin,
        (marker) => {
          expect(publicLine('Checkpoint: ' + marker)).toBe('Checkpoint: ' + marker);
          markers.push(marker);
        },
        click,
      ),
    respond: (req, code) => {
      const response = { request: () => req, status: () => code };
      if (matches(response)) pending.resolve(response);
      return response;
    },
    timeout: () =>
      pending.reject(Object.assign(new Error('private detail'), { name: 'TimeoutError' })),
  };
}
describe('password checkpoint attribution', () => {
  it.each([
    ['net::ERR_CONNECTION_REFUSED', 'connection-refused'],
    ['net::ERR_CONNECTION_RESET', 'connection-reset'],
    ['net::ERR_CONNECTION_CLOSED', 'connection-closed'],
    ['net::ERR_CONNECTION_TIMED_OUT', 'connection-timeout'],
    ['net::ERR_BLOCKED_BY_CLIENT', 'blocked-by-client'],
    ['net::ERR_ABORTED', 'aborted'],
    ['net::ERR_FAILED', 'generic-failure'],
    ['net::ERR_CONNECTION_REFUSED private detail', 'unknown'],
    ['net::ERR_FAILED\nCheckpoint: password-headers-2xx', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
  ])('emits only a fixed category for case %#', async (raw, category) => {
    const probe = observation();
    let reads = 0,
      unrelatedReads = 0;
    const first = {
      ...request(),
      failure: () => {
        reads++;
        if (raw === undefined) throw new Error('private detail');
        return raw === null ? null : { errorText: raw };
      },
    };
    const other = {
      ...request(),
      failure: () => {
        unrelatedReads++;
        return { errorText: raw };
      },
    };
    await expect(
      probe.run(async () => {
        probe.page.emit('request', first);
        probe.page.emit('request', other);
        probe.page.emit('requestfailed', other);
        probe.page.emit('requestfailed', first);
        probe.page.emit('requestfailed', first);
        probe.timeout();
      }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(reads).toBe(1);
    expect(unrelatedReads).toBe(0);
    expect(probe.markers.filter((m) => m.startsWith('password-transport-'))).toEqual([
      'password-transport-failed-before-headers',
      'password-transport-' + category,
    ]);
    expect(publicLine('Checkpoint: password-transport-' + raw)).toBeNull();
  });
  it.each([
    [200, '2xx'],
    [403, '4xx'],
    [503, '5xx'],
    [302, 'other'],
  ])('classifies only the original request with status %i', async (code, category) => {
    const probe = observation();
    let originalResponse;
    const response = await probe.run(async () => {
      for (const wrong of [
        request(passwordUrl, 'GET'),
        request('https://invalid.example/private'),
        request(passwordUrl + '&private=value'),
      ]) {
        probe.page.emit('request', wrong);
        probe.respond(wrong, 500);
      }
      const first = request(),
        second = request();
      probe.page.emit('request', first);
      probe.page.emit('request', second);
      probe.page.emit('requestfailed', second);
      probe.respond(second, 500);
      originalResponse = probe.respond(first, code);
      probe.page.emit('requestfailed', first);
    });
    expect(response).toBe(originalResponse);
    expect(probe.markers).toEqual([
      'password-click-start',
      'password-request-dispatched',
      'password-headers-' + category,
      'password-click-complete',
    ]);
    expect(probe.page.eventNames()).toEqual([]);
  });
  it.each([
    ['absent', 'password-timeout-before-dispatch'],
    ['pending', 'password-timeout-before-headers'],
    ['transport', 'password-ended-with-transport-failure'],
  ])('keeps a %s request distinct from received headers', async (state, terminal) => {
    const probe = observation();
    await expect(
      probe.run(async () => {
        const first = request();
        if (state !== 'absent') probe.page.emit('request', first);
        probe.page.emit('requestfailed', request());
        if (state === 'transport') probe.page.emit('requestfailed', first);
        probe.timeout();
      }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(probe.markers).toContain(terminal);
    expect(probe.markers.includes('password-transport-failed-before-headers')).toBe(
      state === 'transport',
    );
    expect(probe.markers.some((m) => m.startsWith('password-headers'))).toBe(false);
    expect(probe.page.eventNames()).toEqual([]);
  });
  it('keeps click errors private and detaches observers on failure', async () => {
    const probe = observation();
    const error = new Error('private detail');
    await expect(
      probe.run(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(probe.markers).toEqual(['password-click-start', 'password-click-failed']);
    expect(publicLine('Checkpoint: password-click-failed ' + error.message)).toBeNull();
    expect(publicLine('Checkpoint: password-headers-403')).toBeNull();
    expect(probe.page.eventNames()).toEqual([]);
  });
});

describe('focused hosted checkpoint', () => {
  it('retains only a fixed Storage pull outcome including unknown', () => {
    for (const [message, category] of [
      ['no space left on device', 'disk-full'],
      ['TOOMANYREQUESTS', 'rate-limited'],
      ['manifest unknown', 'manifest-unavailable'],
      ['unauthorized', 'registry-denial'],
      ['TLS handshake timeout', 'connection-error'],
      ['unrecognized', 'unknown'],
    ]) {
      expect(storagePullResult({ status: 1, stderr: 'private fixture detail ' + message })).toBe(
        category,
      );
    }
    expect(storagePullResult({ status: null, signal: 'SIGTERM', stderr: 'sensitive' })).toBe(
      'process-error',
    );
    expect(storagePullResult({ status: 0, stderr: 'sensitive' })).toBe('passed');
  });
  it('reports bounded HTTP failure categories without response bodies', () => {
    expect(() => requireStatus(403, 200)).toThrow(
      expect.objectContaining({ code: 'CHECKPOINT_4XX' }),
    );
    expect(() => requireStatus(503, 201)).toThrow(
      expect.objectContaining({ code: 'CHECKPOINT_5XX' }),
    );
    expect(publicLine('Session proof stopped at preview (http-4xx).')).toBe(
      'Session proof stopped at preview (http-4xx).',
    );
    expect(publicLine('Session proof stopped at preview (http-4xx private).')).toBeNull();
  });
  const member = { membershipId: 'owner', applicability: 'trainee' };
  const response = {
    decision: 'credential_workspace',
    organizationId: 'school',
    hasMore: false,
    members: [member],
  };
  it('recognizes only the authorized school and single expected owner', () => {
    expect(authorizedMetadata(response, 'school', 'owner')).toBe(true);
    for (const patch of [
      { organizationId: 'elsewhere' },
      { decision: 'denied' },
      { hasMore: true },
      { members: [] },
      { members: [member, member] },
      { members: [{ ...member, membershipId: 'other' }] },
    ]) {
      expect(authorizedMetadata({ ...response, ...patch }, 'school', 'owner')).toBe(false);
    }
  });
  it('only publishes fixed phase, failure and cleanup messages', () => {
    for (const line of [
      'Checkpoint: browser-password-passed',
      'Session proof stopped at preview (assertion).',
      'Test=failed teardown=passed inventory=match',
    ])
      expect(publicLine(line)).toBe(line);
    for (const line of [
      'Checkpoint: private',
      'Checkpoint: preview private-path',
      'Test=passed teardown=passed inventory=match extra',
      'Authorization: private',
      'Local receipt: private-path',
      'Session proof stopped at secret (operation).',
    ])
      expect(publicLine(line)).toBeNull();
  });
});
