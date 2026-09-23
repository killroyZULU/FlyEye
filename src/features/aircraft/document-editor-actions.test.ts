import { describe, expect, it, vi } from 'vitest';

import type { AircraftDocumentGateway } from './document-gateway';
import { saveAircraftDocument, type UploadCache } from './document-editor-actions';
import type { PendingAircraftAttempt } from './idempotency-retry';

describe('saveAircraftDocument', () => {
  it('keeps the upload idempotency key across an uncertain file retry', async () => {
    const file = new File(['synthetic'], 'record.pdf', { type: 'application/pdf' });
    const upload = vi
      .fn<AircraftDocumentGateway['upload']>()
      .mockRejectedValueOnce(new Error('uncertain upload'))
      .mockResolvedValueOnce('30000000-0000-4000-8000-000000000001');
    const create = vi.fn().mockResolvedValue({
      decision: 'created',
      documentId: '40000000-0000-4000-8000-000000000001',
      aggregateVersion: 1,
      documentState: 'active',
      currentVersionId: '50000000-0000-4000-8000-000000000001',
      currentVersionNumber: 1,
      replayed: false,
      correlationId: '60000000-0000-4000-8000-000000000001',
    });
    const gateway = { upload, create } as unknown as AircraftDocumentGateway;
    const uploadCache: { current: UploadCache } = { current: undefined };
    const mutationAttempt: { current: PendingAircraftAttempt } = { current: undefined };
    const request = {
      gateway,
      aircraftId: '10000000-0000-4000-8000-000000000001',
      categoryId: '20000000-0000-4000-8000-000000000001',
      mode: 'create' as const,
      values: {
        success: true as const,
        data: {
          documentTitle: 'Registration Certificate',
          documentSource: 'Synthetic Authority',
          referenceNumber: null,
          issueDate: null,
          expirationDate: '2027-09-03',
          notes: null,
          storedFileId: null,
        },
      },
      reason: '',
      file,
      metadataOnly: false,
      uploadCache,
      mutationAttempt,
    };

    await expect(saveAircraftDocument(request)).rejects.toThrow('uncertain upload');
    await expect(saveAircraftDocument(request)).resolves.toMatchObject({ decision: 'created' });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0]?.[2]).toBe(upload.mock.calls[1]?.[2]);
    expect(upload.mock.calls[0]?.[2]).toMatch(/^[0-9a-f]{32}$/);
  });
});
