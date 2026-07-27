// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createAuthBootstrapHandler, type AuthBootstrapDependencies } from './handler';

const allowedOrigin = 'https://staging.flyeye.example';
const organizationId = '20000000-0000-4000-8000-000000000001';
const actorUserId = '40000000-0000-4000-8000-000000000001';
const correlationId = '30000000-0000-4000-8000-000000000001';
const fallbackCorrelationId = '30000000-0000-4000-8000-000000000002';

const validContext = {
  memberships: [
    {
      membershipId: '10000000-0000-4000-8000-000000000001',
      organizationId,
      organizationName: 'Synthetic Flight School',
      role: 'student_pilot',
      permissions: ['portal.student.access'],
      membershipVersion: 1,
      requiredAssuranceLevel: 'aal1',
      accessStatus: 'granted',
    },
  ],
  correlationId,
  decision: 'granted',
  currentAssuranceLevel: 'aal1',
  selectedOrganizationId: null,
  organizationIds: [organizationId],
};

function dependencies(
  overrides: Partial<AuthBootstrapDependencies> = {},
): AuthBootstrapDependencies {
  return {
    allowedOrigin,
    authenticate: vi.fn().mockResolvedValue({
      userId: actorUserId,
      assuranceLevel: 'aal1',
      authenticationMethods: ['password'],
    }),
    resolveAccessContext: vi.fn().mockResolvedValue(validContext),
    recordDecision: vi.fn().mockResolvedValue(undefined),
    createCorrelationId: () => fallbackCorrelationId,
    ...overrides,
  };
}

function request(
  body = '{}',
  options: { token?: string | null; origin?: string; contentLength?: string } = {},
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    origin: options.origin ?? allowedOrigin,
  });
  if (options.token !== null)
    headers.set('authorization', `Bearer ${options.token ?? 'test-token'}`);
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength);
  return new Request('https://functions.example/auth-bootstrap', {
    method: 'POST',
    headers,
    body,
  });
}

describe('auth-bootstrap Edge Function handler', () => {
  it('returns a validated student AAL1 context and records exactly one success', async () => {
    const configured = dependencies();
    const response = await createAuthBootstrapHandler(configured)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(validContext);
    expect(configured.recordDecision).toHaveBeenCalledTimes(1);
    expect(configured.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        actorSubjectId: actorUserId,
        eventName: 'authentication.access_context_loaded',
        outcome: 'success',
        organizationId,
        organizationIds: [organizationId],
        reasonCode: 'access_context_granted',
      }),
    );
  });

  it('rejects missing and invalid authentication before database access', async () => {
    const missing = dependencies();
    const missingResponse = await createAuthBootstrapHandler(missing)(
      request('{}', { token: null }),
    );
    expect(missingResponse.status).toBe(401);
    expect(missing.resolveAccessContext).not.toHaveBeenCalled();

    const invalid = dependencies({ authenticate: vi.fn().mockRejectedValue(new Error('invalid')) });
    const invalidResponse = await createAuthBootstrapHandler(invalid)(request());
    expect(invalidResponse.status).toBe(401);
    expect(invalid.resolveAccessContext).not.toHaveBeenCalled();
  });

  it.each([
    ['OTP-only', ['otp']],
    ['empty', []],
  ])(
    'denies and audits a verified %s session before resolving organization context',
    async (_label, authenticationMethods) => {
      const configured = dependencies({
        authenticate: vi.fn().mockResolvedValue({
          userId: actorUserId,
          assuranceLevel: 'aal1',
          authenticationMethods,
        }),
      });

      const response = await createAuthBootstrapHandler(configured)(request());

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'auth.authentication_method_not_allowed',
          message: 'Sign in with your password to continue.',
        },
      });
      expect(configured.resolveAccessContext).not.toHaveBeenCalled();
      expect(configured.recordDecision).toHaveBeenCalledTimes(1);
      expect(configured.recordDecision).toHaveBeenCalledWith({
        actorUserId,
        actorSubjectId: actorUserId,
        eventName: 'authentication.access_denied',
        outcome: 'denied',
        correlationId: fallbackCorrelationId,
        organizationId: null,
        organizationIds: [],
        reasonCode: 'authentication_method_not_allowed',
        metadata: {
          currentAssuranceLevel: 'aal1',
          requiredAuthenticationMethod: 'password',
        },
      });
    },
  );

  it('fails closed when an authentication-method denial cannot be audited', async () => {
    const configured = dependencies({
      authenticate: vi.fn().mockResolvedValue({
        userId: actorUserId,
        assuranceLevel: 'aal1',
        authenticationMethods: ['otp'],
      }),
      recordDecision: vi.fn().mockRejectedValue(new Error('audit unavailable')),
    });

    const response = await createAuthBootstrapHandler(configured)(request());

    expect(response.status).toBe(500);
    expect(configured.resolveAccessContext).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'auth.audit_unavailable',
        message: 'Access could not be verified. Try again.',
      },
    });
  });

  it('retains password plus TOTP sessions for the existing AAL2 authorization path', async () => {
    const configured = dependencies({
      authenticate: vi.fn().mockResolvedValue({
        userId: actorUserId,
        assuranceLevel: 'aal2',
        authenticationMethods: ['password', 'totp'],
      }),
      resolveAccessContext: vi.fn().mockResolvedValue({
        ...validContext,
        currentAssuranceLevel: 'aal2',
      }),
    });

    const response = await createAuthBootstrapHandler(configured)(request());

    expect(response.status).toBe(200);
    expect(configured.resolveAccessContext).toHaveBeenCalledWith({
      actorUserId,
      assuranceLevel: 'aal2',
      selectedOrganizationId: undefined,
    });
  });

  it('treats an AAL1 privileged context as denied audit evidence', async () => {
    const privilegedContext = {
      ...validContext,
      memberships: [
        {
          ...validContext.memberships[0],
          role: 'admin',
          permissions: ['portal.admin.access'],
          requiredAssuranceLevel: 'aal2',
          accessStatus: 'mfa_required',
        },
      ],
      decision: 'mfa_required',
    };
    const configured = dependencies({
      resolveAccessContext: vi.fn().mockResolvedValue(privilegedContext),
    });

    const response = await createAuthBootstrapHandler(configured)(request());

    expect(response.status).toBe(200);
    expect(configured.recordDecision).toHaveBeenCalledTimes(1);
    expect(configured.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'authentication.access_denied',
        outcome: 'denied',
        reasonCode: 'mfa_required',
      }),
    );
  });

  it('passes organization selection only as a resolver hint', async () => {
    const resolveAccessContext = vi.fn().mockResolvedValue({
      ...validContext,
      selectedOrganizationId: organizationId,
    });
    const configured = dependencies({ resolveAccessContext });
    const response = await createAuthBootstrapHandler(configured)(
      request(JSON.stringify({ organizationId })),
    );

    expect(response.status).toBe(200);
    expect(resolveAccessContext).toHaveBeenCalledWith({
      actorUserId,
      assuranceLevel: 'aal1',
      selectedOrganizationId: organizationId,
    });
  });

  it('rejects client-supplied role, permission, and metadata fields', async () => {
    const configured = dependencies();
    for (const body of [
      { role: 'admin' },
      { permission: 'portal.admin.access' },
      { metadata: { aal: 'aal2' } },
    ]) {
      const response = await createAuthBootstrapHandler(configured)(request(JSON.stringify(body)));
      expect(response.status).toBe(422);
    }
    expect(configured.resolveAccessContext).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'not-a-number'],
    ['misleading', '2'],
  ])('enforces actual body bytes with %s Content-Length', async (_label, contentLength) => {
    const configured = dependencies();
    const response = await createAuthBootstrapHandler(configured)(
      request(JSON.stringify({ padding: 'x'.repeat(3000) }), { contentLength }),
    );

    expect(response.status).toBe(413);
    expect(configured.authenticate).not.toHaveBeenCalled();
  });

  it('records denied—not success—when runtime response validation fails', async () => {
    const configured = dependencies({
      resolveAccessContext: vi.fn().mockResolvedValue({ memberships: 'invalid' }),
    });
    const response = await createAuthBootstrapHandler(configured)(request());

    expect(response.status).toBe(409);
    expect(configured.recordDecision).toHaveBeenCalledTimes(1);
    expect(configured.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'authentication.access_denied',
        outcome: 'denied',
        reasonCode: 'runtime_contract_rejected',
      }),
    );
  });

  it('returns safe responses for database and unexpected failures', async () => {
    const configured = dependencies({
      resolveAccessContext: vi.fn().mockRejectedValue(new Error('sensitive database detail')),
    });
    const response = await createAuthBootstrapHandler(configured)(request());
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(500);
    expect(body.error.message).not.toContain('sensitive');
    expect(configured.recordDecision).toHaveBeenCalledTimes(1);
    expect(configured.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'access_context_unavailable' }),
    );
  });

  it('fails closed when audit evidence cannot be written', async () => {
    const configured = dependencies({
      recordDecision: vi.fn().mockRejectedValue(new Error('audit unavailable')),
    });
    const response = await createAuthBootstrapHandler(configured)(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'auth.audit_unavailable',
        message: 'Access could not be verified. Try again.',
      },
    });
  });

  it('rejects requests from an unapproved origin', async () => {
    const configured = dependencies();
    const response = await createAuthBootstrapHandler(configured)(
      request('{}', { origin: 'https://attacker.example' }),
    );
    expect(response.status).toBe(403);
    expect(configured.authenticate).not.toHaveBeenCalled();
  });
});
