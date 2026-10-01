import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/database.types';
import {
  adminOnboardingCompleteSchema,
  adminOnboardingStartSchema,
  adminOnboardingStatusSchema,
  type AdminBootstrapGrant,
  type AdminOnboardingComplete,
  type AdminOnboardingStart,
  type AdminOnboardingStatus,
  type TotpPreparation,
} from '../admin-onboarding';
import { AuthGatewayError, asGatewayError } from './auth-gateway-errors';
import { edgeErrorDetails } from './edge-error-details';
import { normalizeTotpQrSvg } from './totp-qr-svg';
import { factorInventory, verifyEnrollmentTotp } from './onboarding-authenticator';

type OnboardingClient = Pick<SupabaseClient<Database>, 'auth' | 'functions'>;

export class AdminOnboardingGateway {
  constructor(private readonly client: OnboardingClient) {}

  private async invokeAdminOnboarding(body: Record<string, unknown>): Promise<unknown> {
    const invocation: unknown = await this.client.functions.invoke(
      'organization-admin-onboarding',
      { body },
    );
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'admin_onboarding_audit_unavailable',
        'Administrator onboarding could not be verified. Try again.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');
    if (!error) return data;

    const details = await edgeErrorDetails(error);
    switch (details.code) {
      case 'admin_onboarding.rate_limited':
        throw new AuthGatewayError(
          'rate_limited',
          details.retryAfterSeconds
            ? `Wait ${details.retryAfterSeconds} seconds before trying again.`
            : 'Too many attempts. Wait before trying again.',
        );
      case 'admin_onboarding.recent_authentication_required':
        throw new AuthGatewayError(
          'admin_onboarding_recent_authentication_required',
          'Sign in with your password again to continue.',
        );
      case 'admin_onboarding.not_available':
      case 'admin_onboarding.not_eligible':
        throw new AuthGatewayError(
          'admin_onboarding_not_available',
          'This administrator onboarding request is not available.',
        );
      case 'admin_onboarding.conflict':
        throw new AuthGatewayError(
          'admin_onboarding_conflict',
          'Your administrator onboarding information needs review.',
        );
      case 'admin_onboarding.provider_unavailable':
        throw new AuthGatewayError(
          'admin_onboarding_provider_unavailable',
          'Authenticator state could not be confirmed. Try again.',
        );
      case 'admin_onboarding.limiter_unavailable':
        throw new AuthGatewayError(
          'admin_onboarding_limiter_unavailable',
          'Administrator onboarding is temporarily unavailable. Try again later.',
        );
      case 'admin_onboarding.audit_unavailable':
        throw new AuthGatewayError(
          'admin_onboarding_audit_unavailable',
          'Administrator onboarding could not be verified. Try again.',
        );
      default:
        if (details.status === 429) {
          throw new AuthGatewayError(
            'rate_limited',
            'Too many attempts. Wait before trying again.',
          );
        }
        throw new AuthGatewayError(
          'admin_onboarding_audit_unavailable',
          'Administrator onboarding could not be verified. Try again.',
        );
    }
  }

  async loadAdminOnboardingStatus(): Promise<AdminOnboardingStatus> {
    const parsed = adminOnboardingStatusSchema.safeParse(
      await this.invokeAdminOnboarding({ action: 'status' }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your administrator onboarding information needs review.',
      );
    }
    return parsed.data;
  }

  async startAdminOnboarding(grant: AdminBootstrapGrant): Promise<AdminOnboardingStart> {
    const parsed = adminOnboardingStartSchema.safeParse(
      await this.invokeAdminOnboarding({
        action: 'start',
        bootstrapGrantId: grant.bootstrapGrantId,
        expectedVersion: grant.grantVersion,
        idempotencyKey: crypto
          .getRandomValues(new Uint8Array(16))
          .reduce((value, byte) => `${value}${byte.toString(16).padStart(2, '0')}`, ''),
      }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your administrator onboarding information needs review.',
      );
    }
    return parsed.data;
  }

  async prepareAdminTotp(
    factorState: AdminOnboardingStart['factorState'],
  ): Promise<TotpPreparation> {
    const { data, error } = await this.client.auth.mfa.listFactors();
    if (error) throw asGatewayError(error);

    const all = factorInventory(data.all);
    const allTotpIds = all
      .filter((factor) => factor.factor_type === 'totp')
      .map((factor) => factor.id)
      .sort();
    const convenienceTotpIds = factorInventory(data.totp)
      .map((factor) => factor.id)
      .sort();
    if (
      allTotpIds.length !== convenienceTotpIds.length ||
      allTotpIds.some((id, index) => id !== convenienceTotpIds[index])
    ) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }

    if (factorState === 'challenge_required') {
      if (all.length !== 1 || all[0]?.factor_type !== 'totp' || all[0].status !== 'verified') {
        throw new AuthGatewayError(
          'admin_onboarding_conflict',
          'Your authenticator information needs administrator review.',
        );
      }
      return { kind: 'challenge', factorId: all[0].id };
    }

    if (all.length !== 0) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }

    const { data: enrollment, error: enrollmentError } = await this.client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'FlyEye authenticator',
    });
    if (enrollmentError) throw asGatewayError(enrollmentError);

    const qrSvg = normalizeTotpQrSvg(enrollment.totp.qr_code);
    const manualSecret = enrollment.totp.secret;
    const uri = enrollment.totp.uri;
    if (
      !qrSvg ||
      !/^[A-Z2-7]+=*$/i.test(manualSecret) ||
      manualSecret.length < 16 ||
      manualSecret.length > 256 ||
      !uri.startsWith('otpauth://totp/') ||
      uri.length > 2048
    ) {
      throw new AuthGatewayError(
        'admin_onboarding_provider_unavailable',
        'Authenticator enrollment could not be prepared safely.',
      );
    }

    return {
      kind: 'enrollment',
      factorId: enrollment.id,
      qrSvg,
      manualSecret,
    };
  }

  verifyAdminTotp(factorId: string, code: string): Promise<void> {
    return verifyEnrollmentTotp(this.client.auth.mfa, factorId, code);
  }

  async completeAdminOnboarding(
    start: AdminOnboardingStart,
    idempotencyKey: string,
  ): Promise<AdminOnboardingComplete> {
    const parsed = adminOnboardingCompleteSchema.safeParse(
      await this.invokeAdminOnboarding({
        action: 'complete',
        bootstrapGrantId: start.bootstrapGrantId,
        expectedVersion: start.grantVersion,
        idempotencyKey,
      }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Administrator onboarding completion could not be revalidated.',
      );
    }
    return parsed.data;
  }

  async cancelAdminOnboarding(bootstrapGrantId: string, idempotencyKey: string): Promise<void> {
    try {
      await this.invokeAdminOnboarding({
        action: 'cancel',
        bootstrapGrantId,
        idempotencyKey,
      });
    } finally {
      try {
        await this.client.auth.signOut({ scope: 'local' });
      } catch {
        // The UI clears in-memory enrollment state even if local SDK cleanup reports failure.
      }
    }
  }
}
