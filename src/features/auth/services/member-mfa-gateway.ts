import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/database.types';
import type { TotpPreparation } from '../admin-onboarding';
import {
  memberMfaBoundSchema,
  memberMfaCompleteSchema,
  memberMfaStartSchema,
  memberMfaStatusSchema,
  type MemberMfaComplete,
  type MemberMfaStart,
  type MemberMfaStatus,
} from '../member-mfa';
import { AuthGatewayError, asGatewayError } from './auth-gateway-errors';
import { factorInventory, verifyEnrollmentTotp } from './onboarding-authenticator';
import { normalizeTotpQrSvg } from './totp-qr-svg';
import { edgeErrorDetails } from './edge-error-details';

type MemberMfaClient = Pick<SupabaseClient<Database>, 'auth' | 'functions'>;

export class MemberMfaGateway {
  constructor(private readonly client: MemberMfaClient) {}

  private async invokeMemberMfa(body: Record<string, unknown>): Promise<unknown> {
    const invocation: unknown = await this.client.functions.invoke('member-mfa', { body });
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'member_mfa_unavailable',
        'Authenticator setup is temporarily unavailable.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');
    if (!error) return data;

    const details = await edgeErrorDetails(error);
    switch (details.code) {
      case 'member_mfa.rate_limited':
        throw new AuthGatewayError(
          'rate_limited',
          details.retryAfterSeconds
            ? `Wait ${details.retryAfterSeconds} seconds before trying again.`
            : 'Too many attempts. Wait before trying again.',
        );
      case 'member_mfa.not_available':
        throw new AuthGatewayError(
          'member_mfa_not_available',
          'Authenticator setup is not available for this membership.',
        );
      case 'member_mfa.recent_authentication_required':
        throw new AuthGatewayError(
          'member_mfa_recent_authentication_required',
          'Sign in with your password again to continue.',
        );
      case 'member_mfa.factor_conflict':
        throw new AuthGatewayError(
          'member_mfa_factor_conflict',
          'Your authenticator information needs support review.',
        );
      case 'member_mfa.state_conflict':
        throw new AuthGatewayError(
          'member_mfa_state_conflict',
          'Authenticator setup changed. Sign in again before retrying.',
        );
      case 'member_mfa.cleanup_uncertain':
        throw new AuthGatewayError(
          'member_mfa_cleanup_uncertain',
          'Authenticator cleanup could not be confirmed. Sign in again before retrying.',
        );
      default:
        throw new AuthGatewayError(
          'member_mfa_unavailable',
          'Authenticator setup could not be confirmed. Try again.',
        );
    }
  }

  async loadMemberMfaStatus(): Promise<MemberMfaStatus> {
    const parsed = memberMfaStatusSchema.safeParse(
      await this.invokeMemberMfa({ action: 'status' }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_mfa_state_conflict',
        'Authenticator readiness could not be confirmed.',
      );
    }
    return parsed.data;
  }

  async startMemberMfaEnrollment(idempotencyKey: string): Promise<MemberMfaStart> {
    const parsed = memberMfaStartSchema.safeParse(
      await this.invokeMemberMfa({ action: 'start', idempotencyKey }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_mfa_state_conflict',
        'Authenticator setup could not be started safely.',
      );
    }
    return parsed.data;
  }

  async prepareMemberTotp(start: MemberMfaStart, idempotencyKey: string): Promise<TotpPreparation> {
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
        'member_mfa_factor_conflict',
        'Your authenticator information needs support review.',
      );
    }

    if (start.factorState === 'challenge_required') {
      if (
        all.length !== 1 ||
        all[0]?.factor_type !== 'totp' ||
        (start.operationVersion > 1
          ? !['unverified', 'verified'].includes(all[0].status)
          : all[0].status !== 'verified')
      ) {
        throw new AuthGatewayError(
          'member_mfa_factor_conflict',
          'Your authenticator information needs support review.',
        );
      }
      return { kind: 'challenge', factorId: all[0].id };
    }

    if (all.length !== 0) {
      throw new AuthGatewayError(
        'member_mfa_factor_conflict',
        'Your authenticator information needs support review.',
      );
    }

    const preparation = await this.enrollMemberTotp();
    return this.bindMemberTotp(start, idempotencyKey, preparation);
  }

  private async enrollMemberTotp(): Promise<Extract<TotpPreparation, { kind: 'enrollment' }>> {
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
      let cleanupFailed: boolean;
      try {
        const cleanup = await this.client.auth.mfa.unenroll({ factorId: enrollment.id });
        cleanupFailed = Boolean(cleanup.error);
      } catch {
        cleanupFailed = true;
      }
      throw new AuthGatewayError(
        cleanupFailed ? 'member_mfa_cleanup_uncertain' : 'member_mfa_unavailable',
        cleanupFailed
          ? 'Authenticator setup could not be cleaned up safely. Sign in again before retrying.'
          : 'Authenticator enrollment could not be prepared safely.',
      );
    }

    return {
      kind: 'enrollment' as const,
      factorId: enrollment.id,
      qrSvg,
      manualSecret,
    };
  }

  private async bindMemberTotp(
    start: MemberMfaStart,
    idempotencyKey: string,
    preparation: Extract<TotpPreparation, { kind: 'enrollment' }>,
  ): Promise<TotpPreparation> {
    const reconcileBinding = async (): Promise<TotpPreparation> => {
      const reconciled = memberMfaStatusSchema.safeParse(
        await this.invokeMemberMfa({ action: 'status' }),
      );
      if (
        reconciled.success &&
        reconciled.data.operationState === 'bound' &&
        reconciled.data.operationId === start.operationId &&
        reconciled.data.factorState === 'resume_required' &&
        reconciled.data.operationVersion
      ) {
        start.operationVersion = reconciled.data.operationVersion;
        return preparation;
      }
      throw new AuthGatewayError(
        'member_mfa_cleanup_uncertain',
        'Authenticator binding could not be confirmed. Sign in again to resume safely.',
      );
    };
    let boundPayload: unknown;
    try {
      boundPayload = await this.invokeMemberMfa({
        action: 'bind_factor',
        operationId: start.operationId,
        expectedVersion: start.operationVersion,
        factorId: preparation.factorId,
        idempotencyKey,
      });
    } catch (error) {
      try {
        return await reconcileBinding();
      } catch (reconciliationError) {
        throw new AuthGatewayError(
          'member_mfa_cleanup_uncertain',
          'Authenticator binding could not be confirmed. Sign in again to resume safely.',
          { cause: new AggregateError([error, reconciliationError]) },
        );
      }
    }

    const bound = memberMfaBoundSchema.safeParse(boundPayload);
    if (!bound.success || bound.data.operationId !== start.operationId) {
      try {
        return await reconcileBinding();
      } catch (error) {
        throw new AuthGatewayError(
          'member_mfa_cleanup_uncertain',
          'Authenticator binding could not be confirmed. Sign in again to resume safely.',
          { cause: error },
        );
      }
    }
    start.operationVersion = bound.data.operationVersion;
    return preparation;
  }

  async verifyMemberTotp(factorId: string, code: string): Promise<void> {
    await verifyEnrollmentTotp(this.client.auth.mfa, factorId, code);
  }

  async completeMemberMfaEnrollment(
    start: MemberMfaStart,
    idempotencyKey: string,
  ): Promise<MemberMfaComplete> {
    const parsed = memberMfaCompleteSchema.safeParse(
      await this.invokeMemberMfa({
        action: 'complete',
        operationId: start.operationId,
        expectedVersion: start.operationVersion,
        idempotencyKey,
      }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_mfa_state_conflict',
        'Authenticator readiness could not be confirmed.',
      );
    }
    return parsed.data;
  }

  async cancelMemberMfaEnrollment(
    start: MemberMfaStart,
    factorId: string | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      await this.invokeMemberMfa({
        action: 'cancel',
        operationId: start.operationId,
        expectedVersion: start.operationVersion,
        factorId,
        idempotencyKey,
      });
    } finally {
      try {
        await this.client.auth.signOut({ scope: 'local' });
      } catch {
        // The UI still clears all enrollment material and fails closed.
      }
    }
  }
}
