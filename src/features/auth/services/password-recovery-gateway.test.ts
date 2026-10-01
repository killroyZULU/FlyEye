import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../lib/database.types';
import { AuthGatewayError, SupabaseAuthGateway } from './auth-gateway';

function fixture(origin = () => 'http://127.0.0.1:5173') {
  const auth = {
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  };
  const invoke = vi.fn();
  const gateway = new SupabaseAuthGateway(
    { auth, functions: { invoke } } as unknown as SupabaseClient<Database>,
    origin,
  );
  return { gateway, auth, invoke };
}

describe('password recovery gateway compatibility', () => {
  it('resolves the current origin only when requesting recovery and forwards exact arguments', async () => {
    const origin = vi.fn().mockReturnValue('http://127.0.0.1:5173');
    const { gateway, auth, invoke } = fixture(origin);
    expect(origin).not.toHaveBeenCalled();
    for (const method of Object.values(auth)) expect(method).not.toHaveBeenCalled();

    await gateway.requestPasswordRecovery('synthetic@example.test', 'synthetic-captcha');
    origin.mockReturnValue('http://127.0.0.1:4173');
    await gateway.requestPasswordRecovery('another@example.test');

    expect(origin).toHaveBeenCalledTimes(2);
    expect(auth.resetPasswordForEmail).toHaveBeenNthCalledWith(1, 'synthetic@example.test', {
      redirectTo: 'http://127.0.0.1:5173/auth/recovery',
      captchaToken: 'synthetic-captcha',
    });
    expect(auth.resetPasswordForEmail).toHaveBeenNthCalledWith(2, 'another@example.test', {
      redirectTo: 'http://127.0.0.1:4173/auth/recovery',
      captchaToken: undefined,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['returned', 'thrown'] as const)(
    'keeps a %s provider request failure generic',
    async (mode) => {
      const { gateway, auth } = fixture();
      const failure = { status: 429, message: 'synthetic restricted provider detail' };
      if (mode === 'returned') auth.resetPasswordForEmail.mockResolvedValue({ error: failure });
      else auth.resetPasswordForEmail.mockRejectedValue(failure);
      await expect(
        gateway.requestPasswordRecovery('synthetic@example.test'),
      ).resolves.toBeUndefined();
      expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      expect(auth.updateUser).not.toHaveBeenCalled();
    },
  );

  it.each(['https://example.test', 'http://127.0.0.1:5173/other', 'http://localhost:5173'])(
    'rejects an unapproved origin before provider dispatch: %s',
    async (origin) => {
      const { gateway, auth } = fixture(() => origin);
      await expect(gateway.requestPasswordRecovery('synthetic@example.test')).rejects.toMatchObject(
        {
          name: 'AuthGatewayError',
          code: 'configuration_error',
          message: 'Password recovery is not configured for this environment.',
        },
      );
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    },
  );

  it('maps an origin lookup failure before provider dispatch', async () => {
    const cause = new Error('synthetic origin failure');
    const { gateway, auth } = fixture(() => {
      throw cause;
    });
    await expect(gateway.requestPasswordRecovery('synthetic@example.test')).rejects.toMatchObject({
      code: 'configuration_error',
      cause,
    });
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('verifies only the supplied recovery credential without issuing another auth operation', async () => {
    const { gateway, auth, invoke } = fixture();
    await expect(gateway.verifyRecoveryCredential('synthetic-token-hash')).resolves.toBeUndefined();
    expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      token_hash: 'synthetic-token-hash',
      type: 'recovery',
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['returned', 'thrown'] as const)(
    'maps a %s credential rejection to the existing safe error',
    async (mode) => {
      const { gateway, auth } = fixture();
      const cause = { status: 429, code: 'otp_expired', message: 'synthetic provider detail' };
      if (mode === 'returned') auth.verifyOtp.mockResolvedValue({ error: cause });
      else auth.verifyOtp.mockRejectedValue(cause);
      await expect(gateway.verifyRecoveryCredential('synthetic-token-hash')).rejects.toMatchObject({
        code: 'recovery_invalid',
        message: 'This recovery link cannot be used. Request a new one.',
        cause,
      });
    },
  );

  it.each(['verifyRecoveryCredential', 'updateRecoveredPassword'] as const)(
    'maps a network rejection in %s through the existing error constructor',
    async (method) => {
      const { gateway, auth } = fixture();
      const cause = new TypeError('synthetic network failure');
      auth.verifyOtp.mockRejectedValue(cause);
      auth.updateUser.mockRejectedValue(cause);
      const result = gateway[method]('synthetic-input');
      await expect(result).rejects.toBeInstanceOf(AuthGatewayError);
      await expect(result).rejects.toMatchObject({
        code: 'network_error',
        message: 'FlyEye could not reach the authentication service.',
        cause,
      });
    },
  );

  it('updates the supplied password without combining update and revocation', async () => {
    const { gateway, auth, invoke } = fixture();
    await expect(
      gateway.updateRecoveredPassword('synthetic password value'),
    ).resolves.toBeUndefined();
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({
      password: 'synthetic password value',
    });
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    [
      'weak_password',
      'weak_password',
      'Choose a stronger password that follows the guidance shown.',
    ],
    [
      'same_password',
      'same_password',
      'Choose a password that is different from your current password.',
    ],
    ['unexpected', 'password_update_failed', 'Your password could not be changed. Try again.'],
  ])('preserves guidance for returned password error %s', async (code, expectedCode, message) => {
    const { gateway, auth } = fixture();
    const cause = { code, message: 'synthetic provider detail' };
    auth.updateUser.mockResolvedValue({ error: cause });
    await expect(gateway.updateRecoveredPassword('synthetic password value')).rejects.toMatchObject(
      {
        code: expectedCode,
        message,
        cause,
      },
    );
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('preserves the distinction between thrown and returned provider password errors', async () => {
    const { gateway, auth } = fixture();
    const cause = { code: 'weak_password' };
    auth.updateUser.mockRejectedValue(cause);
    await expect(gateway.updateRecoveredPassword('synthetic password value')).rejects.toMatchObject(
      {
        code: 'password_update_failed',
        cause,
      },
    );
  });

  it('preserves an existing gateway error by identity', async () => {
    const { gateway, auth } = fixture();
    const cause = new AuthGatewayError('rate_limited', 'Synthetic existing error');
    auth.updateUser.mockRejectedValue(cause);
    await expect(gateway.updateRecoveredPassword('synthetic password value')).rejects.toBe(cause);
    auth.getSession.mockResolvedValue({ error: cause });
    await expect(gateway.hasSession()).rejects.toBe(cause);
  });

  it('uses only global sign-out when revocation succeeds', async () => {
    const { gateway, auth } = fixture();
    await expect(gateway.signOutEverywhere()).resolves.toBeUndefined();
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'global' });
  });

  it.each([
    ['returned', 'success'],
    ['returned', 'error'],
    ['returned', 'rejection'],
    ['thrown', 'success'],
    ['thrown', 'error'],
    ['thrown', 'rejection'],
  ])('retains the %s global failure after local cleanup %s', async (globalMode, localMode) => {
    const { gateway, auth } = fixture();
    const cause = new Error('synthetic global failure');
    if (globalMode === 'returned') auth.signOut.mockResolvedValueOnce({ error: cause });
    else auth.signOut.mockRejectedValueOnce(cause);
    if (localMode === 'rejection')
      auth.signOut.mockRejectedValueOnce(new Error('synthetic local failure'));
    else
      auth.signOut.mockResolvedValueOnce({ error: localMode === 'error' ? { status: 500 } : null });
    await expect(gateway.signOutEverywhere()).rejects.toMatchObject({
      code: 'revocation_failed',
      cause,
      message:
        'Your password changed, but session closure could not be confirmed. Sign in again or contact support.',
    });
    expect(auth.signOut).toHaveBeenCalledTimes(2);
    expect(auth.signOut).toHaveBeenNthCalledWith(1, { scope: 'global' });
    expect(auth.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
  });

  it('waits for the global result before attempting local cleanup', async () => {
    const { gateway, auth } = fixture();
    let finish!: (value: { error: Error }) => void;
    auth.signOut.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const result = gateway.signOutEverywhere();
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'global' });
    finish({ error: new Error('synthetic global failure') });
    await expect(result).rejects.toMatchObject({ code: 'revocation_failed' });
    expect(auth.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
  });
});
