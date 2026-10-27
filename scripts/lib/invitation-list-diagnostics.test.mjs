import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFixtureDiagnostics, fixtureDiagnosticLines } from './fixture-diagnostics.mjs';
import { withInvitationListDiagnostics } from './invitation-list-diagnostics.mjs';
import { fetchLocalEdge } from './local-edge-request.mjs';

// Execute the fixture's actual invoke and initial-list block with synthetic inputs;
// do not import the top-level fixture, which owns a real database/worker lifecycle.
const source = readFileSync('scripts/test-feat-004-runtime.mjs', 'utf8');
const invoke = source.slice(
  source.indexOf('async function invoke('),
  source.indexOf('async function waitForInvitationMail('),
);
const initial = source.slice(
  source.indexOf("  diagnostics.enter('invitation-list');"),
  source.indexOf("  diagnostics.enter('new-invitation-create');"),
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction(
  'dependencies',
  `const { assert, fetchLocalEdge, diagnostics, withInvitationListDiagnostics, apiUrl, publishableKey, origin, correlations, limiterKeys, limiterHash, admin, organizationA, aal2Data } = dependencies; ${invoke}\n${initial}`,
);
const secret = 'synthetic-private-token-email-url';
const payload = () => ({ roles: [1, 2, 3], invitations: [], correlationId: secret });

function harness({
  response = Response.json(payload()),
  error,
  write,
  correlations = new Set(),
  limiterHash = () => 'synthetic-limiter',
} = {}) {
  const lines = [];
  const fetchMock = vi.fn();
  if (error) fetchMock.mockRejectedValue(error);
  else fetchMock.mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  const dependencies = {
    assert,
    fetchLocalEdge,
    diagnostics: createFixtureDiagnostics('FEAT-004', {
      enabled: true,
      write: (line) => lines.push(line),
    }),
    withInvitationListDiagnostics: (operation) =>
      withInvitationListDiagnostics(operation, {
        enabled: true,
        write: write ?? ((line) => lines.push(line)),
      }),
    apiUrl: 'http://127.0.0.1:55321',
    publishableKey: secret,
    origin: 'http://127.0.0.1:5173',
    correlations,
    limiterKeys: new Set(),
    limiterHash,
    admin: { id: secret },
    organizationA: 'synthetic-school',
    aal2Data: { session: { access_token: secret } },
  };
  return { lines, fetchMock, dependencies, run: () => execute(dependencies) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('initial invitation-list diagnostics', () => {
  it('preserves the request, one body read, correlations and all successful checks', async () => {
    const response = Response.json(payload());
    const json = vi.spyOn(response, 'json');
    const clone = vi.spyOn(response, 'clone');
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const h = harness({ response });
    await h.run();
    expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000);
    expect(h.fetchMock).toHaveBeenCalledExactlyOnceWith(
      'http://127.0.0.1:55321/functions/v1/member-invitations',
      {
        method: 'POST',
        headers: {
          apikey: secret,
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:5173',
        },
        body: JSON.stringify({ action: 'list', organizationId: 'synthetic-school' }),
        signal: timeout.mock.results[0].value,
      },
    );
    expect(json).toHaveBeenCalledTimes(1);
    expect(clone).not.toHaveBeenCalled();
    expect(h.dependencies.correlations).toEqual(new Set([secret]));
    expect(h.dependencies.limiterKeys).toEqual(new Set(['synthetic-limiter']));
    for (const stage of [
      'prepare',
      'transport',
      'decode',
      'correlation',
      'status',
      'roles',
      'invitations',
    ]) {
      expect(h.lines).toContain(
        `FEAT-004 runtime diagnostic: stage=invitation-list-${stage} event=passed.`,
      );
    }
    expect(fixtureDiagnosticLines('FEAT-004', h.lines.join('\n'))).toEqual(h.lines);
    expect(h.lines.join('\n')).not.toContain(secret);
  });

  it.each([
    ['ECONNREFUSED', 'transport-connection-refused'],
    ['ECONNRESET', 'transport-connection-reset'],
    ['UND_ERR_SOCKET', 'transport-socket-closed'],
    ['EAI_AGAIN', 'transport-dns-failed'],
    ['UND_ERR_HEADERS_TIMEOUT', 'transport-timeout'],
    ['ERR_INVALID_URL', 'transport-invalid-request'],
    [secret, 'transport-unknown'],
  ])('classifies transport %s without retrying or replacing the error', async (code, detail) => {
    const error = new TypeError(secret, { cause: { code, message: secret } });
    const h = harness({ error });
    await expect(h.run()).rejects.toBe(error);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.lines.at(-1)).toContain(
      `stage=invitation-list-transport event=failed detail=${detail}`,
    );
    expect(h.lines.join('\n')).not.toContain(secret);
  });

  it.each(['AbortError', 'TimeoutError'])('preserves %s without retries', async (name) => {
    const error = Object.assign(new Error(secret), { name });
    const h = harness({ error });
    await expect(h.run()).rejects.toBe(error);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.lines.at(-1)).toContain(
      name === 'AbortError' ? 'transport-aborted' : 'transport-timeout',
    );
  });

  it.each([
    [new SyntaxError(secret), 'response-decoding-failed'],
    [new TypeError(secret, { cause: { code: 'UND_ERR_SOCKET' } }), 'transport-socket-closed'],
  ])(
    'distinguishes body failures from transport and preserves the original',
    async (error, detail) => {
      const response = { status: 200, json: vi.fn().mockRejectedValue(error) };
      const h = harness({ response });
      await expect(h.run()).rejects.toBe(error);
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(h.lines).toContain(
        'FEAT-004 runtime diagnostic: stage=invitation-list-decode event=response detail=http-2xx.',
      );
      expect(h.lines.at(-1)).toContain(
        `stage=invitation-list-decode event=failed detail=${detail}`,
      );
      expect(h.lines.join('\n')).not.toContain(secret);
    },
  );

  it('classifies real malformed JSON without another body read', async () => {
    const response = new Response(secret);
    const json = vi.spyOn(response, 'json');
    const h = harness({ response });
    await expect(h.run()).rejects.toBeInstanceOf(SyntaxError);
    expect(json).toHaveBeenCalledTimes(1);
    expect(h.lines.at(-1)).toContain(
      'stage=invitation-list-decode event=failed detail=response-decoding-failed',
    );
    expect(h.lines.join('\n')).not.toContain(secret);
  });

  it.each([
    [null, 'roles', TypeError],
    [{}, 'roles', TypeError],
    [{ roles: null }, 'roles', TypeError],
    [{ roles: [1, 2, 3] }, 'invitations', TypeError],
    [{ roles: [1, 2, 3], invitations: null }, 'invitations', TypeError],
    [{ roles: [], invitations: [] }, 'roles', assert.AssertionError],
    [{ roles: [1, 2, 3], invitations: [secret] }, 'invitations', assert.AssertionError],
  ])(
    'keeps missing fields and wrong counts failing at their original assertion',
    async (body, stage, ErrorType) => {
      const h = harness({ response: Response.json(body) });
      await expect(h.run()).rejects.toBeInstanceOf(ErrorType);
      expect(h.lines.at(-1)).toContain(`stage=invitation-list-${stage} event=failed`);
      expect(h.lines.join('\n')).not.toContain(secret);
    },
  );

  it.each([201, 401, 429, 500, 503, 418])(
    'keeps status %i failing with fixed response evidence',
    async (status) => {
      const h = harness({ response: Response.json(payload(), { status }) });
      await expect(h.run()).rejects.toMatchObject({
        name: 'AssertionError',
        actual: status,
        expected: 200,
      });
      const detail = status === 201 ? 'http-2xx' : status === 418 ? 'http-other' : `http-${status}`;
      expect(h.lines).toContain(
        `FEAT-004 runtime diagnostic: stage=invitation-list-decode event=response detail=${detail}.`,
      );
      expect(h.lines.at(-1)).toContain(
        'stage=invitation-list-status event=failed detail=assertion',
      );
      expect(h.fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['prepare', 'correlation'])('preserves the original %s error', async (stage) => {
    const error = new Error(secret);
    const fail = () => {
      throw error;
    };
    const h = harness(
      stage === 'prepare' ? { limiterHash: fail } : { correlations: { add: fail } },
    );
    await expect(h.run()).rejects.toBe(error);
    expect(h.lines.at(-1)).toContain(
      `stage=invitation-list-${stage} event=failed detail=unclassified`,
    );
    expect(h.fetchMock).toHaveBeenCalledTimes(stage === 'prepare' ? 0 : 1);
  });

  it('does not let diagnostic output failure change success or original failure', async () => {
    const write = () => {
      throw new Error(secret);
    };
    await expect(harness({ write }).run()).resolves.toBeUndefined();
    const error = new TypeError(secret);
    await expect(harness({ write, error }).run()).rejects.toBe(error);
    const hostile = {
      get name() {
        throw new Error(secret);
      },
    };
    await expect(
      withInvitationListDiagnostics(
        () => {
          throw hostile;
        },
        { enabled: true, write },
      ),
    ).rejects.toBe(hostile);
  });

  it('preserves exactly three proxy attempts, 500ms delays and one shared signal', async () => {
    vi.useFakeTimers();
    const h = harness();
    const times = [];
    const responses = [
      new Response('', { status: 502 }),
      Response.json({ message: 'name resolution failed' }, { status: 503 }),
      Response.json(payload()),
    ];
    h.fetchMock.mockImplementation(async () => {
      times.push(Date.now());
      return responses.shift();
    });
    const pending = h.run();
    await vi.runAllTimersAsync();
    await pending;
    expect(times.map((time) => time - times[0])).toEqual([0, 500, 1000]);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    const init = h.fetchMock.mock.calls[0][1];
    expect(h.fetchMock.mock.calls.every(([, value]) => value === init)).toBe(true);
    expect(h.lines.filter((line) => line.includes('event=retry'))).toEqual([
      'FEAT-004 runtime diagnostic: stage=invitation-list event=retry detail=http-502.',
      'FEAT-004 runtime diagnostic: stage=invitation-list event=retry detail=http-503.',
    ]);
  });

  it('rejects non-allowlisted or private lines at the runner boundary', () => {
    const valid =
      'FEAT-004 runtime diagnostic: stage=invitation-list-decode event=response detail=http-2xx.';
    const lines = [
      valid,
      valid.replace('http-2xx', secret),
      valid.replace('decode', secret),
      valid.replace('FEAT-004', 'FEAT-005'),
      `${valid} ${secret}`,
      secret,
    ];
    expect(fixtureDiagnosticLines('FEAT-004', lines.join('\n'))).toEqual([valid]);
  });
});
