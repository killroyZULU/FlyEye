import { streamedRequest } from '../../../src/test/request-stream';
import { describe, expect, it, vi } from 'vitest';

import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';
import { createAdminOnboardingHandler, type AdminOnboardingDependencies } from './handler.ts';

const ORIGIN = 'http://127.0.0.1:5173';
const USER_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000001';
const GRANT_ID = '30000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '40000000-0000-4000-8000-000000000001';
const MEMBERSHIP_ID = '50000000-0000-4000-8000-000000000001';
const FACTOR_ID = '60000000-0000-4000-8000-000000000001';
const CORRELATION_ID = '70000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = Array.from({ length: 32 }, (_, index) => (index % 16).toString(16)).join(
  '',
);

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const actor: VerifiedAuthenticationEvidence = {
  actorUserId: USER_ID,
  actorSubjectId: USER_ID,
  sessionId: SESSION_ID,
  assuranceLevel: 'aal2',
  authenticationMethods: ['password', 'totp'],
  passwordAuthenticatedAt: 400,
  totpAuthenticatedAt: 900,
};

const verifiedFactor = {
  id: FACTOR_ID,
  friendly_name: 'Synthetic authenticator',
  factor_type: 'totp',
  status: 'verified',
  created_at: '2026-07-28T00:00:00Z',
  updated_at: '2026-07-28T00:00:00Z',
};

function dependencies(
  overrides: Partial<AdminOnboardingDependencies> = {},
): AdminOnboardingDependencies {
  return {
    allowedOrigin: ORIGIN,
    authenticate: vi.fn().mockResolvedValue(actor),
    listFactors: vi.fn().mockResolvedValue([verifiedFactor]),
    consumeLimit: vi.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: null,
      correlationId: CORRELATION_ID,
      networkSourceUsed: false,
      policyVersion: 'subject-action-v1',
    }),
    recordDenied: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({
      grants: [],
      correlationId: CORRELATION_ID,
    }),
    start: vi.fn().mockResolvedValue({
      decision: 'ready',
      bootstrapGrantId: GRANT_ID,
      organizationId: ORGANIZATION_ID,
      organizationName: 'Synthetic Flight School',
      grantVersion: 1,
      replayed: false,
      correlationId: CORRELATION_ID,
    }),
    complete: vi.fn().mockResolvedValue({
      decision: 'completed',
      bootstrapGrantId: GRANT_ID,
      organizationId: ORGANIZATION_ID,
      organizationName: 'Synthetic Flight School',
      membershipId: MEMBERSHIP_ID,
      grantVersion: 2,
      correlationId: CORRELATION_ID,
    }),
    cancel: vi.fn().mockResolvedValue({
      decision: 'cancelled',
      cleanupOutcome: 'not_attempted',
      replayed: false,
      correlationId: CORRELATION_ID,
    }),
    createCorrelationId: () => CORRELATION_ID,
    nowSeconds: () => 1_000,
    ...overrides,
  };
}

function request(body: unknown, options: { origin?: string; token?: string } = {}) {
  const headers = new Headers({
    'content-type': 'application/json',
    origin: options.origin ?? ORIGIN,
  });
  if (options.token !== '') {
    headers.set('authorization', `Bearer ${options.token ?? 'verified-token'}`);
  }
  return new Request('http://127.0.0.1:54321/functions/v1/organization-admin-onboarding', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('administrator onboarding handler compatibility', () => {
  const IDEMPOTENCY_DIGEST = '3eb1bd439947eb762998e566ccc2e099c791118b2f40579cc4f7da2b5061b7f9';
  const grantRequest = {
    bootstrapGrantId: GRANT_ID,
    expectedVersion: 1,
    idempotencyKey: IDEMPOTENCY_KEY,
  };
  const cases = [
    { action: 'status' },
    { action: 'start', ...grantRequest },
    { action: 'complete', ...grantRequest },
    { action: 'cancel', bootstrapGrantId: GRANT_ID, idempotencyKey: IDEMPOTENCY_KEY },
  ] as const;

  it.each(cases)('preserves $action payload and dependency order', async (body) => {
    const deps = dependencies();
    const response = await createAdminOnboardingHandler(deps)(request(body));
    expect(response.status).toBe(200);
    expect(deps.authenticate).toHaveBeenCalledExactlyOnceWith('verified-token');
    expect(deps.consumeLimit).toHaveBeenCalledExactlyOnceWith({
      actorSubjectId: USER_ID,
      action: body.action,
      correlationId: CORRELATION_ID,
    });
    const input: Record<string, unknown> = { actorUserId: USER_ID, correlationId: CORRELATION_ID };
    if (body.action !== 'status')
      Object.assign(input, { bootstrapGrantId: GRANT_ID, idempotencyKeyHash: IDEMPOTENCY_DIGEST });
    if (body.action === 'start' || body.action === 'complete') input.expectedVersion = 1;
    if (body.action === 'complete') {
      delete input.actorUserId;
      Object.assign(input, { actor, verifiedTotpFactorId: FACTOR_ID, totalFactorCount: 1 });
    }
    expect(deps[body.action]).toHaveBeenCalledExactlyOnceWith(input);
    expect(vi.mocked(deps.authenticate).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.consumeLimit).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(deps.consumeLimit).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps[body.action]).mock.invocationCallOrder[0]!,
    );
    if (body.action === 'start' || body.action === 'complete') {
      expect(deps.listFactors).toHaveBeenCalledExactlyOnceWith(USER_ID);
      expect(vi.mocked(deps.consumeLimit).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(deps.listFactors).mock.invocationCallOrder[0]!,
      );
      expect(vi.mocked(deps.listFactors).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(deps[body.action]).mock.invocationCallOrder[0]!,
      );
    } else expect(deps.listFactors).not.toHaveBeenCalled();
    expect(deps.recordDenied).not.toHaveBeenCalled();
    expect(JSON.stringify(await payload(response))).not.toContain(FACTOR_ID);
  });

  it('returns enrollment guidance for an empty factor inventory without creating a factor', async () => {
    const deps = dependencies({ listFactors: vi.fn().mockResolvedValue([]) });
    const response = await createAdminOnboardingHandler(deps)(request(cases[1]));
    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({
      factorState: 'enrollment_required',
      replayed: false,
    });
    expect(deps.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    { correlationId: GRANT_ID },
    { networkSourceUsed: true },
    { policyVersion: 'untrusted' },
    ...[null, 0, 61].map((retryAfterSeconds) => ({ allowed: false, retryAfterSeconds })),
  ])('rejects invalid limiter metadata before protected work %j', async (patch) => {
    const deps = dependencies({
      consumeLimit: vi.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: null,
        correlationId: CORRELATION_ID,
        networkSourceUsed: false,
        policyVersion: 'subject-action-v1',
        ...patch,
      }),
    });
    const response = await createAdminOnboardingHandler(deps)(request(cases[2]));
    expect(response.status).toBe(503);
    expect(deps.listFactors).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.recordDenied).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves cancellation limiter failure guidance for rejected=%s',
    async (rejected) => {
      const deps = dependencies({
        consumeLimit: rejected
          ? vi.fn().mockRejectedValue(new Error('synthetic failure'))
          : vi.fn().mockResolvedValue({
              allowed: true,
              correlationId: GRANT_ID,
              networkSourceUsed: false,
              policyVersion: 'subject-action-v1',
              retryAfterSeconds: null,
            }),
      });
      const response = await createAdminOnboardingHandler(deps)(request(cases[3]));
      expect(response.status).toBe(503);
      expect(await payload(response)).toEqual({
        error: {
          code: 'admin_onboarding.limiter_unavailable',
          message: rejected
            ? 'Server cancellation could not be confirmed. You will be signed out.'
            : 'Onboarding is temporarily unavailable. Try again later.',
        },
        correlationId: CORRELATION_ID,
      });
      expect(deps.cancel).not.toHaveBeenCalled();
      expect(deps.listFactors).not.toHaveBeenCalled();
    },
  );

  it.each(cases.slice(0, 3))(
    'audits expired password before $action dependencies',
    async (body) => {
      const deps = dependencies({
        authenticate: vi.fn().mockResolvedValue({ ...actor, passwordAuthenticatedAt: 399 }),
      });
      const response = await createAdminOnboardingHandler(deps)(request(body));
      expect(response.status).toBe(403);
      expect(deps.recordDenied).toHaveBeenCalledExactlyOnceWith({
        actor: { ...actor, passwordAuthenticatedAt: 399 },
        eventName: 'admin_onboarding.denied',
        correlationId: CORRELATION_ID,
        reasonCode: 'recent_authentication_required',
        targetId: body.action === 'status' ? undefined : GRANT_ID,
        metadata: { currentAssuranceLevel: 'aal2' },
      });
      expect(deps.listFactors).not.toHaveBeenCalled();
      expect(deps[body.action]).not.toHaveBeenCalled();
    },
  );

  it('allows cancellation without password evidence and never inspects factors', async () => {
    const nowSeconds = vi.fn(() => 1000);
    const deps = dependencies({
      nowSeconds,
      authenticate: vi.fn().mockResolvedValue({
        ...actor,
        passwordAuthenticatedAt: null,
        authenticationMethods: ['recovery'],
      }),
    });
    expect((await createAdminOnboardingHandler(deps)(request(cases[3]))).status).toBe(200);
    expect(deps.cancel).toHaveBeenCalledTimes(1);
    expect(deps.listFactors).not.toHaveBeenCalled();
    expect(nowSeconds).not.toHaveBeenCalled();
  });

  it.each(['aal1', 'missing_totp'] as const)(
    'denies completion before factor access when %s',
    async (invalid) => {
      const evidence = {
        ...actor,
        ...(invalid === 'aal1'
          ? { assuranceLevel: 'aal1' as const }
          : { totpAuthenticatedAt: null }),
      };
      const deps = dependencies({ authenticate: vi.fn().mockResolvedValue(evidence) });
      const response = await createAdminOnboardingHandler(deps)(request(cases[2]));
      expect(response.status).toBe(403);
      expect(await payload(response)).toMatchObject({
        error: { code: 'admin_onboarding.mfa_required' },
      });
      expect(deps.recordDenied).toHaveBeenCalledExactlyOnceWith({
        actor: evidence,
        eventName: 'admin_onboarding.denied',
        correlationId: CORRELATION_ID,
        reasonCode: 'mfa_required',
        targetId: GRANT_ID,
        metadata: { currentAssuranceLevel: evidence.assuranceLevel },
      });
      expect(deps.listFactors).not.toHaveBeenCalled();
      expect(deps.complete).not.toHaveBeenCalled();
    },
  );

  it.each(['start', 'complete'] as const)(
    'records exact provider failure and audit precedence for %s',
    async (action) => {
      const deps = dependencies({
        listFactors: vi.fn().mockRejectedValue(new Error('synthetic provider failure')),
      });
      const handler = createAdminOnboardingHandler(deps);
      const body = { action, ...grantRequest };
      const response = await handler(request(body));
      expect(response.status).toBe(503);
      expect(await payload(response)).toEqual({
        error: {
          code: 'admin_onboarding.provider_unavailable',
          message: 'Authenticator state could not be confirmed. Try again.',
        },
        correlationId: CORRELATION_ID,
      });
      expect(deps.recordDenied).toHaveBeenCalledExactlyOnceWith({
        actor,
        eventName: 'admin_onboarding.conflict',
        correlationId: CORRELATION_ID,
        reasonCode: 'factor_inventory_unavailable',
        targetId: GRANT_ID,
        metadata: { currentAssuranceLevel: 'aal2' },
      });
      vi.mocked(deps.recordDenied).mockRejectedValue(new Error('synthetic audit failure'));
      const failedAudit = await handler(request(body));
      expect(failedAudit.status).toBe(500);
      expect(await payload(failedAudit)).toMatchObject({
        error: { code: 'admin_onboarding.audit_unavailable' },
      });
      expect(deps[action]).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      action: 'start',
      factors: [{ ...verifiedFactor, status: 'unverified' }],
      status: 409,
      reason: 'factor_state_conflict',
    },
    {
      action: 'start',
      factors: [verifiedFactor, verifiedFactor],
      status: 503,
      reason: 'factor_inventory_unavailable',
    },
    { action: 'complete', factors: [], status: 409, reason: 'factor_state_conflict' },
    {
      action: 'complete',
      factors: [{ ...verifiedFactor, status: 'unverified' }],
      status: 409,
      reason: 'factor_state_conflict',
    },
  ] as const)(
    'blocks $action on unsupported factor inventory',
    async ({ action, factors, status, reason }) => {
      const deps = dependencies({ listFactors: vi.fn().mockResolvedValue(factors) });
      const response = await createAdminOnboardingHandler(deps)(
        request({ action, ...grantRequest }),
      );
      expect(response.status).toBe(status);
      expect(deps.recordDenied).toHaveBeenCalledExactlyOnceWith({
        actor,
        eventName: 'admin_onboarding.conflict',
        correlationId: CORRELATION_ID,
        reasonCode: reason,
        targetId: GRANT_ID,
        metadata: { currentAssuranceLevel: 'aal2' },
      });
      expect(deps[action]).not.toHaveBeenCalled();
    },
  );

  it.each(cases)('contains asynchronous $action command failure without retry', async (body) => {
    const deps = dependencies();
    vi.mocked(deps[body.action]).mockRejectedValue(new Error('synthetic audit failure'));
    const response = await createAdminOnboardingHandler(deps)(request(body));
    expect(response.status).toBe(500);
    expect(await payload(response)).toEqual({
      error: {
        code: 'admin_onboarding.audit_unavailable',
        message: 'Onboarding could not be verified. Try again.',
      },
      correlationId: CORRELATION_ID,
    });
    expect(deps[body.action]).toHaveBeenCalledTimes(1);
    expect(deps.recordDenied).not.toHaveBeenCalled();
  });

  it.each(cases)('rejects malformed $action RPC results without exposing them', async (body) => {
    const deps = dependencies();
    vi.mocked(deps[body.action]).mockResolvedValue({
      decision: 'unexpected',
      correlationId: CORRELATION_ID,
      providerDetail: 'synthetic internal detail',
    });
    const response = await createAdminOnboardingHandler(deps)(request(body));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await payload(response))).not.toContain('synthetic internal detail');
    expect(deps[body.action]).toHaveBeenCalledTimes(1);
  });

  it.each(['not_available', 'expired', 'conflict', 'recent_authentication_required'])(
    'preserves completion decision %s',
    async (decision) => {
      const deps = dependencies({
        complete: vi.fn().mockResolvedValue({ decision, correlationId: CORRELATION_ID }),
      });
      const response = await createAdminOnboardingHandler(deps)(request(cases[2]));
      expect(response.status).toBe(
        { not_available: 404, expired: 403, conflict: 409, recent_authentication_required: 403 }[
          decision as 'not_available'
        ],
      );
      expect(deps.recordDenied).not.toHaveBeenCalled();
    },
  );

  it('preserves already-completed replay without additional commands or audit', async () => {
    const result = {
      decision: 'already_completed',
      bootstrapGrantId: GRANT_ID,
      organizationId: ORGANIZATION_ID,
      membershipId: MEMBERSHIP_ID,
      grantVersion: 2,
      correlationId: CORRELATION_ID,
    };
    const deps = dependencies({ complete: vi.fn().mockResolvedValue(result) });
    const response = await createAdminOnboardingHandler(deps)(request(cases[2]));
    expect(response.status).toBe(200);
    expect(await payload(response)).toEqual(result);
    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(deps.recordDenied).not.toHaveBeenCalled();
  });

  it('returns normalized safe grant contexts and rejects duplicate grant IDs', async () => {
    const grant = {
      bootstrapGrantId: GRANT_ID,
      organizationId: ORGANIZATION_ID,
      organizationName: '  Synthetic Flight School  ',
      grantVersion: 1,
      expiresAt: '2026-10-05T00:30:00Z',
    };
    const deps = dependencies({
      status: vi.fn().mockResolvedValue({ grants: [grant], correlationId: CORRELATION_ID }),
    });
    const handler = createAdminOnboardingHandler(deps);
    const response = await handler(request(cases[0]));
    expect(response.status).toBe(200);
    expect(await payload(response)).toEqual({
      grants: [{ ...grant, organizationName: 'Synthetic Flight School' }],
      correlationId: CORRELATION_ID,
    });
    vi.mocked(deps.status).mockResolvedValue({
      grants: [grant, grant],
      correlationId: CORRELATION_ID,
    });
    expect((await handler(request(cases[0]))).status).toBe(500);
  });

  it('captures factory callbacks while reading allowed origin per request', async () => {
    const deps = dependencies();
    const handler = createAdminOnboardingHandler(deps);
    deps.createCorrelationId = () => GRANT_ID;
    deps.nowSeconds = () => 2000;
    deps.allowedOrigin = 'https://synthetic.example.test';
    const response = await handler(request(cases[2], { origin: deps.allowedOrigin }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(deps.allowedOrigin);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await payload(response)).toMatchObject({ correlationId: CORRELATION_ID });
  });
});

describe('FEAT-003 organization admin onboarding handler', () => {
  it('rejects foreign origins before authentication or limiter work', async () => {
    const deps = dependencies();
    const response = await createAdminOnboardingHandler(deps)(
      request({ action: 'status' }, { origin: 'http://example.test' }),
    );

    expect(response.status).toBe(403);
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(deps.consumeLimit).not.toHaveBeenCalled();
  });

  it('rejects a missing origin before authentication or limiter work', async () => {
    const deps = dependencies();
    const missingOriginRequest = request({ action: 'status' });
    missingOriginRequest.headers.delete('origin');

    const response = await createAdminOnboardingHandler(deps)(missingOriginRequest);

    expect(response.status).toBe(403);
    expect(await payload(response)).toMatchObject({
      error: { code: 'admin_onboarding.origin_denied' },
    });
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(deps.consumeLimit).not.toHaveBeenCalled();
  });

  it('rejects extra client authority fields', async () => {
    const deps = dependencies();
    const response = await createAdminOnboardingHandler(deps)(
      request({ action: 'status', organizationId: ORGANIZATION_ID }),
    );

    expect(response.status).toBe(422);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it('fails status closed when the atomic limiter is unavailable', async () => {
    const deps = dependencies({
      consumeLimit: vi.fn().mockRejectedValue(new Error('database unavailable')),
    });
    const response = await createAdminOnboardingHandler(deps)(request({ action: 'status' }));

    expect(response.status).toBe(503);
    expect(await payload(response)).toMatchObject({
      error: { code: 'admin_onboarding.limiter_unavailable' },
    });
    expect(deps.status).not.toHaveBeenCalled();
  });

  it('returns bounded 429 guidance and never consumes a protected action', async () => {
    const deps = dependencies({
      consumeLimit: vi.fn().mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 15,
        correlationId: CORRELATION_ID,
        networkSourceUsed: false,
        policyVersion: 'subject-action-v1',
      }),
    });
    const response = await createAdminOnboardingHandler(deps)(
      request({
        action: 'start',
        bootstrapGrantId: GRANT_ID,
        expectedVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('15');
    expect(deps.start).not.toHaveBeenCalled();
  });

  it('fails closed when the database limiter policy does not match the Edge contract', async () => {
    const deps = dependencies({
      consumeLimit: vi.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: null,
        correlationId: CORRELATION_ID,
        networkSourceUsed: false,
        policyVersion: 'unexpected-policy',
      }),
    });

    const response = await createAdminOnboardingHandler(deps)(request({ action: 'status' }));

    expect(response.status).toBe(503);
    expect(await payload(response)).toMatchObject({
      error: { code: 'admin_onboarding.limiter_unavailable' },
    });
    expect(deps.status).not.toHaveBeenCalled();
  });

  it('requires password AMR no older than exactly 600 seconds', async () => {
    const staleActor = { ...actor, passwordAuthenticatedAt: 399 };
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue(staleActor),
    });
    const response = await createAdminOnboardingHandler(deps)(request({ action: 'status' }));

    expect(response.status).toBe(403);
    expect(deps.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'recent_authentication_required' }),
    );
    expect(deps.status).not.toHaveBeenCalled();
  });

  it('blocks a denial when mandatory audit evidence cannot be written', async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({ ...actor, passwordAuthenticatedAt: null }),
      recordDenied: vi.fn().mockRejectedValue(new Error('audit unavailable')),
    });
    const response = await createAdminOnboardingHandler(deps)(request({ action: 'status' }));

    expect(response.status).toBe(500);
    expect(await payload(response)).toMatchObject({
      error: { code: 'admin_onboarding.audit_unavailable' },
    });
  });

  it('starts only with a complete server factor inventory and hashes idempotency', async () => {
    const deps = dependencies();
    const response = await createAdminOnboardingHandler(deps)(
      request({
        action: 'start',
        bootstrapGrantId: GRANT_ID,
        expectedVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );

    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({
      factorState: 'challenge_required',
      bootstrapGrantId: GRANT_ID,
    });
    expect(deps.start).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: USER_ID,
        idempotencyKeyHash: await sha256(IDEMPOTENCY_KEY),
      }),
    );
  });

  it('rejects stale unverified or multiple factors before starting', async () => {
    const deps = dependencies({
      listFactors: vi.fn().mockResolvedValue([{ ...verifiedFactor, status: 'unverified' }]),
    });
    const response = await createAdminOnboardingHandler(deps)(
      request({
        action: 'start',
        bootstrapGrantId: GRANT_ID,
        expectedVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );

    expect(response.status).toBe(409);
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'admin_onboarding.conflict',
        reasonCode: 'factor_state_conflict',
      }),
    );
  });

  it('completes only with AAL2, TOTP AMR, and exactly one verified TOTP', async () => {
    const deps = dependencies();
    const response = await createAdminOnboardingHandler(deps)(
      request({
        action: 'complete',
        bootstrapGrantId: GRANT_ID,
        expectedVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );

    expect(response.status).toBe(200);
    expect(deps.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        verifiedTotpFactorId: FACTOR_ID,
        totalFactorCount: 1,
        actor,
      }),
    );
  });

  it('allows uncertain cancel to reach only the server cancellation command', async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({ ...actor, passwordAuthenticatedAt: null }),
    });
    const response = await createAdminOnboardingHandler(deps)(
      request({
        action: 'cancel',
        bootstrapGrantId: GRANT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );

    expect(response.status).toBe(200);
    expect(deps.cancel).toHaveBeenCalledOnce();
    expect(deps.status).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });
});

describe('streaming request-body contract', () => {
  it('preserves strict UTF-8 rejection before authentication', async () => {
    const deps = dependencies();
    const fixture = streamedRequest([new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x30, 0x7d])], {
      origin: deps.allowedOrigin,
      authorization: 'Bearer synthetic-token',
    });
    const response = await createAdminOnboardingHandler(deps)(fixture.request);
    expect(response.status).toBe(400);
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.stream.locked).toBe(false);
  });

  it.each([undefined, '1'])(
    'stops oversized input with declared length %s before protected work',
    async (declaredLength) => {
      const deps = dependencies();
      const headers = new Headers({
        origin: deps.allowedOrigin,
        authorization: 'Bearer synthetic-token',
      });
      if (declaredLength !== undefined) headers.set('content-length', declaredLength);
      const fixture = streamedRequest(
        [new Uint8Array(4096), new Uint8Array(1), new Uint8Array(10)],
        headers,
      );
      const response = await createAdminOnboardingHandler(deps)(fixture.request);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'admin_onboarding.request_too_large' },
      });
      expect(fixture.pull).toHaveBeenCalledTimes(2);
      expect(fixture.cancel).toHaveBeenCalledOnce();
      expect(fixture.stream.locked).toBe(false);
      for (const dependency of Object.values(deps)) {
        if (vi.isMockFunction(dependency)) expect(dependency).not.toHaveBeenCalled();
      }
    },
  );

  it('accepts an exactly bounded valid body through to authentication', async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockRejectedValue(new Error('Synthetic invalid credential')),
    });
    const body = '{"action":"status"}'.padEnd(4096, ' ');
    const fixture = streamedRequest([new TextEncoder().encode(body)], {
      origin: deps.allowedOrigin,
      authorization: 'Bearer synthetic-token',
    });
    const response = await createAdminOnboardingHandler(deps)(fixture.request);
    expect(response.status).toBe(401);
    expect(deps.authenticate).toHaveBeenCalledOnce();
    expect(fixture.cancel).not.toHaveBeenCalled();
    expect(fixture.stream.locked).toBe(false);
  });
});
