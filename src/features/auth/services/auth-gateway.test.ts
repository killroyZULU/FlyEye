import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../lib/database.types';
import { SupabaseAuthGateway } from './auth-gateway';

function clientWithAuth(auth: Record<string, unknown>): SupabaseClient<Database> {
  return { auth } as unknown as SupabaseClient<Database>;
}

describe('FEAT-002 Supabase auth gateway', () => {
  it('uses the exact recovery redirect and keeps provider outcomes generic', async () => {
    const resetPasswordForEmail = vi
      .fn()
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'over_request_rate_limit', status: 429 },
      });
    const gateway = new SupabaseAuthGateway(
      clientWithAuth({ resetPasswordForEmail }),
      () => 'http://127.0.0.1:5173',
    );

    await expect(
      gateway.requestPasswordRecovery('user@example.test', 'synthetic-captcha-token'),
    ).resolves.toBeUndefined();
    await expect(gateway.requestPasswordRecovery('unknown@example.test')).resolves.toBeUndefined();
    expect(resetPasswordForEmail).toHaveBeenNthCalledWith(1, 'user@example.test', {
      redirectTo: 'http://127.0.0.1:5173/auth/recovery',
      captchaToken: 'synthetic-captcha-token',
    });
  });

  it('always verifies token hashes as recovery and maps rejection safely', async () => {
    const verifyOtp = vi
      .fn()
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'otp_expired' } });
    const gateway = new SupabaseAuthGateway(clientWithAuth({ verifyOtp }));

    await gateway.verifyRecoveryCredential('synthetic-token-hash');
    await expect(gateway.verifyRecoveryCredential('used-token-hash')).rejects.toMatchObject({
      code: 'recovery_invalid',
    });
    expect(verifyOtp).toHaveBeenNthCalledWith(1, {
      token_hash: 'synthetic-token-hash',
      type: 'recovery',
    });
  });

  it.each([
    ['weak_password', 'weak_password'],
    ['same_password', 'same_password'],
    ['unexpected_provider_failure', 'password_update_failed'],
  ])('maps %s without exposing provider details', async (providerCode, expectedCode) => {
    const updateUser = vi.fn().mockResolvedValue({
      data: null,
      error: { code: providerCode, message: 'sensitive provider detail' },
    });
    const gateway = new SupabaseAuthGateway(clientWithAuth({ updateUser }));

    await expect(gateway.updateRecoveredPassword('synthetic password')).rejects.toMatchObject({
      code: expectedCode,
    });
  });

  it.each([
    [
      'returns an error',
      vi
        .fn()
        .mockResolvedValueOnce({ error: { code: 'provider_failure' } })
        .mockResolvedValueOnce({ error: null }),
    ],
    [
      'rejects',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('unexpected global sign-out failure'))
        .mockResolvedValueOnce({ error: null }),
    ],
  ])(
    'maps revocation_failed and attempts local cleanup when global logout %s',
    async (_label, signOut) => {
      const gateway = new SupabaseAuthGateway(clientWithAuth({ signOut }));

      await expect(gateway.signOutEverywhere()).rejects.toMatchObject({
        name: 'AuthGatewayError',
        code: 'revocation_failed',
      });
      expect(signOut).toHaveBeenNthCalledWith(1, { scope: 'global' });
      expect(signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    },
  );
});
