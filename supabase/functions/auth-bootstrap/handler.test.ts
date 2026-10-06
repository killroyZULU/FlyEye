import { streamedRequest } from '../../../src/test/request-stream';
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
      roleLabel: 'Student Pilot',
      workspacePermission: 'portal.student.access',
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
    consumeLimit: vi.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: null,
      correlationId: fallbackCorrelationId,
      policyVersion: 'auth-bootstrap-subject-v1',
    }),
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
    });
  });

  it('treats an AAL1 privileged context as denied audit evidence', async () => {
    const privilegedContext = {
      ...validContext,
      memberships: [
        {
          ...validContext.memberships[0],
          role: 'admin',
          roleLabel: 'Organization Admin',
          workspacePermission: 'portal.admin.access',
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

  it('rejects organization selection in a single-school deployment', async () => {
    const resolveAccessContext = vi.fn().mockResolvedValue(validContext);
    const configured = dependencies({ resolveAccessContext });
    const response = await createAuthBootstrapHandler(configured)(
      request(JSON.stringify({ organizationId })),
    );

    expect(response.status).toBe(422);
    expect(resolveAccessContext).not.toHaveBeenCalled();
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

  it('revalidates exactly-one verified TOTP before returning granted admin access', async () => {
    const adminContext = {
      ...validContext,
      memberships: [
        {
          ...validContext.memberships[0],
          role: 'admin',
          roleLabel: 'Organization Admin',
          workspacePermission: 'portal.admin.access',
          permissions: ['portal.admin.access'],
          requiredAssuranceLevel: 'aal2',
          accessStatus: 'granted',
        },
      ],
      currentAssuranceLevel: 'aal2',
    };
    const validateAdminFactorState = vi.fn().mockResolvedValue(true);
    const configured = dependencies({
      authenticate: vi.fn().mockResolvedValue({
        userId: actorUserId,
        assuranceLevel: 'aal2',
        authenticationMethods: ['password', 'totp'],
      }),
      resolveAccessContext: vi.fn().mockResolvedValue(adminContext),
      validateAdminFactorState,
    });

    const response = await createAuthBootstrapHandler(configured)(request());

    expect(response.status).toBe(200);
    expect(validateAdminFactorState).toHaveBeenCalledWith(actorUserId);
    expect(configured.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'authentication.access_context_loaded',
        outcome: 'success',
      }),
    );
  });

  it('fails admin access closed when the provider factor inventory conflicts', async () => {
    const adminContext = {
      ...validContext,
      memberships: [
        {
          ...validContext.memberships[0],
          role: 'admin',
          roleLabel: 'Organization Admin',
          workspacePermission: 'portal.admin.access',
          permissions: ['portal.admin.access'],
          requiredAssuranceLevel: 'aal2',
          accessStatus: 'granted',
        },
      ],
      currentAssuranceLevel: 'aal2',
    };
    const configured = dependencies({
      authenticate: vi.fn().mockResolvedValue({
        userId: actorUserId,
        assuranceLevel: 'aal2',
        authenticationMethods: ['password', 'totp'],
      }),
      resolveAccessContext: vi.fn().mockResolvedValue(adminContext),
      validateAdminFactorState: vi.fn().mockResolvedValue(false),
    });

    const response = await createAuthBootstrapHandler(configured)(request());

    expect(response.status).toBe(409);
    expect(configured.recordDecision).toHaveBeenCalledTimes(1);
    expect(configured.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'authentication.access_denied',
        reasonCode: 'factor_state_conflict',
      }),
    );
  });

  it('reports unavailable audit when factor inventory and denial audit both fail', async () => {
    const adminContext = {
      ...validContext,
      memberships: [
        {
          ...validContext.memberships[0],
          role: 'admin',
          roleLabel: 'Organization Admin',
          workspacePermission: 'portal.admin.access',
          permissions: ['portal.admin.access'],
          requiredAssuranceLevel: 'aal2',
          accessStatus: 'granted',
        },
      ],
      currentAssuranceLevel: 'aal2',
    };
    const configured = dependencies({
      authenticate: vi.fn().mockResolvedValue({
        userId: actorUserId,
        assuranceLevel: 'aal2',
        authenticationMethods: ['password', 'totp'],
      }),
      resolveAccessContext: vi.fn().mockResolvedValue(adminContext),
      validateAdminFactorState: vi.fn().mockRejectedValue(new Error('provider unavailable')),
      recordDecision: vi.fn().mockRejectedValue(new Error('audit unavailable')),
    });

    const response = await createAuthBootstrapHandler(configured)(request());

    expect(response.status).toBe(500);
    expect(configured.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'authentication.access_denied',
        reasonCode: 'factor_inventory_unavailable',
      }),
    );
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

  it('rejects requests without an Origin header before authentication', async () => {
    const configured = dependencies();
    const missingOriginRequest = request();
    missingOriginRequest.headers.delete('origin');

    const response = await createAuthBootstrapHandler(configured)(missingOriginRequest);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'auth.origin_denied' } });
    expect(configured.authenticate).not.toHaveBeenCalled();
  });
});

describe('streaming request-body contract', () => {
  it('preserves strict UTF-8 rejection before authentication', async () => {
    const deps = dependencies();
    const fixture = streamedRequest([new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x30, 0x7d])], {
      origin: deps.allowedOrigin,
      authorization: 'Bearer synthetic-token',
    });
    const response = await createAuthBootstrapHandler(deps)(fixture.request);
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
        [new Uint8Array(2048), new Uint8Array(1), new Uint8Array(10)],
        headers,
      );
      const response = await createAuthBootstrapHandler(deps)(fixture.request);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'auth.request_too_large' },
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
    const body = '{}'.padEnd(2048, ' ');
    const fixture = streamedRequest([new TextEncoder().encode(body)], {
      origin: deps.allowedOrigin,
      authorization: 'Bearer synthetic-token',
    });
    const response = await createAuthBootstrapHandler(deps)(fixture.request);
    expect(response.status).toBe(401);
    expect(deps.authenticate).toHaveBeenCalledOnce();
    expect(fixture.cancel).not.toHaveBeenCalled();
    expect(fixture.stream.locked).toBe(false);
  });
});

function adminContext() {
  return {
    ...validContext,
    memberships: [
      {
        ...validContext.memberships[0],
        role: 'admin',
        roleLabel: 'Organization Admin',
        workspacePermission: 'portal.admin.access',
        permissions: ['portal.admin.access'],
        requiredAssuranceLevel: 'aal2',
        accessStatus: 'granted',
      },
    ],
    currentAssuranceLevel: 'aal2',
  };
}

function deferredAudit() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('auth-bootstrap extraction compatibility', () => {
  it.each([
    [
      'origin precedes method',
      'OPTIONS',
      'https://attacker.example',
      undefined,
      403,
      'auth.origin_denied',
    ],
    ['preflight', 'OPTIONS', allowedOrigin, undefined, 204, undefined],
    [
      'method precedes authentication',
      'GET',
      allowedOrigin,
      undefined,
      405,
      'auth.method_not_allowed',
    ],
    [
      'authentication header precedes body',
      'POST',
      allowedOrigin,
      '{',
      401,
      'auth.authentication_required',
    ],
    ['malformed JSON', 'POST', allowedOrigin, '{', 400, 'auth.invalid_request'],
    ['non-object JSON', 'POST', allowedOrigin, '[]', 422, 'auth.invalid_request'],
    [
      'client authority',
      'POST',
      allowedOrigin,
      JSON.stringify({ organizationId }),
      422,
      'auth.invalid_request',
    ],
    ['body budget', 'POST', allowedOrigin, 'x'.repeat(2049), 413, 'auth.request_too_large'],
  ])(
    'preserves %s and response headers without protected work',
    async (label, method, origin, body, status, code) => {
      const configured = dependencies({
        createCorrelationId: vi.fn(() => fallbackCorrelationId),
        validateAdminFactorState: vi.fn(),
      });
      const headers = new Headers({ origin: origin });
      if (label !== 'authentication header precedes body')
        headers.set('authorization', 'Bearer synthetic-token');
      const input = new Request('https://functions.example/auth-bootstrap', {
        method: method,
        headers,
        body: body,
      });
      const response = await createAuthBootstrapHandler(configured)(input);
      expect(response.status).toBe(status);
      expect(Object.fromEntries(response.headers.entries())).toEqual({
        'access-control-allow-origin': allowedOrigin,
        'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-expose-headers': 'Retry-After',
        'cache-control': 'no-store',
        'content-type': 'application/json',
        vary: 'Origin',
      });
      if (status === 204) expect(await response.text()).toBe('');
      else expect(await response.json()).toMatchObject({ error: { code } });
      for (const dependency of Object.values(configured)) {
        if (vi.isMockFunction(dependency)) expect(dependency).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['no_active_membership', 'permission_denied', 'mfa_required'] as const)(
    'preserves exact %s audit and context response without factor lookup',
    async (reasonCode) => {
      const empty = reasonCode === 'no_active_membership';
      const decision = reasonCode === 'mfa_required' ? 'mfa_required' : 'denied';
      const context = {
        ...validContext,
        memberships: empty ? [] : [{ ...validContext.memberships[0], accessStatus: decision }],
        organizationIds: empty ? [] : [organizationId],
        decision,
      };
      const configured = dependencies({
        resolveAccessContext: vi.fn().mockResolvedValue(context),
        validateAdminFactorState: vi.fn(),
        createCorrelationId: vi.fn(() => fallbackCorrelationId),
      });
      const response = await createAuthBootstrapHandler(configured)(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(context);
      expect(configured.validateAdminFactorState).not.toHaveBeenCalled();
      expect(configured.createCorrelationId).toHaveBeenCalledOnce();
      expect(configured.recordDecision).toHaveBeenCalledExactlyOnceWith({
        actorUserId,
        actorSubjectId: actorUserId,
        eventName: 'authentication.access_denied',
        outcome: 'denied',
        correlationId,
        organizationId: empty ? null : organizationId,
        organizationIds: context.organizationIds,
        reasonCode,
        metadata: { membershipCount: empty ? 0 : 1, currentAssuranceLevel: 'aal1' },
      });
    },
  );

  it.each([
    ['valid', false, 200, undefined],
    ['valid', true, 500, 'auth.audit_unavailable'],
    ['conflict', false, 409, 'auth.access_context_conflict'],
    ['conflict', true, 500, 'auth.audit_unavailable'],
    ['unavailable', false, 503, 'auth.factor_inventory_unavailable'],
    ['unavailable', true, 500, 'auth.audit_unavailable'],
  ] as const)(
    'preserves admin factor %s with audit failure %s',
    async (factor, auditFails, status, code) => {
      const calls: string[] = [];
      const context = adminContext();
      const configured = dependencies({
        authenticate: vi.fn<AuthBootstrapDependencies['authenticate']>(async (token) => {
          calls.push('authenticate');
          expect(token).toBe('test-token');
          await Promise.resolve();
          return {
            userId: actorUserId,
            assuranceLevel: 'aal2',
            authenticationMethods: ['password', 'totp'],
          };
        }),
        resolveAccessContext: vi.fn<AuthBootstrapDependencies['resolveAccessContext']>(
          async (input) => {
            calls.push('resolve');
            expect(input).toEqual({ actorUserId, assuranceLevel: 'aal2' });
            await Promise.resolve();
            return context;
          },
        ),
        validateAdminFactorState: vi.fn(async (actor: string) => {
          calls.push('factor');
          expect(actor).toBe(actorUserId);
          await Promise.resolve();
          if (factor === 'unavailable') throw new Error('Private factor inventory');
          return factor === 'valid';
        }),
        recordDecision: vi.fn(async () => {
          calls.push('audit');
          await Promise.resolve();
          if (auditFails) throw new Error('Private audit detail');
        }),
        createCorrelationId: vi.fn(() => fallbackCorrelationId),
      });
      const response = await createAuthBootstrapHandler(configured)(request());
      expect(response.status).toBe(status);
      expect(calls).toEqual(['authenticate', 'resolve', 'factor', 'audit']);
      expect(configured.createCorrelationId).toHaveBeenCalledOnce();
      expect(configured.recordDecision).toHaveBeenCalledExactlyOnceWith({
        actorUserId,
        actorSubjectId: actorUserId,
        eventName:
          factor === 'valid'
            ? 'authentication.access_context_loaded'
            : 'authentication.access_denied',
        outcome: factor === 'valid' ? 'success' : 'denied',
        correlationId,
        organizationId,
        organizationIds: [organizationId],
        reasonCode:
          factor === 'valid'
            ? 'access_context_granted'
            : factor === 'conflict'
              ? 'factor_state_conflict'
              : 'factor_inventory_unavailable',
        metadata: { membershipCount: 1, currentAssuranceLevel: 'aal2' },
      });
      if (status === 200) expect(await response.json()).toEqual(context);
      else {
        const text = await response.text();
        expect(JSON.parse(text)).toMatchObject({ error: { code } });
        expect(text).not.toContain('Private');
        expect(text).not.toContain('memberships');
      }
    },
  );

  it.each(['resolver', 'contract'] as const)(
    'retains %s error precedence when its denial audit also fails',
    async (failure) => {
      const configured = dependencies({
        resolveAccessContext:
          failure === 'resolver'
            ? vi.fn().mockRejectedValue(new Error('Private resolver detail'))
            : vi.fn().mockResolvedValue({ memberships: 'invalid' }),
        recordDecision: vi.fn().mockRejectedValue(new Error('Private audit detail')),
        createCorrelationId: vi.fn(() => fallbackCorrelationId),
        validateAdminFactorState: vi.fn(),
      });
      const response = await createAuthBootstrapHandler(configured)(request());
      expect(response.status).toBe(failure === 'resolver' ? 500 : 409);
      expect(await response.json()).toEqual({
        error: {
          code:
            failure === 'resolver'
              ? 'auth.access_context_unavailable'
              : 'auth.access_context_conflict',
          message:
            failure === 'resolver'
              ? 'Access could not be verified. Try again.'
              : 'Your access information needs administrator review.',
        },
      });
      expect(configured.createCorrelationId).toHaveBeenCalledTimes(2);
      expect(configured.validateAdminFactorState).not.toHaveBeenCalled();
      expect(configured.recordDecision).toHaveBeenCalledExactlyOnceWith({
        actorUserId,
        actorSubjectId: actorUserId,
        eventName: 'authentication.access_denied',
        outcome: 'denied',
        correlationId: fallbackCorrelationId,
        organizationId: null,
        organizationIds: [],
        reasonCode:
          failure === 'resolver' ? 'access_context_unavailable' : 'runtime_contract_rejected',
        metadata: { currentAssuranceLevel: 'aal1' },
      });
    },
  );

  it.each(['mismatched organization', 'multiple memberships'])(
    'rejects %s before factor inspection and success audit',
    async (failure) => {
      const otherOrganization = '20000000-0000-4000-8000-000000000002';
      const raw =
        failure === 'mismatched organization'
          ? { ...validContext, organizationIds: [otherOrganization] }
          : {
              ...validContext,
              memberships: [
                ...validContext.memberships,
                { ...validContext.memberships[0], organizationId: otherOrganization },
              ],
              organizationIds: [organizationId, otherOrganization],
            };
      const configured = dependencies({
        resolveAccessContext: vi.fn().mockResolvedValue(raw),
        validateAdminFactorState: vi.fn(),
      });
      const response = await createAuthBootstrapHandler(configured)(request());
      expect(response.status).toBe(409);
      expect(configured.validateAdminFactorState).not.toHaveBeenCalled();
      expect(configured.recordDecision).toHaveBeenCalledOnce();
      expect(configured.recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'denied',
          reasonCode: 'runtime_contract_rejected',
          organizationIds: [],
        }),
      );
      expect(await response.text()).not.toContain(otherOrganization);
    },
  );

  it('preserves the optional factor-validator factory contract', async () => {
    const context = adminContext();
    const configured = dependencies({ resolveAccessContext: vi.fn().mockResolvedValue(context) });
    const response = await createAuthBootstrapHandler(configured)(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(context);
    expect(configured.recordDecision).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'waits for required audit before responding (password denial: %s)',
    async (passwordDenied) => {
      const audit = deferredAudit();
      const configured = dependencies({
        authenticate: vi.fn().mockResolvedValue({
          userId: actorUserId,
          assuranceLevel: 'aal1',
          authenticationMethods: passwordDenied ? ['otp'] : ['password'],
        }),
        recordDecision: vi.fn(() => audit.promise),
      });
      let responded = false;
      const pending = createAuthBootstrapHandler(configured)(request()).then((response) => {
        responded = true;
        return response;
      });
      await vi.waitFor(() => expect(configured.recordDecision).toHaveBeenCalledOnce());
      expect(responded).toBe(false);
      audit.resolve();
      expect((await pending).status).toBe(passwordDenied ? 403 : 200);
      expect(configured.resolveAccessContext).toHaveBeenCalledTimes(passwordDenied ? 0 : 1);
    },
  );
});
