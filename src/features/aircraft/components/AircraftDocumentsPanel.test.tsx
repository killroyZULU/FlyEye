import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentStatusList } from '../aircraft-documents';
import type { AircraftDocumentGateway } from '../document-gateway';
import { AircraftDocumentsPanel } from './AircraftDocumentsPanel';

/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies injected gateway mocks. */

const aircraftId = '10000000-0000-4000-8000-000000000001';
const systemCategoryId = '20000000-0000-4000-8000-000000000001';
const customCategoryId = '20000000-0000-4000-8000-000000000002';
const availableCategoryId = '20000000-0000-4000-8000-000000000004';
const requirementId = '30000000-0000-4000-8000-000000000001';
const correlationId = '40000000-0000-4000-8000-000000000001';

const items: DocumentStatusList['items'] = [
  {
    categoryId: systemCategoryId,
    categoryCode: 'airworthiness',
    categoryLabel: 'Airworthiness Certificate',
    categoryKind: 'system',
    categoryVersion: 1,
    requirementId: null,
    requirementVersion: null,
    documentId: null,
    aggregateVersion: null,
    status: 'missing',
    expirationDate: null,
    calculatedOn: '2026-09-02',
  },
  {
    categoryId: customCategoryId,
    categoryCode: 'custom_radio',
    categoryLabel: 'Radio License',
    categoryKind: 'custom',
    categoryVersion: 2,
    requirementId,
    requirementVersion: 3,
    documentId: null,
    aggregateVersion: null,
    status: 'missing',
    expirationDate: null,
    calculatedOn: '2026-09-02',
  },
];

function gateway(overrides: Partial<AircraftDocumentGateway> = {}): AircraftDocumentGateway {
  return {
    listAircraft: vi.fn().mockResolvedValue({
      decision: 'listed',
      aircraft: [{ id: aircraftId, label: 'RP-C123 · Cessna 172S' }],
      page: 1,
      pageSize: 25,
      hasNext: false,
      correlationId,
    }),
    listStatus: vi.fn().mockResolvedValue({
      decision: 'listed',
      aircraft: { id: aircraftId, label: 'RP-C123 · Cessna 172S' },
      items,
      availableCustomCategories: [
        {
          categoryId: availableCategoryId,
          categoryCode: 'custom_insurance',
          categoryLabel: 'Insurance',
          categoryVersion: 4,
        },
      ],
      calculatedOn: '2026-09-02',
      correlationId,
    }),
    detail: vi.fn(),
    history: vi.fn(),
    create: vi.fn().mockResolvedValue({
      decision: 'created',
      documentId: '50000000-0000-4000-8000-000000000001',
      aggregateVersion: 1,
      documentState: 'active',
      currentVersionId: '60000000-0000-4000-8000-000000000001',
      currentVersionNumber: 1,
      replayed: false,
      correlationId,
    }),
    renew: vi.fn(),
    correct: vi.fn(),
    suspend: vi.fn(),
    restore: vi.fn(),
    createCategory: vi.fn().mockResolvedValue({
      decision: 'category_created',
      categoryId: '20000000-0000-4000-8000-000000000003',
      categoryCode: 'custom_insurance',
      categoryLabel: 'Insurance',
      categoryState: 'active',
      categoryVersion: 1,
      requirementId: null,
      requirementVersion: null,
      replayed: false,
      correlationId,
    }),
    renameCategory: vi.fn().mockResolvedValue({}),
    assignCategory: vi.fn().mockResolvedValue({}),
    removeCategory: vi.fn().mockResolvedValue({}),
    archiveCategory: vi.fn().mockResolvedValue({}),
    listNotifications: vi.fn().mockResolvedValue({ items: [], page: 1, hasNext: false }),
    openNotification: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
    ...overrides,
  };
}

function panel(subject: AircraftDocumentGateway, canManage = true) {
  return render(
    <AircraftDocumentsPanel
      gateway={subject}
      canReadDetails={canManage}
      canReadAttachment={canManage}
      canManage={canManage}
      canManageCategories={canManage}
      canReadNotifications={canManage}
      onClose={vi.fn()}
      onAccessRevoked={vi.fn()}
      onRequirePassword={vi.fn()}
    />,
  );
}

describe('AircraftDocumentsPanel', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('shows bounded status-only rows without Admin metadata or actions', async () => {
    const subject = gateway({
      listStatus: vi.fn().mockResolvedValue({
        decision: 'listed',
        aircraft: { id: aircraftId, label: 'RP-C123 · Cessna 172S' },
        items: [
          {
            ...items[0]!,
            documentId: '50000000-0000-4000-8000-000000000001',
            aggregateVersion: 1,
            status: 'valid',
            expirationDate: '2027-09-02',
          },
        ],
        availableCustomCategories: [],
        calculatedOn: '2026-09-02',
        correlationId,
      }),
    });
    panel(subject, false);
    expect(await screen.findByText('Airworthiness Certificate')).toBeInTheDocument();
    expect(screen.getByText(/not an airworthiness or dispatch decision/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add document' })).not.toBeInTheDocument();
    expect(screen.queryByText('Private attachment')).not.toBeInTheDocument();
    expect(subject.listNotifications).not.toHaveBeenCalled();
  });

  it.each(['Renew', 'Correct'])(
    'loads later pages and edits the notification aircraft with %s',
    async (action) => {
      const secondAircraftId = '10000000-0000-4000-8000-000000000002';
      const documentId = '50000000-0000-4000-8000-000000000002';
      const secondAircraft = { id: secondAircraftId, label: 'RP-C456 · Second trainer' };
      const currentVersion = {
        id: '60000000-0000-4000-8000-000000000002',
        versionNumber: 2,
        versionKind: 'renewal',
        title: 'Second aircraft certificate',
        source: 'Synthetic Authority',
        referenceNumber: null,
        issueDate: null,
        expirationDate: '2026-09-02',
        notes: null,
        versionReason: 'Synthetic renewal',
        createdAt: '2026-09-02T00:00:00Z',
        hasAttachment: false,
        attachment: null,
      };
      const secondStatus = {
        aircraft: secondAircraft,
        items: [{ ...items[0]!, documentId, aggregateVersion: 2, status: 'expired' }],
        availableCustomCategories: [],
      };
      const listStatus = vi.fn().mockResolvedValue({
        aircraft: { id: aircraftId, label: 'RP-C123 · Cessna 172S' },
        items,
        availableCustomCategories: [],
      });
      const subject = gateway({
        listAircraft: vi
          .fn()
          .mockResolvedValueOnce({
            aircraft: [{ id: aircraftId, label: 'RP-C123' }],
            page: 1,
            hasNext: true,
          })
          .mockResolvedValueOnce({ aircraft: [secondAircraft], page: 2, hasNext: false }),
        listStatus,
        listNotifications: vi
          .fn()
          .mockResolvedValueOnce({ items: [], page: 1, hasNext: true })
          .mockResolvedValueOnce({
            items: [
              {
                id: '70000000-0000-4000-8000-000000000002',
                documentId,
                documentVersionId: currentVersion.id,
                aircraftRegistration: 'RP-C456',
                categoryLabel: 'Airworthiness Certificate',
                eventKind: 'expiration',
                expirationDate: '2026-09-02',
              },
            ],
            page: 2,
            hasNext: false,
          }),
        openNotification: vi.fn().mockResolvedValue(documentId),
        detail: vi.fn().mockResolvedValue({
          id: documentId,
          aircraftId: secondAircraftId,
          aircraftLabel: secondAircraft.label,
          categoryId: systemCategoryId,
          categoryCode: 'airworthiness',
          categoryLabel: 'Airworthiness Certificate',
          documentState: 'active',
          aggregateVersion: 2,
          status: 'expired',
          calculatedOn: '2026-09-05',
          currentVersion,
        }),
        history: vi
          .fn()
          .mockResolvedValueOnce({ items: [currentVersion], page: 1, hasNext: true })
          .mockResolvedValueOnce({
            items: [
              {
                ...currentVersion,
                id: '60000000-0000-4000-8000-000000000001',
                versionNumber: 1,
                versionKind: 'initial',
              },
            ],
            page: 2,
            hasNext: false,
          }),
      });
      const user = userEvent.setup();
      panel(subject);
      await screen.findByText('Radio License');
      await user.click(screen.getByRole('button', { name: 'Load more aircraft' }));
      expect(await screen.findByRole('option', { name: secondAircraft.label })).toBeInTheDocument();
      expect(subject.listAircraft).toHaveBeenLastCalledWith(2);
      expect(screen.queryByRole('button', { name: 'Load more aircraft' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Load more notifications' }));
      expect(subject.listNotifications).toHaveBeenLastCalledWith(2);
      listStatus.mockResolvedValue(secondStatus);
      await user.click(
        await screen.findByRole('button', { name: /RP-C456.*Airworthiness Certificate/ }),
      );
      expect(await screen.findByText('Second aircraft certificate')).toBeInTheDocument();
      expect(listStatus).toHaveBeenLastCalledWith(secondAircraftId);
      await user.click(screen.getByRole('button', { name: 'Load older versions' }));
      expect(await screen.findByText('Version 1 · initial')).toBeInTheDocument();
      expect(subject.history).toHaveBeenLastCalledWith(documentId, 2);
      expect(screen.queryByRole('button', { name: 'Load older versions' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: action }));
      expect(await screen.findByLabelText('Document title')).toHaveValue(
        'Second aircraft certificate',
      );
      expect(screen.getByText(secondAircraft.label)).toBeInTheDocument();
    },
  );

  it('creates metadata and preserves the same retry key after an uncertain response', async () => {
    const create = vi
      .fn<AircraftDocumentGateway['create']>()
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValueOnce({
        decision: 'created',
        documentId: '50000000-0000-4000-8000-000000000001',
        aggregateVersion: 1,
        documentState: 'active',
        currentVersionId: '60000000-0000-4000-8000-000000000001',
        currentVersionNumber: 1,
        replayed: false,
        correlationId,
      });
    const subject = gateway({ create });
    const user = userEvent.setup();
    panel(subject);
    await user.click((await screen.findAllByRole('button', { name: 'Add document' }))[0]!);
    await user.type(screen.getByLabelText('Document title'), 'Registration');
    await user.type(screen.getByLabelText('Source or issuing authority'), 'Synthetic Authority');
    await user.type(screen.getByLabelText('Expiration date'), '2027-09-01');
    await user.click(screen.getByRole('button', { name: 'Add document' }));
    expect(await screen.findByText('temporarily unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add document' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[0]?.[0].idempotencyKey).toBe(create.mock.calls[1]?.[0].idempotencyKey);
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        aircraftId,
        categoryId: systemCategoryId,
        documentTitle: 'Registration',
        expirationDate: '2027-09-01',
      }),
    );
  });

  it('manages custom category rename, removal, archival, and creation with versions', async () => {
    const subject = gateway();
    const user = userEvent.setup();
    panel(subject);
    await screen.findByText('Radio License');

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const name = screen.getByLabelText('Category name');
    await user.clear(name);
    await user.type(name, 'Station License');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() =>
      expect(subject.renameCategory).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: customCategoryId,
          categoryLabel: 'Station License',
          expectedVersion: 2,
        }),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(subject.removeCategory).toHaveBeenCalledWith(
        expect.objectContaining({ expectedVersion: 3, aircraftId }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Archive category' }));
    await waitFor(() =>
      expect(subject.archiveCategory).toHaveBeenCalledWith(
        expect.objectContaining({ expectedVersion: 2 }),
      ),
    );

    await user.type(screen.getByLabelText('New custom category'), 'Insurance');
    await user.click(screen.getByRole('button', { name: 'Add to this aircraft' }));
    await waitFor(() => expect(subject.createCategory).toHaveBeenCalled());
    expect(subject.assignCategory).toHaveBeenCalledWith(
      expect.objectContaining({ aircraftId, expectedVersion: 1 }),
    );

    await user.selectOptions(
      screen.getByLabelText('Existing custom category'),
      availableCategoryId,
    );
    await user.click(screen.getByRole('button', { name: 'Assign to this aircraft' }));
    await waitFor(() =>
      expect(subject.assignCategory).toHaveBeenCalledWith(
        expect.objectContaining({
          aircraftId,
          categoryId: availableCategoryId,
          expectedVersion: 4,
        }),
      ),
    );
  });
});
