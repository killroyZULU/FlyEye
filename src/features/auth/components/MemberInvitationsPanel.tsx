import { MemberInvitationForm } from './MemberInvitationForm';
import { MemberInvitationList } from './MemberInvitationList';
import { useMemberInvitations, type MemberInvitationsOptions } from './useMemberInvitations';

type Props = MemberInvitationsOptions & {
  organizationName: string;
  onClose: () => void;
};

export function MemberInvitationsPanel({
  gateway,
  organizationId,
  organizationName,
  onClose,
}: Props) {
  const flow = useMemberInvitations({ gateway, organizationId });
  const { result, busy, message, headingRef, mutate } = flow;
  return (
    <section className="invitation-panel" aria-busy={busy}>
      <span className="eyebrow">Organization administration</span>
      <h2 ref={headingRef} tabIndex={-1}>
        Member invitations
      </h2>
      <p>
        Invite one person to <strong>{organizationName}</strong> with one approved initial role.
      </p>

      <MemberInvitationForm flow={flow} organizationName={organizationName} />

      <div className="status-message" role="status" aria-live="polite">
        {message ?? ''}
      </div>
      {busy && !result ? <div className="loading-line" aria-label="Loading invitations" /> : null}
      <MemberInvitationList invitations={result?.invitations} busy={busy} onMutation={mutate} />
      <button className="text-button" type="button" disabled={busy} onClick={onClose}>
        Return to workspace
      </button>
    </section>
  );
}
