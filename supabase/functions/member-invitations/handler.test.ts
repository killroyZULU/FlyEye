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
