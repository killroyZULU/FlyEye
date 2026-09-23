import { describe, expect, it } from 'vitest';

import {
  aircraftDocumentCapabilities,
  documentStatusLabel,
  documentStatusListSchema,
  validateDocumentForm,
} from './aircraft-documents';

const correlationId = '40000000-0000-4000-8000-000000000001';

describe('aircraft document browser contracts', () => {
  it('normalizes valid metadata without inferring an operational result', () => {
    expect(
      validateDocumentForm({
        documentTitle: '  Registration  ',
        documentSource: ' Synthetic Authority ',
        referenceNumber: ' ',
        issueDate: '',
        expirationDate: '2027-09-01',
        notes: ' Record note ',
      }),
    ).toEqual({
      success: true,
      data: {
        documentTitle: 'Registration',
        documentSource: 'Synthetic Authority',
        referenceNumber: null,
        issueDate: null,
        expirationDate: '2027-09-01',
        notes: 'Record note',
        storedFileId: null,
      },
    });
    expect(documentStatusLabel('expiring_soon')).toBe('Expiring Soon');
    expect(documentStatusLabel('missing')).toBe('Missing');
  });

  it('returns bounded field validation messages', () => {
    const result = validateDocumentForm({
      documentTitle: '',
      documentSource: 'x'.repeat(161),
      referenceNumber: 'x'.repeat(161),
      expirationDate: '',
      notes: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.messages).toHaveLength(5);
  });

  it('derives attachment visibility from its distinct permission', () => {
    expect(aircraftDocumentCapabilities(['aircraft.document.read'])).toMatchObject({
      canReadDetails: true,
      canReadAttachment: false,
    });
  });

  it('rejects status responses containing Admin-only metadata or unknown fields', () => {
    expect(
      documentStatusListSchema.safeParse({
        decision: 'listed',
        aircraft: { id: '10000000-0000-4000-8000-000000000001', label: 'RP-C123' },
        items: [],
        availableCustomCategories: [],
        calculatedOn: '2026-09-02',
        correlationId,
        attachmentName: 'private.pdf',
      }).success,
    ).toBe(false);
  });
});
