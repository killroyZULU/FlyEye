import type {
  AircraftFormValues,
  AircraftListResult,
  AircraftMutationResult,
  AircraftRecord,
  ArchiveReason,
  ReactivationReason,
} from './aircraft-registry';

export type AircraftRegistryErrorCode =
  | 'unauthenticated'
  | 'mfa_required'
  | 'unauthorized'
  | 'not_found'
  | 'validation_failed'
  | 'duplicate_registration'
  | 'state_conflict'
  | 'version_conflict'
  | 'idempotency_conflict'
  | 'rate_limited'
  | 'audit_failed'
  | 'service_unavailable';

export class AircraftRegistryError extends Error {
  constructor(
    public readonly code: AircraftRegistryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AircraftRegistryError';
  }
}

export function isAircraftAccessRevoked(error: unknown): error is AircraftRegistryError {
  return (
    error instanceof AircraftRegistryError &&
    ['unauthenticated', 'mfa_required', 'unauthorized'].includes(error.code)
  );
}

export type MutationBase = { idempotencyKey: string };

export interface AircraftRegistryGateway {
  list(request: {
    search?: string;
    includeArchived: boolean;
    page: number;
    pageSize?: number;
  }): Promise<AircraftListResult>;
  get(recordId: string): Promise<AircraftRecord>;
  create(request: AircraftFormValues & MutationBase): Promise<AircraftMutationResult>;
  update(
    request: AircraftFormValues & MutationBase & { recordId: string; expectedVersion: number },
  ): Promise<AircraftMutationResult>;
  archive(request: {
    recordId: string;
    expectedVersion: number;
    reason: ArchiveReason;
    idempotencyKey: string;
  }): Promise<AircraftMutationResult>;
  reactivate(request: {
    recordId: string;
    expectedVersion: number;
    reason: ReactivationReason;
    idempotencyKey: string;
  }): Promise<AircraftMutationResult>;
}
