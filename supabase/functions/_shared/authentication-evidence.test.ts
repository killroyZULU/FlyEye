import { describe, expect, it } from 'vitest';

import {
  authenticationEvidenceFromVerifiedToken,
  classifyCompleteFactorInventory,
  passwordAuthenticationIsPresent,
  passwordAuthenticationIsRecent,
} from './authentication-evidence.ts';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000001';
const FACTOR_ID = '30000000-0000-4000-8000-000000000001';

function token(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `header.${encoded}.signature`;
}

function payload(amr: unknown, aal = 'aal1') {
  return {
    sub: USER_ID,
    session_id: SESSION_ID,
    aal,
    amr,
  };
}

function factor(status: 'verified' | 'unverified' = 'verified') {
  return {
    id: FACTOR_ID,
    friendly_name: 'Synthetic authenticator',
    factor_type: 'totp',
    status,
    created_at: '2026-07-28T00:00:00Z',
    updated_at: '2026-07-28T00:00:00Z',
  };
}

describe('FEAT-003 verified authentication evidence', () => {
  it('accepts an older verified password session without implying recent authentication', () => {
    const evidence = authenticationEvidenceFromVerifiedToken(
      token(payload([{ method: 'password', timestamp: 1 }])),
      USER_ID,
      1_000,
    );
    expect(passwordAuthenticationIsPresent(evidence, 1_000)).toBe(true);
    expect(passwordAuthenticationIsRecent(evidence, 1_000)).toBe(false);
  });

  it.each(['otp', 'recovery', 'invite', 'magiclink', 'totp'])(
    'does not treat verified %s evidence as password authentication',
    (method) => {
      const evidence = authenticationEvidenceFromVerifiedToken(
        token(payload([{ method, timestamp: 999 }])),
        USER_ID,
        1_000,
      );
      expect(passwordAuthenticationIsPresent(evidence, 1_000)).toBe(false);
    },
  );

  it.each([null, -1, 1_001, Number.NaN, Infinity, 1.5])(
    'rejects invalid password timestamp %s even when the method is present',
    (timestamp) => {
      const evidence = authenticationEvidenceFromVerifiedToken(
        token(payload([{ method: 'password', timestamp: 1 }])),
        USER_ID,
        1_000,
      );
      expect(
        passwordAuthenticationIsPresent({ ...evidence, passwordAuthenticatedAt: timestamp }, 1_000),
      ).toBe(false);
      expect(
        passwordAuthenticationIsPresent({ ...evidence, authenticationMethods: ['otp'] }, 1_000),
      ).toBe(false);
    },
  );

  it('accepts password authentication exactly 600 seconds old and rejects 601 seconds', () => {
    const evidence = authenticationEvidenceFromVerifiedToken(
      token(payload([{ method: 'password', timestamp: 400 }])),
      USER_ID,
      1_000,
    );

    expect(passwordAuthenticationIsRecent(evidence, 1_000)).toBe(true);
    expect(passwordAuthenticationIsRecent(evidence, 1_001)).toBe(false);
  });

  it('rejects missing, future, malformed, or caller-added AMR evidence', () => {
    expect(() =>
      authenticationEvidenceFromVerifiedToken(token(payload([])), USER_ID, 1_000),
    ).toThrow();
    expect(() =>
      authenticationEvidenceFromVerifiedToken(
        token(payload([{ method: 'password', timestamp: 1_001 }])),
        USER_ID,
        1_000,
      ),
    ).not.toThrow();
    const future = authenticationEvidenceFromVerifiedToken(
      token(payload([{ method: 'password', timestamp: 1_001 }])),
      USER_ID,
      1_000,
    );
    expect(passwordAuthenticationIsRecent(future, 1_000)).toBe(false);
    expect(() =>
      authenticationEvidenceFromVerifiedToken(
        token(payload([{ method: 'password', timestamp: 999, callerTrusted: true }])),
        USER_ID,
        1_000,
      ),
    ).toThrow();
  });

  it('requires the verified token subject to match the authenticated user', () => {
    expect(() =>
      authenticationEvidenceFromVerifiedToken(
        token(payload([{ method: 'password', timestamp: 999 }])),
        '10000000-0000-4000-8000-000000000002',
        1_000,
      ),
    ).toThrow();
  });

  it('classifies only zero or one strict TOTP factor as a usable onboarding state', () => {
    expect(classifyCompleteFactorInventory([])).toEqual({ kind: 'none' });
    expect(classifyCompleteFactorInventory([factor('unverified')])).toEqual({
      kind: 'one_unverified_totp',
      factorId: FACTOR_ID,
    });
    expect(classifyCompleteFactorInventory([factor('verified')])).toEqual({
      kind: 'one_verified_totp',
      factorId: FACTOR_ID,
    });
    expect(
      classifyCompleteFactorInventory([
        factor('verified'),
        { ...factor('verified'), id: '30000000-0000-4000-8000-000000000002' },
      ]),
    ).toEqual({ kind: 'conflict' });
    expect(() =>
      classifyCompleteFactorInventory([{ ...factor(), providerInternal: 'restricted' }]),
    ).toThrow();
    expect(classifyCompleteFactorInventory([{ ...factor(), phone: '' }])).toEqual({
      kind: 'one_verified_totp',
      factorId: FACTOR_ID,
    });
  });
});
