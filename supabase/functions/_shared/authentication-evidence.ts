import { z } from 'zod';

import { assuranceLevelSchema, type AssuranceLevel } from './access-context.ts';

const authenticationMethodSchema = z
  .object({
    method: z.string().trim().min(1).max(64),
    timestamp: z.number().int().nonnegative(),
  })
  .strict();

const verifiedTokenPayloadSchema = z
  .object({
    sub: z.uuid(),
    session_id: z.uuid(),
    aal: assuranceLevelSchema,
    amr: z.array(authenticationMethodSchema).min(1).max(16),
  })
  .passthrough();

const factorSchema = z
  .object({
    id: z.uuid(),
    friendly_name: z.string().max(160).optional(),
    factor_type: z.enum(['totp', 'phone', 'webauthn']),
    status: z.enum(['verified', 'unverified']),
    phone: z.string().max(64).optional(),
    created_at: z.string().min(1).max(80),
    updated_at: z.string().min(1).max(80),
    last_challenged_at: z.string().min(1).max(80).optional(),
  })
  .strict();

export const completeFactorInventorySchema = z
  .array(factorSchema)
  .max(16)
  .superRefine((factors, refinement) => {
    const ids = factors.map((factor) => factor.id);
    if (new Set(ids).size !== ids.length) {
      refinement.addIssue({
        code: 'custom',
        message: 'The factor inventory contains duplicate identifiers.',
      });
    }
  });

export type CompleteFactor = z.infer<typeof factorSchema>;
export type FactorInventoryClassification =
  | { kind: 'none' }
  | { kind: 'one_unverified_totp'; factorId: string }
  | { kind: 'one_verified_totp'; factorId: string }
  | { kind: 'conflict' };

export type VerifiedAuthenticationEvidence = {
  actorUserId: string;
  actorSubjectId: string;
  sessionId: string;
  assuranceLevel: AssuranceLevel;
  authenticationMethods: string[];
  passwordAuthenticatedAt: number | null;
  totpAuthenticatedAt: number | null;
};

function decodePayload(accessToken: string): unknown {
  const payloadSegment = accessToken.split('.')[1];
  if (!payloadSegment) {
    throw new Error('The verified token payload is unavailable.');
  }

  const padded = payloadSegment
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
  return JSON.parse(atob(padded));
}

function latestNonFutureTimestamp(
  methods: Array<{ method: string; timestamp: number }>,
  method: string,
  serverNowSeconds: number,
): number | null {
  const timestamps = methods
    .filter((reference) => reference.method === method)
    .map((reference) => reference.timestamp)
    .filter((timestamp) => timestamp <= serverNowSeconds);

  return timestamps.length === 0 ? null : Math.max(...timestamps);
}

export function authenticationEvidenceFromVerifiedToken(
  accessToken: string,
  verifiedUserId: string,
  serverNowSeconds = Math.floor(Date.now() / 1000),
): VerifiedAuthenticationEvidence {
  const payload = verifiedTokenPayloadSchema.parse(decodePayload(accessToken));
  if (payload.sub !== verifiedUserId) {
    throw new Error('The verified token subject does not match the authenticated user.');
  }

  return {
    actorUserId: verifiedUserId,
    actorSubjectId: payload.sub,
    sessionId: payload.session_id,
    assuranceLevel: payload.aal,
    authenticationMethods: [...new Set(payload.amr.map((reference) => reference.method))],
    passwordAuthenticatedAt: latestNonFutureTimestamp(payload.amr, 'password', serverNowSeconds),
    totpAuthenticatedAt: latestNonFutureTimestamp(payload.amr, 'totp', serverNowSeconds),
  };
}

export function passwordAuthenticationIsRecent(
  evidence: VerifiedAuthenticationEvidence,
  serverNowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return (
    evidence.passwordAuthenticatedAt !== null &&
    evidence.passwordAuthenticatedAt <= serverNowSeconds &&
    serverNowSeconds - evidence.passwordAuthenticatedAt <= 600
  );
}

export function classifyCompleteFactorInventory(input: unknown): FactorInventoryClassification {
  const factors = completeFactorInventorySchema.parse(input);
  if (factors.length === 0) {
    return { kind: 'none' };
  }
  if (
    factors.length === 1 &&
    factors[0]?.factor_type === 'totp' &&
    factors[0].status === 'unverified'
  ) {
    return { kind: 'one_unverified_totp', factorId: factors[0].id };
  }
  if (
    factors.length === 1 &&
    factors[0]?.factor_type === 'totp' &&
    factors[0].status === 'verified'
  ) {
    return { kind: 'one_verified_totp', factorId: factors[0].id };
  }
  return { kind: 'conflict' };
}
