import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import {
  type AircraftMutationResult,
  type AircraftRecord,
  type ArchiveReason,
  type ReactivationReason,
} from '../aircraft-registry';
import {
  AircraftRegistryError,
  isAircraftAccessRevoked,
  type AircraftRegistryGateway,
} from '../gateway';
import {
  idempotencyKeyForAttempt,
  releaseDefinitiveAttempt,
  type PendingAircraftAttempt,
} from '../idempotency-retry';
import { AircraftEditor } from './AircraftEditor';
import { AircraftRegistryView, type AircraftConfirmation } from './AircraftRegistryView';
import { useAircraftRegistryLoader } from './use-aircraft-registry-loader';

type PanelProps = {
  gateway: AircraftRegistryGateway;
  organizationName: string;
  canManage: boolean;
  onClose: () => void;
  onAccessRevoked: () => void;
};

type EditorState = { record?: AircraftRecord };

function safeMessage(error: unknown): string {
  return error instanceof AircraftRegistryError
    ? error.message
    : 'The aircraft registry is temporarily unavailable. Try again.';
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function AircraftRegistryPanel({
  gateway,
  organizationName,
  canManage,
  onClose,
  onAccessRevoked,
}: PanelProps) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<string>();
  const [editor, setEditor] = useState<EditorState>();
  const [confirmation, setConfirmation] = useState<AircraftConfirmation>();
  const [reason, setReason] = useState<ArchiveReason | ReactivationReason>('no_longer_tracked');
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);
  const lifecycleAttemptRef = useRef<PendingAircraftAttempt>(undefined);
  const onAccessRevokedRef = useLatest(onAccessRevoked);

  const clearRevokedAccess = useCallback(() => {
    setSearchInput('');
    setSearch('');
    setAnnouncement(undefined);
    setEditor(undefined);
    setConfirmation(undefined);
    lifecycleAttemptRef.current = undefined;
    onAccessRevokedRef.current();
  }, [onAccessRevokedRef]);
  const {
    records,
    page,
    hasNext,
    loading,
    online,
    message,
    accessRevoked,
    criteriaRef,
    load,
    revokeAccess,
    setMessage,
    setPage,
  } = useAircraftRegistryLoader(gateway, clearRevokedAccess);

  function openEditor(record?: AircraftRecord) {
    setMessage(undefined);
    setEditor({ record });
  }

  function openConfirmation(
    action: AircraftConfirmation['action'],
    record: AircraftRecord,
    button: HTMLButtonElement,
  ) {
    actionButtonRef.current = button;
    setReason(action === 'archive' ? 'no_longer_tracked' : 'tracking_resumed');
    setConfirmation({ action, record });
  }

  function cancelConfirmation() {
    lifecycleAttemptRef.current = undefined;
    setConfirmation(undefined);
    queueMicrotask(() => actionButtonRef.current?.focus());
  }

  async function handleSaved(result: AircraftMutationResult) {
    setEditor(undefined);
    setAnnouncement(
      `${result.record.registrationMark} was ${result.decision === 'created' ? 'added' : 'saved'}.`,
    );
    const current = criteriaRef.current;
    await load(current.page, current.search, current.includeArchived);
  }

  async function confirmLifecycle() {
    if (!confirmation || !online) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const idempotencyKey = idempotencyKeyForAttempt(lifecycleAttemptRef, {
        action: confirmation.action,
        recordId: confirmation.record.id,
        expectedVersion: confirmation.record.version,
        reason,
      });
      const common = {
        recordId: confirmation.record.id,
        expectedVersion: confirmation.record.version,
        idempotencyKey,
      };
      const result =
        confirmation.action === 'archive'
          ? await gateway.archive({ ...common, reason: reason as ArchiveReason })
          : await gateway.reactivate({ ...common, reason: reason as ReactivationReason });
      lifecycleAttemptRef.current = undefined;
      setConfirmation(undefined);
      setAnnouncement(`${result.record.registrationMark} was ${result.decision}.`);
      const current = criteriaRef.current;
      await load(current.page, current.search, current.includeArchived);
    } catch (error) {
      if (isAircraftAccessRevoked(error)) {
        revokeAccess();
        return;
      }
      releaseDefinitiveAttempt(lifecycleAttemptRef, error);
      setMessage(safeMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const normalized = searchInput.normalize('NFC').replace(/^ +| +$/gu, '');
    criteriaRef.current = { page: 1, search: normalized, includeArchived };
    setSearch(normalized);
    setPage(1);
    void load(1, normalized, includeArchived);
  }

  if (accessRevoked) return null;

  if (editor) {
    return (
      <AircraftEditor
        gateway={gateway}
        record={editor.record}
        online={online}
        onSaved={handleSaved}
        onCancel={() => setEditor(undefined)}
        onAccessRevoked={revokeAccess}
      />
    );
  }

  return (
    <AircraftRegistryView
      organizationName={organizationName}
      records={records}
      searchInput={searchInput}
      filtered={Boolean(search || includeArchived)}
      includeArchived={includeArchived}
      page={page}
      hasNext={hasNext}
      loading={loading}
      busy={busy}
      online={online}
      canManage={canManage}
      message={message}
      announcement={announcement}
      confirmation={confirmation}
      reason={reason}
      onClose={onClose}
      onSearchInput={setSearchInput}
      onSearch={submitSearch}
      onIncludeArchived={(value) => {
        const current = criteriaRef.current;
        criteriaRef.current = { ...current, page: 1, includeArchived: value };
        setIncludeArchived(value);
        setPage(1);
        void load(1, current.search, value);
      }}
      onOpenEditor={openEditor}
      onOpenConfirmation={openConfirmation}
      onPage={(value) => {
        const current = criteriaRef.current;
        criteriaRef.current = { ...current, page: value };
        void load(value, current.search, current.includeArchived);
      }}
      onReason={setReason}
      onConfirm={() => void confirmLifecycle()}
      onCancelConfirmation={cancelConfirmation}
    />
  );
}
