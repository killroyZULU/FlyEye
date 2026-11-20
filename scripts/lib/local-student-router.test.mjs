// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { createMemberAdministrationHandler } from '../../supabase/functions/member-administration/handler.ts';
import {
  studentOrigin,
  studentGateway,
  routeStudentRequest,
  studentResponseHeaders,
  gatewayOnlyFetch,
} from './local-student-router.mjs';

const token = (claims) =>
  ['fixture', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'fixture'].join('.');
const userId = '00000000-0000-4000-8000-000000000010';
const anon = token({ role: 'anon' });
const student = token({ role: 'authenticated', sub: userId });
const login = '/auth/v1/token?grant_type=password',
  bootstrap = '/functions/v1/auth-bootstrap',
  members = '/functions/v1/member-administration';
const credentials = {
  email: 'student_pilot@school.invalid',
  password: 'disposable',
  gotrue_meta_security: {},
};
const session = { access_token: student, user: { id: userId, email: credentials.email } };
const setup = {
  anon,
  userId,
  assets: new Map([['/', { bytes: 'fixture frontend', type: 'text/html' }]]),
  handlers: { bootstrap: vi.fn(), members: vi.fn() },
  passwordSignIn: vi.fn(),
};
function call(path, body = {}, headers = {}, method = 'POST') {
  return routeStudentRequest(
    new Request(studentOrigin + path, {
      method,
      headers: {
        host: new URL(studentOrigin).host,
        origin: studentOrigin,
        apikey: anon,
        authorization: 'Bearer ' + (path === login ? anon : student),
        'content-type': 'application/json',
        ...headers,
      },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
    setup,
  );
}
beforeEach(() => vi.resetAllMocks());
it.each([
  [429, '30', '30'],
  [429, '3600', '3600'],
  [429, '0', undefined],
  [429, '3601', undefined],
  [429, 'private', undefined],
  [200, '30', undefined],
])('forwards only bounded throttle delays (%i, %s)', (status, retry, expected) => {
  const headers = studentResponseHeaders(
    new Response(null, { status, headers: { 'retry-after': retry, 'set-cookie': 'private' } }),
  );
  expect(headers['retry-after']).toBe(expected);
  expect(headers['set-cookie']).toBeUndefined();
});
it('pins the SDK transport to the exact owned gateway and disables redirects', () => {
  const transport = vi.fn(),
    fetchLocal = gatewayOnlyFetch(transport);
  for (const url of ['https://other.invalid', studentOrigin, 'http://name@127.0.0.1:58321/'])
    expect(() => fetchLocal(url)).toThrow('upstream rejected');
  expect(transport).not.toHaveBeenCalled();
  const request = new Request(studentGateway + '/auth/v1/user');
  fetchLocal(request, { redirect: 'follow' });
  expect(transport).toHaveBeenCalledExactlyOnceWith(request, { redirect: 'error' });
});
it('serves only assets in the public build inventory', async () => {
  expect(await (await call('/', {}, {}, 'GET')).text()).toBe('fixture frontend');
  for (const path of ['/.env', '/scripts/lib/local-student-worker.mjs', bootstrap, '/?x=1'])
    expect((await call(path, {}, {}, 'GET')).status).toBe(404);
  expect((await call('/', {}, { host: 'other.invalid' }, 'GET')).status).toBe(403);
});
it.each([
  [bootstrap, {}, 'bootstrap', 200],
  [
    members,
    { action: 'get_profile', membershipId: '00000000-0000-4000-8000-000000000011' },
    'members',
    200,
  ],
  [
    members,
    { action: 'list', organizationId: '00000000-0000-4000-8000-000000000099' },
    'members',
    403,
  ],
])(
  'passes through the injected handler decision for %s %j',
  async (path, body, handler, status) => {
    setup.handlers[handler].mockResolvedValue(new Response('decision', { status }));
    const response = await call(path, body, { 'x-foreign': 'drop' });
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('decision');
    const [request] = setup.handlers[handler].mock.calls[0];
    expect(await request.json()).toEqual(body);
    expect(request.headers.get('authorization')).toBe('Bearer ' + student);
    expect(request.headers.has('x-foreign')).toBe(false);
    expect(setup.passwordSignIn).not.toHaveBeenCalled();
  },
);
it.each([
  [members, { action: 'update_profile' }, {}, 404],
  [members, { action: 'get_profile' }, { origin: 'null' }, 403],
  [bootstrap, {}, { apikey: 'wrong' }, 403],
  [
    members,
    { action: 'list' },
    { authorization: 'Bearer ' + token({ sub: userId, role: 'service_role' }) },
    403,
  ],
  [
    bootstrap,
    {},
    { authorization: 'Bearer ' + token({ sub: 'other', role: 'authenticated' }) },
    403,
  ],
  [bootstrap, {}, { authorization: 'not-a-token' }, 403],
  [bootstrap, { padding: 'x'.repeat(2048) }, {}, 413],
  [login, { ...credentials, email: 'other@school.invalid' }, {}, 403],
  [login, { ...credentials, redirect: 'outside' }, {}, 403],
  [login, credentials, { authorization: 'Bearer ' + student }, 403],
  ['/auth/v1/recover', credentials, {}, 404],
  [members + '?different=1', { action: 'list' }, {}, 404],
])('rejects disallowed request %# before dispatch', async (path, body, headers, status) => {
  expect((await call(path, body, headers)).status).toBe(status);
  expect(setup.passwordSignIn).not.toHaveBeenCalled();
  expect(setup.handlers.members).not.toHaveBeenCalled();
  expect(setup.handlers.bootstrap).not.toHaveBeenCalled();
});
it('returns the real member handler assurance denial and records its reason', async () => {
  const recordDenied = vi.fn();
  const authenticate = vi.fn(async () => ({
    actorUserId: userId,
    actorSubjectId: userId,
    assuranceLevel: 'aal1',
    totpAuthenticatedAt: null,
  }));
  setup.handlers.members.mockImplementation(
    createMemberAdministrationHandler({
      allowedOrigin: studentOrigin,
      runtimeProfile: 'local-synthetic-v1',
      authenticate,
      resolveLimitScope: async () => userId,
      consumeLimit: async ({ correlationId }) => ({
        allowed: true,
        correlationId,
        networkSourceUsed: false,
        policyVersion: 'member-administration-subject-scope-v1',
      }),
      recordDenied,
    }),
  );
  const response = await call(members, {
    action: 'list',
    organizationId: '00000000-0000-4000-8000-000000000099',
  });
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe(
    'member_administration.authentication_assurance_required',
  );
  expect(authenticate).toHaveBeenCalledExactlyOnceWith(student);
  expect(recordDenied).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      actorUserId: userId,
      reasonCode: 'authentication_assurance_required',
    }),
  );
});
it('sends only the fixed password request to the witnessed gateway', async () => {
  setup.passwordSignIn.mockResolvedValue(Response.json(session));
  expect(await (await call(login, credentials, { 'x-extra': 'drop' })).json()).toEqual(session);
  const [url, options] = setup.passwordSignIn.mock.calls[0];
  expect(url).toBe(studentGateway + login);
  expect(options.redirect).toBe('error');
  expect(options.headers).toEqual({
    apikey: anon,
    authorization: 'Bearer ' + anon,
    'content-type': 'application/json',
  });
  expect(JSON.parse(options.body)).toEqual({
    email: credentials.email,
    password: credentials.password,
  });
});
it('suppresses foreign identities and provider errors', async () => {
  for (const value of [
    { ...session, user: { ...session.user, id: 'wrong' } },
    { ...session, access_token: anon },
  ]) {
    setup.passwordSignIn.mockResolvedValue(Response.json(value));
    const response = await call(login, credentials);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('');
  }
  setup.passwordSignIn.mockResolvedValue(new Response('private upstream detail', { status: 401 }));
  const failure = await call(login, credentials);
  expect(failure.status).toBe(401);
  expect(await failure.text()).toBe('');
});
