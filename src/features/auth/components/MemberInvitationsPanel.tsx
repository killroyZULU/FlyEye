import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  createIdempotencyKey,
  invitationFormSchema,
  type MemberInvitation,
  type MemberInvitationList,
} from '../member-invitations';
import { AuthGatewayError, type AuthGateway } from '../services/auth-gateway';

type Props = {
  gateway: AuthGateway;
  organizationId: string;
  organizationName: string;
  onClose: () => void;
};

function invitationError(error: unknown): string {
  return error instanceof AuthGatewayError
    ? error.message
    : 'The invitation action could not be completed. Refresh and try again.';
}

function canResend(invitation: MemberInvitation, invitations: MemberInvitation[]): boolean {
  const newerActiveExists =
    invitation.status === 'expired' &&
    invitations.some(
      (candidate) =>
        candidate.invitationId !== invitation.invitationId &&
        candidate.email.toLowerCase() === invitation.email.toLowerCase() &&
        ['issuing', 'pending', 'delivery_failed', 'delivery_uncertain'].includes(candidate.status),
    );
  return (
    !newerActiveExists &&
    (['pending', 'expired', 'delivery_failed', 'delivery_uncertain'].includes(invitation.status) ||
      (invitation.status === 'issuing' && Date.now() - Date.parse(invitation.issuedAt) >= 60_000))
  );
}

function canRevoke(invitation: MemberInvitation): boolean {
  return (
    ['pending', 'delivery_failed', 'delivery_uncertain'].includes(invitation.status) ||
    (invitation.status === 'issuing' && Date.now() - Date.parse(invitation.issuedAt) >= 60_000)
  );
}

export function MemberInvitationsPanel({
  gateway,
  organizationId,
  organizationName,
  onClose,
}: Props) {
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

  return (
    <section className="invitation-panel" aria-busy={busy}>
      <span className="eyebrow">Organization administration</span>
      <h2 ref={headingRef} tabIndex={-1}>
        Member invitations
      </h2>
      <p>
        Invite one person to <strong>{organizationName}</strong> with one approved initial role.
      </p>

      {confirmation ? (
        <section
          className="state-panel invitation-confirmation"
          aria-labelledby="invitation-confirmation-title"
        >
          <span className="eyebrow">Confirm invitation</span>
          <h3 id="invitation-confirmation-title">Check before sending</h3>
          <dl>
            <div>
              <dt>Organization</dt>
              <dd>{organizationName}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{confirmation.email}</dd>
            </div>
            <div>
              <dt>Initial role</dt>
              <dd>
                {result?.roles.find((role) => role.code === confirmation.roleCode)?.label ??
                  confirmation.roleCode}
              </dd>
            </div>
          </dl>
          <div className="invitation-actions">
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void confirmInvitation()}
            >
              Confirm and send
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirmation(undefined)}>
              Edit invitation
            </button>
          </div>
        </section>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="field-group">
            <label htmlFor="invitation-email">Email address</label>
            <input
              id="invitation-email"
              type="email"
              autoComplete="off"
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field-group">
            <label htmlFor="invitation-role">Initial role</label>
            <select
              id="invitation-role"
              value={roleCode}
              disabled={busy || !result}
              onChange={(event) => setRoleCode(event.target.value)}
            >
              {result?.roles.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>
          <p className="privacy-copy">
            Sending does not create membership. The verified recipient must explicitly accept within
            one hour.
          </p>
          <button className="primary-button" type="submit" disabled={busy || !result}>
            Review invitation
          </button>
        </form>
      )}

      <div className="status-message" role="status" aria-live="polite">
        {message ?? ''}
      </div>
      {busy && !result ? <div className="loading-line" aria-label="Loading invitations" /> : null}
      {result && result.invitations.length === 0 ? (
        <p className="placeholder-note">No invitations have been created for this organization.</p>
      ) : null}
      {result?.invitations.length ? (
        <ul className="invitation-list">
          {result.invitations.map((invitation) => (
            <li key={invitation.invitationId}>
              <div>
                <strong>{invitation.email}</strong>
                <span>
                  {invitation.roleLabel} · {invitation.status.replaceAll('_', ' ')}
                </span>
              </div>
              <div className="invitation-actions">
                {canResend(invitation, result.invitations) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void mutate('resend', invitation)}
                  >
                    Resend
                  </button>
                ) : null}
                {canRevoke(invitation) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void mutate('revoke', invitation)}
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <button className="text-button" type="button" disabled={busy} onClick={onClose}>
        Return to workspace
      </button>
    </section>
  );
}
