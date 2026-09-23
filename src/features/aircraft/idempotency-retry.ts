import type { MutableRefObject } from 'react';

import { createAircraftIdempotencyKey } from './aircraft-registry';
import { AircraftRegistryError } from './gateway';

export type PendingAircraftAttempt = { fingerprint: string; idempotencyKey: string } | undefined;

export function idempotencyKeyForAttempt(
  attemptRef: MutableRefObject<PendingAircraftAttempt>,
  payload: object,
): string {
  const fingerprint = JSON.stringify(payload);
  if (attemptRef.current?.fingerprint !== fingerprint) {
    attemptRef.current = { fingerprint, idempotencyKey: createAircraftIdempotencyKey() };
  }
  return attemptRef.current.idempotencyKey;
}

export function releaseDefinitiveAttempt(
  attemptRef: MutableRefObject<PendingAircraftAttempt>,
  error: unknown,
): void {
  if (!(
    error instanceof AircraftRegistryError &&
    ['service_unavailable', 'rate_limited'].includes(error.code)
  )) {
    attemptRef.current = undefined;
  }
}
