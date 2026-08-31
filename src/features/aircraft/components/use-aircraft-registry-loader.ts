import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AircraftRegistryError,
  isAircraftAccessRevoked,
  type AircraftRegistryGateway,
} from '../gateway';

export type RegistryCriteria = { page: number; search: string; includeArchived: boolean };

const initialCriteria: RegistryCriteria = { page: 1, search: '', includeArchived: false };

function safeMessage(error: unknown): string {
  return error instanceof AircraftRegistryError
    ? error.message
    : 'The aircraft registry is temporarily unavailable. Try again.';
}

export function useAircraftRegistryLoader(
  gateway: AircraftRegistryGateway,
  onAccessRevoked: () => void,
) {
  const [records, setRecords] = useState<Awaited<ReturnType<typeof gateway.list>>['records']>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [message, setMessage] = useState<string>();
  const [accessRevoked, setAccessRevoked] = useState(false);
  const criteriaRef = useRef<RegistryCriteria>(initialCriteria);
  const loadGenerationRef = useRef(0);

  const revokeAccess = useCallback(() => {
    loadGenerationRef.current += 1;
    criteriaRef.current = initialCriteria;
    setRecords([]);
    setPage(1);
    setHasNext(false);
    setMessage(undefined);
    setAccessRevoked(true);
    onAccessRevoked();
  }, [onAccessRevoked]);

  const load = useCallback(
    async (requestedPage: number, requestedSearch: string, requestedArchived: boolean) => {
      const generation = ++loadGenerationRef.current;
      if (!navigator.onLine) {
        setOnline(false);
        setLoading(false);
        setMessage('You are offline. Any visible current-session results may be stale.');
        return;
      }
      setLoading(true);
      setMessage(undefined);
      try {
        const result = await gateway.list({
          search: requestedSearch || undefined,
          includeArchived: requestedArchived,
          page: requestedPage,
        });
        if (generation !== loadGenerationRef.current) return;
        criteriaRef.current = {
          page: result.page,
          search: requestedSearch,
          includeArchived: requestedArchived,
        };
        setRecords(result.records);
        setHasNext(result.hasNext);
        setPage(result.page);
      } catch (error) {
        if (generation !== loadGenerationRef.current) return;
        if (isAircraftAccessRevoked(error)) {
          revokeAccess();
          return;
        }
        setMessage(safeMessage(error));
      } finally {
        if (generation === loadGenerationRef.current) setLoading(false);
      }
    },
    [gateway, revokeAccess],
  );

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(1, '', false), 0);
    const handleOnline = () => {
      setOnline(true);
      const current = criteriaRef.current;
      void load(current.page, current.search, current.includeArchived);
    };
    const handleOffline = () => {
      loadGenerationRef.current += 1;
      setOnline(false);
      setLoading(false);
      setMessage('You are offline. Any visible current-session results may be stale.');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [load]);

  return {
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
  };
}
