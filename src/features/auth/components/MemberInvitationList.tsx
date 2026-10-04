import type { MemberInvitation } from '../member-invitations';

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

type Props = {
  invitations: MemberInvitation[] | undefined;
  busy: boolean;
  onMutation: (kind: 'resend' | 'revoke', invitation: MemberInvitation) => Promise<void>;
};

export function MemberInvitationList({ invitations, busy, onMutation }: Props) {
  return (
    <>
      {invitations && invitations.length === 0 ? (
        <p className="placeholder-note">No invitations have been created for this organization.</p>
      ) : null}
      {invitations?.length ? (
        <ul className="invitation-list">
          {invitations.map((invitation) => (
            <li key={invitation.invitationId}>
              <div>
                <strong>{invitation.email}</strong>
                <span>
                  {invitation.roleLabel} · {invitation.status.replaceAll('_', ' ')}
                </span>
              </div>
              <div className="invitation-actions">
                {canResend(invitation, invitations) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onMutation('resend', invitation)}
                  >
                    Resend
                  </button>
                ) : null}
                {canRevoke(invitation) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onMutation('revoke', invitation)}
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
