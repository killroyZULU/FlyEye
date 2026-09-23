import type { AircraftAction } from './domain.ts';
import { isAircraftAuditFailure } from './transport.ts';

export type AircraftAuditFailureInput = {
  action: AircraftAction;
  correlationId: string;
  kind: 'domain_audit' | 'security_event';
};

export type AircraftSecurityEventInput = {
  actorUserId: string;
  organizationId: string;
  action: AircraftAction;
  outcome: 'denied' | 'conflict';
  reason: string;
  correlationId: string;
};

type AuditDependencies = {
  recordSecurity: (input: AircraftSecurityEventInput) => Promise<void>;
  reportAuditFailure: (input: AircraftAuditFailureInput) => void;
};

export function reportAircraftAuditFailure(
  reporter: AuditDependencies['reportAuditFailure'],
  input: AircraftAuditFailureInput,
): void {
  try {
    reporter(input);
  } catch {
    // The protected operation remains fail closed even when fallback telemetry is unavailable.
  }
}

export function reportCaughtAircraftAuditFailure(
  reporter: AuditDependencies['reportAuditFailure'],
  action: AircraftAction,
  correlationId: string,
  error: unknown,
): void {
  if (isAircraftAuditFailure(error)) {
    reportAircraftAuditFailure(reporter, { action, correlationId, kind: 'domain_audit' });
  }
}

export async function recordAircraftSecurityEvent(
  dependencies: AuditDependencies,
  input: AircraftSecurityEventInput,
): Promise<boolean> {
  try {
    await dependencies.recordSecurity(input);
    return true;
  } catch {
    reportAircraftAuditFailure(dependencies.reportAuditFailure, {
      action: input.action,
      correlationId: input.correlationId,
      kind: 'security_event',
    });
    return false;
  }
}
