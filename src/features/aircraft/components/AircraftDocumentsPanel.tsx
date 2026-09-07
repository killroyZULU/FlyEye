import { useEffect, useRef, useState } from 'react';

import type { AircraftDocumentDetail, DocumentStatusList } from '../aircraft-documents';
import { AircraftDocumentError, type AircraftDocumentGateway } from '../document-gateway';
import { idempotencyKeyForAttempt, type PendingAircraftAttempt } from '../idempotency-retry';
import { useDocumentWorkspace } from '../use-document-workspace';
import { useDocumentCategoryActions } from '../use-document-category-actions';
import { AircraftDocumentDetailView } from './AircraftDocumentDetailView';
import { AircraftDocumentEditor } from './AircraftDocumentEditor';
import { AircraftDocumentsOverview } from './AircraftDocumentsOverview';

type Editor = {
  mode: 'create' | 'renew' | 'correct';
  item: DocumentStatusList['items'][number];
  detail?: AircraftDocumentDetail;
};

type Props = {
  gateway: AircraftDocumentGateway;
  canReadDetails: boolean;
  canReadAttachment: boolean;
  canManage: boolean;
  canManageCategories: boolean;
  canReadNotifications: boolean;
  onClose: () => void;
  onAccessRevoked: () => void;
  onRequirePassword: (reason: string) => void;
};

function safeMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Aircraft documents are temporarily unavailable. Try again.';
}

function accessFailure(error: unknown): boolean {
  return (
    error instanceof AircraftDocumentError &&
    ['unauthenticated', 'mfa_required', 'unauthorized'].includes(error.code)
  );
}

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export function AircraftDocumentsPanel(props: Props) {
  const [editor, setEditor] = useState<Editor>();
  const [message, setMessage] = useState<string>();
  const [announcement, setAnnouncement] = useState<string>();
  const [busy, setBusy] = useState(true);
  const online = useOnlineStatus();
  const attempt = useRef<PendingAircraftAttempt>(undefined);
  const {
    aircraft,
    selectedId,
    status,
    detail,
    history,
    notifications,
    nextAircraftPage,
    nextHistoryPage,
    nextNotificationPage,
    loadStatus,
    loadDetail,
    loadMore,
    setDetail,
  } = useDocumentWorkspace({
    gateway: props.gateway,
    canReadNotifications: props.canReadNotifications,
    setBusy,
    clearMessage: () => setMessage(undefined),
    onError: handleError,
    onStatusLoaded: () => setEditor(undefined),
  });
  function handleError(error: unknown) {
    if (error instanceof AircraftDocumentError && error.code === 'recent_password_required') {
      props.onRequirePassword(error.message);
    } else if (accessFailure(error)) {
      props.onAccessRevoked();
    } else {
      setMessage(safeMessage(error));
    }
  }

  async function lifecycle(action: 'suspend' | 'restore', reason: string) {
    if (!detail || !online) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const payload = {
        action,
        aircraftId: detail.aircraftId,
        categoryId: detail.categoryId,
        documentId: detail.id,
        expectedVersion: detail.aggregateVersion,
        reason,
      };
      const request = {
        ...payload,
        idempotencyKey: idempotencyKeyForAttempt(attempt, payload),
      };
      const result =
        action === 'suspend'
          ? await props.gateway.suspend(request)
          : await props.gateway.restore(request);
      attempt.current = undefined;
      setAnnouncement(`${detail.categoryLabel} was ${result.decision}.`);
      await loadDetail(detail.id);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  const categories = useDocumentCategoryActions({
    gateway: props.gateway,
    selectedAircraftId: selectedId,
    setBusy,
    clearMessage: () => setMessage(undefined),
    handleError,
    announce: setAnnouncement,
    reload: loadStatus,
  });

  if (editor && status) {
    return (
      <AircraftDocumentEditor
        gateway={props.gateway}
        aircraft={status.aircraft}
        item={editor.item}
        detail={editor.detail}
        mode={editor.mode}
        online={online}
        onSaved={(result) => {
          setAnnouncement(`Document was ${result.decision}.`);
          setEditor(undefined);
          void loadStatus(status.aircraft.id);
        }}
        onCancel={() => setEditor(undefined)}
        onAccessRevoked={props.onAccessRevoked}
      />
    );
  }

  if (detail) {
    return (
      <AircraftDocumentDetailView
        detail={detail}
        history={history}
        onLoadMoreHistory={nextHistoryPage ? () => void loadMore('history') : undefined}
        canManage={props.canManage}
        canReadAttachment={props.canReadAttachment}
        busy={busy}
        message={message}
        onBack={() => setDetail(undefined)}
        onEdit={(mode) => {
          const item = status?.items.find((candidate) => candidate.documentId === detail.id);
          if (item) setEditor({ mode, item, detail });
        }}
        onLifecycle={(action, reason) => void lifecycle(action, reason)}
        onDownload={(fileId) => {
          void props.gateway
            .download(fileId)
            .then((url) => window.location.assign(url))
            .catch(handleError);
        }}
      />
    );
  }

  return (
    <AircraftDocumentsOverview
      aircraft={aircraft}
      selectedId={selectedId}
      status={status}
      notifications={notifications}
      onLoadMoreAircraft={nextAircraftPage ? () => void loadMore('aircraft') : undefined}
      onLoadMoreNotifications={
        nextNotificationPage ? () => void loadMore('notifications') : undefined
      }
      busy={busy}
      online={online}
      message={message}
      announcement={announcement}
      canReadDetails={props.canReadDetails}
      canManage={props.canManage}
      canManageCategories={props.canManageCategories}
      onClose={props.onClose}
      onSelect={(aircraftId) => void loadStatus(aircraftId)}
      onOpenDocument={(documentId) => void loadDetail(documentId)}
      onOpenNotification={(notificationId) => {
        void props.gateway.openNotification(notificationId).then(loadDetail).catch(handleError);
      }}
      onCreateDocument={(item) => setEditor({ mode: 'create', item })}
      onCreateCategory={categories.create}
      onAssignCategory={categories.assign}
      onRenameCategory={categories.rename}
      onRemoveCategory={categories.remove}
      onArchiveCategory={categories.archive}
    />
  );
}
