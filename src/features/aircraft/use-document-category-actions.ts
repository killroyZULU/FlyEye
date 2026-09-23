import { useRef } from 'react';

import type { DocumentStatusList } from './aircraft-documents';
import type { AircraftDocumentGateway } from './document-gateway';
import { idempotencyKeyForAttempt, type PendingAircraftAttempt } from './idempotency-retry';

type StatusItem = DocumentStatusList['items'][number];

type Options = {
  gateway: AircraftDocumentGateway;
  selectedAircraftId?: string;
  setBusy: (busy: boolean) => void;
  clearMessage: () => void;
  handleError: (error: unknown) => void;
  announce: (message: string) => void;
  reload: (aircraftId: string) => Promise<void>;
};

export function useDocumentCategoryActions(options: Options) {
  const createAttempt = useRef<PendingAircraftAttempt>(undefined);
  const assignAttempt = useRef<PendingAircraftAttempt>(undefined);
  const changeAttempt = useRef<PendingAircraftAttempt>(undefined);

  async function create(labelInput: string) {
    const aircraftId = options.selectedAircraftId;
    const label = labelInput.trim();
    if (!aircraftId || !label) return;
    options.setBusy(true);
    options.clearMessage();
    try {
      const created = await options.gateway.createCategory(
        label,
        idempotencyKeyForAttempt(createAttempt, { action: 'create_category', label }),
      );
      const payload = {
        action: 'assign_category',
        categoryId: created.categoryId,
        aircraftId,
        expectedVersion: created.categoryVersion,
      };
      await options.gateway.assignCategory({
        ...payload,
        idempotencyKey: idempotencyKeyForAttempt(assignAttempt, payload),
      });
      createAttempt.current = undefined;
      assignAttempt.current = undefined;
      options.announce(`${created.categoryLabel} was added to this aircraft.`);
      await options.reload(aircraftId);
    } catch (error) {
      options.handleError(error);
    } finally {
      options.setBusy(false);
    }
  }

  async function archive(item: StatusItem) {
    if (!item.categoryVersion) return;
    await change(
      {
        action: 'archive_category',
        categoryId: item.categoryId,
        expectedVersion: item.categoryVersion,
      },
      (request) => options.gateway.archiveCategory(request),
      `${item.categoryLabel} was archived.`,
    );
  }

  async function rename(item: StatusItem, labelInput: string) {
    const label = labelInput.trim();
    if (!label || !item.categoryVersion) return;
    await change(
      {
        action: 'rename_category',
        categoryId: item.categoryId,
        categoryLabel: label,
        expectedVersion: item.categoryVersion,
      },
      (request) => options.gateway.renameCategory(request),
      `${item.categoryLabel} was renamed to ${label}.`,
    );
  }

  async function remove(item: StatusItem) {
    const aircraftId = options.selectedAircraftId;
    if (!aircraftId || !item.requirementVersion) return;
    await change(
      {
        action: 'remove_category',
        categoryId: item.categoryId,
        aircraftId,
        expectedVersion: item.requirementVersion,
      },
      (request) => options.gateway.removeCategory(request),
      `${item.categoryLabel} was removed from this aircraft.`,
    );
  }

  async function assign(category: DocumentStatusList['availableCustomCategories'][number]) {
    const aircraftId = options.selectedAircraftId;
    if (!aircraftId) return;
    const payload = {
      action: 'assign_category',
      categoryId: category.categoryId,
      aircraftId,
      expectedVersion: category.categoryVersion,
    };
    await change(
      payload,
      (request) => options.gateway.assignCategory(request),
      `${category.categoryLabel} was assigned to this aircraft.`,
    );
  }

  async function change<T extends object>(
    payload: T,
    operation: (request: T & { idempotencyKey: string }) => Promise<unknown>,
    announcement: string,
  ) {
    options.setBusy(true);
    options.clearMessage();
    try {
      await operation({
        ...payload,
        idempotencyKey: idempotencyKeyForAttempt(changeAttempt, payload),
      });
      changeAttempt.current = undefined;
      options.announce(announcement);
      if (options.selectedAircraftId) await options.reload(options.selectedAircraftId);
    } catch (error) {
      options.handleError(error);
    } finally {
      options.setBusy(false);
    }
  }

  return { create, assign, rename, remove, archive };
}
