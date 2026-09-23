import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../lib/database.types';
import { AircraftDocumentError, SupabaseAircraftDocumentGateway } from './document-gateway';

/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest matchers inspect dynamic SDK calls. */

const correlationId = '40000000-0000-4000-8000-000000000001';
const aircraftId = '10000000-0000-4000-8000-000000000001';
const categoryId = '20000000-0000-4000-8000-000000000001';

function gateway(invoke: ReturnType<typeof vi.fn>, storage: object = {}) {
  const client = { functions: { invoke }, storage } as unknown as SupabaseClient<Database>;
  return new SupabaseAircraftDocumentGateway(client);
}

describe('Supabase aircraft document gateway', () => {
  it.each([
    ['assignCategory', 'assign_category', 'category_assign', 'category_assigned'],
    ['renameCategory', 'rename_category', 'category_rename', 'category_renamed'],
    ['removeCategory', 'remove_category', 'category_remove', 'category_removed'],
    ['archiveCategory', 'archive_category', 'category_archive', 'category_archived'],
  ] as const)(
    'preserves the API discriminator for %s with UI retry metadata',
    async (method, uiAction, apiAction, decision) => {
      const invoke = vi.fn().mockResolvedValue({
        data: {
          decision,
          categoryId,
          categoryCode: 'custom_record',
          categoryLabel: 'Custom record',
          categoryState: 'active',
          categoryVersion: 2,
          requirementId: null,
          requirementVersion: null,
          replayed: false,
          correlationId,
        },
        error: null,
      });
      const request = {
        action: uiAction,
        categoryId,
        aircraftId,
        categoryLabel: 'Custom record',
        expectedVersion: 1,
        idempotencyKey: 'b'.repeat(32),
      };
      await gateway(invoke)[method](request);
      expect(invoke).toHaveBeenCalledWith(
        'aircraft-documents',
        expect.objectContaining({ body: { ...request, action: apiAction } }),
      );
    },
  );

  it('validates status and category mutation responses', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          decision: 'listed',
          aircraft: { id: aircraftId, label: 'RP-C123' },
          items: [],
          availableCustomCategories: [],
          calculatedOn: '2026-09-02',
          correlationId,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          decision: 'category_renamed',
          categoryId,
          categoryCode: 'custom_record',
          categoryLabel: 'Radio License',
          categoryState: 'active',
          categoryVersion: 2,
          requirementId: null,
          requirementVersion: null,
          replayed: false,
          correlationId,
        },
        error: null,
      });
    const subject = gateway(invoke);
    await expect(subject.listStatus(aircraftId)).resolves.toMatchObject({
      calculatedOn: '2026-09-02',
    });
    await expect(
      subject.renameCategory({
        categoryId,
        categoryLabel: 'Radio License',
        expectedVersion: 1,
        idempotencyKey: 'a'.repeat(32),
      }),
    ).resolves.toMatchObject({ decision: 'category_renamed', categoryVersion: 2 });
  });

  it('maps stable Edge errors and fails closed on malformed results', async () => {
    const context = Response.json(
      { error: { code: 'aircraft_documents.audit_failed' } },
      { status: 503 },
    );
    await expect(
      gateway(vi.fn().mockResolvedValue({ data: null, error: { context } })).listAircraft(),
    ).rejects.toMatchObject({
      code: 'audit_failed',
      message: 'The required document audit could not be recorded.',
    });
    await expect(
      gateway(
        vi.fn().mockResolvedValue({ data: { decision: 'listed' }, error: null }),
      ).listAircraft(),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      gateway(vi.fn().mockRejectedValue(new Error('offline'))).detail(categoryId),
    ).rejects.toBeInstanceOf(AircraftDocumentError);
  });

  it('uploads through a signed private path and completes deterministic scanning', async () => {
    const fileId = '30000000-0000-4000-8000-000000000001';
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        data: { decision: 'staged', fileId, uploadPath: 'private/path', uploadToken: 'token' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { decision: 'completed', fileId, scanState: 'clean', correlationId },
        error: null,
      });
    const uploadToSignedUrl = vi.fn().mockResolvedValue({ error: new Error('uncertain response') });
    const subject = gateway(invoke, {
      from: vi.fn().mockReturnValue({ uploadToSignedUrl }),
    });
    const file = new File(['synthetic'], 'record.pdf', { type: 'application/pdf' });
    const idempotencyKey = 'f'.repeat(32);
    await expect(subject.upload(aircraftId, file, idempotencyKey)).resolves.toBe(fileId);
    expect(uploadToSignedUrl).toHaveBeenCalledWith('private/path', 'token', file, {
      contentType: 'application/pdf',
    });
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'aircraft-documents',
      expect.objectContaining({
        body: expect.objectContaining({
          action: 'file_initiate',
          idempotencyKey,
          sha256Hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    );
  });

  it('resumes an already-clean upload attempt without replacing the private object', async () => {
    const fileId = '30000000-0000-4000-8000-000000000001';
    const invoke = vi.fn().mockResolvedValue({
      data: { decision: 'completed', fileId, scanState: 'clean', correlationId },
      error: null,
    });
    const uploadToSignedUrl = vi.fn();
    const subject = gateway(invoke, {
      from: vi.fn().mockReturnValue({ uploadToSignedUrl }),
    });
    const file = new File(['synthetic'], 'record.pdf', { type: 'application/pdf' });
    await expect(subject.upload(aircraftId, file, 'e'.repeat(32))).resolves.toBe(fileId);
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });
});
