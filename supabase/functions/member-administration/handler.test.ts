import { describe, expect, it, vi } from 'vitest';

import {
  createMemberAdministrationHandler,
  type MemberAdministrationDependencies,
} from './handler.ts';

const ORIGIN = 'http://127.0.0.1:5173';
const USER_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const MEMBERSHIP_ID = '40000000-0000-4000-8000-000000000001';
const CORRELATION_ID = '50000000-0000-4000-8000-000000000001';
const IDEMPOTENCY_KEY = '0123456789abcdef0123456789abcdef';

const actor = {
  actorUserId: USER_ID,
  actorSubjectId: USER_ID,
  sessionId: SESSION_ID,
  assuranceLevel: 'aal2' as const,
  authenticationMethods: ['password', 'totp'],
  passwordAuthenticatedAt: 900,
  totpAuthenticatedAt: 950,
};

const summary = {
  membershipId: MEMBERSHIP_ID,
  displayName: 'Synthetic Member',
  email: 'member@example.test',
  roleCode: 'student_pilot',
  roleLabel: 'Student Pilot',
  status: 'active' as const,
  membershipVersion: 1,
  profileVersion: 1,
  profileComplete: true,
  createdAt: '2026-08-11T00:00:00Z',
};

const profile = {
  organizationId: ORGANIZATION_ID,
  organizationName: 'Synthetic Flight School',
  membershipId: MEMBERSHIP_ID,
  displayName: 'Synthetic Member',
  contactNumber: null,
  email: 'member@example.test',
  roleCode: 'student_pilot',
  roleLabel: 'Student Pilot',
  status: 'active' as const,
  version: 1,
  complete: true,
};

function dependencies(
  overrides: Partial<MemberAdministrationDependencies> = {},
): MemberAdministrationDependencies {
  return {
    allowedOrigin: ORIGIN,
    authenticate: vi.fn().mockResolvedValue(actor),
    resolveLimitScope: vi.fn().mockResolvedValue(ORGANIZATION_ID),
    resolveProfileAssurance: vi.fn().mockResolvedValue('aal1'),
    consumeLimit: vi.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: null,
      correlationId: CORRELATION_ID,
      networkSourceUsed: false,
      policyVersion: 'member-administration-subject-scope-v1',
    }),
    recordDenied: vi.fn().mockResolvedValue(undefined),
    decodeCursor: vi.fn().mockResolvedValue({
      createdAt: '2026-08-10T00:00:00Z',
      membershipId: MEMBERSHIP_ID,
    }),
    encodeCursor: vi.fn().mockResolvedValue('signed-cursor'.padEnd(32, '0')),
    list: vi.fn().mockResolvedValue({
      decision: 'listed',
      organizationId: ORGANIZATION_ID,
      members: [summary],
      hasMore: false,
      correlationId: CORRELATION_ID,
    }),
    detail: vi.fn().mockResolvedValue({
      decision: 'found',
      organizationId: ORGANIZATION_ID,
      member: { ...summary, contactNumber: null, updatedAt: '2026-08-11T00:00:00Z' },
      correlationId: CORRELATION_ID,
    }),
    getProfile: vi.fn().mockResolvedValue({
      decision: 'found',
      profile,
      correlationId: CORRELATION_ID,
    }),
    updateProfile: vi.fn().mockResolvedValue({
      decision: 'updated',
      profile: { ...profile, version: 2 },
      correlationId: CORRELATION_ID,
    }),
    changeStatus: vi.fn().mockResolvedValue({
      decision: 'suspended',
      organizationId: ORGANIZATION_ID,
      membershipId: MEMBERSHIP_ID,
      status: 'suspended',
      roleCode: 'student_pilot',
      roleLabel: 'Student Pilot',
      version: 2,
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
  return new Request('http://127.0.0.1:55321/functions/v1/member-administration', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe('FEAT-005 member administration handler', () => {
  it('rejects a foreign origin before authentication', async () => {
    const deps = dependencies();
    const response = await createMemberAdministrationHandler(deps)(
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
    const response = await createMemberAdministrationHandler(deps)(
      request({ action: 'list', organizationId: ORGANIZATION_ID, actorUserId: USER_ID }),
    );
    expect(response.status).toBe(422);
    expect(deps.list).not.toHaveBeenCalled();
  });

  it('requires AAL2 with TOTP for the member directory', async () => {
    const deps = dependencies({
      authenticate: vi
        .fn()
        .mockResolvedValue({ ...actor, assuranceLevel: 'aal1', totpAuthenticatedAt: null }),
    });
    const response = await createMemberAdministrationHandler(deps)(
      request({ action: 'list', organizationId: ORGANIZATION_ID }),
    );
    expect(response.status).toBe(403);
    expect(deps.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'authentication_assurance_required' }),
    );
    expect(deps.list).not.toHaveBeenCalled();
  });

  it('returns a bounded protected member list', async () => {
    const response = await createMemberAdministrationHandler(dependencies())(
      request({ action: 'list', organizationId: ORGANIZATION_ID }),
    );
    expect(response.status).toBe(200);
    expect(await payload(response)).toEqual({
      decision: 'listed',
      organizationId: ORGANIZATION_ID,
      members: [summary],
      correlationId: CORRELATION_ID,
    });
  });

  it('fails closed when a successful database response is not bound to the request', async () => {
    const deps = dependencies({
      list: vi.fn().mockResolvedValue({
        decision: 'listed',
        organizationId: '30000000-0000-4000-8000-000000000099',
        members: [summary],
        hasMore: false,
        correlationId: CORRELATION_ID,
      }),
    });
    const response = await createMemberAdministrationHandler(deps)(
      request({ action: 'list', organizationId: ORGANIZATION_ID }),
    );
    expect(response.status).toBe(503);
  });

  it('rejects a cursor that is not bound to the current query', async () => {
    const deps = dependencies({ decodeCursor: vi.fn().mockRejectedValue(new Error('bad cursor')) });
    const response = await createMemberAdministrationHandler(deps)(
      request({ action: 'list', organizationId: ORGANIZATION_ID, cursor: 'x'.repeat(32) }),
    );
    expect(response.status).toBe(422);
    expect(deps.list).not.toHaveBeenCalled();
  });

  it('allows an active member to read a profile without AAL2', async () => {
    const deps = dependencies({
      authenticate: vi
        .fn()
        .mockResolvedValue({ ...actor, assuranceLevel: 'aal1', totpAuthenticatedAt: null }),
    });
    const response = await createMemberAdministrationHandler(deps)(
      request({ action: 'get_profile', membershipId: MEMBERSHIP_ID }),
    );
    expect(response.status).toBe(200);
    expect((await payload(response)).profile).toEqual(profile);
  });

  it('requires server-derived portal MFA for a privileged member profile', async () => {
    const deps = dependencies({
      authenticate: vi
        .fn()
        .mockResolvedValue({ ...actor, assuranceLevel: 'aal1', totpAuthenticatedAt: null }),
      resolveProfileAssurance: vi.fn().mockResolvedValue('aal2'),
    });
    const response = await createMemberAdministrationHandler(deps)(
      request({ action: 'get_profile', membershipId: MEMBERSHIP_ID }),
    );
    expect(response.status).toBe(403);
    expect(deps.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'authentication_assurance_required' }),
    );
    expect(deps.getProfile).not.toHaveBeenCalled();
  });

  it('denies an inactive or missing server-derived profile role at AAL1', async () => {
    const getProfile = vi.fn<MemberAdministrationDependencies['getProfile']>();
    const deps = dependencies({
      authenticate: vi
        .fn()
        .mockResolvedValue({ ...actor, assuranceLevel: 'aal1', totpAuthenticatedAt: null }),
      resolveProfileAssurance: vi.fn().mockResolvedValue('denied'),
      getProfile,
    });
    const response = await createMemberAdministrationHandler(deps)(
      request({ action: 'get_profile', membershipId: MEMBERSHIP_ID }),
    );
    expect(response.status).toBe(404);
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('preserves profile data when the database reports a stale version', async () => {
    const deps = dependencies({
      updateProfile: vi.fn().mockResolvedValue({
        decision: 'state_conflict',
        correlationId: CORRELATION_ID,
      }),
    });
    const response = await createMemberAdministrationHandler(deps)(
      request({
        action: 'update_profile',
        membershipId: MEMBERSHIP_ID,
        displayName: 'Synthetic Member',
        contactNumber: '',
        expectedVersion: 1,
      }),
    );
    expect(response.status).toBe(409);
    expect(deps.recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'member_administration.conflicted' }),
    );
  });

  it('requires a recent password and AAL2 for status changes', async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({ ...actor, passwordAuthenticatedAt: 1 }),
    });
    const response = await createMemberAdministrationHandler(deps)(
      request({
        action: 'suspend',
        organizationId: ORGANIZATION_ID,
        membershipId: MEMBERSHIP_ID,
        reasonCode: 'temporary_access_hold',
        expectedVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );
    expect(response.status).toBe(403);
    expect(deps.changeStatus).not.toHaveBeenCalled();
  });

  it('returns an atomic membership status result', async () => {
    const changeStatus = vi
      .fn<MemberAdministrationDependencies['changeStatus']>()
      .mockResolvedValue({
        decision: 'suspended',
        organizationId: ORGANIZATION_ID,
        membershipId: MEMBERSHIP_ID,
        status: 'suspended',
        roleCode: 'student_pilot',
        roleLabel: 'Student Pilot',
        version: 2,
        replayed: false,
        correlationId: CORRELATION_ID,
      });
    const deps = dependencies({ changeStatus });
    const response = await createMemberAdministrationHandler(deps)(
      request({
        action: 'suspend',
        organizationId: ORGANIZATION_ID,
        membershipId: MEMBERSHIP_ID,
        reasonCode: 'temporary_access_hold',
        expectedVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );
    expect(response.status).toBe(200);
    expect(changeStatus).toHaveBeenCalledOnce();
    const changeRequest = changeStatus.mock.calls[0]?.[0];
    expect(changeRequest?.actorUserId).toBe(USER_ID);
    expect(changeRequest?.idempotencyKeyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails closed when a status response does not match the requested transition', async () => {
    const deps = dependencies({
      changeStatus: vi.fn().mockResolvedValue({
        decision: 'active',
        organizationId: ORGANIZATION_ID,
        membershipId: MEMBERSHIP_ID,
        status: 'active',
        roleCode: 'student_pilot',
        roleLabel: 'Student Pilot',
        version: 2,
        replayed: false,
        correlationId: CORRELATION_ID,
      }),
    });
    const response = await createMemberAdministrationHandler(deps)(
      request({
        action: 'suspend',
        organizationId: ORGANIZATION_ID,
        membershipId: MEMBERSHIP_ID,
        reasonCode: 'temporary_access_hold',
        expectedVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    );
    expect(response.status).toBe(503);
  });

  it('fails closed when the limiter audit is unavailable', async () => {
    const deps = dependencies({
      consumeLimit: vi.fn().mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 5,
        correlationId: CORRELATION_ID,
        networkSourceUsed: false,
        policyVersion: 'member-administration-subject-scope-v1',
      }),
      recordDenied: vi.fn().mockRejectedValue(new Error('audit unavailable')),
    });
    const response = await createMemberAdministrationHandler(deps)(
      request({ action: 'list', organizationId: ORGANIZATION_ID }),
    );
    expect(response.status).toBe(503);
    expect(deps.list).not.toHaveBeenCalled();
  });
});
