import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../lib/database.types';
import { SupabaseAuthGateway } from './auth-gateway';

const grant = {
  bootstrapGrantId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000001',
  organizationName: 'Synthetic Flight School',
  grantVersion: 3,
  expiresAt: '2026-10-01T00:30:00Z',
};
const correlationId = '30000000-0000-4000-8000-000000000001';
const start = {
  decision: 'ready' as const,
  bootstrapGrantId: grant.bootstrapGrantId,
  organizationId: grant.organizationId,
  organizationName: grant.organizationName,
  grantVersion: 4,
  replayed: true,
  correlationId,
  factorState: 'enrollment_required' as const,
};
const completion = {
  decision: 'already_completed',
  bootstrapGrantId: grant.bootstrapGrantId,
  organizationId: grant.organizationId,
  organizationName: grant.organizationName,
  membershipId: '40000000-0000-4000-8000-000000000001',
  grantVersion: 5,
  correlationId,
};
const key = 'a'.repeat(32);
const factor = {
  id: '50000000-0000-4000-8000-000000000001',
  factor_type: 'totp',
  status: 'verified',
};
const memberStart = {
  decision: 'ready' as const,
  operationId: '60000000-0000-4000-8000-000000000001',
  organizationId: grant.organizationId,
  organizationName: grant.organizationName,
  membershipId: completion.membershipId,
  operationVersion: 1,
  replayed: false,
  factorState: 'challenge_required' as const,
  correlationId,
};

function fixture() {
  const invoke = vi.fn().mockResolvedValue({ data: null, error: null });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const mfa = {
    listFactors: vi.fn().mockResolvedValue({ data: { all: [], totp: [] }, error: null }),
    enroll: vi.fn(),
    unenroll: vi.fn(),
    challengeAndVerify: vi.fn().mockResolvedValue({ data: {}, error: null }),
    getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    }),
  };
  const functions = { invoke };
  const auth = { mfa, signOut };
  const gateway = new SupabaseAuthGateway({
    auth,
    functions,
  } as unknown as SupabaseClient<Database>);
  return { gateway, invoke, functions, auth, signOut, mfa };
}

afterEach(() => vi.restoreAllMocks());

describe('Administrator onboarding facade compatibility', () => {
  it('constructs without provider calls and preserves status and replay payloads', async () => {
    const { gateway, invoke, functions, mfa, signOut } = fixture();
    expect(invoke).not.toHaveBeenCalled();
    expect(mfa.listFactors).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    for (const grants of [[], [grant]]) {
      invoke.mockResolvedValueOnce({ data: { grants, correlationId }, error: null });
      await expect(gateway.loadAdminOnboardingStatus()).resolves.toEqual({ grants, correlationId });
      expect(invoke).toHaveBeenLastCalledWith('organization-admin-onboarding', {
        body: { action: 'status' },
      });
    }
    invoke.mockResolvedValueOnce({ data: start, error: null });
    const random = vi.spyOn(crypto, 'getRandomValues');
    await expect(gateway.startAdminOnboarding(grant)).resolves.toEqual(start);
    expect(random).toHaveBeenCalledTimes(1);
    const bytes = random.mock.calls[0]?.[0];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes?.byteLength).toBe(16);
    expect(invoke).toHaveBeenLastCalledWith('organization-admin-onboarding', {
      body: {
        action: 'start',
        bootstrapGrantId: grant.bootstrapGrantId,
        expectedVersion: 3,
        idempotencyKey: [...(bytes as Uint8Array)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join(''),
      },
    });
    for (const decision of ['completed', 'already_completed']) {
      const data = { ...completion, decision };
      invoke.mockResolvedValueOnce({ data, error: null });
      await expect(gateway.completeAdminOnboarding(start, key)).resolves.toEqual(data);
      expect(invoke).toHaveBeenLastCalledWith('organization-admin-onboarding', {
        body: {
          action: 'complete',
          bootstrapGrantId: start.bootstrapGrantId,
          expectedVersion: 4,
          idempotencyKey: key,
        },
      });
    }
    expect(invoke.mock.contexts.every((context) => context === functions)).toBe(true);
  });

  const commands = [
    ['status', (gateway: SupabaseAuthGateway) => gateway.loadAdminOnboardingStatus()],
    ['start', (gateway: SupabaseAuthGateway) => gateway.startAdminOnboarding(grant)],
    ['complete', (gateway: SupabaseAuthGateway) => gateway.completeAdminOnboarding(start, key)],
  ] as const;

  it.each(commands)('rejects malformed %s response schemas', async (_action, call) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({ data: { decision: 'unexpected' }, error: null });
    await expect(call(gateway)).rejects.toMatchObject({ code: 'admin_onboarding_conflict' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined, 42])('rejects malformed invocation %s', async (value) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue(value);
    await expect(gateway.loadAdminOnboardingStatus()).rejects.toMatchObject({
      code: 'admin_onboarding_audit_unavailable',
      message: 'Administrator onboarding could not be verified. Try again.',
    });
  });

  it.each([
    [
      'recent_authentication_required',
      'admin_onboarding_recent_authentication_required',
      'Sign in with your password again to continue.',
    ],
    [
      'not_available',
      'admin_onboarding_not_available',
      'This administrator onboarding request is not available.',
    ],
    [
      'not_eligible',
      'admin_onboarding_not_available',
      'This administrator onboarding request is not available.',
    ],
    [
      'conflict',
      'admin_onboarding_conflict',
      'Your administrator onboarding information needs review.',
    ],
    [
      'provider_unavailable',
      'admin_onboarding_provider_unavailable',
      'Authenticator state could not be confirmed. Try again.',
    ],
    [
      'limiter_unavailable',
      'admin_onboarding_limiter_unavailable',
      'Administrator onboarding is temporarily unavailable. Try again later.',
    ],
    [
      'audit_unavailable',
      'admin_onboarding_audit_unavailable',
      'Administrator onboarding could not be verified. Try again.',
    ],
    [
      'unknown',
      'admin_onboarding_audit_unavailable',
      'Administrator onboarding could not be verified. Try again.',
    ],
  ])('preserves protected error %s', async (suffix, code, message) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({ error: { code: `admin_onboarding.${suffix}` } }), {
          status: 503,
        }),
      },
    });
    await expect(gateway.loadAdminOnboardingStatus()).rejects.toMatchObject({ code, message });
  });

  it.each([
    ['rate_limited', '12', 400, 'Wait 12 seconds before trying again.'],
    ['rate_limited', '0', 400, 'Too many attempts. Wait before trying again.'],
    ['rate_limited', '-1', 400, 'Too many attempts. Wait before trying again.'],
    ['unknown', '12', 429, 'Too many attempts. Wait before trying again.'],
  ])('preserves retry guidance for %s / %s / %s', async (suffix, retry, status, message) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({ error: { code: `admin_onboarding.${suffix}` } }), {
          status,
          headers: { 'retry-after': retry },
        }),
      },
    });
    await expect(gateway.loadAdminOnboardingStatus()).rejects.toMatchObject({
      code: 'rate_limited',
      message,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each(commands)('preserves raw %s rejection without retry', async (_action, call) => {
    const { gateway, invoke } = fixture();
    const error = new TypeError('synthetic network failure');
    invoke.mockRejectedValue(error);
    await expect(call(gateway)).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'error', 'rejection'] as const)(
    'always signs out locally after cancel %s, without deleting factors',
    async (outcome) => {
      for (const cleanup of ['success', 'error', 'rejection']) {
        const { gateway, invoke, signOut, auth, mfa } = fixture();
        const failure = new Error('synthetic cancellation failure');
        if (outcome === 'error')
          invoke.mockResolvedValue({ error: { context: new Response('{}', { status: 503 }) } });
        if (outcome === 'rejection') invoke.mockRejectedValue(failure);
        if (cleanup === 'error')
          signOut.mockResolvedValue({ error: new Error('synthetic cleanup failure') });
        if (cleanup === 'rejection')
          signOut.mockRejectedValue(new Error('synthetic cleanup failure'));
        const result = gateway.cancelAdminOnboarding(grant.bootstrapGrantId, key);
        if (outcome === 'success') await expect(result).resolves.toBeUndefined();
        else if (outcome === 'rejection') await expect(result).rejects.toBe(failure);
        else
          await expect(result).rejects.toMatchObject({
            code: 'admin_onboarding_audit_unavailable',
          });
        expect(invoke).toHaveBeenCalledExactlyOnceWith('organization-admin-onboarding', {
          body: { action: 'cancel', bootstrapGrantId: grant.bootstrapGrantId, idempotencyKey: key },
        });
        expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
        expect(signOut.mock.contexts[0]).toBe(auth);
        expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(
          signOut.mock.invocationCallOrder[0] ?? 0,
        );
        expect(mfa.unenroll).not.toHaveBeenCalled();
      }
    },
  );
});

describe('Shared onboarding authenticator compatibility', () => {
  it.each(['valid', 'short secret', 'long secret', 'invalid secret', 'invalid URI', 'long URI'])(
    'preserves administrator enrollment for %s without deleting a factor',
    async (variant) => {
      const { gateway, mfa } = fixture();
      const qrSvg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect x="0" y="0" width="1" height="1" style="fill:black"/></svg>';
      const secret =
        variant === 'short secret'
          ? 'A'.repeat(15)
          : variant === 'long secret'
            ? 'A'.repeat(257)
            : variant === 'invalid secret'
              ? '1'.repeat(16)
              : 'A'.repeat(16);
      const uri =
        variant === 'invalid URI'
          ? 'https://example.test'
          : variant === 'long URI'
            ? `otpauth://totp/${'x'.repeat(2048)}`
            : 'otpauth://totp/synthetic';
      mfa.enroll.mockResolvedValue({
        data: {
          id: factor.id,
          totp: { qr_code: `data:image/svg+xml;utf-8,${qrSvg}`, secret, uri },
        },
        error: null,
      });
      const result = gateway.prepareAdminTotp('enrollment_required');
      if (variant === 'valid')
        await expect(result).resolves.toEqual({
          kind: 'enrollment',
          factorId: factor.id,
          qrSvg,
          manualSecret: secret,
        });
      else
        await expect(result).rejects.toMatchObject({
          code: 'admin_onboarding_provider_unavailable',
        });
      expect(mfa.enroll).toHaveBeenCalledExactlyOnceWith({
        factorType: 'totp',
        friendlyName: 'FlyEye authenticator',
      });
      expect(mfa.enroll.mock.contexts[0]).toBe(mfa);
      expect(mfa.unenroll).not.toHaveBeenCalled();
    },
  );

  it.each(['listFactors', 'enroll'] as const)(
    'preserves %s provider errors and raw rejection without retry',
    async (method) => {
      const { gateway, mfa } = fixture();
      mfa[method].mockResolvedValueOnce({ data: null, error: { status: 429 } });
      await expect(gateway.prepareAdminTotp('enrollment_required')).rejects.toMatchObject({
        code: 'rate_limited',
      });
      const error = new Error('synthetic provider failure');
      mfa[method].mockRejectedValueOnce(error);
      await expect(gateway.prepareAdminTotp('enrollment_required')).rejects.toBe(error);
      expect(mfa[method]).toHaveBeenCalledTimes(2);
      expect(mfa.unenroll).not.toHaveBeenCalled();
    },
  );

  const inventories = [
    ['not an array', null],
    ['oversized', Array.from({ length: 17 }, () => factor)],
    ['null factor', [null]],
    ['primitive factor', [4]],
    ['invalid id', [{ ...factor, id: 'invalid' }]],
    ['invalid type', [{ ...factor, factor_type: 'email' }]],
    ['invalid status', [{ ...factor, status: 'unknown' }]],
    ['duplicate id', [factor, factor]],
  ] as const;

  it.each(inventories)(
    'preserves shared validation for %s in both callers',
    async (_label, all) => {
      for (const caller of ['admin', 'member']) {
        const { gateway, mfa } = fixture();
        mfa.listFactors.mockResolvedValue({ data: { all, totp: [] }, error: null });
        const result =
          caller === 'admin'
            ? gateway.prepareAdminTotp('challenge_required')
            : gateway.prepareMemberTotp({ ...memberStart }, key);
        await expect(result).rejects.toMatchObject({
          code: 'admin_onboarding_conflict',
          message: 'Your authenticator information needs administrator review.',
        });
        expect(mfa.enroll).not.toHaveBeenCalled();
        expect(mfa.unenroll).not.toHaveBeenCalled();
      }
    },
  );

  it('validates the convenience inventory through the same strict parser', async () => {
    const { gateway, mfa } = fixture();
    mfa.listFactors.mockResolvedValue({
      data: { all: [factor], totp: [{ ...factor, id: 'invalid' }] },
      error: null,
    });
    await expect(gateway.prepareAdminTotp('challenge_required')).rejects.toMatchObject({
      code: 'admin_onboarding_conflict',
    });
    expect(mfa.enroll).not.toHaveBeenCalled();
  });

  it.each([
    ['missing convenience factor', [factor], []],
    ['different convenience factor', [factor], [{ ...factor, id: correlationId }]],
    [
      'unverified factor',
      [{ ...factor, status: 'unverified' }],
      [{ ...factor, status: 'unverified' }],
    ],
    ['mixed factors', [factor, { ...factor, id: correlationId, factor_type: 'phone' }], [factor]],
    ['phone only', [{ ...factor, factor_type: 'phone' }], []],
    ['webauthn only', [{ ...factor, factor_type: 'webauthn' }], []],
    ['no challenge factor', [], []],
  ])('rejects administrator %s without mutation', async (_label, all, totp) => {
    const { gateway, mfa } = fixture();
    mfa.listFactors.mockResolvedValue({ data: { all, totp }, error: null });
    await expect(gateway.prepareAdminTotp('challenge_required')).rejects.toMatchObject({
      code: 'admin_onboarding_conflict',
    });
    expect(mfa.enroll).not.toHaveBeenCalled();
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });

  it('challenges exactly one verified factor and rejects enrollment over it', async () => {
    const { gateway, mfa } = fixture();
    mfa.listFactors.mockResolvedValue({ data: { all: [factor], totp: [factor] }, error: null });
    await expect(gateway.prepareAdminTotp('challenge_required')).resolves.toEqual({
      kind: 'challenge',
      factorId: factor.id,
    });
    await expect(gateway.prepareAdminTotp('enrollment_required')).rejects.toMatchObject({
      code: 'admin_onboarding_conflict',
    });
    expect(mfa.enroll).not.toHaveBeenCalled();
    expect(mfa.listFactors.mock.contexts.every((context) => context === mfa)).toBe(true);
  });

  it.each(['admin', 'member'] as const)(
    'verifies %s with exact arguments, receiver and AAL2 ordering',
    async (caller) => {
      const { gateway, mfa } = fixture();
      await gateway[caller === 'admin' ? 'verifyAdminTotp' : 'verifyMemberTotp'](
        factor.id,
        '123456',
      );
      expect(mfa.challengeAndVerify).toHaveBeenCalledExactlyOnceWith({
        factorId: factor.id,
        code: '123456',
      });
      expect(mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalledExactlyOnceWith();
      expect(mfa.challengeAndVerify.mock.contexts[0]).toBe(mfa);
      expect(mfa.getAuthenticatorAssuranceLevel.mock.contexts[0]).toBe(mfa);
      expect(mfa.challengeAndVerify.mock.invocationCallOrder[0]).toBeLessThan(
        mfa.getAuthenticatorAssuranceLevel.mock.invocationCallOrder[0] ?? 0,
      );
    },
  );

  it.each([
    ['challenge rate limit', 'challengeAndVerify', { error: { status: 429 } }, 'rate_limited'],
    ['challenge rejected', 'challengeAndVerify', { error: { status: 400 } }, 'mfa_invalid'],
    [
      'assurance rate limit',
      'getAuthenticatorAssuranceLevel',
      { error: { status: 429 } },
      'rate_limited',
    ],
    [
      'assurance unavailable',
      'getAuthenticatorAssuranceLevel',
      { error: new TypeError('synthetic') },
      'network_error',
    ],
    [
      'AAL1',
      'getAuthenticatorAssuranceLevel',
      { data: { currentLevel: 'aal1' }, error: null },
      'admin_onboarding_provider_unavailable',
    ],
    [
      'missing AAL',
      'getAuthenticatorAssuranceLevel',
      { data: { currentLevel: null }, error: null },
      'admin_onboarding_provider_unavailable',
    ],
  ] as const)(
    'preserves %s for both verification callers',
    async (_label, method, result, code) => {
      for (const caller of ['verifyAdminTotp', 'verifyMemberTotp'] as const) {
        const { gateway, mfa } = fixture();
        mfa[method].mockResolvedValue(result);
        await expect(gateway[caller](factor.id, '123456')).rejects.toMatchObject({ code });
        if (method === 'challengeAndVerify')
          expect(mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['challengeAndVerify', 'getAuthenticatorAssuranceLevel'] as const)(
    'preserves raw %s failures for both callers',
    async (method) => {
      for (const caller of ['verifyAdminTotp', 'verifyMemberTotp'] as const) {
        const { gateway, mfa } = fixture();
        const error = new Error('synthetic provider failure');
        mfa[method].mockRejectedValue(error);
        await expect(gateway[caller](factor.id, '123456')).rejects.toBe(error);
        expect(mfa[method]).toHaveBeenCalledTimes(1);
      }
    },
  );
});
