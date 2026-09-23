import { useEffect, useRef, useState } from 'react';
import type {
  AircraftDocumentDetail,
  AircraftDocumentNotification,
  AircraftDocumentVersion,
  DocumentAircraftList,
  DocumentStatusList,
} from './aircraft-documents';
import type { AircraftDocumentGateway } from './document-gateway';

type Options = {
  gateway: AircraftDocumentGateway;
  canReadNotifications: boolean;
  setBusy: (busy: boolean) => void;
  clearMessage: () => void;
  onError: (error: unknown) => void;
  onStatusLoaded: () => void;
};

export function useDocumentWorkspace(options: Options) {
  const [aircraft, setAircraft] = useState<DocumentAircraftList['aircraft']>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [status, setStatus] = useState<DocumentStatusList>();
  const [detail, setDetail] = useState<AircraftDocumentDetail>();
  const [history, setHistory] = useState<AircraftDocumentVersion[]>([]);
  const [notifications, setNotifications] = useState<AircraftDocumentNotification[]>([]);
  const [nextAircraftPage, setNextAircraftPage] = useState<number>();
  const [nextHistoryPage, setNextHistoryPage] = useState<number>();
  const [nextNotificationPage, setNextNotificationPage] = useState<number>();
  const operation = useRef(0);
  async function loadStatus(aircraftId: string) {
    const current = ++operation.current;
    options.setBusy(true);
    options.clearMessage();
    try {
      const result = await options.gateway.listStatus(aircraftId);
      if (current !== operation.current) return;
      setSelectedId(aircraftId);
      setStatus(result);
      setDetail(undefined);
      options.onStatusLoaded();
    } catch (error) {
      if (current === operation.current) options.onError(error);
    } finally {
      if (current === operation.current) options.setBusy(false);
    }
  }

  async function loadDetail(documentId: string) {
    const current = ++operation.current;
    options.setBusy(true);
    options.clearMessage();
    try {
      const [nextDetail, nextHistory] = await Promise.all([
        options.gateway.detail(documentId),
        options.gateway.history(documentId),
      ]);
      if (current !== operation.current) return;
      const nextStatus = await options.gateway.listStatus(nextDetail.aircraftId);
      if (current !== operation.current) return;
      setSelectedId(nextDetail.aircraftId);
      setStatus(nextStatus);
      setAircraft((items) =>
        items.some((item) => item.id === nextDetail.aircraftId)
          ? items
          : [...items, nextStatus.aircraft],
      );
      setDetail(nextDetail);
      setHistory(nextHistory.items);
      setNextHistoryPage(nextHistory.hasNext ? nextHistory.page + 1 : undefined);
    } catch (error) {
      if (current === operation.current) options.onError(error);
    } finally {
      if (current === operation.current) options.setBusy(false);
    }
  }

  async function loadWorkspace() {
    const current = ++operation.current;
    options.setBusy(true);
    options.clearMessage();
    try {
      const [list, alerts] = await Promise.all([
        options.gateway.listAircraft(),
        options.canReadNotifications
          ? options.gateway.listNotifications()
          : Promise.resolve(undefined),
      ]);
      if (current !== operation.current) return;
      setAircraft(list.aircraft);
      setNextAircraftPage(list.hasNext ? list.page + 1 : undefined);
      setNotifications(alerts?.items ?? []);
      setNextNotificationPage(alerts?.hasNext ? alerts.page + 1 : undefined);
      if (list.aircraft[0]) await loadStatus(list.aircraft[0].id);
      else options.setBusy(false);
    } catch (error) {
      if (current === operation.current) {
        options.onError(error);
        options.setBusy(false);
      }
    }
  }

  async function loadMore(kind: 'aircraft' | 'history' | 'notifications') {
    const current = ++operation.current;
    options.setBusy(true);
    options.clearMessage();
    try {
      if (kind === 'aircraft' && nextAircraftPage) {
        const result = await options.gateway.listAircraft(nextAircraftPage);
        if (current !== operation.current) return;
        setAircraft((items) => [
          ...items,
          ...result.aircraft.filter((item) => !items.some((loaded) => loaded.id === item.id)),
        ]);
        setNextAircraftPage(result.hasNext ? result.page + 1 : undefined);
      } else if (kind === 'history' && detail && nextHistoryPage) {
        const result = await options.gateway.history(detail.id, nextHistoryPage);
        if (current !== operation.current) return;
        setHistory((items) => [...items, ...result.items]);
        setNextHistoryPage(result.hasNext ? result.page + 1 : undefined);
      } else if (kind === 'notifications' && nextNotificationPage) {
        const result = await options.gateway.listNotifications(nextNotificationPage);
        if (current !== operation.current) return;
        setNotifications((items) => [...items, ...result.items]);
        setNextNotificationPage(result.hasNext ? result.page + 1 : undefined);
      }
    } catch (error) {
      if (current === operation.current) options.onError(error);
    } finally {
      if (current === operation.current) options.setBusy(false);
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadWorkspace(), 0);
    return () => {
      operation.current += 1;
      window.clearTimeout(initialLoad);
    };
    // The gateway and permission set are stable application dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.gateway]);

  return {
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
  };
}
