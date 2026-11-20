import { readBoundedRequestBody } from '../../supabase/functions/_shared/request-body.ts';
import { studentGateway, studentOrigin, tokenClaims } from './local-student-router.mjs';
import { studentUuid } from './local-student-journal.mjs';

// This state belongs to one worker and one newly authenticated browser session.
export function instructorMfaRoutes(userId, factorId, upstream, role = 'instructor_pilot') {
  if (!studentUuid(userId) || !studentUuid(factorId) || factorId === userId)
    throw new Error('Invalid fixture identity.');
  if (!['instructor_pilot', 'admin'].includes(role)) throw new Error('Invalid fixture role.');
  const email = role + '@school.invalid';
  const base = '/auth/v1/factors/' + factorId;
  let sessionId, challengeId;
  const deny = () => new Response(null, { status: 403 });
  function identity(s, level) {
    const c = tokenClaims(s?.access_token);
    return (
      s?.user?.id === userId &&
      s.user.email === email &&
      c?.role === 'authenticated' &&
      c.sub === userId &&
      c.aal === level &&
      studentUuid(c.session_id) &&
      (!sessionId || sessionId === c.session_id)
    );
  }
  return {
    email,
    bindLogin(s) {
      if (sessionId || !identity(s, 'aal1')) return false;
      sessionId = tokenClaims(s.access_token).session_id;
      return true;
    },
    accepts(token) {
      const c = tokenClaims(token);
      return Boolean(
        sessionId && c?.sub === userId && c.role === 'authenticated' && c.session_id === sessionId,
      );
    },
    async route(request, target, anon) {
      if (!['/auth/v1/user', base + '/challenge', base + '/verify'].includes(target)) return null;
      const h = request.headers,
        bearer = h.get('authorization') ?? '',
        get = target === '/auth/v1/user';
      if (
        request.method !== (get ? 'GET' : 'POST') ||
        h.get('apikey') !== anon ||
        !(
          h.get('origin') === studentOrigin ||
          (get && !h.has('origin') && h.get('sec-fetch-site') === 'same-origin')
        ) ||
        !bearer.startsWith('Bearer ') ||
        !this.accepts(bearer.slice(7))
      )
        return deny();
      let body;
      if (!get) {
        if (
          h.get('content-type')?.split(';')[0].trim() !== 'application/json' ||
          tokenClaims(bearer.slice(7)).aal !== 'aal1'
        )
          return deny();
        try {
          body = JSON.parse(await readBoundedRequestBody(request, 512, { fatalUtf8: true }));
        } catch {
          return deny();
        }
        if (!body || typeof body !== 'object') return deny();
        if (target.endsWith('/challenge')) {
          if (challengeId || Object.keys(body).length !== 1 || body.factorId !== factorId)
            return deny();
          challengeId = 'pending';
        } else {
          if (
            !studentUuid(challengeId) ||
            body.challenge_id !== challengeId ||
            typeof body.code !== 'string' ||
            !/^\d{6}$/.test(body.code) ||
            Object.keys(body).length !== 2
          )
            return deny();
          challengeId = 'consumed';
        }
      }
      const response = await upstream(studentGateway + target, {
        method: request.method,
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { apikey: anon, authorization: bearer, 'content-type': 'application/json' },
        body: get ? undefined : JSON.stringify(body),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        return new Response(null, { status: response.status });
      }
      const data = await response.json();
      if (get) {
        const f = data?.factors;
        if (
          data.id !== userId ||
          data.email !== email ||
          f?.length !== 1 ||
          f[0].id !== factorId ||
          f[0].status !== 'verified' ||
          f[0].factor_type !== 'totp'
        )
          return deny();
        return Response.json({
          id: userId,
          email,
          factors: [{ id: factorId, status: 'verified', factor_type: 'totp' }],
        });
      }
      if (target.endsWith('/challenge')) {
        if (!studentUuid(data.id) || data.type !== 'totp') return deny();
        challengeId = data.id;
        return Response.json({ id: data.id, type: data.type, expires_at: data.expires_at });
      }
      if (!identity(data, 'aal2')) return deny();
      return Response.json(data);
    },
  };
}
