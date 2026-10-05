import { streamedRequest } from '../../../src/test/request-stream';
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

describe('member MFA handler compatibility', () => {
  const IDEMPOTENCY_DIGEST = '3eb1bd439947eb762998e566ccc2e099c791118b2f40579cc4f7da2b5061b7f9';
  const FACTOR_DIGEST = '6964221939c942adcd4ab5cbc4d35e1822f2603fd379717a1a8ee7f2434a96ee';
  const operation = { operationId: OPERATION_ID, expectedVersion: 2, idempotencyKey: KEY };
  const cases = [
    { body: { action: 'status' }, command: 'status' },
    { body: { action: 'start', idempotencyKey: KEY }, command: 'start' },
    { body: { action: 'bind_factor', ...operation, factorId: FACTOR_ID }, command: 'bindFactor' },
    { body: { action: 'complete', ...operation }, command: 'complete' },
    { body: { action: 'cancel', ...operation }, command: 'cancel' },
  ] as const;

  function configured(action: string) {
    const deps = dependencies();
    if (action === 'bind_factor')
      vi.mocked(deps.listFactors).mockResolvedValue([factor('unverified')]);
    if (action === 'cancel') {
      vi.mocked(deps.listFactors).mockResolvedValue([]);
      vi.mocked(deps.status).mockResolvedValue({
        decision: 'available',
        operationState: 'started',
        operationId: OPERATION_ID,
        operationVersion: 2,
        correlationId: CORRELATION_ID,
      });
      vi.mocked(deps.cancel).mockResolvedValue({
        decision: 'cancelled',
        cleanupOutcome: 'not_required',
        replayed: false,
        correlationId: CORRELATION_ID,
      });
    }
    return deps;
  }

  it.each(cases)(
    'preserves $body.action payloads and dependency ordering',
    async ({ body, command }) => {
      const deps = configured(body.action);
      const response = await createMemberMfaHandler(deps)(request(body));
      expect(response.status).toBe(200);
      expect(deps.authenticate).toHaveBeenCalledExactlyOnceWith('verified-token');
      expect(deps.consumeLimit).toHaveBeenCalledExactlyOnceWith({
        actorSubjectId: USER_ID,
        action: body.action,
        correlationId: CORRELATION_ID,
      });
      expect(deps.listFactors).toHaveBeenCalledExactlyOnceWith(USER_ID);
      const input: Record<string, unknown> = {
        actorUserId: USER_ID,
        correlationId: CORRELATION_ID,
        factorReferenceHash: FACTOR_DIGEST,
      };
      if (body.action !== 'status') input.idempotencyKeyHash = IDEMPOTENCY_DIGEST;
      if ('operationId' in body)
        Object.assign(input, { operationId: OPERATION_ID, expectedVersion: 2 });
      if (body.action === 'complete') {
        delete input.actorUserId;
        input.actor = actor;
      }
      if (body.action === 'cancel')
        Object.assign(input, { factorReferenceHash: null, cleanupOutcome: 'not_required' });
      expect(deps[command]).toHaveBeenCalledExactlyOnceWith(input);
      for (const [before, after] of [
        [deps.authenticate, deps.consumeLimit],
        [deps.consumeLimit, deps.listFactors],
        [deps.listFactors, deps[command]],
      ] as const) {
        expect(vi.mocked(before).mock.invocationCallOrder[0]).toBeLessThan(
          vi.mocked(after).mock.invocationCallOrder[0]!,
        );
      }
      if (body.action === 'cancel') {
        expect(deps.status).toHaveBeenCalledExactlyOnceWith({
          actorUserId: USER_ID,
          correlationId: CORRELATION_ID,
          factorReferenceHash: null,
        });
        expect(vi.mocked(deps.status).mock.invocationCallOrder[0]).toBeLessThan(
          vi.mocked(deps.cancel).mock.invocationCallOrder[0]!,
        );
      }
      expect(deps.recordDenied).not.toHaveBeenCalled();
      expect(JSON.stringify(await payload(response))).not.toContain(FACTOR_ID);
    },
  );

  it.each([
    { factors: [], state: undefined, expected: 'enrollment_required' },
    { factors: [], state: 'started', expected: 'cancellation_required' },
    { factors: [factor()], state: undefined, expected: 'challenge_required' },
    { factors: [factor()], state: 'bound', expected: 'resume_required' },
    { factors: [factor('unverified')], state: 'bound', expected: 'resume_required' },
  ])(
    'derives status $expected from the bound operation and inventory',
    async ({ factors, state, expected }) => {
      const deps = dependencies({
        listFactors: vi.fn().mockResolvedValue(factors),
        status: vi.fn().mockResolvedValue({
          decision: 'available',
          operationState: state,
          correlationId: CORRELATION_ID,
        }),
      });
      const response = await createMemberMfaHandler(deps)(request({ action: 'status' }));
      expect(response.status).toBe(200);
      expect(await payload(response)).toEqual({
        decision: 'available',
        ...(state ? { operationState: state } : {}),
        correlationId: CORRELATION_ID,
        factorState: expected,
      });
      expect(deps.status).toHaveBeenCalledWith({
        actorUserId: USER_ID,
        factorReferenceHash: factors.length ? FACTOR_DIGEST : null,
        correlationId: CORRELATION_ID,
      });
    },
  );

  it.each([
    { correlationId: OPERATION_ID },
    { networkSourceUsed: true },
    { policyVersion: 'untrusted' },
    { allowed: false, retryAfterSeconds: null },
    { allowed: false, retryAfterSeconds: 0 },
  ])('rejects invalid limiter metadata before factors %j', async (patch) => {
    const deps = dependencies({
      consumeLimit: vi.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: null,
        correlationId: CORRELATION_ID,
        networkSourceUsed: false,
        policyVersion: 'member-mfa-subject-action-v1',
        ...patch,
      }),
    });
    const response = await createMemberMfaHandler(deps)(
      request({ action: 'start', idempotencyKey: KEY }),
    );
    expect(response.status).toBe(503);
    expect(await payload(response)).toMatchObject({
      error: { code: 'member_mfa.limiter_unavailable' },
      correlationId: CORRELATION_ID,
    });
    expect(deps.listFactors).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.recordDenied).not.toHaveBeenCalled();
  });

  it('preserves rate-limit headers without an additional denial audit', async () => {
    const deps = dependencies({
      consumeLimit: vi.fn().mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 17,
        correlationId: CORRELATION_ID,
        networkSourceUsed: false,
        policyVersion: 'member-mfa-subject-action-v1',
      }),
    });
    const response = await createMemberMfaHandler(deps)(request({ action: 'status' }));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('17');
    expect(await payload(response)).toEqual({
      error: { code: 'member_mfa.rate_limited', message: 'Wait 17 seconds before trying again.' },
      correlationId: CORRELATION_ID,
    });
    expect(deps.recordDenied).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves provider failure and mandatory audit precedence (audit fails=%s)',
    async (auditFails) => {
      const deps = dependencies({
        listFactors: vi.fn().mockRejectedValue(new Error('synthetic provider failure')),
      });
      if (auditFails)
        vi.mocked(deps.recordDenied).mockRejectedValue(new Error('synthetic audit failure'));
      const response = await createMemberMfaHandler(deps)(request({ action: 'status' }));
      expect(response.status).toBe(auditFails ? 500 : 503);
      expect(await payload(response)).toMatchObject({
        error: {
          code: auditFails ? 'member_mfa.audit_unavailable' : 'member_mfa.provider_unavailable',
        },
        correlationId: CORRELATION_ID,
      });
      expect(deps.recordDenied).toHaveBeenCalledExactlyOnceWith({
        actorUserId: USER_ID,
        eventName: 'member_mfa.conflict',
        correlationId: CORRELATION_ID,
        reasonCode: 'factor_inventory_unavailable',
      });
      expect(deps.status).not.toHaveBeenCalled();
    },
  );

  it.each(cases)(
    'contains asynchronous $command failures without retry',
    async ({ body, command }) => {
      const deps = configured(body.action);
      vi.mocked(deps[command]).mockRejectedValue(new Error('synthetic database failure'));
      const response = await createMemberMfaHandler(deps)(request(body));
      expect(response.status).toBe(500);
      expect(await payload(response)).toEqual({
        error: {
          code: 'member_mfa.audit_unavailable',
          message: 'Authenticator setup could not be verified.',
        },
        correlationId: CORRELATION_ID,
      });
      expect(deps[command]).toHaveBeenCalledTimes(1);
      expect(deps.recordDenied).not.toHaveBeenCalled();
    },
  );

  it.each(['decision', 'operationState', 'operationId', 'operationVersion'])(
    'denies cancellation before mutation when preflight %s differs',
    async (field) => {
      const deps = configured('cancel');
      const differences = {
        decision: 'not_available',
        operationState: undefined,
        operationId: MEMBERSHIP_ID,
        operationVersion: 3,
      };
      vi.mocked(deps.status).mockResolvedValue({
        decision: 'available',
        operationState: 'started',
        operationId: OPERATION_ID,
        operationVersion: 2,
        correlationId: CORRELATION_ID,
        [field]: differences[field as keyof typeof differences],
      });
      const response = await createMemberMfaHandler(deps)(request(cases[4].body));
      expect(response.status).toBe(409);
      expect(deps.cancel).not.toHaveBeenCalled();
      expect(deps.recordDenied).toHaveBeenCalledExactlyOnceWith({
        actorUserId: USER_ID,
        eventName: 'member_mfa.conflict',
        correlationId: CORRELATION_ID,
        reasonCode: 'cleanup_operation_conflict',
        operationId: OPERATION_ID,
      });
    },
  );

  it('permits empty-operation cancellation without fresh password evidence', async () => {
    const deps = configured('cancel');
    vi.mocked(deps.authenticate).mockResolvedValue({
      ...actor,
      passwordAuthenticatedAt: null,
      authenticationMethods: ['recovery'],
    });
    expect((await createMemberMfaHandler(deps)(request(cases[4].body))).status).toBe(200);
    expect(deps.cancel).toHaveBeenCalledTimes(1);
  });

  it('rechecks password freshness after factor lookup before completion', async () => {
    const nowSeconds = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const deps = dependencies({ nowSeconds });
    const response = await createMemberMfaHandler(deps)(request(cases[3].body));
    expect(response.status).toBe(409);
    expect(deps.listFactors).toHaveBeenCalledTimes(1);
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'mfa_assurance_required', operationId: OPERATION_ID }),
    );
    expect(nowSeconds).toHaveBeenCalledTimes(2);
  });

  it.each(['aal1', 'missing_totp', 'unverified_factor'] as const)(
    'denies completion for %s after initial password verification',
    async (invalid) => {
      const deps = dependencies();
      if (invalid === 'aal1')
        vi.mocked(deps.authenticate).mockResolvedValue({ ...actor, assuranceLevel: 'aal1' });
      if (invalid === 'missing_totp')
        vi.mocked(deps.authenticate).mockResolvedValue({ ...actor, totpAuthenticatedAt: null });
      if (invalid === 'unverified_factor')
        vi.mocked(deps.listFactors).mockResolvedValue([factor('unverified')]);
      const response = await createMemberMfaHandler(deps)(request(cases[3].body));
      expect(response.status).toBe(409);
      expect(deps.complete).not.toHaveBeenCalled();
      expect(deps.recordDenied).toHaveBeenCalledWith(
        expect.objectContaining({
          reasonCode:
            invalid === 'unverified_factor'
              ? 'completion_factor_conflict'
              : 'mfa_assurance_required',
          operationId: OPERATION_ID,
        }),
      );
    },
  );

  it.each([false, true])(
    'rejects unbound factor identifiers with audit failure=%s',
    async (auditFails) => {
      const deps = configured('bind_factor');
      if (auditFails)
        vi.mocked(deps.recordDenied).mockRejectedValue(new Error('synthetic audit failure'));
      const response = await createMemberMfaHandler(deps)(
        request({ ...cases[2].body, factorId: MEMBERSHIP_ID }),
      );
      expect(response.status).toBe(auditFails ? 500 : 409);
      expect(deps.bindFactor).not.toHaveBeenCalled();
      expect(deps.recordDenied).toHaveBeenCalledWith(
        expect.objectContaining({
          reasonCode: 'factor_binding_conflict',
          operationId: OPERATION_ID,
        }),
      );
    },
  );

  it.each(['not_available', 'conflict', 'recent_authentication_required', 'unknown'])(
    'maps database %s decisions without a second audit',
    async (decision) => {
      const deps = dependencies({
        start: vi.fn().mockResolvedValue({ decision, correlationId: CORRELATION_ID }),
      });
      const response = await createMemberMfaHandler(deps)(request(cases[1].body));
      expect(response.status).toBe(
        (
          { not_available: 404, conflict: 409, recent_authentication_required: 403 } as Record<
            string,
            number
          >
        )[decision] ?? 500,
      );
      expect(deps.recordDenied).not.toHaveBeenCalled();
    },
  );

  it('preserves replay fields on mutation results and strict status shape', async () => {
    const result = {
      decision: 'completed',
      correlationId: CORRELATION_ID,
      replayed: true,
      readinessVersion: 4,
    };
    const deps = dependencies({
      complete: vi.fn().mockResolvedValue(result),
      status: vi.fn().mockResolvedValue({
        decision: 'available',
        correlationId: CORRELATION_ID,
        unexpected: true,
      }),
    });
    expect(await payload(await createMemberMfaHandler(deps)(request(cases[3].body)))).toEqual(
      result,
    );
    expect((await createMemberMfaHandler(deps)(request(cases[0].body))).status).toBe(500);
  });

  it('captures factory callbacks but reads origin on each request', async () => {
    const deps = dependencies();
    const handler = createMemberMfaHandler(deps);
    deps.createCorrelationId = () => MEMBERSHIP_ID;
    deps.nowSeconds = () => 2000;
    deps.allowedOrigin = 'https://synthetic.example.test';
    const response = await handler(request(cases[3].body, deps.allowedOrigin));
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(deps.allowedOrigin);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await payload(response)).toMatchObject({ correlationId: CORRELATION_ID });
  });
});

describe('FEAT-006A member MFA handler', () => {
  it.each(['otp', 'recovery', 'magiclink', 'invite', 'totp'])(
    'denies %s-only readiness reads before factor or status access',
    async (method) => {
      const deps = dependencies({
        authenticate: vi.fn().mockResolvedValue({
          ...actor,
          authenticationMethods: [method],
          passwordAuthenticatedAt: null,
        }),
      });
      const response = await createMemberMfaHandler(deps)(request({ action: 'status' }));
      expect(response.status).toBe(403);
      expect(await payload(response)).toMatchObject({
        error: { code: 'member_mfa.recent_authentication_required' },
      });
      expect(deps.recordDenied).toHaveBeenCalledWith({
        actorUserId: USER_ID,
        eventName: 'member_mfa.denied',
        correlationId: CORRELATION_ID,
        reasonCode: 'password_authentication_required',
        operationId: undefined,
      });
      expect(deps.consumeLimit).toHaveBeenCalledOnce();
      expect(deps.listFactors).not.toHaveBeenCalled();
      expect(deps.status).not.toHaveBeenCalled();
    },
  );

  it('accepts older password evidence for readiness without requiring recent authentication', async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({ ...actor, passwordAuthenticatedAt: 1 }),
    });
    const response = await createMemberMfaHandler(deps)(request({ action: 'status' }));
    expect(response.status).toBe(200);
    expect(deps.status).toHaveBeenCalledOnce();
    expect(deps.recordDenied).not.toHaveBeenCalled();
  });

  it('fails closed when password-session denial auditing fails', async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({ ...actor, passwordAuthenticatedAt: null }),
      recordDenied: vi.fn().mockRejectedValue(new Error('synthetic audit failure')),
    });
    const response = await createMemberMfaHandler(deps)(request({ action: 'status' }));
    expect(response.status).toBe(500);
    expect(await payload(response)).toMatchObject({
      error: { code: 'member_mfa.audit_unavailable' },
    });
    expect(deps.listFactors).not.toHaveBeenCalled();
    expect(deps.status).not.toHaveBeenCalled();
  });

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

describe('streaming request-body contract', () => {
  it('preserves strict UTF-8 rejection before authentication', async () => {
    const deps = dependencies();
    const fixture = streamedRequest([new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x30, 0x7d])], {
      origin: deps.allowedOrigin,
      authorization: 'Bearer synthetic-token',
    });
    const response = await createMemberMfaHandler(deps)(fixture.request);
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
      const response = await createMemberMfaHandler(deps)(fixture.request);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'member_mfa.request_too_large' },
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
    const response = await createMemberMfaHandler(deps)(fixture.request);
    expect(response.status).toBe(401);
    expect(deps.authenticate).toHaveBeenCalledOnce();
    expect(fixture.cancel).not.toHaveBeenCalled();
    expect(fixture.stream.locked).toBe(false);
  });
});
