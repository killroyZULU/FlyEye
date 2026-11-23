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
  it('records a scope denial before returning it', async () => {
    const { response, calls } = await scenario(form, true, null);
    expect(response.status).toBe(403);
    expect(calls.at(-1)).toMatch(/credential_request_guard$/);
  });
});
