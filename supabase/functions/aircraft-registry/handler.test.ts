import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAircraftRegistryHandler, type AircraftRegistryDependencies } from './handler';

const actor = {
  actorUserId: '10000000-0000-4000-8000-000000000001',
  actorSubjectId: '10000000-0000-4000-8000-000000000001',
  sessionId: '20000000-0000-4000-8000-000000000001',
  assuranceLevel: 'aal2' as const,
  authenticationMethods: ['password', 'totp'],
  passwordAuthenticatedAt: 1,
  totpAuthenticatedAt: 1,
};
const organizationId = '30000000-0000-4000-8000-000000000001';
const correlationId = '40000000-0000-4000-8000-000000000001';
const record = {
  id: '50000000-0000-4000-8000-000000000001',
  registrationMark: 'RP-C123',
  manufacturer: 'Cessna',
  model: '172S',
  registryState: 'tracked' as const,
  version: 1,
  updatedAt: '2026-08-29T00:00:00Z',
};

function dependencies(
  overrides: Partial<AircraftRegistryDependencies> = {},
): AircraftRegistryDependencies {
  return {
    allowedOrigin: 'http://127.0.0.1:5173',
    authenticate: vi.fn().mockResolvedValue(actor),
    resolveContext: vi.fn().mockResolvedValue({ organizationId, canRead: true, canManage: true }),
    limiterKey: vi.fn().mockResolvedValue('a'.repeat(64)),
    consumeLimit: vi
      .fn()
      .mockImplementation((input: Parameters<AircraftRegistryDependencies['consumeLimit']>[0]) =>
        Promise.resolve({
          allowed: true,
          retryAfterSeconds: null,
          correlationId: input.correlationId,
          policyVersion: 'aircraft-registry-v1',
        }),
      ),
    recordSecurity: vi.fn().mockResolvedValue(undefined),
    reportAuditFailure: vi.fn(),
    list: vi.fn().mockResolvedValue({
      decision: 'listed',
      records: [record],
      page: 1,
      pageSize: 25,
      hasNext: false,
      correlationId,
    }),
    get: vi.fn().mockResolvedValue({ decision: 'found', record, correlationId }),
    lookupIdempotency: vi.fn().mockResolvedValue({ decision: 'missing', result: null }),
    mutate: vi.fn().mockResolvedValue({
      decision: 'created',
      record,
      replayed: false,
      correlationId,
    }),
    createCorrelationId: () => correlationId,
    ...overrides,
  };
}

function request(body: object, options: { origin?: string; token?: string; method?: string } = {}) {
  return new Request('http://local/aircraft-registry', {
    method: options.method ?? 'POST',
    headers: {
      origin: options.origin ?? 'http://127.0.0.1:5173',
      authorization: `Bearer ${options.token ?? 'verified-token'}`,
      'content-type': 'application/json',
    },
    body: options.method && options.method !== 'POST' ? undefined : JSON.stringify(body),
  });
}

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe('aircraft registry Edge handler', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns an audited bounded list after general and read limits', async () => {
    const deps = dependencies();
    const response = await createAircraftRegistryHandler(deps)(
      request({ action: 'list', includeArchived: false, page: 1, pageSize: 25, search: '%' }),
    );
    expect(response.status).toBe(200);
    expect((await payload(response)).records).toEqual([record]);
    expect(deps.consumeLimit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ bucket: 'general' }),
    );
    expect(deps.consumeLimit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ bucket: 'read' }),
    );
    expect(deps.list).toHaveBeenCalledWith(expect.objectContaining({ search: '%' }));
  });

  it('rejects wrong origin, method, authentication, and unknown fields', async () => {
    const handler = createAircraftRegistryHandler(dependencies());
    expect((await handler(request({}, { origin: 'https://evil.test' }))).status).toBe(403);
    expect((await handler(request({}, { method: 'GET' }))).status).toBe(405);
    expect(
      (
        await handler(
          new Request('http://local', {
            method: 'POST',
            headers: { origin: 'http://127.0.0.1:5173' },
            body: '{}',
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handler(
          request({ action: 'get', recordId: record.id, organizationId: organizationId }),
        )
      ).status,
    ).toBe(422);
  });

  it('fails closed for permission, MFA, and limiter denials', async () => {
    const unauthorized = dependencies({
      resolveContext: vi
        .fn()
        .mockResolvedValue({ organizationId, canRead: false, canManage: false }),
    });
    expect(
      (
        await createAircraftRegistryHandler(unauthorized)(
          request({ action: 'get', recordId: record.id }),
        )
      ).status,
    ).toBe(403);
    expect(unauthorized.recordSecurity).toHaveBeenCalled();

    const mfa = dependencies({
      authenticate: vi
        .fn()
        .mockResolvedValue({ ...actor, assuranceLevel: 'aal1', totpAuthenticatedAt: null }),
    });
    expect(
      (await createAircraftRegistryHandler(mfa)(request({ action: 'get', recordId: record.id })))
        .status,
    ).toBe(403);

    const limited = dependencies({
      consumeLimit: vi.fn().mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 7,
        correlationId,
        policyVersion: 'aircraft-registry-v1',
      }),
    });
    const limitedResponse = await createAircraftRegistryHandler(limited)(
      request({ action: 'get', recordId: record.id }),
    );
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get('Retry-After')).toBe('7');
  });

  it('security-logs permission revocation detected by read and mutation RPCs', async () => {
    const read = dependencies({
      list: vi.fn().mockResolvedValue({ decision: 'unauthorized', correlationId }),
    });
    const listBody = { action: 'list', includeArchived: false, page: 1, pageSize: 25 } as const;
    expect((await createAircraftRegistryHandler(read)(request(listBody))).status).toBe(403);
    expect(read.recordSecurity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'list', outcome: 'denied', reason: 'unauthorized' }),
    );

    const auditError = Object.assign(new Error('synthetic security-log failure'), {
      name: 'AircraftAuditError',
    });
    const mutation = dependencies({
      mutate: vi.fn().mockResolvedValue({ decision: 'unauthorized', correlationId }),
      recordSecurity: vi.fn().mockRejectedValue(auditError),
    });
    const createBody = {
      action: 'create',
      registrationMark: 'RP-C123',
      manufacturer: 'Cessna',
      model: '172S',
      idempotencyKey: 'e'.repeat(32),
    } as const;
    expect((await createAircraftRegistryHandler(mutation)(request(createBody))).status).toBe(503);
    expect(mutation.recordSecurity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', outcome: 'denied', reason: 'unauthorized' }),
    );
    expect(mutation.reportAuditFailure).toHaveBeenCalledWith({
      action: 'create',
      correlationId,
      kind: 'security_event',
    });
  });

  it('security-logs permission revocation detected during idempotency lookup', async () => {
    const body = {
      action: 'create',
      registrationMark: 'RP-C123',
      manufacturer: 'Cessna',
      model: '172S',
      idempotencyKey: '9'.repeat(32),
    } as const;
    const revoked = dependencies({
      lookupIdempotency: vi.fn().mockResolvedValue({ decision: 'unauthorized', result: null }),
    });
    expect((await createAircraftRegistryHandler(revoked)(request(body))).status).toBe(403);
    expect(revoked.recordSecurity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', outcome: 'denied', reason: 'unauthorized' }),
    );
    expect(revoked.mutate).not.toHaveBeenCalled();

    const unlogged = dependencies({
      lookupIdempotency: vi.fn().mockResolvedValue({ decision: 'unauthorized', result: null }),
      recordSecurity: vi.fn().mockRejectedValue(
        Object.assign(new Error('synthetic security-log failure'), {
          name: 'AircraftAuditError',
        }),
      ),
    });
    expect((await createAircraftRegistryHandler(unlogged)(request(body))).status).toBe(503);
    expect(unlogged.mutate).not.toHaveBeenCalled();
  });

  it('accepts response fields bounded by Unicode code points', async () => {
    const manufacturer = '😀'.repeat(100);
    const deps = dependencies({
      mutate: vi.fn().mockResolvedValue({
        decision: 'created',
        record: { ...record, manufacturer },
        replayed: false,
        correlationId,
      }),
    });
    const response = await createAircraftRegistryHandler(deps)(
      request({
        action: 'create',
        registrationMark: 'RP-C123',
        manufacturer,
        model: '172S',
        idempotencyKey: '8'.repeat(32),
      }),
    );
    expect(response.status).toBe(200);
    expect((await payload(response)).record).toEqual(expect.objectContaining({ manufacturer }));
  });

  it('reports a value-free fallback when a required domain audit write fails', async () => {
    const auditError = Object.assign(new Error('synthetic domain-audit failure'), {
      name: 'AircraftAuditError',
    });
    const deps = dependencies({ list: vi.fn().mockRejectedValue(auditError) });
    const response = await createAircraftRegistryHandler(deps)(
      request({ action: 'list', includeArchived: false, page: 1, pageSize: 25 }),
    );
    expect(response.status).toBe(503);
    expect(deps.reportAuditFailure).toHaveBeenCalledWith({
      action: 'list',
      correlationId,
      kind: 'domain_audit',
    });
  });

  it('normalizes a create, fingerprints it, and consumes the mutation bucket', async () => {
    const deps = dependencies();
    const response = await createAircraftRegistryHandler(deps)(
      request({
        action: 'create',
        registrationMark: ' rp-c 123 ',
        manufacturer: ' Cessna ',
        model: ' 172S ',
        idempotencyKey: 'b'.repeat(32),
      }),
    );
    expect(response.status).toBe(200);
    expect(deps.lookupIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', recordId: null, expectedVersion: null }),
    );
    expect(deps.consumeLimit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ bucket: 'mutation' }),
    );
    const mutation = vi.mocked(deps.mutate).mock.calls[0]?.[0];
    expect(mutation?.identity).toMatchObject({
      registrationMark: 'RP-C 123',
      registrationKey: 'rpc123',
    });
  });

  it('returns stored replays and changed-input conflicts without action tokens', async () => {
    const replayResult = {
      decision: 'archived',
      record: { ...record, registryState: 'archived' },
      replayed: false,
    };
    const replay = dependencies({
      lookupIdempotency: vi.fn().mockResolvedValue({ decision: 'replay', result: replayResult }),
    });
    const body = {
      action: 'archive',
      recordId: record.id,
      expectedVersion: 1,
      reason: 'created_in_error',
      idempotencyKey: 'c'.repeat(32),
    } as const;
    expect((await createAircraftRegistryHandler(replay)(request(body))).status).toBe(200);
    expect(replay.consumeLimit).toHaveBeenCalledTimes(1);
    expect(replay.mutate).not.toHaveBeenCalled();

    const conflict = dependencies({
      lookupIdempotency: vi.fn().mockResolvedValue({ decision: 'conflict', result: null }),
    });
    expect((await createAircraftRegistryHandler(conflict)(request(body))).status).toBe(409);
    expect(conflict.consumeLimit).toHaveBeenCalledTimes(1);
    expect(conflict.recordSecurity).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'conflict', reason: 'idempotency_conflict' }),
    );
  });

  it('routes archive and reactivate through the shared lifecycle bucket', async () => {
    for (const action of ['archive', 'reactivate'] as const) {
      const deps = dependencies({
        mutate: vi.fn().mockResolvedValue({
          decision: action === 'archive' ? 'archived' : 'reactivated',
          record: {
            ...record,
            registryState: action === 'archive' ? 'archived' : 'tracked',
          },
          replayed: false,
          correlationId,
        }),
      });
      await createAircraftRegistryHandler(deps)(
        request({
          action,
          recordId: record.id,
          expectedVersion: 1,
          reason: action === 'archive' ? 'created_in_error' : 'archive_incorrect',
          idempotencyKey: 'f'.repeat(32),
        }),
      );
      expect(deps.consumeLimit).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ bucket: 'lifecycle' }),
      );
    }
  });

  it('security-logs state/version conflicts and fails closed when that log is unavailable', async () => {
    const body = {
      action: 'update',
      recordId: record.id,
      registrationMark: record.registrationMark,
      manufacturer: record.manufacturer,
      model: record.model,
      expectedVersion: 1,
      idempotencyKey: 'd'.repeat(32),
    } as const;
    const conflict = dependencies({
      mutate: vi.fn().mockResolvedValue({ decision: 'version_conflict', correlationId }),
    });
    expect((await createAircraftRegistryHandler(conflict)(request(body))).status).toBe(409);
    expect(conflict.recordSecurity).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'conflict', reason: 'version_conflict' }),
    );

    const unavailable = dependencies({
      mutate: vi.fn().mockResolvedValue({ decision: 'state_conflict', correlationId }),
      recordSecurity: vi.fn().mockRejectedValue(new Error('synthetic audit failure')),
    });
    expect((await createAircraftRegistryHandler(unavailable)(request(body))).status).toBe(503);
  });
});
