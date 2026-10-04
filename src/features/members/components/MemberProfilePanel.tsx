import type { AuthGateway } from '../../auth';
import { MemberProfileForm } from './MemberProfileForm';
import { useMemberProfile } from './useMemberProfile';

type MemberProfilePanelProps = {
  gateway: AuthGateway;
  membershipId: string;
  onClose: () => void;
};

export function MemberProfilePanel({ gateway, membershipId, onClose }: MemberProfilePanelProps) {
  const {
    profile,
    displayName,
    setDisplayName,
    contactNumber,
    setContactNumber,
    busy,
    message,
    errors,
    save,
  } = useMemberProfile({ gateway, membershipId });
  return (
    <section className="member-workspace" aria-labelledby="profile-heading">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Organization profile</span>
          <h2 id="profile-heading">My basic profile</h2>
        </div>
        <button className="text-button" type="button" onClick={onClose}>
          Back to workspace
        </button>
      </div>
      {busy && !profile ? (
        <div role="status">
          <div className="loading-line" aria-hidden="true" />
          <p>Loading your current organization profile.</p>
        </div>
      ) : null}
      {profile ? (
        <MemberProfileForm
          profile={profile}
          displayName={displayName}
          contactNumber={contactNumber}
          busy={busy}
          errors={errors}
          onDisplayNameChange={setDisplayName}
          onContactNumberChange={setContactNumber}
          onSave={save}
        />
      ) : null}
      <p className="status-message" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
