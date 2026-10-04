import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  createIdempotencyKey,
  invitationFormSchema,
  type MemberInvitation,
  type MemberInvitationList,
} from '../member-invitations';
import { AuthGatewayError, type AuthGateway } from '../services/auth-gateway';

export type MemberInvitationsOptions = {
  gateway: AuthGateway;
  organizationId: string;
};

function invitationError(error: unknown): string {
  return error instanceof AuthGatewayError
    ? error.message
    : 'The invitation action could not be completed. Refresh and try again.';
}

export function useMemberInvitations({ gateway, organizationId }: MemberInvitationsOptions) {
  const [result, setResult] = useState<MemberInvitationList>();
  const [email, setEmail] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [confirmation, setConfirmation] = useState<{ email: string; roleCode: string }>();
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    let current = true;
    void gateway
      .loadMemberInvitations(organizationId)
      .then((next) => {
        if (!current) return;
        setResult(next);
        setRoleCode(next.roles[0]?.code ?? '');
      })
      .catch((error: unknown) => {
        if (current) setMessage(invitationError(error));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [gateway, organizationId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = invitationFormSchema.safeParse({ email, roleCode });
    if (!parsed.success || !result?.roles.some((role) => role.code === parsed.data.roleCode)) {
      setMessage('Enter a valid ASCII email address and select an available initial role.');
      return;
    }
    setMessage(undefined);
    setConfirmation(parsed.data);
  }

  async function refreshAfterMutationError(error: unknown) {
    const failureMessage = invitationError(error);
    try {
      setResult(await gateway.loadMemberInvitations(organizationId));
    } catch {
      // The original mutation failure remains the useful non-enumerating guidance.
    }
    setMessage(failureMessage);
  }

  async function confirmInvitation() {
    if (!confirmation) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await gateway.createMemberInvitation({
        organizationId,
        ...confirmation,
        idempotencyKey: createIdempotencyKey(),
      });
      setEmail('');
      setConfirmation(undefined);
      setMessage('The provider accepted the invitation request. Inbox delivery is not confirmed.');
      setResult(await gateway.loadMemberInvitations(organizationId));
    } catch (error) {
      await refreshAfterMutationError(error);
    } finally {
      setBusy(false);
    }
  }

  async function mutate(kind: 'resend' | 'revoke', invitation: MemberInvitation) {
    setBusy(true);
    setMessage(undefined);
    try {
      const request = {
        organizationId,
        invitationId: invitation.invitationId,
        expectedVersion: invitation.version,
        idempotencyKey: createIdempotencyKey(),
      };
      if (kind === 'resend') await gateway.resendMemberInvitation(request);
      else await gateway.revokeMemberInvitation(request);
      setMessage(
        kind === 'resend'
          ? 'A replacement invitation request was accepted.'
          : 'The invitation was revoked.',
      );
      setResult(await gateway.loadMemberInvitations(organizationId));
    } catch (error) {
      await refreshAfterMutationError(error);
    } finally {
      setBusy(false);
    }
  }

  return {
    result,
    email,
    setEmail,
    roleCode,
    setRoleCode,
    confirmation,
    setConfirmation,
    busy,
    message,
    headingRef,
    submit,
    confirmInvitation,
    mutate,
  };
}
