export type AuthGatewayErrorCode =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'network_error'
  | 'configuration_error'
  | 'access_context_conflict'
  | 'access_context_unavailable'
  | 'admin_onboarding_conflict'
  | 'admin_onboarding_not_available'
  | 'admin_onboarding_recent_authentication_required'
  | 'admin_onboarding_provider_unavailable'
  | 'admin_onboarding_audit_unavailable'
  | 'admin_onboarding_limiter_unavailable'
  | 'member_invitation_not_available'
  | 'member_invitation_conflict'
  | 'member_invitation_recent_authentication_required'
  | 'member_invitation_delivery_failed'
  | 'member_invitation_delivery_uncertain'
  | 'member_invitation_unavailable'
  | 'member_administration_not_found'
  | 'member_administration_validation_failed'
  | 'member_administration_state_conflict'
  | 'member_administration_last_administrator'
  | 'member_administration_self_action'
  | 'member_administration_target_mfa_not_ready'
  | 'member_administration_recent_authentication_required'
  | 'member_administration_assurance_required'
  | 'member_administration_unavailable'
  | 'mfa_invalid'
  | 'mfa_enrollment_required'
  | 'member_mfa_not_available'
  | 'member_mfa_recent_authentication_required'
  | 'member_mfa_factor_conflict'
  | 'member_mfa_state_conflict'
  | 'member_mfa_cleanup_uncertain'
  | 'member_mfa_unavailable'
  | 'recovery_invalid'
  | 'weak_password'
  | 'same_password'
  | 'password_update_failed'
  | 'revocation_failed'
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

export function responseStatus(error: unknown): number {
  if (typeof error !== 'object' || error === null) {
    return 0;
  }

  const context: unknown = Reflect.get(error, 'context');
  return context instanceof Response ? context.status : 0;
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function providerStatus(error: unknown): number {
  if (typeof error !== 'object' || error === null) return 0;
  const status: unknown = Reflect.get(error, 'status') as unknown;
  return typeof status === 'number' ? status : responseStatus(error);
}

export function asGatewayError(error: unknown): AuthGatewayError {
  if (error instanceof AuthGatewayError) {
    return error;
  }

  if (providerStatus(error) === 429) {
    return new AuthGatewayError('rate_limited', 'Too many attempts. Wait before trying again.', {
      cause: error,
    });
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
