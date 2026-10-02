import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../lib/database.types';
import type { MemberMfaStart } from '../member-mfa';
import { SupabaseAuthGateway } from './auth-gateway';

const context = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  organizationName: 'Synthetic School',
  membershipId: '20000000-0000-4000-8000-000000000001',
  correlationId: '30000000-0000-4000-8000-000000000001',
};
const operationId = '40000000-0000-4000-8000-000000000001';
const factorId = '50000000-0000-4000-8000-000000000001';
const idempotencyKey = 'a'.repeat(32);
const qrSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect x="0" y="0" width="1" height="1" style="fill:black"/></svg>';
const syntheticSecret = 'A'.repeat(16);
const preparation = { kind: 'enrollment', factorId, qrSvg, manualSecret: syntheticSecret };

function start(): MemberMfaStart {
  return {
    ...context,
    decision: 'ready',
    operationId,
    operationVersion: 3,
    replayed: true,
    factorState: 'enrollment_required',
  };
}

function boundStatus() {
  return {
    ...context,
    decision: 'available',
    ready: false,
    operationState: 'bound',
    operationId,
    operationVersion: 7,
    factorState: 'resume_required',
  };
}

function fixture() {
  const invoke = vi.fn().mockResolvedValue({
    data: {
      decision: 'bound',
      operationId,
      operationVersion: 4,
      replayed: true,
      correlationId: context.correlationId,
    },
    error: null,
  });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const mfa = {
    listFactors: vi.fn().mockResolvedValue({ data: { all: [], totp: [] }, error: null }),
    enroll: vi.fn().mockResolvedValue({
      data: {
        id: factorId,
        totp: {
          qr_code: `data:image/svg+xml;utf-8,${qrSvg}`,
          secret: syntheticSecret,
          uri: 'otpauth://totp/synthetic',
        },
      },
      error: null,
    }),
    unenroll: vi.fn().mockResolvedValue({ error: null }),
    challengeAndVerify: vi.fn().mockResolvedValue({ error: null }),
    getAuthenticatorAssuranceLevel: vi
      .fn()
      .mockResolvedValue({ data: { currentLevel: 'aal2' }, error: null }),
  };
  const functions = { invoke };
  const auth = { mfa, signOut };
  const gateway = new SupabaseAuthGateway({
    auth,
    functions,
  } as unknown as SupabaseClient<Database>);
  return { gateway, invoke, functions, auth, signOut, mfa };
}

describe('Member MFA facade commands', () => {
  it('constructs without provider calls and preserves status/start/completion requests and replay', async () => {
    const { gateway, invoke, functions, mfa, signOut } = fixture();
    expect(invoke).not.toHaveBeenCalled();
    expect(mfa.listFactors).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    const status = boundStatus();
    invoke.mockResolvedValueOnce({ data: status, error: null });
    await expect(gateway.loadMemberMfaStatus()).resolves.toEqual(status);
    expect(invoke).toHaveBeenLastCalledWith('member-mfa', { body: { action: 'status' } });
    const started = start();
    invoke.mockResolvedValueOnce({ data: started, error: null });
    await expect(gateway.startMemberMfaEnrollment(idempotencyKey)).resolves.toEqual(started);
    expect(invoke).toHaveBeenLastCalledWith('member-mfa', {
      body: { action: 'start', idempotencyKey },
    });
    const completed = {
      decision: 'completed',
      organizationId: context.organizationId,
      membershipId: context.membershipId,
      readinessVersion: 8,
      replayed: true,
      correlationId: context.correlationId,
    };
    invoke.mockResolvedValueOnce({ data: completed, error: null });
    await expect(gateway.completeMemberMfaEnrollment(started, idempotencyKey)).resolves.toEqual(
      completed,
    );
    expect(invoke).toHaveBeenLastCalledWith('member-mfa', {
      body: { action: 'complete', operationId, expectedVersion: 3, idempotencyKey },
    });
    expect(invoke.mock.contexts.every((receiver) => receiver === functions)).toBe(true);
    expect(started.operationVersion).toBe(3);
  });

  const commands = [
    ['status', (gateway: SupabaseAuthGateway) => gateway.loadMemberMfaStatus()],
    ['start', (gateway: SupabaseAuthGateway) => gateway.startMemberMfaEnrollment(idempotencyKey)],
    [
      'complete',
      (gateway: SupabaseAuthGateway) =>
        gateway.completeMemberMfaEnrollment(start(), idempotencyKey),
    ],
  ] as const;

  it.each(commands)(
    'rejects malformed %s responses and preserves raw rejections',
    async (_label, call) => {
      const { gateway, invoke } = fixture();
      invoke.mockResolvedValueOnce({ data: { decision: 'unexpected' }, error: null });
      await expect(call(gateway)).rejects.toMatchObject({ code: 'member_mfa_state_conflict' });
      const failure = new TypeError('synthetic');
      invoke.mockRejectedValueOnce(failure);
      await expect(call(gateway)).rejects.toBe(failure);
      expect(invoke).toHaveBeenCalledTimes(2);
    },
  );

  it.each([null, undefined, 42])('rejects malformed invocation %s', async (value) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue(value);
    await expect(gateway.loadMemberMfaStatus()).rejects.toMatchObject({
      code: 'member_mfa_unavailable',
      message: 'Authenticator setup is temporarily unavailable.',
    });
  });

  it.each([
    [
      'not_available',
      'member_mfa_not_available',
      'Authenticator setup is not available for this membership.',
    ],
    [
      'recent_authentication_required',
      'member_mfa_recent_authentication_required',
      'Sign in with your password again to continue.',
    ],
    [
      'factor_conflict',
      'member_mfa_factor_conflict',
      'Your authenticator information needs support review.',
    ],
    [
      'state_conflict',
      'member_mfa_state_conflict',
      'Authenticator setup changed. Sign in again before retrying.',
    ],
    [
      'cleanup_uncertain',
      'member_mfa_cleanup_uncertain',
      'Authenticator cleanup could not be confirmed. Sign in again before retrying.',
    ],
    ['unknown', 'member_mfa_unavailable', 'Authenticator setup could not be confirmed. Try again.'],
  ])('preserves protected %s errors', async (suffix, code, message) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({
      error: {
        context: new Response(JSON.stringify({ error: { code: `member_mfa.${suffix}` } }), {
          status: 409,
        }),
      },
    });
    await expect(gateway.loadMemberMfaStatus()).rejects.toMatchObject({ code, message });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['12', 'Wait 12 seconds before trying again.'],
    ['0', 'Too many attempts. Wait before trying again.'],
    ['invalid', 'Too many attempts. Wait before trying again.'],
  ])('preserves rate-limit guidance for retry header %s', async (retry, message) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({
      error: {
        context: new Response(JSON.stringify({ error: { code: 'member_mfa.rate_limited' } }), {
          status: 429,
          headers: { 'retry-after': retry },
        }),
      },
    });
    await expect(gateway.startMemberMfaEnrollment(idempotencyKey)).rejects.toMatchObject({
      code: 'rate_limited',
      message,
    });
  });

  it('preserves generic unavailable for an unrecognized 429 response', async () => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({ error: { context: new Response('not JSON', { status: 429 }) } });
    await expect(gateway.loadMemberMfaStatus()).rejects.toMatchObject({
      code: 'member_mfa_unavailable',
    });
  });

  it.each(['success', 'error', 'rejection'] as const)(
    'always signs out locally after cancel %s without deleting factors',
    async (outcome) => {
      for (const cleanup of ['success', 'error', 'rejection']) {
        for (const suppliedFactor of [factorId, undefined]) {
          const { gateway, invoke, signOut, auth, mfa } = fixture();
          const failure = new Error('synthetic cancellation');
          if (outcome === 'error')
            invoke.mockResolvedValue({ error: { context: new Response('{}', { status: 503 }) } });
          if (outcome === 'rejection') invoke.mockRejectedValue(failure);
          if (cleanup === 'error')
            signOut.mockResolvedValue({ error: new Error('synthetic cleanup') });
          if (cleanup === 'rejection') signOut.mockRejectedValue(new Error('synthetic cleanup'));
          const result = gateway.cancelMemberMfaEnrollment(start(), suppliedFactor, idempotencyKey);
          if (outcome === 'success') await expect(result).resolves.toBeUndefined();
          else if (outcome === 'rejection') await expect(result).rejects.toBe(failure);
          else await expect(result).rejects.toMatchObject({ code: 'member_mfa_unavailable' });
          expect(invoke).toHaveBeenCalledExactlyOnceWith('member-mfa', {
            body: {
              action: 'cancel',
              operationId,
              expectedVersion: 3,
              factorId: suppliedFactor,
              idempotencyKey,
            },
          });
          expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
          expect(signOut.mock.contexts[0]).toBe(auth);
          expect(mfa.unenroll).not.toHaveBeenCalled();
          expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(
            signOut.mock.invocationCallOrder[0] ?? 0,
          );
        }
      }
    },
  );
});

describe('Member MFA preparation and binding compatibility', () => {
  it('enrolls then binds with exact arguments and propagates the bound version into completion', async () => {
    const { gateway, invoke, functions, mfa } = fixture();
    const started = start();
    await expect(gateway.prepareMemberTotp(started, idempotencyKey)).resolves.toEqual(preparation);
    expect(mfa.listFactors).toHaveBeenCalledExactlyOnceWith();
    expect(mfa.enroll).toHaveBeenCalledExactlyOnceWith({
      factorType: 'totp',
      friendlyName: 'FlyEye authenticator',
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('member-mfa', {
      body: { action: 'bind_factor', operationId, expectedVersion: 3, factorId, idempotencyKey },
    });
    expect(mfa.enroll.mock.contexts[0]).toBe(mfa);
    expect(invoke.mock.contexts[0]).toBe(functions);
    expect(mfa.listFactors.mock.invocationCallOrder[0]).toBeLessThan(
      mfa.enroll.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mfa.enroll.mock.invocationCallOrder[0]).toBeLessThan(
      invoke.mock.invocationCallOrder[0] ?? 0,
    );
    expect(started.operationVersion).toBe(4);
    expect(mfa.unenroll).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({
      data: {
        decision: 'completed',
        organizationId: context.organizationId,
        membershipId: context.membershipId,
        readinessVersion: 1,
        replayed: false,
        correlationId: context.correlationId,
      },
      error: null,
    });
    await gateway.completeMemberMfaEnrollment(started, idempotencyKey);
    expect(invoke).toHaveBeenLastCalledWith('member-mfa', {
      body: { action: 'complete', operationId, expectedVersion: 4, idempotencyKey },
    });
  });

  it.each(['lost response', 'malformed payload', 'wrong operation'] as const)(
    'reconciles %s only through status for the same bound operation',
    async (bindResult) => {
      const { gateway, invoke, mfa } = fixture();
      if (bindResult === 'lost response')
        invoke.mockRejectedValueOnce(new Error('synthetic transport'));
      else
        invoke.mockResolvedValueOnce({
          data:
            bindResult === 'malformed payload'
              ? {}
              : {
                  decision: 'bound',
                  operationId: context.correlationId,
                  operationVersion: 9,
                  replayed: true,
                  correlationId: context.correlationId,
                },
          error: null,
        });
      invoke.mockResolvedValueOnce({ data: boundStatus(), error: null });
      const started = start();
      await expect(gateway.prepareMemberTotp(started, idempotencyKey)).resolves.toEqual(
        preparation,
      );
      expect(started.operationVersion).toBe(7);
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke).toHaveBeenLastCalledWith('member-mfa', { body: { action: 'status' } });
      expect(mfa.enroll).toHaveBeenCalledTimes(1);
      expect(mfa.unenroll).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['wrong operation', { ...boundStatus(), operationId: context.correlationId }],
    [
      'not bound',
      { ...context, decision: 'available', ready: false, factorState: 'enrollment_required' },
    ],
    ['wrong factor state', { ...boundStatus(), factorState: 'challenge_required' }],
    ['missing version', { ...boundStatus(), operationVersion: undefined }],
    ['malformed status', {}],
  ])('retains version and factor when reconciliation has %s', async (_label, data) => {
    const { gateway, invoke, mfa } = fixture();
    invoke
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data, error: null });
    const started = start();
    await expect(gateway.prepareMemberTotp(started, idempotencyKey)).rejects.toMatchObject({
      code: 'member_mfa_cleanup_uncertain',
      cause: { code: 'member_mfa_cleanup_uncertain' },
    });
    expect(started.operationVersion).toBe(3);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(mfa.enroll).toHaveBeenCalledTimes(1);
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });

  it.each(['rejected bind', 'malformed bind'])(
    'preserves reconciliation error causes after %s',
    async (binding) => {
      const { gateway, invoke, mfa } = fixture();
      const bindError = new TypeError('synthetic bind');
      const statusError = new TypeError('synthetic status');
      if (binding === 'rejected bind') invoke.mockRejectedValueOnce(bindError);
      else invoke.mockResolvedValueOnce({ data: {}, error: null });
      invoke.mockRejectedValueOnce(statusError);
      const started = start();
      const failure: unknown = await gateway
        .prepareMemberTotp(started, idempotencyKey)
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'member_mfa_cleanup_uncertain' });
      if (!(failure instanceof Error)) throw new Error('Expected gateway error');
      if (binding === 'rejected bind') {
        expect(failure.cause).toBeInstanceOf(AggregateError);
        expect((failure.cause as AggregateError).errors).toEqual([bindError, statusError]);
      } else expect(failure.cause).toBe(statusError);
      expect(started.operationVersion).toBe(3);
      expect(mfa.unenroll).not.toHaveBeenCalled();
    },
  );

  it.each(['error', 'rejection', 'success'])(
    'cleans invalid enrollment before binding when cleanup reports %s',
    async (cleanup) => {
      const { gateway, invoke, mfa } = fixture();
      mfa.enroll.mockResolvedValue({
        data: {
          id: factorId,
          totp: {
            qr_code: `data:image/svg+xml;utf-8,${qrSvg}`,
            secret: 'invalid',
            uri: 'otpauth://totp/synthetic',
          },
        },
        error: null,
      });
      if (cleanup === 'error')
        mfa.unenroll.mockResolvedValue({ error: new Error('synthetic cleanup') });
      if (cleanup === 'rejection') mfa.unenroll.mockRejectedValue(new Error('synthetic cleanup'));
      const started = start();
      await expect(gateway.prepareMemberTotp(started, idempotencyKey)).rejects.toMatchObject({
        code: cleanup === 'success' ? 'member_mfa_unavailable' : 'member_mfa_cleanup_uncertain',
      });
      expect(mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId });
      expect(mfa.unenroll.mock.contexts[0]).toBe(mfa);
      expect(invoke).not.toHaveBeenCalled();
      expect(started.operationVersion).toBe(3);
    },
  );

  it.each(['listFactors', 'enroll'] as const)(
    'preserves %s provider failures without binding or cleanup',
    async (method) => {
      for (const rejection of [false, true]) {
        const { gateway, invoke, mfa } = fixture();
        const failure = new TypeError('synthetic');
        if (rejection) mfa[method].mockRejectedValue(failure);
        else mfa[method].mockResolvedValue({ error: { status: 429 }, data: null });
        const result = gateway.prepareMemberTotp(start(), idempotencyKey);
        if (rejection) await expect(result).rejects.toBe(failure);
        else await expect(result).rejects.toMatchObject({ code: 'rate_limited' });
        expect(mfa[method]).toHaveBeenCalledTimes(1);
        expect(invoke).not.toHaveBeenCalled();
        expect(mfa.unenroll).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ['verified', 1, true],
    ['unverified', 1, false],
    ['verified', 2, true],
    ['unverified', 2, true],
  ] as const)(
    'preserves challenge behavior for %s factor at version %s',
    async (status, operationVersion, allowed) => {
      const { gateway, invoke, mfa } = fixture();
      const factor = { id: factorId, factor_type: 'totp', status };
      mfa.listFactors.mockResolvedValue({ data: { all: [factor], totp: [factor] }, error: null });
      const started = { ...start(), factorState: 'challenge_required' as const, operationVersion };
      const result = gateway.prepareMemberTotp(started, idempotencyKey);
      if (allowed) await expect(result).resolves.toEqual({ kind: 'challenge', factorId });
      else await expect(result).rejects.toMatchObject({ code: 'member_mfa_factor_conflict' });
      expect(started.operationVersion).toBe(operationVersion);
      expect(mfa.enroll).not.toHaveBeenCalled();
      expect(mfa.unenroll).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each(['inventory mismatch', 'existing enrollment factor', 'mixed factors'])(
    'rejects %s without provider mutation',
    async (variant) => {
      const { gateway, invoke, mfa } = fixture();
      const factor = { id: factorId, factor_type: 'totp', status: 'verified' };
      const all =
        variant === 'mixed factors'
          ? [factor, { ...factor, id: context.correlationId, factor_type: 'phone' }]
          : [factor];
      mfa.listFactors.mockResolvedValue({
        data: { all, totp: variant === 'inventory mismatch' ? [] : [factor] },
        error: null,
      });
      const started = start();
      if (variant !== 'existing enrollment factor') started.factorState = 'challenge_required';
      await expect(gateway.prepareMemberTotp(started, idempotencyKey)).rejects.toMatchObject({
        code: 'member_mfa_factor_conflict',
      });
      expect(mfa.enroll).not.toHaveBeenCalled();
      expect(mfa.unenroll).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    },
  );
});
