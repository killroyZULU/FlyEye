import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AircraftDocumentDetail, AircraftDocumentVersion } from '../aircraft-documents';
import { AircraftDocumentDetailView } from './AircraftDocumentDetailView';

const version: AircraftDocumentVersion = {
  id: '10000000-0000-4000-8000-000000000001',
  versionNumber: 2,
  versionKind: 'renewal',
  title: 'Registration Certificate',
  source: 'Synthetic Authority',
  referenceNumber: 'REF-2',
  issueDate: '2026-09-01',
  expirationDate: '2027-09-01',
  notes: 'Synthetic note',
  versionReason: 'Annual renewal recorded',
  createdAt: '2026-09-02T00:00:00Z',
  hasAttachment: true,
  attachment: {
    id: '20000000-0000-4000-8000-000000000001',
    displayName: 'record.pdf',
    mediaType: 'application/pdf',
    sizeBytes: 1024,
    scanState: 'clean',
  },
};

const detail: AircraftDocumentDetail = {
  id: '30000000-0000-4000-8000-000000000001',
  aircraftId: '40000000-0000-4000-8000-000000000001',
  aircraftLabel: 'RP-C123 · Cessna 172S',
  categoryId: '50000000-0000-4000-8000-000000000001',
  categoryCode: 'registration_certificate',
  categoryLabel: 'Registration Certificate',
  documentState: 'active',
  aggregateVersion: 3,
  status: 'valid',
  calculatedOn: '2026-09-02',
  currentVersion: version,
};

describe('AircraftDocumentDetailView', () => {
  it('shows Admin metadata/history and wires renewal, download, and reasoned suspension', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDownload = vi.fn();
    const onLifecycle = vi.fn();
    render(
      <AircraftDocumentDetailView
        detail={detail}
        history={[version]}
        canManage
        canReadAttachment
        busy={false}
        onBack={vi.fn()}
        onEdit={onEdit}
        onLifecycle={onLifecycle}
        onDownload={onDownload}
      />,
    );
    expect(screen.getByText('Synthetic Authority')).toBeInTheDocument();
    expect(screen.getByText(/Version 2 · renewal/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download private file' }));
    expect(onDownload).toHaveBeenCalledWith(version.attachment?.id);
    await user.click(screen.getByRole('button', { name: 'Renew' }));
    expect(onEdit).toHaveBeenCalledWith('renew');
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    await user.type(
      screen.getByLabelText('Administrative reason'),
      'Administrative review pending',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onLifecycle).toHaveBeenCalledWith('suspend', 'Administrative review pending');
  });

  it('keeps management actions out of a read-only detail rendering', () => {
    render(
      <AircraftDocumentDetailView
        detail={{ ...detail, documentState: 'suspended', status: 'suspended' }}
        history={[]}
        canManage={false}
        canReadAttachment={false}
        busy={false}
        message="Synthetic warning"
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onLifecycle={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic warning');
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
    expect(screen.queryByText('record.pdf')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download private file' })).not.toBeInTheDocument();
  });
});
