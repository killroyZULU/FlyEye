import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../lib/database.types';
import { approvedRecoveryRedirect } from '../recovery';
import { AuthGatewayError, asGatewayError, errorCode } from './auth-gateway-errors';

type RecoveryAuth = Pick<
  SupabaseClient<Database>['auth'],
  'resetPasswordForEmail' | 'verifyOtp' | 'updateUser' | 'signOut'
>;

export class PasswordRecoveryGateway {
  constructor(
    private readonly auth: RecoveryAuth,
    private readonly recoveryOrigin: () => string,
  ) {}

  async requestPasswordRecovery(email: string, captchaToken?: string): Promise<void> {
    let redirectTo: string;
    try {
      redirectTo = approvedRecoveryRedirect(this.recoveryOrigin());
    } catch (error) {
      throw new AuthGatewayError(
        'configuration_error',
        'Password recovery is not configured for this environment.',
        { cause: error },
      );
    }

    try {
      await this.auth.resetPasswordForEmail(email, {
        redirectTo,
        captchaToken,
      });
    } catch {
      // A syntactically valid public request always receives the same visible acknowledgement.
    }
  }

  async verifyRecoveryCredential(tokenHash: string): Promise<void> {
    try {
      const { error } = await this.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery',
      });
      if (!error) return;
      throw error;
    } catch (error) {
      if (error instanceof TypeError) {
        throw asGatewayError(error);
      }
      throw new AuthGatewayError(
        'recovery_invalid',
        'This recovery link cannot be used. Request a new one.',
        { cause: error },
      );
    }
  }

  async updateRecoveredPassword(password: string): Promise<void> {
    try {
      const { error } = await this.auth.updateUser({ password });
      if (!error) return;

      const code = errorCode(error);
      if (code === 'weak_password') {
        throw new AuthGatewayError(
          'weak_password',
          'Choose a stronger password that follows the guidance shown.',
          { cause: error },
        );
      }
      if (code === 'same_password') {
        throw new AuthGatewayError(
          'same_password',
          'Choose a password that is different from your current password.',
          { cause: error },
        );
      }
      throw error;
    } catch (error) {
      if (error instanceof AuthGatewayError) throw error;
      if (error instanceof TypeError) throw asGatewayError(error);
      throw new AuthGatewayError(
        'password_update_failed',
        'Your password could not be changed. Try again.',
        { cause: error },
      );
    }
  }

  async signOutEverywhere(): Promise<void> {
    let revocationError: unknown;
    try {
      const { error } = await this.auth.signOut({ scope: 'global' });
      if (!error) return;
      revocationError = error;
    } catch (error) {
      revocationError = error;
    }

    try {
      await this.auth.signOut({ scope: 'local' });
    } catch {
      // The recovery UI remains fail-closed even if local SDK cleanup also reports a failure.
    }

    throw new AuthGatewayError(
      'revocation_failed',
      'Your password changed, but session closure could not be confirmed. Sign in again or contact support.',
      { cause: revocationError },
    );
  }
}
