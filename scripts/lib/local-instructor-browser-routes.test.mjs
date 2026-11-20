// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { instructorMfaRoutes } from './local-instructor-browser-routes.mjs';
import { studentOrigin, routeStudentRequest } from './local-student-router.mjs';
it('restricts the Admin fixture to its fixed address and rejects other role selectors', () => {
  const user = randomUUID(),
    factor = randomUUID();
  const routes = instructorMfaRoutes(user, factor, vi.fn(), 'admin');
  expect(routes.email).toBe('admin@school.invalid');
  const claims = { sub: user, role: 'authenticated', aal: 'aal1', session_id: randomUUID() };
  const access_token =
    'fixture.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.fixture';
  const login = (email) => routes.bindLogin({ access_token, user: { id: user, email } });
  expect(login('instructor_pilot@school.invalid')).toBe(false);
  expect(login('admin@school.invalid')).toBe(true);
  expect(() => instructorMfaRoutes(user, factor, vi.fn(), 'other')).toThrow();
});

function harness() {
  const userId = randomUUID(),
    factorId = randomUUID(),
    challenge = randomUUID(),
    session = randomUUID(),
    email = 'instructor_pilot@school.invalid';
  const jwt = (aal = 'aal1', sub = userId, sid = session) =>
    'fixture.' +
    Buffer.from(JSON.stringify({ role: 'authenticated', aal, sub, session_id: sid })).toString(
      'base64url',
    ) +
    '.fixture';
  const login = { access_token: jwt(), user: { id: userId, email } };
  const upstream = vi.fn(async (url) => {
    if (url.endsWith('/challenge')) return Response.json({ id: challenge, type: 'totp' });
    if (url.endsWith('/verify')) return Response.json({ ...login, access_token: jwt('aal2') });
    return Response.json({
      id: userId,
      email,
      factors: [{ id: factorId, status: 'verified', factor_type: 'totp' }],
      privateMarker: 'discard',
    });
  });
  const routes = instructorMfaRoutes(userId, factorId, upstream);
  const call = (path, body, overrides = {}) =>
    routeStudentRequest(
      new Request(studentOrigin + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          host: '127.0.0.1:58329',
          ...(body ? { origin: studentOrigin } : {}),
          'sec-fetch-site': 'same-origin',
          apikey: 'public',
          authorization: 'Bearer ' + jwt(),
          'content-type': 'application/json',
          ...overrides,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      { anon: 'public', userId, assets: new Map(), handlers: {}, instructor: routes },
    );
  return {
    routes,
    call,
    login,
    jwt,
    upstream,
    factorId,
    base: '/auth/v1/factors/' + factorId,
    challenge,
  };
}
it('pins the browser factor, session and one challenge and returns only public factor fields', async () => {
  const h = harness();
  expect(h.routes.bindLogin(h.login)).toBe(true);
  expect(await (await h.call('/auth/v1/user')).json()).not.toHaveProperty('privateMarker');
  expect((await h.call(h.base + '/challenge', { factorId: h.factorId })).status).toBe(200);
  expect(
    (await h.call(h.base + '/verify', { challenge_id: h.challenge, code: '123456' })).status,
  ).toBe(200);
  expect(
    (await h.call(h.base + '/verify', { challenge_id: h.challenge, code: '123456' })).status,
  ).toBe(403);
  expect(h.upstream).toHaveBeenCalledTimes(3);
});
it.each([
  'foreign-session',
  'wrong-factor',
  'foreign-subject',
  'privileged-route',
  'other-origin',
  'wrong-key',
  'missing-login',
  'missing-challenge',
])('rejects %s without forwarding', async (mode) => {
  const h = harness();
  if (mode !== 'missing-login') h.routes.bindLogin(h.login);
  let path = h.base + '/challenge',
    body = { factorId: h.factorId },
    headers = {};
  if (mode === 'foreign-session')
    headers.authorization = 'Bearer ' + h.jwt('aal1', undefined, randomUUID());
  if (mode === 'foreign-subject') headers.authorization = 'Bearer ' + h.jwt('aal1', randomUUID());
  if (mode === 'wrong-factor') path = '/auth/v1/factors/' + randomUUID() + '/challenge';
  if (mode === 'privileged-route') path = '/functions/v1/organization-admin-onboarding';
  if (mode === 'other-origin') headers.origin = 'https://other.invalid';
  if (mode === 'wrong-key') headers.apikey = 'different';
  if (mode === 'missing-challenge') {
    path = h.base + '/verify';
    body = { challenge_id: h.challenge, code: '123456' };
  }
  expect([403, 404]).toContain((await h.call(path, body, headers)).status);
  expect(h.upstream).not.toHaveBeenCalled();
});
