import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialOwnerHandler, passwordActor } from './handler';
const actor = 'd8834278-2366-45b6-bbd1-91c38aa14f11';
const session = '67acb2a2-2dbd-4657-bdfe-f9dd43391651';
const token = (methods: string[]) =>
  'eyJhbGciOiJIUzI1NiJ9.' +
  btoa(
    JSON.stringify({
      sub: actor,
      session_id: session,
      aal: 'aal2',
      amr: methods.map((method) => ({ method, timestamp: 100 })),
      exp: 2000000000,
    }),
  ) +
  '.stub';
const origin = 'http://127.0.0.1:58329';
const form = {
  organizationId: actor,
  membershipId: session,
  action: 'submit',
  operationId: session,
  licenseType: 'PPL',
  licenseNumber: '001-SYN',
  issueDate: '2025-01-01',
  expiryDate: null,
  noExpiry: true,
  mime: 'image/png',
  filename: 'sample.png',
  file: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQzlwPAAIGAUQpAeg+AAAAAElFTkSuQmCC',
};
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('local owner command boundary', () => {
  it('requires the presented verified token to contain a usable password authentication method', () => {
    expect(passwordActor(token(['totp']), actor)).toBeNull();
    expect(passwordActor(token(['password', 'totp']), actor)?.p_session).toBe(session);
    expect(() => passwordActor('incomplete', actor)).toThrow();
  });
  async function scenario(
    body: Record<string, unknown>,
    guard: boolean | 'outage',
    readback: unknown = null,
  ) {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: URL | string | Request) => {
        const p = new URL(url instanceof Request ? url.url : String(url)).pathname;
        calls.push(p);
        if (p.endsWith('/user')) return Response.json({ id: actor });
        if (p.endsWith('credential_request_guard'))
          return Response.json(guard === 'outage' ? {} : guard, {
            status: guard === 'outage' ? 503 : 200,
          });
        if (p.endsWith('credential_owner_submission')) return Response.json(readback);
        throw Error('Unexpected outbound call');
      }),
    );
    const handler = credentialOwnerHandler({
      supabaseUrl: 'http://127.0.0.1:58321',
      supabaseServiceRoleKey: 'synthetic-service',
      supabasePublishableKey: 'synthetic-public',
      allowedOrigin: origin,
    });
    const response = await handler(
      new Request(origin, {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token(['password', 'totp']),
        },
        body: JSON.stringify(body),
      }),
    );
    return { response, calls };
  }
  it.each(['\t001', '001\n', '00\u00001'])(
    'rejects raw control characters before trimming',
    async (licenseNumber) => {
      const { response, calls } = await scenario({ ...form, licenseNumber }, true);
      expect(response.status).toBe(400);
      expect(calls).toHaveLength(1);
    },
  );
  it.each([
    [false, 429],
    ['outage', 503],
  ] as const)(
    'fails closed before storage or submission when the limiter returns %s',
    async (guard, status) => {
      const { response, calls } = await scenario(form, guard);
      expect(response.status).toBe(status);
      expect(calls).toHaveLength(2);
    },
  );
  it('answers an authorized replay without writing bytes', async () => {
    const { response, calls } = await scenario(form, true, {
      replayed: true,
      id: actor,
      state: 'pending',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: actor });
    expect(calls).toHaveLength(3);
  });
  it.each([
    { choice: 'explicit no expiry', expiryDate: null, noExpiry: true, status: 200 },
    { choice: 'dated expiry', expiryDate: '2025-12-31', noExpiry: false, status: 200 },
    { choice: 'neither selected', expiryDate: null, noExpiry: false, status: 400 },
    { choice: 'missing selection', expiryDate: null, noExpiry: undefined, status: 400 },
    { choice: 'blank date', expiryDate: '', noExpiry: false, status: 400 },
    { choice: 'both selected', expiryDate: '2025-12-31', noExpiry: true, status: 400 },
  ])('validates the SPL expiry choice: $choice', async ({ expiryDate, noExpiry, status }) => {
    const { response, calls } = await scenario(
      { ...form, licenseType: 'SPL', expiryDate, noExpiry },
      true,
      { replayed: true, id: actor, state: 'pending' },
    );
    expect(response.status).toBe(status);
    expect(calls.filter((path) => path.endsWith('/credential_owner_submission'))).toHaveLength(
      status === 200 ? 1 : 0,
    );
    expect(calls.some((path) => path.startsWith('/storage/'))).toBe(false);
  });
  it.each([
    ['withdraw', { id: actor, state: 'withdrawn' }, 200],
    ['withdraw_outcome', { id: actor, state: 'unconfirmed' }, 200],
    ['withdraw', { conflict: true }, 409],
    ['withdraw', null, 403],
    ['withdraw', { id: session, state: 'withdrawn' }, 503],
    ['withdraw', { id: actor, state: 'unconfirmed' }, 503],
  ] as const)(
    'binds %s to the exact version and protected outcome',
    async (action, readback, status) => {
      const { response, calls } = await scenario(
        {
          organizationId: actor,
          membershipId: session,
          action,
          operationId: session,
          versionId: actor,
        },
        true,
        readback,
      );
      expect(response.status).toBe(status);
      expect(calls.some((p) => p.startsWith('/storage/'))).toBe(false);
      if (status === 200) expect(await response.json()).toEqual(readback);
    },
  );
  it.each([
    [{ action: 'replace' }, 400],
    [{ action: 'replace', expectedPendingId: 'invalid' }, 400],
    [{ action: 'submit', expectedPendingId: session }, 400],
    [{ action: 'replace', expectedPendingId: session, file: 'invalid' }, 400],
    [{ action: 'replace', expectedPendingId: session }, 409],
  ] as const)(
    'requires an exact replacement target and validated PNG before upload',
    async (patch, status) => {
      const result = await scenario({ ...form, ...patch }, true, { conflict: true });
      expect(result.response.status).toBe(status);
      expect(result.calls.some((path) => path.startsWith('/storage/'))).toBe(false);
    },
  );
  it('replays a confirmed replacement without uploading again', async () => {
    const result = await scenario(
      { ...form, action: 'replace', expectedPendingId: session },
      true,
      { replayed: true, state: 'pending', id: actor },
    );
    expect(result.response.status).toBe(200);
    expect(await result.response.json()).toEqual({ state: 'pending', id: actor });
    expect(result.calls).toHaveLength(3);
  });
  const elp = {
    action: 'submit',
    category: 'elp',
    organizationId: actor,
    membershipId: session,
    operationId: session,
    elpLevel: 6,
    issueDate: '2020-01-15',
    expiryDate: '2023-06-30',
    noExpiry: false,
    filename: form.filename,
    mime: form.mime,
    file: form.file,
  };
  it.each([
    ...[1, 2, 3, 4, 5, 6].map((level) => ({
      name: 'dated level ' + level,
      patch: { elpLevel: level },
      expected: 200,
    })),
    { name: 'explicit no expiry', patch: { noExpiry: true, expiryDate: null }, expected: 200 },
    ...[0, 7, 1.5, '6', null, undefined].map((level) => ({
      name: 'invalid level ' + String(level),
      patch: { elpLevel: level },
      expected: 400,
    })),
    { name: 'blank date without choice', patch: { expiryDate: null }, expected: 400 },
    { name: 'no choice provided', patch: { expiryDate: null, noExpiry: undefined }, expected: 400 },
    {
      name: 'future issue',
      patch: { issueDate: '2099-01-01', expiryDate: null, noExpiry: true },
      expected: 400,
    },
    { name: 'expiry before issue', patch: { expiryDate: '2019-01-01' }, expected: 400 },
    { name: 'both expiry choices', patch: { noExpiry: true }, expected: 400 },
    { name: 'irrelevant license field', patch: { licenseNumber: 'SYN' }, expected: 400 },
    { name: 'missing evidence', patch: { file: undefined }, expected: 400 },
  ])('ELP $name', async ({ patch, expected }) => {
    const result = await scenario({ ...elp, ...patch }, true, {
      replayed: true,
      id: actor,
      state: 'pending',
    });
    expect(result.response.status).toBe(expected);
    expect(result.calls.some((p) => p.endsWith('credential_owner_submission'))).toBe(
      expected === 200,
    );
    expect(result.calls.some((p) => p.startsWith('/storage/'))).toBe(false);
  });
  it.each([
    [{ expectedPendingId: session }, 200],
    [{}, 400],
    [{ expectedPendingId: session, elpLevel: 7 }, 400],
    [{ expectedPendingId: session, expiryDate: null }, 400],
    [{ expectedPendingId: session, licenseType: 'PPL' }, 400],
  ] as const)('validates ELP replacement before any upload', async (patch, status) => {
    const result = await scenario({ ...elp, action: 'replace', ...patch }, true, {
      replayed: true,
      id: actor,
      state: 'pending',
    });
    expect(result.response.status).toBe(status);
    expect(result.calls.some((p) => p.startsWith('/storage/'))).toBe(false);
  });
  it.each([
    [{}, { elpCompleteness: 'not_yet_obtained' }, 200],
    [{}, null, 403],
    [{}, { conflict: true }, 409],
    [{}, { state: 'pending' }, 503],
    [{ operationId: undefined }, null, 400],
    [{ category: 'ntc' }, null, 400],
    [{ file: form.file }, null, 400],
    [{ applicability: 'trainee' }, null, 400],
  ] as const)(
    'keeps declaration separate from evidence and school-controlled applicability',
    async (patch, receipt, status) => {
      const { response, calls } = await scenario(
        {
          action: 'declare_elp',
          organizationId: actor,
          membershipId: session,
          operationId: actor,
          ...patch,
        },
        true,
        receipt,
      );
      expect(response.status).toBe(status);
      expect(calls.some((p) => p.startsWith('/storage/'))).toBe(false);
      expect(calls.some((p) => p.endsWith('credential_owner_submission'))).toBe(status !== 400);
    },
  );
  it.each([
    [{}, 200],
    [{ noExpiry: true, expiryDate: null }, 200],
    [{ elpLevel: 4 }, 400],
    [{ licenseNumber: '001' }, 400],
    [{ licenseType: 'PPL' }, 400],
    [{ issueDate: '2099-01-01' }, 400],
    [{ issueDate: '2020-02-30' }, 400],
    [{ expiryDate: '2019-01-01' }, 400],
    [{ noExpiry: true }, 400],
    [{ expiryDate: null }, 400],
    [{ noExpiry: undefined }, 400],
    [{ file: undefined }, 400],
    [{ action: 'replace', expectedPendingId: session }, 400],
  ] as const)('checks the NTC submission contract before storage', async (patch, status) => {
    const ntc = { ...elp, category: 'ntc', elpLevel: undefined, ...patch };
    const { response, calls } = await scenario(ntc, true, {
      replayed: true,
      id: actor,
      state: 'pending',
    });
    expect(response.status).toBe(status);
    expect(calls.some((p) => p.endsWith('credential_owner_submission'))).toBe(status === 200);
    expect(calls.some((p) => p.startsWith('/storage/'))).toBe(false);
  });
  it('uses Manila midnight for the ELP issue date cutoff', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const cmd = { ...elp, issueDate: '2026-01-02', expiryDate: null, noExpiry: true };
      vi.setSystemTime(new Date('2026-01-01T15:59:59Z'));
      expect((await scenario(cmd, true)).response.status).toBe(400);
      vi.setSystemTime(new Date('2026-01-01T16:00:00Z'));
      expect(
        (await scenario(cmd, true, { replayed: true, id: actor, state: 'pending' })).response
          .status,
      ).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
  it('records a scope denial before returning it', async () => {
    const { response, calls } = await scenario(form, true, null);
    expect(response.status).toBe(403);
    expect(calls.at(-1)).toMatch(/credential_request_guard$/);
  });
});
