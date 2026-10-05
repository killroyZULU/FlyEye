import { AuthGatewayError } from '../../auth';
import type { MemberDetail, MemberStatus, MemberStatusAction } from '../member-administration';

export type Confirmation = {
  action: MemberStatusAction;
  member: MemberDetail;
  reasonCode: string;
  idempotencyKey: string;
};

export type RoleConfirmation = {
  member: MemberDetail;
  roleCode: string;
  reasonCode: 'responsibility_changed' | 'assignment_corrected';
  idempotencyKey: string;
};

export function safeMessage(error: unknown): string {
  return error instanceof AuthGatewayError
    ? error.message
    : 'Member administration is temporarily unavailable. Try again.';
}

export function resultingStatus(action: MemberStatusAction): MemberStatus {
  if (action === 'suspend') return 'suspended';
  if (action === 'reactivate') return 'active';
  return 'revoked';
}

export function availableActions(member: MemberDetail): MemberStatusAction[] {
  return [...new Set(member.statusReasonOptions.map((option) => option.action))];
}
