import { useEffect, useRef, useState } from 'react';
import { AuthGatewayError, type AuthGateway } from '../../auth';
import {
  createMemberIdempotencyKey,
  type MemberDetail,
  type MemberStatusAction,
} from '../member-administration';
import {
  resultingStatus,
  safeMessage,
  type Confirmation,
  type RoleConfirmation,
} from './member-administration-ui';
import type { MemberDirectory } from './useMemberDirectory';

type MemberAdministrationCommandOptions = {
  gateway: AuthGateway;
  organizationId: string;
  onRequirePassword: (message: string) => void;
  directory: MemberDirectory;
};
export function useMemberAdministrationCommands({
  gateway,
  organizationId,
  onRequirePassword,
  directory,
}: MemberAdministrationCommandOptions) {
  const { mounted, setBusy, setMessage, setSelected, loadMembers } = directory;
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [roleConfirmation, setRoleConfirmation] = useState<RoleConfirmation>();
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const membersHeading = useRef<HTMLHeadingElement>(null);
  const confirmationReturnAction = useRef<MemberStatusAction | null>(null);
  const roleConfirmationReturn = useRef(false);

  useEffect(() => {
    if (confirmation || roleConfirmation) {
      confirmationHeading.current?.focus();
    } else if (confirmationReturnAction.current) {
      const action = confirmationReturnAction.current;
      confirmationReturnAction.current = null;
      const target = document.querySelector<HTMLElement>(`[data-member-action="${action}"]`);
      (target ?? membersHeading.current)?.focus();
    } else if (roleConfirmationReturn.current) {
      roleConfirmationReturn.current = false;
      const target = document.querySelector<HTMLElement>('[data-member-action="assign-role"]');
      (target ?? membersHeading.current)?.focus();
    }
  }, [confirmation, roleConfirmation]);

  function beginStatusAction(action: MemberStatusAction, member: MemberDetail) {
    const firstReason = member.statusReasonOptions.find((option) => option.action === action);
    if (!firstReason) {
      setMessage('This membership action is no longer available. Refresh and try again.');
      return;
    }
    confirmationReturnAction.current = action;
    setConfirmation({
      action,
      member,
      reasonCode: firstReason.code,
      idempotencyKey: createMemberIdempotencyKey(),
    });
    setMessage(undefined);
  }

  async function confirmStatusAction() {
    if (!confirmation) return;
    if (!navigator.onLine) {
      setMessage('You are offline. Membership changes are not queued; reconnect and try again.');
      return;
    }

    setBusy(true);
    setMessage(undefined);
    try {
      await gateway.changeOrganizationMemberStatus({
        organizationId,
        membershipId: confirmation.member.membershipId,
        action: confirmation.action,
        reasonCode: confirmation.reasonCode,
        expectedVersion: confirmation.member.membershipVersion,
        idempotencyKey: confirmation.idempotencyKey,
      });
      if (!mounted.current) return;
      setConfirmation(undefined);
      setSelected(undefined);
      const refreshed = await loadMembers();
      if (mounted.current) {
        const completed = `Membership ${resultingStatus(confirmation.action)} successfully.`;
        setMessage(
          refreshed
            ? completed
            : `${completed} The refreshed member list is unavailable; retry the list before another action.`,
        );
      }
    } catch (error) {
      if (!mounted.current) return;
      if (
        error instanceof AuthGatewayError &&
        error.code === 'member_administration_recent_authentication_required'
      ) {
        onRequirePassword(error.message);
        return;
      }
      setMessage(safeMessage(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function beginRoleAction(member: MemberDetail) {
    const firstRole = member.roleOptions[0];
    const firstReason = member.roleReasonOptions[0];
    if (!firstRole || !firstReason) {
      setMessage('Role assignment is no longer available. Refresh and try again.');
      return;
    }
    roleConfirmationReturn.current = true;
    setRoleConfirmation({
      member,
      roleCode: firstRole.code,
      reasonCode: firstReason.code,
      idempotencyKey: createMemberIdempotencyKey(),
    });
    setMessage(undefined);
  }

  async function confirmRoleAction() {
    if (!roleConfirmation) return;
    if (!navigator.onLine) {
      setMessage('You are offline. Role changes are not queued; reconnect and try again.');
      return;
    }

    setBusy(true);
    setMessage(undefined);
    try {
      const result = await gateway.changeOrganizationMemberRole({
        organizationId,
        membershipId: roleConfirmation.member.membershipId,
        roleCode: roleConfirmation.roleCode,
        reasonCode: roleConfirmation.reasonCode,
        expectedVersion: roleConfirmation.member.membershipVersion,
        idempotencyKey: roleConfirmation.idempotencyKey,
      });
      if (!mounted.current) return;
      setRoleConfirmation(undefined);
      setSelected(undefined);
      const refreshed = await loadMembers();
      if (mounted.current) {
        const completed = `Role changed to ${result.roleLabel} successfully.`;
        setMessage(
          refreshed
            ? completed
            : `${completed} The refreshed member list is unavailable; retry the list before another action.`,
        );
      }
    } catch (error) {
      if (!mounted.current) return;
      if (
        error instanceof AuthGatewayError &&
        error.code === 'member_administration_recent_authentication_required'
      ) {
        onRequirePassword(error.message);
        return;
      }
      setMessage(safeMessage(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return {
    confirmation,
    setConfirmation,
    roleConfirmation,
    setRoleConfirmation,
    confirmationHeading,
    membersHeading,
    beginStatusAction,
    confirmStatusAction,
    beginRoleAction,
    confirmRoleAction,
  };
}
