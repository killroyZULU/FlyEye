// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createAuthBootstrapHandler, type AuthBootstrapDependencies } from './handler';

const user = '40000000-0000-4000-8000-000000000001';
const correlation = '30000000-0000-4000-8000-000000000001';
const origin = 'https://synthetic.example';
const allowed = {
  allowed: true,
  retryAfterSeconds: null,
  correlationId: correlation,
  policyVersion: 'auth-bootstrap-subject-v1',
};
const denied = { ...allowed, allowed: false, retryAfterSeconds: 2 };

function setup(value: unknown = allowed) {
  const context = {
    memberships: [],
    organizationIds: [],
    selectedOrganizationId: null,
    correlationId: correlation,
    decision: 'denied',
    currentAssuranceLevel: 'aal1',
  };
  const dependencies: AuthBootstrapDependencies = {
    allowedOrigin: origin,
    authenticate: vi.fn().mockResolvedValue({
      userId: user,
      assuranceLevel: 'aal1',
      authenticationMethods: ['password'],
    }),
    consumeLimit: vi.fn().mockResolvedValue(value),
    resolveAccessContext: vi.fn().mockResolvedValue(context),
    validateAdminFactorState: vi.fn(),
    recordDecision: vi.fn().mockResolvedValue(undefined),
    createCorrelationId: () => correlation,
  };
  return { dependencies, handler: createAuthBootstrapHandler(dependencies) };
}
function request(body = '{}', headers: Record<string, string> = {}) {
  return new Request('https://edge.example/auth-bootstrap', {
    method: 'POST',
    body,
    headers: { origin, authorization: 'Bearer synthetic', ...headers },
  });
}
function untouched(deps: AuthBootstrapDependencies) {
  expect(deps.resolveAccessContext).not.toHaveBeenCalled();
  expect(deps.validateAdminFactorState).not.toHaveBeenCalled();
  expect(deps.recordDecision).not.toHaveBeenCalled();
}

describe('A010 auth-bootstrap limiting', () => {
  it('waits for the shared decision before access resolution and final audit', async () => {
    const { dependencies, handler } = setup();
    let release!: (value: unknown) => void;
    vi.mocked(dependencies.consumeLimit).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = handler(request());
    await vi.waitFor(() =>
      expect(dependencies.consumeLimit).toHaveBeenCalledWith(user, correlation),
    );
    untouched(dependencies);
    release(allowed);
    expect((await pending).status).toBe(200);
    expect(dependencies.recordDecision).toHaveBeenCalledOnce();
  });

  it('returns bounded retry guidance and does not duplicate the atomic SQL denial audit', async () => {
    const { dependencies, handler } = setup(denied);
    const response = await handler(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('2');
    expect(response.headers.get('access-control-expose-headers')).toBe('Retry-After');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: { code: 'auth.rate_limited', message: 'Wait 2 seconds before trying again.' },
      correlationId: correlation,
    });
    untouched(dependencies);
  });

  it.each([
    null,
    {},
    { ...allowed, allowed: 'true' },
    { ...allowed, retryAfterSeconds: 1 },
    { ...denied, retryAfterSeconds: null },
    { ...denied, retryAfterSeconds: 0 },
    { ...denied, retryAfterSeconds: 3 },
    { ...denied, retryAfterSeconds: 1.5 },
    { ...allowed, correlationId: user },
    { ...allowed, policyVersion: 'unknown' },
    { ...allowed, hidden: 'provider details' },
  ])('fails closed on malformed decision %#', async (value) => {
    const { dependencies, handler } = setup(value);
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: 'auth.limiter_unavailable',
        message: 'Access is temporarily unavailable. Try again shortly.',
      },
      correlationId: correlation,
    });
    untouched(dependencies);
  });

  it('denies RPC/timeout failure without leaking internals or retrying, then recovers', async () => {
    const { dependencies, handler } = setup();
    vi.mocked(dependencies.consumeLimit).mockRejectedValueOnce(
      new Error('private provider payload'),
    );
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
    expect(dependencies.consumeLimit).toHaveBeenCalledTimes(1);
    untouched(dependencies);
    expect((await handler(request())).status).toBe(200);
  });

  it('shares the verified subject across refreshed tokens, AAL transitions and forged network headers', async () => {
    const { dependencies, handler } = setup(denied);
    await handler(
      request('{}', {
        authorization: 'Bearer first',
        'x-forwarded-for': '192.0.2.1',
        'x-real-ip': '192.0.2.2',
      }),
    );
    vi.mocked(dependencies.authenticate).mockResolvedValue({
      userId: user,
      assuranceLevel: 'aal2',
      authenticationMethods: ['password', 'totp'],
    });
    await handler(
      request('{}', {
        authorization: 'Bearer refreshed',
        forwarded: 'for=192.0.2.3',
        'x-correlation-id': user,
      }),
    );
    expect(vi.mocked(dependencies.consumeLimit).mock.calls).toEqual([
      [user, correlation],
      [user, correlation],
    ]);
    untouched(dependencies);
  });

  it('does not consume another subject from a body hint or an unverified token', async () => {
    const { dependencies, handler } = setup();
    expect((await handler(request(JSON.stringify({ actorUserId: user })))).status).toBe(422);
    vi.mocked(dependencies.authenticate).mockRejectedValue(new Error('unverified'));
    expect((await handler(request())).status).toBe(401);
    expect(dependencies.consumeLimit).not.toHaveBeenCalled();
    untouched(dependencies);
  });

  it('does not bypass password-method denial after an allowed limiter decision', async () => {
    const { dependencies, handler } = setup();
    vi.mocked(dependencies.authenticate).mockResolvedValue({
      userId: user,
      assuranceLevel: 'aal1',
      authenticationMethods: ['otp'],
    });
    expect((await handler(request())).status).toBe(403);
    expect(dependencies.consumeLimit).toHaveBeenCalledOnce();
    expect(dependencies.resolveAccessContext).not.toHaveBeenCalled();
    expect(dependencies.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'authentication_method_not_allowed' }),
    );
  });
});
