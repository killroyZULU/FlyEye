import type { SupabaseClient } from '@supabase/supabase-js';

import {
  accessContextResponseSchema,
  type AccessContextResponse,
  type LoginRequest,
} from '../../../lib/access-context';
import type { Database } from '../../../lib/database.types';

export type AuthGatewayErrorCode =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'network_error'
  | 'configuration_error'
  | 'access_context_conflict'
  | 'access_context_unavailable'
  | 'mfa_invalid'
  | 'mfa_enrollment_required'
  | 'unknown';

export class AuthGatewayError extends Error {
  constructor(
    public readonly code: AuthGatewayErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AuthGatewayError';
  }
}

export type MfaAssurance = {
  currentLevel: 'aal1' | 'aal2' | null;
  nextLevel: 'aal1' | 'aal2' | null;
};

export interface AuthGateway {
  hasSession(): Promise<boolean>;
  signIn(request: LoginRequest): Promise<void>;
  loadAccessContext(organizationId?: string): Promise<AccessContextResponse>;
  getMfaAssurance(): Promise<MfaAssurance>;
  verifyTotp(code: string): Promise<void>;
  signOut(): Promise<void>;
  onSignedOut(callback: () => void): () => void;
}

function responseStatus(error: unknown): number {
  if (typeof error !== 'object' || error === null) {
    return 0;
  }

  const context: unknown = Reflect.get(error, 'context');
  return context instanceof Response ? context.status : 0;
}

function supportedAssuranceLevel(level: string | null): 'aal1' | 'aal2' | null {
  return level === 'aal1' || level === 'aal2' ? level : null;
}

function asGatewayError(error: unknown): AuthGatewayError {
  if (error instanceof AuthGatewayError) {
    return error;
  }

  if (error instanceof TypeError) {
    return new AuthGatewayError(
      'network_error',
      'FlyEye could not reach the authentication service.',
      {
        cause: error,
      },
    );
  }

  return new AuthGatewayError('unknown', 'FlyEye could not verify your access.', { cause: error });
}

export class SupabaseAuthGateway implements AuthGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async hasSession(): Promise<boolean> {
    const { data, error } = await this.client.auth.getSession();
    if (error) {
      throw asGatewayError(error);
    }

    return data.session !== null;
  }

  async signIn(request: LoginRequest): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword(request);
    if (!error) {
      return;
    }

    if (error.status === 429) {
      throw new AuthGatewayError('rate_limited', 'Too many attempts. Wait before trying again.');
    }

    if (error.status === 400 || error.status === 401) {
      throw new AuthGatewayError(
        'invalid_credentials',
        'The email or password is incorrect, or access is unavailable.',
      );
    }

    throw asGatewayError(error);
  }

  async loadAccessContext(organizationId?: string): Promise<AccessContextResponse> {
    const invocation: unknown = await this.client.functions.invoke('auth-bootstrap', {
      body: organizationId ? { organizationId } : {},
    });
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'access_context_unavailable',
        'Your access could not be verified. Try again.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');

    if (error) {
      const status = responseStatus(error);
      if (status === 409) {
        throw new AuthGatewayError(
          'access_context_conflict',
          'Your access information needs administrator review.',
        );
      }

      throw new AuthGatewayError(
        'access_context_unavailable',
        'Your access could not be verified. Try again.',
      );
    }

    const parsed = accessContextResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new AuthGatewayError(
        'access_context_conflict',
        'Your access information needs administrator review.',
      );
    }

    return parsed.data;
  }

  async getMfaAssurance(): Promise<MfaAssurance> {
    const { data, error } = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) {
      throw asGatewayError(error);
    }

    return {
      currentLevel: supportedAssuranceLevel(data.currentLevel),
      nextLevel: supportedAssuranceLevel(data.nextLevel),
    };
  }

  async verifyTotp(code: string): Promise<void> {
    const { data: factorData, error: factorError } = await this.client.auth.mfa.listFactors();
    if (factorError) {
      throw asGatewayError(factorError);
    }

    const factor = factorData.totp.find((item) => item.status === 'verified');
    if (!factor) {
      throw new AuthGatewayError(
        'mfa_enrollment_required',
        'A verified authenticator is required. Contact your administrator.',
      );
    }

    const { error } = await this.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (error) {
      throw new AuthGatewayError('mfa_invalid', 'The verification code is invalid or expired.');
    }
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) {
      throw asGatewayError(error);
    }
  }

  onSignedOut(callback: () => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        callback();
      }
    });

    return () => data.subscription.unsubscribe();
  }
}
