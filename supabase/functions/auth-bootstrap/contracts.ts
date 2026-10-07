import type { AssuranceLevel } from '../_shared/access-context.ts';

export type AuthenticatedActor = {
  userId: string;
  assuranceLevel: AssuranceLevel;
  authenticationMethods: string[];
};

export type AuditDecision = {
  actorUserId: string;
  actorSubjectId: string;
  eventName: 'authentication.access_context_loaded' | 'authentication.access_denied';
  outcome: 'success' | 'denied';
  correlationId: string;
  organizationId: string | null;
  organizationIds: string[];
  reasonCode: string;
  metadata: Record<string, unknown>;
};

export type AuthBootstrapDependencies = {
  allowedOrigin: string;
  authenticate: (accessToken: string) => Promise<AuthenticatedActor>;
  consumeLimit: (actorUserId: string, correlationId: string) => Promise<unknown>;
  validateAdminFactorState?: (actorUserId: string) => Promise<boolean>;
  resolveAccessContext: (input: {
    actorUserId: string;
    assuranceLevel: AssuranceLevel;
  }) => Promise<unknown>;
  recordDecision: (decision: AuditDecision) => Promise<void>;
  createCorrelationId?: () => string;
};
