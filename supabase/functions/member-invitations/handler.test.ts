import { streamedRequest } from '../../../src/test/request-stream';
import { describe, expect, it, vi } from 'vitest';

import { createMemberInvitationsHandler, type MemberInvitationDependencies } from './handler.ts';

const ORIGIN = 'http://127.0.0.1:5173';
const USER_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const INVITATION_ID = '40000000-0000-4000-8000-000000000001';
const MEMBERSHIP_ID = '50000000-0000-4000-8000-000000000001';
const CORRELATION_ID = '60000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = '0123456789abcdef0123456789abcdef';

const actor = {
  actorUserId: USER_ID,
  actorSubjectId: USER_ID,
  sessionId: SESSION_ID,
  assuranceLevel: 'aal2' as const,
  authenticationMethods: ['password', 'totp'],
  passwordAuthenticatedAt: 900,
  totpAuthenticatedAt: 950,
  confirmedEmail: 'student@example.test',
};

function dependencies(
  overrides: Partial<MemberInvitationDependencies> = {},
): MemberInvitationDependencies {
  return {
    allowedOrigin: ORIGIN,
    authenticate: vi.fn().mockResolvedValue(actor),
    resolveLimitScope: vi
      .fn()
      .mockImplementation(({ organizationId, invitationId }) =>
        Promise.resolve(invitationId ?? organizationId),
      ),
    consumeLimit: vi.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: null,
      correlationId: CORRELATION_ID,
      networkSourceUsed: false,
      policyVersion: 'invitation-subject-scope-v1',
    }),
    recordDenied: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({
      decision: 'listed',
      organizationId: ORGANIZATION_ID,
      invitations: [],
      roles: [
        { code: 'student_pilot', label: 'Student Pilot' },
        { code: 'instructor_pilot', label: 'Instructor Pilot' },
        { code: 'admin', label: 'Organization Admin' },
      ],
      correlationId: CORRELATION_ID,
    }),
    beginCreate: vi.fn().mockResolvedValue({
      decision: 'issuing',
      invitationId: INVITATION_ID,
      email: 'student@example.test',
      version: 1,
      expiresAt: '2026-08-09T01:00:00Z',
      replayed: false,
      correlationId: CORRELATION_ID,
    }),
    beginResend: vi.fn().mockResolvedValue({
      decision: 'issuing',
      invitationId: INVITATION_ID,
      email: 'student@example.test',
      version: 1,
      expiresAt: '2026-08-09T01:00:00Z',
      replayed: false,
      correlationId: CORRELATION_ID,
    }),
    finalizeDelivery: vi.fn().mockResolvedValue({
      decision: 'pending',
      invitationId: INVITATION_ID,
      version: 2,
      replayed: false,
      correlationId: CORRELATION_ID,
    }),
    send: vi.fn().mockResolvedValue({
      outcome: 'accepted',
      operationClass: 'new_identity_invite',
    }),
    revoke: vi.fn().mockResolvedValue({
      decision: 'revoked',
      invitationId: INVITATION_ID,
      version: 3,
      correlationId: CORRELATION_ID,
    }),
    prepare: vi.fn().mockResolvedValue({
      decision: 'prepared',
      invitationId: INVITATION_ID,
      credentialMode: 'new',
      version: 2,
      correlationId: CORRELATION_ID,
    }),
    accept: vi.fn().mockResolvedValue({
      decision: 'accepted',
      invitationId: INVITATION_ID,
      organizationId: ORGANIZATION_ID,
      membershipId: MEMBERSHIP_ID,
      version: 3,
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
  if (options.token !== '') headers.set('authorization', `Bearer ${options.token ?? 'verified'}`);
  return new Request('http://127.0.0.1:55321/functions/v1/member-invitations', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('FEAT-004 member invitation handler', () => {
  it('rejects a foreign origin before authentication', async () => {
    const deps = dependencies();
    const response = await createMemberInvitationsHandler(deps)(
      request(
        { action: 'list', organizationId: ORGANIZATION_ID },
        { origin: 'https://example.test' },
      ),
    );
    expect(response.status).toBe(403);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it('rejects client-supplied authority fields', async () => {
    const deps = dependencies();
    const response = await createMemberInvitationsHandler(deps)(
      request({
        action: 'create',
        organizationId: ORGANIZATION_ID,
        email: 'student@example.test',
        roleCode: 'student_pilot',
        idempotencyKey: IDEMPOTENCY_KEY,
        actorUserId: USER_ID,
      }),
    );
    expect(response.status).toBe(422);
    expect(deps.beginCreate).not.toHaveBeenCalled();
  });

  it('requires a verified token', async () => {
    const response = await createMemberInvitationsHandler(dependencies())(
      request({ action: 'list', organizationId: ORGANIZATION_ID }, { token: '' }),
    );
    expect(response.status).toBe(401);
  });

  it('requires password-authenticated AAL2 for listing', async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({ ...actor, assuranceLevel: 'aal1' }),
    });
    const response = await createMemberInvitationsHandler(deps)(
      request({ action: 'list', organizationId: ORGANIZATION_ID }),
    );
    expect(response.status).toBe(403);
    expect(deps.list).not.toHaveBeenCalled();
  });

  it('returns only the protected list contract', async () => {
    const response = await createMemberInvitationsHandler(dependencies())(
      request({ action: 'list', organizationId: ORGANIZATION_ID }),
    );
    expect(response.status).toBe(200);
    expect(await responsePayload(response)).toMatchObject({
      decision: 'listed',
      organizationId: ORGANIZATION_ID,
    });
  });

  it('obtains the credential path from protected invitation state before password setup', async () => {
    const prepare = vi.fn().mockResolvedValue({
      decision: 'prepared',
      invitationId: INVITATION_ID,
      credentialMode: 'existing',
      version: 2,
      correlationId: CORRELATION_ID,
    });
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({
        ...actor,
        assuranceLevel: 'aal1',
        authenticationMethods: ['otp'],
        passwordAuthenticatedAt: null,
      }),
      prepare,
    });

    const response = await createMemberInvitationsHandler(deps)(
      request({ action: 'prepare', invitationId: INVITATION_ID, expectedVersion: 2 }),
    );

    expect(response.status).toBe(200);
    expect(await responsePayload(response)).toMatchObject({
      decision: 'prepared',
      credentialMode: 'existing',
    });
    expect(prepare).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      confirmedEmail: 'student@example.test',
      invitationId: INVITATION_ID,
      expectedVersion: 2,
      correlationId: CORRELATION_ID,
    });
  });

  it('records intent, sends once, and finalizes a provider-accepted create', async () => {
    const deps = dependencies();
    const response = await createMemberInvitationsHandler(deps)(
      request({
        action: 'create',
        organizationId: ORGANIZATION_ID,
        email: 'student@example.test',
        roleCode: 'student_pilot',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );
    expect(response.status).toBe(200);
    expect(deps.beginCreate).toHaveBeenCalledBefore(deps.send as ReturnType<typeof vi.fn>);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.finalizeDelivery).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a provider call for a replayed issuing result', async () => {
    const deps = dependencies({
      beginCreate: vi.fn().mockResolvedValue({
        decision: 'issuing',
        invitationId: INVITATION_ID,
        email: 'student@example.test',
        version: 1,
        expiresAt: '2026-08-09T01:00:00Z',
        replayed: true,
        correlationId: CORRELATION_ID,
      }),
    });
    const response = await createMemberInvitationsHandler(deps)(
      request({
        action: 'create',
        organizationId: ORGANIZATION_ID,
        email: 'student@example.test',
        roleCode: 'student_pilot',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );
    expect(response.status).toBe(503);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('returns stable pending state without another provider call after a lost response', async () => {
    const deps = dependencies({
      beginCreate: vi.fn().mockResolvedValue({
        decision: 'pending',
        invitationId: INVITATION_ID,
        email: 'student@example.test',
        version: 2,
        expiresAt: '2026-08-09T01:00:00Z',
        replayed: true,
        correlationId: CORRELATION_ID,
      }),
    });
    const response = await createMemberInvitationsHandler(deps)(
      request({
        action: 'create',
        organizationId: ORGANIZATION_ID,
        email: 'student@example.test',
        roleCode: 'student_pilot',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );
    expect(response.status).toBe(200);
    expect(await responsePayload(response)).toMatchObject({
      decision: 'pending',
      invitationId: INVITATION_ID,
      version: 2,
      replayed: true,
    });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('reports a known delivery failure without pending authority', async () => {
    const deps = dependencies({
      send: vi.fn().mockResolvedValue({ outcome: 'failed', operationClass: 'new_identity_invite' }),
      finalizeDelivery: vi.fn().mockResolvedValue({
        decision: 'delivery_failed',
        invitationId: INVITATION_ID,
        version: 2,
        replayed: false,
        correlationId: CORRELATION_ID,
      }),
    });
    const response = await createMemberInvitationsHandler(deps)(
      request({
        action: 'create',
        organizationId: ORGANIZATION_ID,
        email: 'student@example.test',
        roleCode: 'student_pilot',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );
    expect(response.status).toBe(502);
    expect(await responsePayload(response)).toMatchObject({
      error: { code: 'member_invitation.delivery_failed' },
    });
  });

  it('requires a fresh password before acceptance', async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({ ...actor, passwordAuthenticatedAt: 1 }),
    });
    const response = await createMemberInvitationsHandler(deps)(
      request({
        action: 'accept',
        invitationId: INVITATION_ID,
        expectedVersion: 2,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );
    expect(response.status).toBe(403);
    expect(deps.accept).not.toHaveBeenCalled();
  });

  it('accepts only with the verified confirmed recipient email', async () => {
    const deps = dependencies();
    const response = await createMemberInvitationsHandler(deps)(
      request({
        action: 'accept',
        invitationId: INVITATION_ID,
        expectedVersion: 2,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );
    expect(response.status).toBe(200);
    expect(deps.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmedEmail: 'student@example.test',
        invitationId: INVITATION_ID,
      }),
    );
  });

  it('fails closed when the limiter is unavailable', async () => {
    const response = await createMemberInvitationsHandler(
      dependencies({
        consumeLimit: vi.fn().mockRejectedValue(new Error('unavailable')),
      }),
    )(request({ action: 'list', organizationId: ORGANIZATION_ID }));
    expect(response.status).toBe(503);
    expect(await responsePayload(response)).toMatchObject({
      error: { code: 'member_invitation.limiter_unavailable' },
    });
  });

  it('uses the server-resolved invitation scope for resend limiting', async () => {
    const consumeLimit = vi.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: null,
      correlationId: CORRELATION_ID,
      networkSourceUsed: false,
      policyVersion: 'invitation-subject-scope-v1',
    });
    const response = await createMemberInvitationsHandler(dependencies({ consumeLimit }))(
      request({
        action: 'resend',
        organizationId: ORGANIZATION_ID,
        invitationId: INVITATION_ID,
        expectedVersion: 2,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );

    expect(response.status).toBe(200);
    expect(consumeLimit).toHaveBeenCalledWith({
      actorSubjectId: USER_ID,
      action: 'resend',
      scopeId: INVITATION_ID,
      correlationId: CORRELATION_ID,
    });
  });
});

describe('streaming request-body contract', () => {
  it('preserves strict UTF-8 rejection before authentication', async () => {
    const deps = dependencies();
    const fixture = streamedRequest([new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x30, 0x7d])], {
      origin: deps.allowedOrigin,
      authorization: 'Bearer synthetic-token',
    });
    const response = await createMemberInvitationsHandler(deps)(fixture.request);
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
        [new Uint8Array(8192), new Uint8Array(1), new Uint8Array(10)],
        headers,
      );
      const response = await createMemberInvitationsHandler(deps)(fixture.request);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'member_invitation.request_too_large' },
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
    const body = '{"action":"list","organizationId":"10000000-0000-4000-8000-000000000001"}'.padEnd(
      8192,
      ' ',
    );
    const fixture = streamedRequest([new TextEncoder().encode(body)], {
      origin: deps.allowedOrigin,
      authorization: 'Bearer synthetic-token',
    });
    const response = await createMemberInvitationsHandler(deps)(fixture.request);
    expect(response.status).toBe(401);
    expect(deps.authenticate).toHaveBeenCalledOnce();
    expect(fixture.cancel).not.toHaveBeenCalled();
    expect(fixture.stream.locked).toBe(false);
  });
});

const ACTIONS = ['list', 'create', 'resend', 'revoke', 'prepare', 'accept'] as const;
const IDEMPOTENCY_DIGEST = '3eb1bd439947eb762998e566ccc2e099c791118b2f40579cc4f7da2b5061b7f9';
const OPERATION_ID = '60000000-0000-4000-8000-000000000002';
function actionBody(action: (typeof ACTIONS)[number]) {
  if (action === 'list') return { action, organizationId: ORGANIZATION_ID };
  if (action === 'create')
    return {
      action,
      organizationId: ORGANIZATION_ID,
      email: actor.confirmedEmail,
      roleCode: 'student_pilot',
      idempotencyKey: IDEMPOTENCY_KEY,
    };
  return {
    action,
    invitationId: INVITATION_ID,
    expectedVersion: 2,
    ...(action === 'resend' || action === 'revoke' ? { organizationId: ORGANIZATION_ID } : {}),
    ...(action === 'prepare' ? {} : { idempotencyKey: IDEMPOTENCY_KEY }),
  };
}
function commandFor(deps: MemberInvitationDependencies, action: (typeof ACTIONS)[number]) {
  return action === 'create'
    ? deps.beginCreate
    : action === 'resend'
      ? deps.beginResend
      : deps[action];
}
function expectNoCommands(deps: MemberInvitationDependencies) {
  for (const action of ACTIONS) expect(commandFor(deps, action)).not.toHaveBeenCalled();
  expect(deps.send).not.toHaveBeenCalled();
  expect(deps.finalizeDelivery).not.toHaveBeenCalled();
}

describe('member invitation extraction compatibility', () => {
  it.each([
    ['OPTIONS', 'https://foreign.test', undefined, 403, 'origin_denied'],
    ['OPTIONS', ORIGIN, undefined, 204, undefined],
    ['GET', ORIGIN, undefined, 405, 'method_not_allowed'],
    ['POST', ORIGIN, '{', 400, 'invalid_request'],
    ['POST', ORIGIN, '[]', 422, 'invalid_request'],
    ['POST', ORIGIN, 'x'.repeat(8193), 413, 'request_too_large'],
  ] as const)(
    'preserves HTTP ordering and headers for %s / %s / %s',
    async (method, origin, body, status, code) => {
      const deps = dependencies({ createCorrelationId: vi.fn(() => CORRELATION_ID) });
      const response = await createMemberInvitationsHandler(deps)(
        new Request('https://functions.test/member-invitations', {
          method,
          headers: { origin, authorization: 'Bearer verified' },
          body,
        }),
      );
      expect(response.status).toBe(status);
      expect(Object.fromEntries(response.headers)).toEqual({
        'access-control-allow-origin': ORIGIN,
        'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
        'access-control-allow-methods': 'POST, OPTIONS',
        'cache-control': 'no-store',
        'content-type': 'application/json',
        vary: 'Origin',
      });
      if (status === 204) expect(await response.text()).toBe('');
      else
        expect(await responsePayload(response)).toMatchObject({
          error: { code: `member_invitation.${code}` },
        });
      for (const dependency of Object.values(deps))
        if (vi.isMockFunction(dependency)) expect(dependency).not.toHaveBeenCalled();
    },
  );

  it.each(ACTIONS)('preserves %s server scope, payload, and dependency order', async (action) => {
    const deps = dependencies({
      resolveLimitScope: vi.fn().mockResolvedValue('server-denial-scope'),
    });
    const response = await createMemberInvitationsHandler(deps)(request(actionBody(action)));
    expect(response.status).toBe(200);
    expect(deps.resolveLimitScope).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      action,
      organizationId: ['list', 'create', 'resend', 'revoke'].includes(action)
        ? ORGANIZATION_ID
        : null,
      invitationId: ['list', 'create'].includes(action) ? null : INVITATION_ID,
      confirmedEmail: actor.confirmedEmail,
    });
    expect(deps.consumeLimit).toHaveBeenCalledExactlyOnceWith({
      actorSubjectId: USER_ID,
      action,
      scopeId: 'server-denial-scope',
      correlationId: CORRELATION_ID,
    });
    expect(deps.authenticate).toHaveBeenCalledBefore(
      deps.resolveLimitScope as ReturnType<typeof vi.fn>,
    );
    expect(deps.resolveLimitScope).toHaveBeenCalledBefore(
      deps.consumeLimit as ReturnType<typeof vi.fn>,
    );
    expect(deps.consumeLimit).toHaveBeenCalledBefore(
      commandFor(deps, action) as ReturnType<typeof vi.fn>,
    );
    const input = { ...actionBody(action) };
    const { action: _action, ...fields } = input;
    void _action;
    const expected: Record<string, unknown> = { ...fields, correlationId: CORRELATION_ID };
    if ('idempotencyKey' in expected) {
      delete expected.idempotencyKey;
      expected.idempotencyKeyHash = IDEMPOTENCY_DIGEST;
    }
    if (action === 'accept') expected.actor = actor;
    else expected.actorUserId = USER_ID;
    if (action === 'prepare' || action === 'accept') expected.confirmedEmail = actor.confirmedEmail;
    expect(commandFor(deps, action)).toHaveBeenCalledExactlyOnceWith(expected);
    expect(deps.recordDenied).not.toHaveBeenCalled();
  });

  it.each([
    'scope failure',
    'limiter failure',
    'correlation',
    'network',
    'policy',
    'null retry',
    'zero retry',
    'long retry',
    'throttled',
  ])('fails closed before freshness and commands on %s', async (mode) => {
    const limit = {
      allowed: false,
      retryAfterSeconds: 30,
      correlationId: CORRELATION_ID,
      networkSourceUsed: false,
      policyVersion: 'invitation-subject-scope-v1',
    };
    const result = {
      ...limit,
      ...(mode === 'correlation' ? { correlationId: OPERATION_ID } : {}),
      ...(mode === 'network' ? { networkSourceUsed: true } : {}),
      ...(mode === 'policy' ? { policyVersion: 'untrusted' } : {}),
      ...(mode === 'null retry' ? { retryAfterSeconds: null } : {}),
      ...(mode === 'zero retry' ? { retryAfterSeconds: 0 } : {}),
      ...(mode === 'long retry' ? { retryAfterSeconds: 3601 } : {}),
    };
    const deps = dependencies({
      authenticate: vi
        .fn()
        .mockResolvedValue({ ...actor, assuranceLevel: 'aal1', passwordAuthenticatedAt: null }),
      resolveLimitScope:
        mode === 'scope failure'
          ? vi.fn().mockRejectedValue(new Error('Private scope'))
          : vi.fn().mockResolvedValue('safe-scope'),
      consumeLimit:
        mode === 'limiter failure'
          ? vi.fn().mockRejectedValue(new Error('Private limiter'))
          : vi.fn().mockResolvedValue(result),
      nowSeconds: vi.fn(() => 1000),
    });
    const response = await createMemberInvitationsHandler(deps)(request(actionBody('create')));
    expect(response.status).toBe(mode === 'throttled' ? 429 : 503);
    expect(response.headers.get('retry-after')).toBe(mode === 'throttled' ? '30' : null);
    expect(await responsePayload(response)).toEqual({
      error: {
        code:
          mode === 'throttled'
            ? 'member_invitation.rate_limited'
            : 'member_invitation.limiter_unavailable',
        message:
          mode === 'throttled'
            ? 'Wait 30 seconds before trying again.'
            : 'Invitations are temporarily unavailable.',
      },
      correlationId: CORRELATION_ID,
    });
    if (mode === 'scope failure') expect(deps.consumeLimit).not.toHaveBeenCalled();
    expect(deps.nowSeconds).not.toHaveBeenCalled();
    expect(deps.recordDenied).not.toHaveBeenCalled();
    expectNoCommands(deps);
  });

  it.each([false, true])(
    'awaits denial audit and preserves assurance precedence (audit fails: %s)',
    async (auditFails) => {
      let finish!: () => void;
      const audit = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const deps = dependencies({
        authenticate: vi
          .fn()
          .mockResolvedValue({ ...actor, assuranceLevel: 'aal1', passwordAuthenticatedAt: null }),
        recordDenied: vi.fn(async () => {
          await audit;
          if (auditFails) throw new Error('Private audit');
        }),
      });
      let responded = false;
      const pending = createMemberInvitationsHandler(deps)(request(actionBody('create'))).then(
        (response) => {
          responded = true;
          return response;
        },
      );
      await vi.waitFor(() => expect(deps.recordDenied).toHaveBeenCalledOnce());
      expect(responded).toBe(false);
      expect(deps.recordDenied).toHaveBeenCalledExactlyOnceWith({
        actorUserId: USER_ID,
        eventName: 'member_invitation.denied',
        reasonCode: 'authentication_assurance_required',
        correlationId: CORRELATION_ID,
      });
      finish();
      const response = await pending;
      expect(response.status).toBe(auditFails ? 503 : 403);
      expect(await responsePayload(response)).toMatchObject({
        error: {
          code: auditFails
            ? 'member_invitation.audit_unavailable'
            : 'member_invitation.recent_authentication_required',
        },
        correlationId: CORRELATION_ID,
      });
      expectNoCommands(deps);
    },
  );

  it.each(['create', 'resend'] as const)(
    'retries %s finalization with the identical operation without resending',
    async (action) => {
      const finalize = vi.fn().mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue({
        decision: 'pending',
        invitationId: INVITATION_ID,
        version: 2,
        correlationId: CORRELATION_ID,
      });
      const deps = dependencies({
        finalizeDelivery: finalize,
        createCorrelationId: vi
          .fn()
          .mockReturnValueOnce(CORRELATION_ID)
          .mockReturnValueOnce(OPERATION_ID),
      });
      const response = await createMemberInvitationsHandler(deps)(request(actionBody(action)));
      expect(response.status).toBe(200);
      expect(deps.send).toHaveBeenCalledExactlyOnceWith({
        invitationId: INVITATION_ID,
        invitationVersion: 1,
        email: actor.confirmedEmail,
      });
      expect(commandFor(deps, action)).toHaveBeenCalledBefore(
        deps.send as ReturnType<typeof vi.fn>,
      );
      expect(deps.send).toHaveBeenCalledBefore(finalize);
      expect(finalize).toHaveBeenCalledTimes(2);
      expect(finalize.mock.calls[0]?.[0]).toEqual({
        actorUserId: USER_ID,
        invitationId: INVITATION_ID,
        deliveryOperationId: OPERATION_ID,
        delivery: { outcome: 'accepted', operationClass: 'new_identity_invite' },
        correlationId: CORRELATION_ID,
      });
      expect(finalize.mock.calls[1]?.[0]).toBe(finalize.mock.calls[0]?.[0]);
      expect(deps.createCorrelationId).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['send throws', 'finalize twice fails', 'invalid finalization'])(
    'preserves safe delivery uncertainty when %s',
    async (mode) => {
      const finalize =
        mode === 'finalize twice fails'
          ? vi.fn().mockRejectedValue(new Error('Private finalize'))
          : vi
              .fn()
              .mockResolvedValue(
                mode === 'invalid finalization'
                  ? { private: 'payload' }
                  : { decision: 'delivery_uncertain', correlationId: CORRELATION_ID },
              );
      const deps = dependencies({
        finalizeDelivery: finalize,
        ...(mode === 'send throws'
          ? { send: vi.fn().mockRejectedValue(new Error('Private send')) }
          : {}),
      });
      const response = await createMemberInvitationsHandler(deps)(request(actionBody('create')));
      expect(response.status).toBe(503);
      expect(await responsePayload(response)).toEqual({
        error: {
          code: 'member_invitation.delivery_uncertain',
          message: 'The delivery result could not be confirmed. Wait before retrying.',
        },
        correlationId: CORRELATION_ID,
      });
      expect(deps.send).toHaveBeenCalledOnce();
      expect(finalize).toHaveBeenCalledTimes(mode === 'finalize twice fails' ? 2 : 1);
      if (mode === 'send throws')
        expect(finalize).toHaveBeenCalledWith(
          expect.objectContaining({
            delivery: { outcome: 'uncertain', operationClass: 'new_identity_invite' },
          }),
        );
    },
  );

  it.each(['prepare', 'accept'] as const)(
    'preserves %s confirmed-email denial and audit failure precedence',
    async (action) => {
      for (const auditFails of [false, true]) {
        const deps = dependencies({
          authenticate: vi.fn().mockResolvedValue({ ...actor, confirmedEmail: null }),
          recordDenied: auditFails
            ? vi.fn().mockRejectedValue(new Error('Private audit'))
            : vi.fn().mockResolvedValue(undefined),
        });
        const response = await createMemberInvitationsHandler(deps)(request(actionBody(action)));
        expect(response.status).toBe(auditFails ? 503 : 404);
        expect(await responsePayload(response)).toMatchObject({
          error: {
            code: auditFails
              ? 'member_invitation.audit_unavailable'
              : 'member_invitation.not_available',
          },
          correlationId: CORRELATION_ID,
        });
        expect(deps.recordDenied).toHaveBeenCalledExactlyOnceWith({
          actorUserId: USER_ID,
          eventName: 'member_invitation.denied',
          reasonCode: 'confirmed_email_required',
          correlationId: CORRELATION_ID,
        });
        expectNoCommands(deps);
      }
    },
  );

  it.each(ACTIONS)(
    'preserves %s backend failure and malformed result boundaries',
    async (action) => {
      for (const throws of [false, true]) {
        const command = throws
          ? vi.fn().mockRejectedValue(new Error('Private RPC'))
          : vi.fn().mockResolvedValue({ private: 'payload' });
        const name =
          action === 'create' ? 'beginCreate' : action === 'resend' ? 'beginResend' : action;
        const deps = dependencies({ [name]: command });
        const response = await createMemberInvitationsHandler(deps)(request(actionBody(action)));
        const code = throws
          ? 'audit_unavailable'
          : action === 'list' || action === 'prepare'
            ? 'not_available'
            : 'conflict';
        expect(response.status).toBe(throws ? 503 : code === 'not_available' ? 404 : 409);
        expect(await responsePayload(response)).toMatchObject({
          error: { code: `member_invitation.${code}` },
          correlationId: CORRELATION_ID,
        });
        expect(deps.send).not.toHaveBeenCalled();
        expect(deps.finalizeDelivery).not.toHaveBeenCalled();
      }
    },
  );
});
