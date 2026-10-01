import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../lib/database.types';
import {
  invitationPreparationSchema,
  invitationMutationSchema,
  memberInvitationListSchema,
  type InvitationMutation,
  type MemberInvitationList,
} from '../member-invitations';
import { AuthGatewayError, asGatewayError, errorCode } from './auth-gateway-errors';
import { edgeErrorDetails } from './edge-error-details';

type InvitationClient = Pick<SupabaseClient<Database>, 'auth' | 'functions'>;

export class MemberInvitationGateway {
  constructor(private readonly client: InvitationClient) {}

  private async invokeMemberInvitations(body: Record<string, unknown>): Promise<unknown> {
    const invocation: unknown = await this.client.functions.invoke('member-invitations', { body });
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'member_invitation_unavailable',
        'The invitation service is temporarily unavailable.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');
    if (!error) return data;

    const details = await edgeErrorDetails(error);
    switch (details.code) {
      case 'member_invitation.rate_limited':
        throw new AuthGatewayError(
          'rate_limited',
          details.retryAfterSeconds
            ? `Wait ${details.retryAfterSeconds} seconds before trying again.`
            : 'Too many invitation attempts. Wait before trying again.',
        );
      case 'member_invitation.not_available':
        throw new AuthGatewayError(
          'member_invitation_not_available',
          'This invitation is not available.',
        );
      case 'member_invitation.conflict':
        throw new AuthGatewayError(
          'member_invitation_conflict',
          'The invitation state changed. Refresh and try again.',
        );
      case 'member_invitation.recent_authentication_required':
        throw new AuthGatewayError(
          'member_invitation_recent_authentication_required',
          'Sign in with your password again to continue.',
        );
      case 'member_invitation.delivery_failed':
        throw new AuthGatewayError(
          'member_invitation_delivery_failed',
          'The invitation could not be sent. It may be retried safely.',
        );
      case 'member_invitation.delivery_uncertain':
        throw new AuthGatewayError(
          'member_invitation_delivery_uncertain',
          'The delivery result could not be confirmed. Wait before retrying.',
        );
      default:
        throw new AuthGatewayError(
          'member_invitation_unavailable',
          'The invitation service is temporarily unavailable.',
        );
    }
  }

  async loadMemberInvitations(organizationId: string): Promise<MemberInvitationList> {
    const parsed = memberInvitationListSchema.safeParse(
      await this.invokeMemberInvitations({ action: 'list', organizationId }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_invitation_conflict',
        'The invitation list could not be verified.',
      );
    }
    return parsed.data;
  }

  private async mutateMemberInvitation(body: Record<string, unknown>): Promise<InvitationMutation> {
    const parsed = invitationMutationSchema.safeParse(await this.invokeMemberInvitations(body));
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_invitation_conflict',
        'The invitation result could not be verified.',
      );
    }
    return parsed.data;
  }

  createMemberInvitation(request: {
    organizationId: string;
    email: string;
    roleCode: string;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.mutateMemberInvitation({ action: 'create', ...request });
  }

  resendMemberInvitation(request: {
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.mutateMemberInvitation({ action: 'resend', ...request });
  }

  revokeMemberInvitation(request: {
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.mutateMemberInvitation({ action: 'revoke', ...request });
  }

  async prepareInvitationCredential(
    password: string,
    invitation: { invitationId: string; expectedVersion: number },
  ): Promise<void> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user.email || !data.user.email_confirmed_at) {
      throw new AuthGatewayError(
        'member_invitation_not_available',
        'This invitation is not available for the signed-in account.',
      );
    }

    const preparation = invitationPreparationSchema.safeParse(
      await this.invokeMemberInvitations({ action: 'prepare', ...invitation }),
    );
    if (!preparation.success) {
      throw new AuthGatewayError(
        'member_invitation_not_available',
        'This invitation is not available for the signed-in account.',
      );
    }

    if (preparation.data.credentialMode === 'new') {
      const { error: updateError } = await this.client.auth.updateUser({ password });
      if (updateError) {
        if (errorCode(updateError) === 'weak_password') {
          throw new AuthGatewayError(
            'weak_password',
            'Choose a stronger password that follows the guidance shown.',
          );
        }
        throw asGatewayError(updateError);
      }
    }

    const { error: signInError } = await this.client.auth.signInWithPassword({
      email: data.user.email,
      password,
    });
    if (signInError) {
      throw new AuthGatewayError(
        'invalid_credentials',
        'The password is incorrect, or this invitation is unavailable.',
      );
    }
  }

  acceptMemberInvitation(request: {
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.mutateMemberInvitation({ action: 'accept', ...request });
  }
}
