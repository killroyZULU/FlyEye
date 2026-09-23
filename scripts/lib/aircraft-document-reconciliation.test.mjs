import { describe, expect, it, vi } from 'vitest';

import {
  collectAircraftDocumentObjectHashes,
  reconcileAircraftDocumentStorage,
} from './aircraft-document-reconciliation.mjs';

describe('aircraft document storage reconciliation', () => {
  it('recursively hashes private objects without exposing their contents', async () => {
    const organizationId = '10000000-0000-4000-8000-000000000001';
    const list = vi.fn(async (path) => {
      const name = path.split('/').at(-1);
      if (path === organizationId) return { data: [{ id: null, name: 'aircraft' }], error: null };
      if (name === 'aircraft') return { data: [{ id: null, name: 'file' }], error: null };
      if (name === 'file') return { data: [{ id: 'object-id', name: 'record.pdf' }], error: null };
      return { data: [], error: null };
    });
    const download = vi.fn().mockResolvedValue({
      data: new Blob(['synthetic']),
      error: null,
    });
    const client = {
      storage: { from: vi.fn().mockReturnValue({ list, download }) },
    };
    await expect(collectAircraftDocumentObjectHashes(client, organizationId)).resolves.toEqual({
      [`${organizationId}/aircraft/file/record.pdf`]: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('submits only object hashes to the trusted reconciliation function', async () => {
    const organizationId = '10000000-0000-4000-8000-000000000001';
    const correlationId = '20000000-0000-4000-8000-000000000001';
    const rpc = vi.fn().mockResolvedValue({
      data: { decision: 'ready', failureCount: 0, failures: [], correlationId },
      error: null,
    });
    const client = {
      storage: {
        from: vi
          .fn()
          .mockReturnValue({ list: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      },
      rpc,
    };
    await reconcileAircraftDocumentStorage(client, organizationId, correlationId);
    expect(rpc).toHaveBeenCalledWith('reconcile_aircraft_document_storage', {
      p_organization_id: organizationId,
      p_observed_hashes: {},
      p_correlation_id: correlationId,
    });
  });
});
