import { describe, expect, it, vi } from 'vitest';

import { createAircraftDocumentHandler, type AircraftDocumentDependencies } from './handler';

const actorId = '10000000-0000-4000-8000-000000000001';
const organizationId = '20000000-0000-4000-8000-000000000001';
const membershipId = '30000000-0000-4000-8000-000000000001';
const correlationId = '40000000-0000-4000-8000-000000000001';
const aircraftId = '50000000-0000-4000-8000-000000000001';
const categoryId = '60000000-0000-4000-8000-000000000001';
const documentId = '70000000-0000-4000-8000-000000000001';
const versionId = '80000000-0000-4000-8000-000000000001';

const actor = {
  actorUserId: actorId,
  actorSubjectId: actorId,
  sessionId: '90000000-0000-4000-8000-000000000001',
  assuranceLevel: 'aal2' as const,
  authenticationMethods: ['password', 'totp'],
  passwordAuthenticatedAt: Math.floor(Date.now() / 1000),
  totpAuthenticatedAt: Math.floor(Date.now() / 1000),
};

const access = {
  organizationId,
  membershipId,
  roleCode: 'admin',
  canReadStatus: true,
  canRead: true,
  canReadNotifications: true,
  canManage: true,
  canManageCategories: true,
  canReadAttachment: true,
};

const mutation = {
  decision: 'created',
  documentId,
  aggregateVersion: 1,
  documentState: 'active',
  currentVersionId: versionId,
  currentVersionNumber: 1,
  replayed: false,
  correlationId,
};

function dependencies(overrides: Partial<AircraftDocumentDependencies> = {}) {
  const rpc = vi.fn().mockImplementation((name: string) => {
    if (name === 'lookup_aircraft_document_idempotency') {
      return Promise.resolve({ decision: 'missing', result: null });
    }
    if (name === 'mutate_aircraft_document') return Promise.resolve(mutation);
    if (name === 'list_aircraft_document_status') {
      return Promise.resolve({
        decision: 'listed',
        aircraft: { id: aircraftId, label: 'RP-C123' },
        items: [],
        availableCustomCategories: [],
        calculatedOn: '2026-09-02',
        correlationId,
      });
    }
    return Promise.resolve({ decision: 'not_found', correlationId });
  });
  return {
    allowedOrigin: 'http://127.0.0.1:5173',
    authenticate: vi.fn().mockResolvedValue(actor),
    resolveContext: vi.fn().mockResolvedValue(access),
    limiterKey: vi.fn().mockResolvedValue('a'.repeat(64)),
    consumeLimit: vi
      .fn()
      .mockImplementation((input: Parameters<AircraftDocumentDependencies['consumeLimit']>[0]) =>
        Promise.resolve({
          allowed: true,
          retryAfterSeconds: null,
          correlationId: input.correlationId,
          policyVersion: 'aircraft-documents-v1' as const,
        }),
      ),
    recordSecurity: vi.fn().mockResolvedValue(undefined),
    rpc,
    createSignedUpload: vi.fn().mockResolvedValue({ token: 'token', path: 'private/path' }),
    downloadStagedFile: vi.fn(),
    createSignedDownload: vi.fn(),
    createCorrelationId: () => correlationId,
    currentPhilippineDate: () => '2026-09-02',
    ...overrides,
  } satisfies AircraftDocumentDependencies;
}

function request(body: object, options: { origin?: string; token?: string; method?: string } = {}) {
  return new Request('http://local/aircraft-documents', {
    method: options.method ?? 'POST',
    headers: {
      origin: options.origin ?? 'http://127.0.0.1:5173',
      authorization: `Bearer ${options.token ?? 'verified-token'}`,
      'content-type': 'application/json',
    },
    body: options.method && options.method !== 'POST' ? undefined : JSON.stringify(body),
  });
}

async function errorCode(response: Response) {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}

const createBody = {
  action: 'create',
  aircraftId,
  categoryId,
  documentTitle: 'Registration',
  documentSource: 'Synthetic Authority',
  expirationDate: '2027-09-01',
  idempotencyKey: 'b'.repeat(32),
} as const;

describe('aircraft documents Edge handler', () => {
  it('allows a Student AAL1 status-only read and applies general then read limits', async () => {
    const deps = dependencies({
      authenticate: vi.fn().mockResolvedValue({
        ...actor,
        assuranceLevel: 'aal1',
        totpAuthenticatedAt: null,
      }),
      resolveContext: vi.fn().mockResolvedValue({
        ...access,
        roleCode: 'student_pilot',
        canRead: false,
        canReadNotifications: false,
        canManage: false,
        canManageCategories: false,
        canReadAttachment: false,
      }),
    });
    const response = await createAircraftDocumentHandler(deps)(
      request({ action: 'status_list', aircraftId }),
    );
    expect(response.status).toBe(200);
    expect(deps.consumeLimit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ bucket: 'general' }),
    );
    expect(deps.consumeLimit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ bucket: 'read' }),
    );
  });

  it('fails closed for origin, method, request shape, permission, MFA, and limiter failures', async () => {
    const handler = createAircraftDocumentHandler(dependencies());
    expect((await handler(request({}, { origin: 'https://evil.test' }))).status).toBe(403);
    expect((await handler(request({}, { method: 'GET' }))).status).toBe(405);
    expect(
      (await handler(request({ action: 'status_list', aircraftId, organizationId }))).status,
    ).toBe(422);

    const denied = dependencies({
      resolveContext: vi.fn().mockResolvedValue({ ...access, canRead: false }),
    });
    expect(
      (await createAircraftDocumentHandler(denied)(request({ action: 'detail', documentId })))
        .status,
    ).toBe(403);
    expect(denied.recordSecurity).toHaveBeenCalled();

    const mfa = dependencies({
      authenticate: vi
        .fn()
        .mockResolvedValue({ ...actor, assuranceLevel: 'aal1', totpAuthenticatedAt: null }),
    });
    expect(
      (await createAircraftDocumentHandler(mfa)(request({ action: 'detail', documentId }))).status,
    ).toBe(403);

    const limited = dependencies({
      consumeLimit: vi.fn().mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 9,
        correlationId,
        policyVersion: 'aircraft-documents-v1',
      }),
    });
    const limitedResponse = await createAircraftDocumentHandler(limited)(
      request({ action: 'detail', documentId }),
    );
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get('Retry-After')).toBe('9');
  });

  it('requires recent password evidence for category changes and attachment downloads', async () => {
    const stale = dependencies({
      authenticate: vi.fn().mockResolvedValue({ ...actor, passwordAuthenticatedAt: 1 }),
    });
    const response = await createAircraftDocumentHandler(stale)(
      request({
        action: 'category_archive',
        categoryId,
        expectedVersion: 1,
        idempotencyKey: 'c'.repeat(32),
      }),
    );
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe('aircraft_documents.recent_password_required');
    expect(stale.recordSecurity).toHaveBeenCalled();
  });

  it('audits a concealed identifier denial before returning not found', async () => {
    const deps = dependencies();
    const response = await createAircraftDocumentHandler(deps)(
      request({ action: 'detail', documentId }),
    );

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('aircraft_documents.not_found');
    expect(deps.recordSecurity).toHaveBeenCalledWith({
      actorUserId: actorId,
      organizationId,
      action: 'detail',
      outcome: 'denied',
      reason: 'not_found',
      correlationId,
    });
  });

  it('checks replay before mutation limiting and replays the stored result', async () => {
    const deps = dependencies({
      rpc: vi
        .fn()
        .mockImplementation((name: string) =>
          Promise.resolve(
            name === 'lookup_aircraft_document_idempotency'
              ? { decision: 'replay', result: mutation }
              : { decision: 'not_found', correlationId },
          ),
        ),
    });
    const response = await createAircraftDocumentHandler(deps)(request(createBody));
    expect(response.status).toBe(200);
    expect((await response.json()) as object).toMatchObject({ replayed: true, documentId });
    expect(deps.consumeLimit).toHaveBeenCalledTimes(1);
    expect(deps.rpc).toHaveBeenCalledTimes(1);
  });

  it('creates through the protected mutation and passes server-derived tenant context', async () => {
    const deps = dependencies();
    const response = await createAircraftDocumentHandler(deps)(request(createBody));
    expect(response.status).toBe(200);
    expect((await response.json()) as object).toMatchObject({ replayed: false, documentId });
    expect(deps.rpc).toHaveBeenCalledWith(
      'mutate_aircraft_document',
      expect.objectContaining({
        p_actor_user_id: actorId,
        p_organization_id: organizationId,
        p_aircraft_record_id: aircraftId,
        p_category_id: categoryId,
      }),
    );
  });

  it('returns the stable audit failure code when an atomic event write fails', async () => {
    const auditError = Object.assign(new Error('synthetic audit failure'), {
      name: 'AircraftDocumentAuditError',
    });
    const deps = dependencies({
      rpc: vi
        .fn()
        .mockImplementation((name: string) =>
          name === 'lookup_aircraft_document_idempotency'
            ? Promise.resolve({ decision: 'missing', result: null })
            : Promise.reject(auditError),
        ),
    });
    const response = await createAircraftDocumentHandler(deps)(request(createBody));
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe('aircraft_documents.audit_failed');
  });

  it('stages, completes, and authorizes private files only through protected operations', async () => {
    const fileId = 'a0000000-0000-4000-8000-000000000001';
    const objectKey = `${organizationId}/${aircraftId}/${fileId}/${fileId}.pdf`;
    const staged = dependencies({
      rpc: vi.fn().mockResolvedValue({
        decision: 'staged',
        fileId,
        objectKey,
        scanState: 'staged',
        correlationId,
      }),
    });
    const initiateResponse = await createAircraftDocumentHandler(staged)(
      request({
        action: 'file_initiate',
        aircraftId,
        displayName: 'record.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 100,
        sha256Hash: 'a'.repeat(64),
        idempotencyKey: 'd'.repeat(32),
      }),
    );
    expect(initiateResponse.status).toBe(200);
    const initiatedPayload = (await initiateResponse.json()) as { fileId: string };
    expect(staged.createSignedUpload).toHaveBeenCalledWith(expect.stringMatching(/\.pdf$/));

    const resumed = dependencies({
      rpc: vi.fn().mockResolvedValue({
        decision: 'staged',
        fileId,
        objectKey,
        scanState: 'clean',
        correlationId,
      }),
    });
    const resumedResponse = await createAircraftDocumentHandler(resumed)(
      request({
        action: 'file_initiate',
        aircraftId,
        displayName: 'record.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 100,
        sha256Hash: 'a'.repeat(64),
        idempotencyKey: 'd'.repeat(32),
      }),
    );
    expect(resumedResponse.status).toBe(200);
    expect((await resumedResponse.json()) as object).toMatchObject({
      decision: 'completed',
      fileId: initiatedPayload.fileId,
      scanState: 'clean',
    });
    expect(resumed.createSignedUpload).not.toHaveBeenCalled();

    const alreadyClean = dependencies({
      rpc: vi.fn().mockResolvedValue({
        decision: 'found',
        fileId,
        objectKey,
        mediaType: 'application/pdf',
        sizeBytes: 100,
        sha256Hash: 'a'.repeat(64),
        scanState: 'clean',
      }),
    });
    const completeResponse = await createAircraftDocumentHandler(alreadyClean)(
      request({ action: 'file_complete', fileId, idempotencyKey: 'd'.repeat(32) }),
    );
    expect(completeResponse.status).toBe(200);
    expect((await completeResponse.json()) as object).toMatchObject({
      decision: 'completed',
      scanState: 'clean',
    });

    const download = dependencies({
      rpc: vi
        .fn()
        .mockResolvedValueOnce({
          decision: 'authorized',
          fileId,
          bucketId: 'aircraft-documents',
          objectKey,
          downloadName: 'record.pdf',
          mediaType: 'application/pdf',
          correlationId,
        })
        .mockResolvedValueOnce({ decision: 'confirmed', fileId, correlationId }),
      createSignedDownload: vi.fn().mockResolvedValue('http://local/private-signed'),
    });
    const downloadResponse = await createAircraftDocumentHandler(download)(
      request({ action: 'attachment_download', fileId }),
    );
    expect(downloadResponse.status).toBe(200);
    expect(download.createSignedDownload).toHaveBeenCalledWith(objectKey, 'record.pdf');
    expect(download.rpc).toHaveBeenLastCalledWith(
      'confirm_aircraft_document_download_issued',
      expect.objectContaining({ p_file_id: fileId }),
    );
  });

  it('does not record download issuance when Storage signing fails', async () => {
    const fileId = 'a0000000-0000-4000-8000-000000000003';
    const objectKey = `${organizationId}/${aircraftId}/${fileId}/${fileId}.pdf`;
    const deps = dependencies({
      rpc: vi.fn().mockResolvedValue({
        decision: 'authorized',
        fileId,
        bucketId: 'aircraft-documents',
        objectKey,
        downloadName: 'record.pdf',
        mediaType: 'application/pdf',
        correlationId,
      }),
      createSignedDownload: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    });

    const response = await createAircraftDocumentHandler(deps)(
      request({ action: 'attachment_download', fileId }),
    );
    expect(response.status).toBe(503);
    expect(deps.rpc).toHaveBeenCalledTimes(1);
  });

  it('validates staged bytes before marking an attachment clean', async () => {
    const fileId = 'a0000000-0000-4000-8000-000000000002';
    const objectKey = `${organizationId}/${aircraftId}/${fileId}/${fileId}.png`;
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(bytes.buffer).setUint32(16, 10);
    new DataView(bytes.buffer).setUint32(20, 10);
    const expectedHash = await crypto.subtle
      .digest('SHA-256', Uint8Array.from(bytes).buffer)
      .then((value) =>
        [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      );
    const rpc = vi.fn().mockImplementation((name: string) =>
      Promise.resolve(
        name === 'get_aircraft_document_staged_file'
          ? {
              decision: 'found',
              fileId,
              objectKey,
              mediaType: 'image/png',
              sizeBytes: bytes.length,
              sha256Hash: expectedHash,
              scanState: 'staged',
            }
          : { decision: 'completed', fileId, scanState: 'clean', correlationId },
      ),
    );
    const deps = dependencies({ rpc, downloadStagedFile: vi.fn().mockResolvedValue(bytes) });
    const response = await createAircraftDocumentHandler(deps)(
      request({ action: 'file_complete', fileId, idempotencyKey: 'e'.repeat(32) }),
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'complete_aircraft_document_file',
      expect.objectContaining({ p_scan_state: 'clean', p_verified_size_bytes: bytes.length }),
    );
  });
});
