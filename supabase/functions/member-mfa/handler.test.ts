import { describe, expect, it, vi } from 'vitest';

import type { VerifiedAuthenticationEvidence } from '../_shared/authentication-evidence.ts';
import { createMemberMfaHandler, type MemberMfaDependencies } from './handler.ts';

const ORIGIN = 'http://127.0.0.1:5173';
const USER_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000001';
const OPERATION_ID = '30000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '40000000-0000-4000-8000-000000000001';
const MEMBERSHIP_ID = '50000000-0000-4000-8000-000000000001';
const FACTOR_ID = '60000000-0000-4000-8000-000000000001';
const CORRELATION_ID = '70000000-0000-4000-8000-000000000001';
const KEY = '0123456789abcdef0123456789abcdef';

const actor: VerifiedAuthenticationEvidence = {
  actorUserId: USER_ID,
  actorSubjectId: USER_ID,
  sessionId: SESSION_ID,
  assuranceLevel: 'aal2',
  authenticationMethods: ['password', 'totp'],
  passwordAuthenticatedAt: 900,
  totpAuthenticatedAt: 950,
};

function factor(status: 'verified' | 'unverified' = 'verified') {
  return {
    id: FACTOR_ID,
    friendly_name: 'Synthetic authenticator',
    factor_type: 'totp',
    status,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
  };
}

function dependencies(overrides: Partial<MemberMfaDependencies> = {}): MemberMfaDependencies {
  return {
    allowedOrigin: ORIGIN,
    authenticate: vi.fn().mockResolvedValue(actor),
    listFactors: vi.fn().mockResolvedValue([factor()]),
    consumeLimit: vi.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: null,
      correlationId: CORRELATION_ID,
      networkSourceUsed: false,
      policyVersion: 'member-mfa-subject-action-v1',
    }),
    recordDenied: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({
      decision: 'available',
      organizationId: ORGANIZATION_ID,
      organizationName: 'Synthetic Flight School',
      membershipId: MEMBERSHIP_ID,
      ready: true,
      correlationId: CORRELATION_ID,
    }),
    start: vi.fn().mockResolvedValue({
      decision: 'ready',
      operationId: OPERATION_ID,
      organizationId: ORGANIZATION_ID,
      organizationName: 'Synthetic Flight School',
      membershipId: MEMBERSHIP_ID,
      operationVersion: 1,
      replayed: false,
      correlationId: CORRELATION_ID,
    }),
    bindFactor: vi.fn().mockResolvedValue({
      decision: 'bound',
      operationId: OPERATION_ID,
      operationVersion: 2,
      replayed: false,
      correlationId: CORRELATION_ID,
    }),
    complete: vi.fn().mockResolvedValue({
      decision: 'completed',
      organizationId: ORGANIZATION_ID,
      membershipId: MEMBERSHIP_ID,
      readinessVersion: 1,
      replayed: false,
      correlationId: CORRELATION_ID,
    }),
    cancel: vi.fn().mockResolvedValue({
      decision: 'cancelled',
      cleanupOutcome: 'unverified_removed',
      replayed: false,
      correlationId: CORRELATION_ID,
    }),
    createCorrelationId: () => CORRELATION_ID,
    nowSeconds: () => 1_000,
    ...overrides,
  };
}

function request(body: unknown, origin = ORIGIN) {
  return new Request('http://127.0.0.1:54321/functions/v1/member-mfa', {
    method: 'POST',
    headers: {
      authorization: 'Bearer verified-token',
      'content-type': 'application/json',
      origin,
    },
    body: JSON.stringify(body),
  });
}

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe('FEAT-006A member MFA handler', () => {
  it('rejects foreign origins before authentication', async () => {
    const deps = dependencies();
    const response = await createMemberMfaHandler(deps)(
      request({ action: 'status' }, 'https://example.test'),
    );
    expect(response.status).toBe(403);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it('rejects client-supplied organization authority', async () => {
    const deps = dependencies();
    const response = await createMemberMfaHandler(deps)(
      request({ action: 'start', idempotencyKey: KEY, organizationId: ORGANIZATION_ID }),
    );
    expect(response.status).toBe(422);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it('starts confirmation for exactly one verified TOTP', async () => {
    const deps = dependencies();
    const response = await createMemberMfaHandler(deps)(
      request({ action: 'start', idempotencyKey: KEY }),
    );
    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({ factorState: 'challenge_required' });
    expect(deps.start).toHaveBeenCalledOnce();
    const startInput = vi.mocked(deps.start).mock.calls[0]?.[0];
    expect(startInput?.actorUserId).toBe(USER_ID);
    expect(startInput?.factorReferenceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('requires recent password authentication before start', async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({ ...actor, passwordAuthenticatedAt: 300 }),
    });
    const response = await createMemberMfaHandler(deps)(
      request({ action: 'start', idempotencyKey: KEY }),
    );
    expect(response.status).toBe(403);
    expect(await payload(response)).toMatchObject({
      error: { code: 'member_mfa.recent_authentication_required' },
    });
    expect(deps.start).not.toHaveBeenCalled();
  });

  it('fails closed on mixed factor inventory and records a conflict', async () => {
    const deps = dependencies({
      listFactors: vi
        .fn()
        .mockResolvedValue([
          factor(),
          { ...factor(), id: '60000000-0000-4000-8000-000000000002', status: 'unverified' },
        ]),
    });
    const response = await createMemberMfaHandler(deps)(request({ action: 'status' }));
    expect(response.status).toBe(409);
    expect(deps.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'factor_state_conflict' }),
    );
    expect(deps.status).not.toHaveBeenCalled();
  });

  it('returns a resumable state only for an unverified factor proven by the database operation', async () => {
    const deps = dependencies({
      listFactors: vi.fn().mockResolvedValue([factor('unverified')]),
      status: vi.fn().mockResolvedValue({
        decision: 'available',
        organizationId: ORGANIZATION_ID,
        organizationName: 'Synthetic Flight School',
        membershipId: MEMBERSHIP_ID,
        ready: false,
        operationState: 'bound',
        operationId: OPERATION_ID,
        operationVersion: 2,
        correlationId: CORRELATION_ID,
      }),
    });

    const response = await createMemberMfaHandler(deps)(request({ action: 'status' }));

    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({
      factorState: 'resume_required',
      operationId: OPERATION_ID,
      operationVersion: 2,
    });
  });

  it('completes only with the current verified factor and server authentication evidence', async () => {
    const deps = dependencies();
    const response = await createMemberMfaHandler(deps)(
      request({
        action: 'complete',
        operationId: OPERATION_ID,
        expectedVersion: 2,
        idempotencyKey: KEY,
      }),
    );

    expect(response.status).toBe(200);
    expect(deps.complete).toHaveBeenCalledOnce();
    const completeInput = vi.mocked(deps.complete).mock.calls[0]?.[0];
    expect(completeInput?.actor).toEqual(actor);
    expect(completeInput?.operationId).toBe(OPERATION_ID);
    expect(completeInput?.expectedVersion).toBe(2);
    expect(completeInput?.factorReferenceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates no successful response when database completion rejects stale state', async () => {
    const deps = dependencies({
      complete: vi.fn().mockResolvedValue({
        decision: 'conflict',
        correlationId: CORRELATION_ID,
      }),
    });
    const response = await createMemberMfaHandler(deps)(
      request({
        action: 'complete',
        operationId: OPERATION_ID,
        expectedVersion: 1,
        idempotencyKey: KEY,
      }),
    );

    expect(response.status).toBe(409);
    expect(await payload(response)).toMatchObject({
      error: { code: 'member_mfa.state_conflict' },
    });
  });

  it('fails closed before inventory or database access when rate limited', async () => {
    const deps = dependencies({
      consumeLimit: vi.fn().mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 30,
        correlationId: CORRELATION_ID,
        networkSourceUsed: false,
        policyVersion: 'member-mfa-subject-action-v1',
      }),
    });
    const response = await createMemberMfaHandler(deps)(request({ action: 'status' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(deps.listFactors).not.toHaveBeenCalled();
    expect(deps.status).not.toHaveBeenCalled();
  });

  it('retains a bound factor and operation for safe resume instead of deleting it', async () => {
    const deps = dependencies({
      listFactors: vi.fn().mockResolvedValue([factor('unverified')]),
      status: vi.fn().mockResolvedValue({
        decision: 'available',
        organizationId: ORGANIZATION_ID,
        organizationName: 'Synthetic Flight School',
        membershipId: MEMBERSHIP_ID,
        ready: false,
        operationState: 'bound',
        operationId: OPERATION_ID,
        operationVersion: 2,
        correlationId: CORRELATION_ID,
      }),
    });
    const response = await createMemberMfaHandler(deps)(
      request({
        action: 'cancel',
        operationId: OPERATION_ID,
        expectedVersion: 2,
        factorId: FACTOR_ID,
        idempotencyKey: KEY,
      }),
    );
    expect(response.status).toBe(409);
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(deps.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'factor_retained_for_safe_resume' }),
    );
  });

  it('does not cancel when an unverified factor is bound', async () => {
    const deps = dependencies({
      listFactors: vi.fn().mockResolvedValue([factor('unverified')]),
      status: vi.fn().mockResolvedValue({
        decision: 'available',
        organizationId: ORGANIZATION_ID,
        organizationName: 'Synthetic Flight School',
        membershipId: MEMBERSHIP_ID,
        ready: false,
        operationState: 'bound',
        operationId: OPERATION_ID,
        operationVersion: 2,
        correlationId: CORRELATION_ID,
      }),
    });
    const response = await createMemberMfaHandler(deps)(
      request({
        action: 'cancel',
        operationId: OPERATION_ID,
        expectedVersion: 2,
        factorId: FACTOR_ID,
        idempotencyKey: KEY,
      }),
    );
    expect(response.status).toBe(409);
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it('does not remove a factor when the database cannot prove the requested operation', async () => {
    const deps = dependencies({
      listFactors: vi.fn().mockResolvedValue([factor('unverified')]),
      status: vi.fn().mockResolvedValue({
        decision: 'available',
        organizationId: ORGANIZATION_ID,
        organizationName: 'Synthetic Flight School',
        membershipId: MEMBERSHIP_ID,
        ready: false,
        operationState: 'bound',
        operationId: '30000000-0000-4000-8000-000000000002',
        operationVersion: 2,
        correlationId: CORRELATION_ID,
      }),
    });
    const response = await createMemberMfaHandler(deps)(
      request({
        action: 'cancel',
        operationId: OPERATION_ID,
        expectedVersion: 2,
        factorId: FACTOR_ID,
        idempotencyKey: KEY,
      }),
    );

    expect(response.status).toBe(409);
    expect(deps.cancel).not.toHaveBeenCalled();
  });
});
