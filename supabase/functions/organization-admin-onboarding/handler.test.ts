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
