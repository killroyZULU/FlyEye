import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../lib/database.types';
import {
  memberDetailResultSchema,
  memberListSchema,
  memberProfileResultSchema,
  memberRoleResultSchema,
  memberStatusResultSchema,
  type MemberDetail,
  type MemberList,
  type MemberProfile,
  type MemberRoleResult,
  type MemberStatus,
  type MemberStatusAction,
  type MemberStatusResult,
} from '../../members';
import { AuthGatewayError } from './auth-gateway-errors';
import { edgeErrorDetails } from './edge-error-details';

type AdministrationClient = Pick<SupabaseClient<Database>, 'functions'>;

export class MemberAdministrationGateway {
  constructor(private readonly client: AdministrationClient) {}

  private async invokeMemberAdministration(body: Record<string, unknown>): Promise<unknown> {
    const invocation: unknown = await this.client.functions.invoke('member-administration', {
      body,
    });
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'member_administration_unavailable',
        'Member administration is temporarily unavailable.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');
    if (!error) return data;

    const details = await edgeErrorDetails(error);
    switch (details.code) {
      case 'member_administration.rate_limited':
        throw new AuthGatewayError(
          'rate_limited',
          details.retryAfterSeconds
            ? `Wait ${details.retryAfterSeconds} seconds before trying again.`
            : 'Too many member requests. Wait before trying again.',
        );
      case 'member_administration.not_found':
        throw new AuthGatewayError(
          'member_administration_not_found',
          'The requested member information is not available.',
        );
      case 'member_administration.validation_failed':
      case 'member_administration.invalid_request':
        throw new AuthGatewayError(
          'member_administration_validation_failed',
          'The member request is invalid.',
        );
      case 'member_administration.state_conflict':
        throw new AuthGatewayError(
          'member_administration_state_conflict',
          'The member information changed. Refresh and try again.',
        );
      case 'member_administration.last_administrator':
        throw new AuthGatewayError(
          'member_administration_last_administrator',
          'At least one active Organization Admin must remain.',
        );
      case 'member_administration.self_action':
        throw new AuthGatewayError(
          'member_administration_self_action',
          'You cannot apply this change to your own membership.',
        );
      case 'member_administration.target_mfa_not_ready':
        throw new AuthGatewayError(
          'member_administration_target_mfa_not_ready',
          'The selected privileged role requires the member to verify an authenticator first.',
        );
      case 'member_administration.recent_authentication_required':
        throw new AuthGatewayError(
          'member_administration_recent_authentication_required',
          'Sign in with your password again to continue.',
        );
      case 'member_administration.authentication_assurance_required':
        throw new AuthGatewayError(
          'member_administration_assurance_required',
          'Verify your authenticator to continue.',
        );
      default:
        throw new AuthGatewayError(
          'member_administration_unavailable',
          'Member administration is temporarily unavailable.',
        );
    }
  }

  async loadOrganizationMembers(request: {
    organizationId: string;
    status?: MemberStatus;
    search?: string;
    cursor?: string;
  }): Promise<MemberList> {
    const parsed = memberListSchema.safeParse(
      await this.invokeMemberAdministration({ action: 'list', ...request }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_administration_state_conflict',
        'The member list could not be verified.',
      );
    }
    return parsed.data;
  }

  async loadOrganizationMember(
    organizationId: string,
    membershipId: string,
  ): Promise<MemberDetail> {
    const parsed = memberDetailResultSchema.safeParse(
      await this.invokeMemberAdministration({ action: 'detail', organizationId, membershipId }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_administration_state_conflict',
        'The member detail could not be verified.',
      );
    }
    return parsed.data.member;
  }

  async loadMyMemberProfile(membershipId: string): Promise<MemberProfile> {
    const parsed = memberProfileResultSchema.safeParse(
      await this.invokeMemberAdministration({ action: 'get_profile', membershipId }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_administration_state_conflict',
        'Your profile could not be verified.',
      );
    }
    return parsed.data.profile;
  }

  async updateMyMemberProfile(request: {
    membershipId: string;
    displayName: string;
    contactNumber: string;
    expectedVersion: number;
  }): Promise<MemberProfile> {
    const parsed = memberProfileResultSchema.safeParse(
      await this.invokeMemberAdministration({ action: 'update_profile', ...request }),
    );
    if (!parsed.success || parsed.data.decision !== 'updated') {
      throw new AuthGatewayError(
        'member_administration_state_conflict',
        'Your profile result could not be verified.',
      );
    }
    return parsed.data.profile;
  }

  async changeOrganizationMemberStatus(request: {
    organizationId: string;
    membershipId: string;
    action: MemberStatusAction;
    reasonCode: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<MemberStatusResult> {
    const parsed = memberStatusResultSchema.safeParse(
      await this.invokeMemberAdministration(request),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_administration_state_conflict',
        'The membership result could not be verified.',
      );
    }
    return parsed.data;
  }

  async changeOrganizationMemberRole(request: {
    organizationId: string;
    membershipId: string;
    roleCode: string;
    reasonCode: 'responsibility_changed' | 'assignment_corrected';
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<MemberRoleResult> {
    const parsed = memberRoleResultSchema.safeParse(
      await this.invokeMemberAdministration({ action: 'assign_role', ...request }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_administration_state_conflict',
        'The role assignment result could not be verified.',
      );
    }
    return parsed.data;
  }
}
