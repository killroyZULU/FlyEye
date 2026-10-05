import type { MemberDetail, MemberStatusAction } from '../member-administration';
import { availableActions } from './member-administration-ui';

type MemberDetailCardProps = {
  selected: MemberDetail;
  currentMembershipId: string;
  setSelected: (member: MemberDetail | undefined) => void;
  beginStatusAction: (action: MemberStatusAction, member: MemberDetail) => void;
  beginRoleAction: (member: MemberDetail) => void;
};
export function MemberDetailCard({
  selected,
  currentMembershipId,
  setSelected,
  beginStatusAction,
  beginRoleAction,
}: MemberDetailCardProps) {
  return (
    <article className="member-detail" aria-labelledby="member-detail-heading">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Member detail</span>
          <h3 id="member-detail-heading">{selected.displayName ?? 'Incomplete profile'}</h3>
        </div>
        <button className="text-button" type="button" onClick={() => setSelected(undefined)}>
          Close detail
        </button>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>Email</dt>
          <dd>{selected.email}</dd>
        </div>
        <div>
          <dt>Contact number</dt>
          <dd>{selected.contactNumber ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{selected.roleLabel}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{selected.status}</dd>
        </div>
        <div>
          <dt>Profile</dt>
          <dd>{selected.profileComplete ? 'Complete' : 'Incomplete'}</dd>
        </div>
      </dl>
      {selected.membershipId === currentMembershipId ? (
        <p className="notice">This is your membership. Self-status actions are not available.</p>
      ) : (
        <div className="button-row">
          {availableActions(selected).map((action) => (
            <button
              className={action === 'revoke' ? 'danger-button' : 'primary-button'}
              type="button"
              key={action}
              data-member-action={action}
              onClick={() => beginStatusAction(action, selected)}
            >
              {action === 'revoke' ? 'Revoke membership' : `${action} membership`}
            </button>
          ))}
          {selected.roleOptions.length > 0 ? (
            <button
              className="primary-button"
              type="button"
              data-member-action="assign-role"
              onClick={() => beginRoleAction(selected)}
            >
              Change FlyEye role
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
}
