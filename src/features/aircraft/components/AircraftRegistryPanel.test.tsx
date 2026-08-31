import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AircraftRegistryError, type AircraftRegistryGateway } from '../gateway';
import { AircraftRegistryPanel } from './AircraftRegistryPanel';

/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies injected gateway mocks. */

const record = {
  id: '50000000-0000-4000-8000-000000000001',
  registrationMark: 'RP-C123',
  manufacturer: 'Cessna',
  model: '172S',
  registryState: 'tracked' as const,
  version: 1,
  updatedAt: '2026-08-29T00:00:00Z',
};
const correlationId = '40000000-0000-4000-8000-000000000001';

function gateway(overrides: Partial<AircraftRegistryGateway> = {}): AircraftRegistryGateway {
  return {
    list: vi.fn().mockResolvedValue({
      decision: 'listed',
      records: [record],
      page: 1,
      pageSize: 25,
      hasNext: false,
      correlationId,
    }),
    get: vi.fn().mockResolvedValue(record),
    create: vi.fn().mockResolvedValue({
      decision: 'created',
      record,
      replayed: false,
      correlationId,
    }),
    update: vi.fn().mockResolvedValue({
      decision: 'updated',
      record: { ...record, version: 2 },
      replayed: false,
      correlationId,
    }),
    archive: vi.fn().mockResolvedValue({
      decision: 'archived',
      record: { ...record, registryState: 'archived', version: 2 },
      replayed: false,
      correlationId,
    }),
    reactivate: vi.fn().mockResolvedValue({
      decision: 'reactivated',
      record: { ...record, version: 3 },
      replayed: false,
      correlationId,
    }),
    ...overrides,
  };
}

describe('AircraftRegistryPanel', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('loads records, searches literally, and preserves filters', async () => {
    const subject = gateway();
    const user = userEvent.setup();
    render(
      <AircraftRegistryPanel
        gateway={subject}
        organizationName="Synthetic Flight School"
        canManage
        onClose={vi.fn()}
        onAccessRevoked={vi.fn()}
      />,
    );
    expect(await screen.findByText('RP-C123')).toBeInTheDocument();
    const searchField = screen.getByLabelText(/Search registration/);
    expect(searchField).not.toHaveAttribute('maxlength');
    await user.type(searchField, '%_');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(screen.getByRole('checkbox', { name: 'Include archived' }));
    await waitFor(() =>
      expect(subject.list).toHaveBeenLastCalledWith({
        search: '%_',
        includeArchived: true,
        page: 1,
      }),
    );
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
    await waitFor(() =>
      expect(subject.list).toHaveBeenLastCalledWith({
        search: '%_',
        includeArchived: true,
        page: 1,
      }),
    );
  });

  it('edits a Tracked record and preserves entered values through the editor', async () => {
    const subject = gateway();
    const user = userEvent.setup();
    render(
      <AircraftRegistryPanel
        gateway={subject}
        organizationName="School"
        canManage
        onClose={vi.fn()}
        onAccessRevoked={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Edit record' }));
    expect(screen.getByRole('heading', { name: 'Edit RP-C123' })).toHaveFocus();
    const model = screen.getByLabelText('Model');
    expect(model).not.toHaveAttribute('maxlength');
    await user.clear(model);
    await user.type(model, '172N');
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(subject.update).toHaveBeenCalled());
    expect(subject.update).toHaveBeenCalledWith(
      expect.objectContaining({ model: '172N', recordId: record.id, expectedVersion: 1 }),
    );
  });

  it('ignores an older response after filter criteria changes', async () => {
    const user = userEvent.setup();
    const oldRecord = {
      ...record,
      id: '50000000-0000-4000-8000-000000000002',
      registrationMark: 'OLD-1',
    };
    const newRecord = {
      ...record,
      id: '50000000-0000-4000-8000-000000000003',
      registrationMark: 'NEW-1',
    };
    type ListResult = Awaited<ReturnType<AircraftRegistryGateway['list']>>;
    let resolveOld!: (value: ListResult) => void;
    let resolveNew!: (value: ListResult) => void;
    let oldFinished = false;
    const list = vi
      .fn<AircraftRegistryGateway['list']>()
      .mockResolvedValueOnce({
        decision: 'listed',
        records: [record],
        page: 1,
        pageSize: 25,
        hasNext: false,
        correlationId,
      })
      .mockImplementationOnce(() =>
        new Promise<ListResult>((resolve) => {
          resolveOld = resolve;
        }).then((value) => {
          oldFinished = true;
          return value;
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ListResult>((resolve) => {
            resolveNew = resolve;
          }),
      );
    render(
      <AircraftRegistryPanel
        gateway={gateway({ list })}
        organizationName="School"
        canManage
        onClose={vi.fn()}
        onAccessRevoked={vi.fn()}
      />,
    );
    expect(await screen.findByText('RP-C123')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Search registration/), 'old');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(screen.getByRole('checkbox', { name: 'Include archived' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    act(() => {
      resolveNew({
        decision: 'listed',
        records: [newRecord],
        page: 1,
        pageSize: 25,
        hasNext: false,
        correlationId,
      });
    });
    expect(await screen.findByText('NEW-1')).toBeInTheDocument();
    act(() => {
      resolveOld({
        decision: 'listed',
        records: [oldRecord],
        page: 1,
        pageSize: 25,
        hasNext: false,
        correlationId,
      });
    });
    await waitFor(() => expect(oldFinished).toBe(true));
    expect(screen.getByText('NEW-1')).toBeInTheDocument();
    expect(screen.queryByText('OLD-1')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include archived' })).toBeChecked();
  });

  it('traps modal focus, closes on Escape, and restores the triggering focus', async () => {
    const subject = gateway();
    const user = userEvent.setup();
    render(
      <AircraftRegistryPanel
        gateway={subject}
        organizationName="School"
        canManage
        onClose={vi.fn()}
        onAccessRevoked={vi.fn()}
      />,
    );
    const archiveButton = await screen.findByRole('button', { name: 'Archive record' });
    await user.click(archiveButton);
    const dialog = screen.getByRole('dialog');
    const heading = screen.getByRole('heading', { name: 'Archive RP-C123?' });
    expect(dialog).toBeInTheDocument();
    expect(heading).toHaveFocus();
    expect(dialog.previousElementSibling).toHaveAttribute('inert');
    await user.tab();
    expect(screen.getByLabelText('Reason')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Confirm archive' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(heading).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(archiveButton).toHaveFocus());
  });

  it('keeps current-session results visible and disables mutation when offline', async () => {
    const user = userEvent.setup();
    render(
      <AircraftRegistryPanel
        gateway={gateway()}
        organizationName="School"
        canManage
        onClose={vi.fn()}
        onAccessRevoked={vi.fn()}
      />,
    );
    expect(await screen.findByText('RP-C123')).toBeInTheDocument();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    expect(await screen.findByText(/current-session results may be stale/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add aircraft' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
  });

  it('distinguishes loading, empty, filtered-empty, read-only, and service-error states', async () => {
    const user = userEvent.setup();
    const emptyGateway = gateway({
      list: vi.fn().mockResolvedValue({
        decision: 'listed',
        records: [],
        page: 1,
        pageSize: 25,
        hasNext: false,
        correlationId,
      }),
    });
    const { unmount } = render(
      <AircraftRegistryPanel
        gateway={emptyGateway}
        organizationName="School"
        canManage={false}
        onClose={vi.fn()}
        onAccessRevoked={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading aircraft registry…')).toBeInTheDocument();
    expect(await screen.findByText('No Tracked aircraft records yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add aircraft' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Search registration/), 'missing');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No aircraft match these filters.')).toBeInTheDocument();
    unmount();

    render(
      <AircraftRegistryPanel
        gateway={gateway({
          list: vi
            .fn()
            .mockRejectedValue(
              new AircraftRegistryError('service_unavailable', 'Registry unavailable.'),
            ),
        })}
        organizationName="School"
        canManage
        onClose={vi.fn()}
        onAccessRevoked={vi.fn()}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Registry unavailable.');
  });

  it('preserves attempted values when a version conflict prevents an edit', async () => {
    const user = userEvent.setup();
    const subject = gateway({
      update: vi
        .fn()
        .mockRejectedValue(
          new AircraftRegistryError(
            'version_conflict',
            'The server record changed. Review the latest record before saving.',
          ),
        ),
    });
    render(
      <AircraftRegistryPanel
        gateway={subject}
        organizationName="School"
        canManage
        onClose={vi.fn()}
        onAccessRevoked={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Edit record' }));
    const model = screen.getByLabelText('Model');
    await user.clear(model);
    await user.type(model, 'Preserved attempt');
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server record changed');
    expect(model).toHaveValue('Preserved attempt');
  });

  it('clears current-session data and exits when protected access is revoked', async () => {
    const user = userEvent.setup();
    const onAccessRevoked = vi.fn();
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        decision: 'listed',
        records: [record],
        page: 1,
        pageSize: 25,
        hasNext: false,
        correlationId,
      })
      .mockRejectedValue(new AircraftRegistryError('unauthorized', 'Registry access was revoked.'));
    render(
      <AircraftRegistryPanel
        gateway={gateway({ list })}
        organizationName="School"
        canManage
        onClose={vi.fn()}
        onAccessRevoked={onAccessRevoked}
      />,
    );
    expect(await screen.findByText('RP-C123')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Search registration/), 'recheck');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(onAccessRevoked).toHaveBeenCalledOnce());
    expect(screen.queryByText('RP-C123')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add aircraft' })).not.toBeInTheDocument();
  });

  it('reuses create and update retry keys after an uncertain response', async () => {
    const user = userEvent.setup();
    const uncertain = new AircraftRegistryError('service_unavailable', 'Response was lost.');
    const create = vi
      .fn<AircraftRegistryGateway['create']>()
      .mockRejectedValueOnce(uncertain)
      .mockResolvedValueOnce({ decision: 'created', record, replayed: true, correlationId });
    const first = render(
      <AircraftRegistryPanel
        gateway={gateway({ create })}
        organizationName="School"
        canManage
        onClose={vi.fn()}
        onAccessRevoked={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Add aircraft' }));
    await user.type(screen.getByLabelText('Registration mark'), 'RP-C123');
    await user.type(screen.getByLabelText('Manufacturer'), 'Cessna');
    await user.type(screen.getByLabelText('Model'), '172S');
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Response was lost.');
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[0]?.[0].idempotencyKey).toBe(create.mock.calls[1]?.[0].idempotencyKey);
    first.unmount();

    const update = vi
      .fn<AircraftRegistryGateway['update']>()
      .mockRejectedValueOnce(uncertain)
      .mockResolvedValueOnce({
        decision: 'updated',
        record: { ...record, version: 2 },
        replayed: true,
        correlationId,
      });
    render(
      <AircraftRegistryPanel
        gateway={gateway({ update })}
        organizationName="School"
        canManage
        onClose={vi.fn()}
        onAccessRevoked={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Edit record' }));
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Response was lost.');
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[0]?.[0].idempotencyKey).toBe(update.mock.calls[1]?.[0].idempotencyKey);
  });

  it('reuses archive and reactivate retry keys after an uncertain response', async () => {
    const user = userEvent.setup();
    const uncertain = new AircraftRegistryError('service_unavailable', 'Response was lost.');
    for (const action of ['archive', 'reactivate'] as const) {
      const lifecycle = vi
        .fn<AircraftRegistryGateway[typeof action]>()
        .mockRejectedValueOnce(uncertain)
        .mockResolvedValueOnce({
          decision: action === 'archive' ? 'archived' : 'reactivated',
          record: {
            ...record,
            registryState: action === 'archive' ? 'archived' : 'tracked',
            version: 2,
          },
          replayed: true,
          correlationId,
        });
      const listedRecord = {
        ...record,
        registryState: action === 'archive' ? ('tracked' as const) : ('archived' as const),
      };
      const subject = gateway({
        list: vi.fn().mockResolvedValue({
          decision: 'listed',
          records: [listedRecord],
          page: 1,
          pageSize: 25,
          hasNext: false,
          correlationId,
        }),
        [action]: lifecycle,
      });
      const rendered = render(
        <AircraftRegistryPanel
          gateway={subject}
          organizationName="School"
          canManage
          onClose={vi.fn()}
          onAccessRevoked={vi.fn()}
        />,
      );
      await user.click(
        await screen.findByRole('button', {
          name: action === 'archive' ? 'Archive record' : 'Reactivate record',
        }),
      );
      await user.click(screen.getByRole('button', { name: `Confirm ${action}` }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Response was lost.');
      await user.click(screen.getByRole('button', { name: `Confirm ${action}` }));
      await waitFor(() => expect(lifecycle).toHaveBeenCalledTimes(2));
      expect(lifecycle.mock.calls[0]?.[0].idempotencyKey).toBe(
        lifecycle.mock.calls[1]?.[0].idempotencyKey,
      );
      rendered.unmount();
    }
  });
});
