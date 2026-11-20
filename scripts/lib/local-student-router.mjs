import {
  readBoundedRequestBody,
  RequestTooLargeError,
} from '../../supabase/functions/_shared/request-body.ts';

export const studentOrigin = 'http://127.0.0.1:58329';
export const studentGateway = 'http://127.0.0.1:58321';
const login = '/auth/v1/token?grant_type=password';
const bootstrap = '/functions/v1/auth-bootstrap';
const members = '/functions/v1/member-administration';
const deny = (status) => new Response(null, { status });

export function gatewayOnlyFetch(transport) {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== studentGateway || url.username || url.password)
      throw new Error('Local Student upstream rejected.');
    return transport(input, { ...init, redirect: 'error' });
  };
}

export function studentResponseHeaders(response) {
  const headers = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
      "default-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'content-type': response.headers.get('content-type') ?? 'text/plain',
  };
  const retry = response.headers.get('retry-after');
  if (response.status === 429 && /^[1-9][0-9]{0,3}$/.test(retry) && Number(retry) <= 3600)
    headers['retry-after'] = retry;
  return headers;
}

export function tokenClaims(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// Only accept exact request targets. No filesystem or upstream URL is derived from a request.
export async function routeStudentRequest(
  request,
  { assets, anon, userId, handlers, passwordSignIn, instructor },
) {
  const url = new URL(request.url);
  const target = url.pathname + url.search;
  if (url.origin !== studentOrigin || request.headers.get('host') !== url.host) return deny(403);
  if (instructor) {
    const response = await instructor.route(request, target, anon);
    if (response) return response;
  }
  if (request.method === 'GET') {
    const asset = assets.get(target);
    return asset
      ? new Response(asset.bytes, { headers: { 'content-type': asset.type } })
      : deny(404);
  }
  if (request.method !== 'POST' || ![login, bootstrap, members].includes(target)) return deny(404);
  if (
    request.headers.get('origin') !== studentOrigin ||
    request.headers.get('apikey') !== anon ||
    request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json'
  )
    return deny(403);
  let body;
  try {
    body = JSON.parse(
      await readBoundedRequestBody(request, target === bootstrap ? 2048 : 8192, {
        fatalUtf8: true,
      }),
    );
    if (!body || Array.isArray(body) || typeof body !== 'object') return deny(400);
  } catch (error) {
    return deny(error instanceof RequestTooLargeError ? 413 : 400);
  }
  const authorization = request.headers.get('authorization');
  if (target === login) {
    if (
      authorization !== 'Bearer ' + anon ||
      body.email !== (instructor?.email ?? 'student_pilot@school.invalid') ||
      typeof body.password !== 'string' ||
      !body.password ||
      Object.keys(body).some((k) => !['email', 'password', 'gotrue_meta_security'].includes(k)) ||
      ('gotrue_meta_security' in body && JSON.stringify(body.gotrue_meta_security) !== '{}')
    )
      return deny(403);
    const upstream = await passwordSignIn(studentGateway + login, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { apikey: anon, authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ email: body.email, password: body.password }),
    });
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return deny(upstream.status);
    }
    const session = await upstream.json();
    if (
      session.user?.id !== userId ||
      session.user.email !== body.email ||
      tokenClaims(session.access_token)?.role !== 'authenticated' ||
      tokenClaims(session.access_token)?.sub !== userId
    )
      return deny(502);
    if (instructor && !instructor.bindLogin(session)) return deny(502);
    return Response.json(session);
  }
  if (!authorization?.startsWith('Bearer ')) return deny(403);
  const claims = tokenClaims(authorization.slice(7));
  // Narrow the fixture to its journalled Student. The real handler verifies the token with Auth.
  if (claims?.role !== 'authenticated' || claims.sub !== userId) return deny(403);
  if (instructor && !instructor.accepts(authorization.slice(7))) return deny(403);
  if (target === members && !['get_profile', 'list'].includes(body.action)) return deny(404);
  const handler = target === bootstrap ? handlers.bootstrap : handlers.members;
  return handler(
    new Request(request.url, {
      method: 'POST',
      headers: {
        origin: studentOrigin,
        authorization,
        apikey: anon,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );
}
