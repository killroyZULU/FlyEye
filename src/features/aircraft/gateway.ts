import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../lib/database.types';
import {
  aircraftDetailResultSchema,
  aircraftListResultSchema,
  aircraftMutationResultSchema,
  type AircraftFormValues,
  type AircraftListResult,
  type AircraftMutationResult,
  type AircraftRecord,
  type ArchiveReason,
  type ReactivationReason,
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

type MutationBase = { idempotencyKey: string };

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

type EdgeErrorDetails = { code?: string; retryAfterSeconds?: number };

async function edgeErrorDetails(error: unknown): Promise<EdgeErrorDetails> {
  if (typeof error !== 'object' || error === null) return {};
  const context: unknown = Reflect.get(error, 'context');
  if (!(context instanceof Response)) return {};
  try {
    const payload = (await context.clone().json()) as { error?: EdgeErrorDetails };
    return payload.error ?? {};
  } catch {
    return {};
  }
}

function message(code: AircraftRegistryErrorCode, retryAfterSeconds?: number): string {
  const messages: Record<AircraftRegistryErrorCode, string> = {
    unauthenticated: 'Sign in again to continue.',
    mfa_required: 'Verify your authenticator to continue.',
    unauthorized: 'Your role does not include aircraft registry access.',
    not_found: 'This aircraft record is no longer available.',
    validation_failed: 'Review the aircraft details and try again.',
    duplicate_registration: 'A Tracked record already uses this registration mark.',
    state_conflict: 'The aircraft record is not in the required registry state.',
    version_conflict: 'The server record changed. Review the latest record before saving.',
    idempotency_conflict: 'This retry key was already used for different aircraft details.',
    rate_limited: retryAfterSeconds
      ? `Wait ${retryAfterSeconds} seconds before trying again.`
      : 'Too many aircraft registry requests. Wait before trying again.',
    audit_failed: 'The required aircraft registry audit could not be recorded.',
    service_unavailable: 'The aircraft registry is temporarily unavailable. Try again.',
  };
  return messages[code];
}

function supportedCode(value: string | undefined): AircraftRegistryErrorCode {
  const code = value?.replace('aircraft_registry.', '') as AircraftRegistryErrorCode | undefined;
  return code && code in messageMap ? code : 'service_unavailable';
}

const messageMap: Record<AircraftRegistryErrorCode, true> = {
  unauthenticated: true,
  mfa_required: true,
  unauthorized: true,
  not_found: true,
  validation_failed: true,
  duplicate_registration: true,
  state_conflict: true,
  version_conflict: true,
  idempotency_conflict: true,
  rate_limited: true,
  audit_failed: true,
  service_unavailable: true,
};

export class SupabaseAircraftRegistryGateway implements AircraftRegistryGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  private async invoke(body: Record<string, unknown>): Promise<unknown> {
    let invocation: unknown;
    try {
      invocation = await this.client.functions.invoke('aircraft-registry', { body });
    } catch (error) {
      throw new AircraftRegistryError('service_unavailable', message('service_unavailable'), {
        cause: error,
      });
    }
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AircraftRegistryError('service_unavailable', message('service_unavailable'));
    }
    const error: unknown = Reflect.get(invocation, 'error');
    if (!error) return Reflect.get(invocation, 'data');
    const details = await edgeErrorDetails(error);
    const code = supportedCode(details.code);
    throw new AircraftRegistryError(code, message(code, details.retryAfterSeconds), {
      cause: error,
    });
  }

  async list(request: {
    search?: string;
    includeArchived: boolean;
    page: number;
    pageSize?: number;
  }): Promise<AircraftListResult> {
    const parsed = aircraftListResultSchema.safeParse(
      await this.invoke({ action: 'list', pageSize: 25, ...request }),
    );
    if (!parsed.success)
      throw new AircraftRegistryError('service_unavailable', message('service_unavailable'));
    return parsed.data;
  }

  async get(recordId: string): Promise<AircraftRecord> {
    const parsed = aircraftDetailResultSchema.safeParse(
      await this.invoke({ action: 'get', recordId }),
    );
    if (!parsed.success)
      throw new AircraftRegistryError('service_unavailable', message('service_unavailable'));
    return parsed.data.record;
  }

  async create(request: AircraftFormValues & MutationBase): Promise<AircraftMutationResult> {
    return this.mutation({ action: 'create', ...request });
  }

  async update(
    request: AircraftFormValues & MutationBase & { recordId: string; expectedVersion: number },
  ): Promise<AircraftMutationResult> {
    return this.mutation({ action: 'update', ...request });
  }

  async archive(request: {
    recordId: string;
    expectedVersion: number;
    reason: ArchiveReason;
    idempotencyKey: string;
  }): Promise<AircraftMutationResult> {
    return this.mutation({ action: 'archive', ...request });
  }

  async reactivate(request: {
    recordId: string;
    expectedVersion: number;
    reason: ReactivationReason;
    idempotencyKey: string;
  }): Promise<AircraftMutationResult> {
    return this.mutation({ action: 'reactivate', ...request });
  }

  private async mutation(body: Record<string, unknown>): Promise<AircraftMutationResult> {
    const parsed = aircraftMutationResultSchema.safeParse(await this.invoke(body));
    if (!parsed.success)
      throw new AircraftRegistryError('service_unavailable', message('service_unavailable'));
    return parsed.data;
  }
}
