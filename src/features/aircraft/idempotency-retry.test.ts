import { describe, expect, it } from 'vitest';

import { AircraftRegistryError } from './gateway';
import {
  idempotencyKeyForAttempt,
  releaseDefinitiveAttempt,
  type PendingAircraftAttempt,
} from './idempotency-retry';

describe('aircraft idempotency retry state', () => {
  it('retains one key for the same attempt and replaces it when input changes', () => {
    const attempt = { current: undefined as PendingAircraftAttempt };
    const first = idempotencyKeyForAttempt(attempt, { action: 'create', model: 'One' });
    expect(idempotencyKeyForAttempt(attempt, { action: 'create', model: 'One' })).toBe(first);
    expect(idempotencyKeyForAttempt(attempt, { action: 'create', model: 'Two' })).not.toBe(first);
  });

  it('retains uncertain attempts and releases definitive outcomes', () => {
    const attempt = { current: undefined as PendingAircraftAttempt };
    const key = idempotencyKeyForAttempt(attempt, {
      action: 'archive',
      reason: 'created_in_error',
    });
    releaseDefinitiveAttempt(
      attempt,
      new AircraftRegistryError('service_unavailable', 'Response may have been lost.'),
    );
    expect(attempt.current?.idempotencyKey).toBe(key);
    releaseDefinitiveAttempt(
      attempt,
      new AircraftRegistryError('rate_limited', 'Replay is temporarily rate limited.'),
    );
    expect(attempt.current?.idempotencyKey).toBe(key);
    releaseDefinitiveAttempt(
      attempt,
      new AircraftRegistryError('version_conflict', 'The server replied with a conflict.'),
    );
    expect(attempt.current).toBeUndefined();
  });
});
