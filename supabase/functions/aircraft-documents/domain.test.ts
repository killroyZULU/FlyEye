import { describe, expect, it } from 'vitest';

import {
  aircraftDocumentRequestSchema,
  canonicalDocumentMutationPayload,
  normalizeCategoryLabel,
  normalizeDisplayName,
  normalizeDocumentMetadata,
  normalizeLifecycleReason,
} from './domain';

const aircraftId = '10000000-0000-4000-8000-000000000001';
const categoryId = '20000000-0000-4000-8000-000000000001';

describe('aircraft document domain', () => {
  it('accepts bounded requests and rejects unknown or malformed fields', () => {
    expect(
      aircraftDocumentRequestSchema.safeParse({
        action: 'create',
        aircraftId,
        categoryId,
        documentTitle: 'Certificate',
        documentSource: 'Synthetic Authority',
        expirationDate: '2027-09-01',
        idempotencyKey: 'a'.repeat(32),
      }).success,
    ).toBe(true);
    expect(
      aircraftDocumentRequestSchema.safeParse({
        action: 'status_list',
        aircraftId,
        organizationId: aircraftId,
      }).success,
    ).toBe(false);
    expect(
      aircraftDocumentRequestSchema.safeParse({
        action: 'file_initiate',
        aircraftId,
        displayName: 'record.pdf',
        mediaType: 'text/html',
        sizeBytes: 1,
        sha256Hash: 'a'.repeat(64),
        idempotencyKey: 'b'.repeat(32),
      }).success,
    ).toBe(false);
  });

  it('normalizes approved metadata and produces a canonical retry payload', () => {
    const request = aircraftDocumentRequestSchema.parse({
      action: 'renew',
      aircraftId,
      categoryId,
      documentId: '30000000-0000-4000-8000-000000000001',
      expectedVersion: 2,
      documentTitle: '  Certificate  ',
      documentSource: 'Synthetic Authority',
      referenceNumber: ' ',
      issueDate: '2026-09-01',
      expirationDate: '2027-09-01',
      notes: null,
      reason: 'Annual renewal recorded',
      idempotencyKey: 'c'.repeat(32),
    });
    if (request.action !== 'renew') throw new Error('Unexpected test request.');
    const normalized = normalizeDocumentMetadata(request);
    expect(normalized).toMatchObject({
      documentTitle: 'Certificate',
      referenceNumber: null,
      issueDate: '2026-09-01',
      reason: 'Annual renewal recorded',
    });
    expect(JSON.parse(canonicalDocumentMutationPayload(request, normalized))).toEqual({
      action: 'renew',
      ...normalized,
    });
  });

  it('rejects invalid dates, control characters, unusual separators, and short reasons', () => {
    const invalidDate = aircraftDocumentRequestSchema.parse({
      action: 'create',
      aircraftId,
      categoryId,
      documentTitle: 'Certificate',
      documentSource: 'Authority',
      expirationDate: '2026-02-30',
      idempotencyKey: 'd'.repeat(32),
    });
    if (invalidDate.action !== 'create') throw new Error('Unexpected test request.');
    expect(() => normalizeDocumentMetadata(invalidDate)).toThrow('date validation');
    expect(() => normalizeCategoryLabel('Bad\u0000label')).toThrow('text validation');
    expect(() => normalizeDisplayName('bad\u2013name.pdf')).toThrow('text validation');
    expect(() => normalizeLifecycleReason('too short')).toThrow('reason validation');
  });
});
