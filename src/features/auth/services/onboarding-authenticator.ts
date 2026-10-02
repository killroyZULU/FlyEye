import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/database.types';
import { AuthGatewayError, asGatewayError } from './auth-gateway-errors';

export function factorInventory(input: unknown): Array<{
  id: string;
  factor_type: 'totp' | 'phone' | 'webauthn';
  status: 'verified' | 'unverified';
}> {
  if (!Array.isArray(input) || input.length > 16) {
    throw new AuthGatewayError(
      'admin_onboarding_conflict',
      'Your authenticator information needs administrator review.',
    );
  }

  const factors = input.map((factor) => {
    if (typeof factor !== 'object' || factor === null) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }
    const id: unknown = Reflect.get(factor, 'id') as unknown;
    const factorType: unknown = Reflect.get(factor, 'factor_type') as unknown;
    const status: unknown = Reflect.get(factor, 'status') as unknown;
    if (
      typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
      !['totp', 'phone', 'webauthn'].includes(String(factorType)) ||
      !['verified', 'unverified'].includes(String(status))
    ) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }
    return {
      id,
      factor_type: factorType as 'totp' | 'phone' | 'webauthn',
      status: status as 'verified' | 'unverified',
    };
  });

  if (new Set(factors.map((factor) => factor.id)).size !== factors.length) {
    throw new AuthGatewayError(
      'admin_onboarding_conflict',
      'Your authenticator information needs administrator review.',
    );
  }
  return factors;
}

export async function verifyEnrollmentTotp(
  mfa: SupabaseClient<Database>['auth']['mfa'],
  factorId: string,
  code: string,
): Promise<void> {
  const { error } = await mfa.challengeAndVerify({ factorId, code });
  if (error) {
    if (error.status === 429) {
      throw new AuthGatewayError('rate_limited', 'Too many attempts. Wait before trying again.');
    }
    throw new AuthGatewayError('mfa_invalid', 'The verification code is invalid or expired.');
  }

  const { data: assurance, error: assuranceError } = await mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw asGatewayError(assuranceError);
  if (assurance.currentLevel !== 'aal2') {
    throw new AuthGatewayError(
      'admin_onboarding_provider_unavailable',
      'Authenticator verification could not be confirmed.',
    );
  }
}
