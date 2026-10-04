import type { RefObject } from 'react';
import { resultingStatus, type Confirmation } from './member-administration-ui';

type MemberStatusConfirmationProps = {
  organizationName: string;
  confirmation: Confirmation;
  busy: boolean;
  confirmationHeading: RefObject<HTMLHeadingElement | null>;
  setConfirmation: (value: Confirmation | undefined) => void;
  confirmStatusAction: () => Promise<void>;
};
export function MemberStatusConfirmation({
  organizationName,
  confirmation,
  busy,
  confirmationHeading,
  setConfirmation,
  confirmStatusAction,
}: MemberStatusConfirmationProps) {
  const reasonOptions = confirmation.member.statusReasonOptions.filter(
    (option) => option.action === confirmation.action,
  );
  return (
    <section className="confirmation-card" aria-labelledby="status-confirmation-heading">
      <span className="eyebrow">Confirm membership change</span>
      <h3 id="status-confirmation-heading" tabIndex={-1} ref={confirmationHeading}>
        {confirmation.action === 'revoke'
          ? 'Permanently revoke this membership?'
          : `${confirmation.action} this membership?`}
      </h3>
      <dl className="detail-grid">
        <div>
          <dt>Organization</dt>
          <dd>{organizationName}</dd>
        </div>
        <div>
          <dt>Member</dt>
          <dd>{confirmation.member.displayName ?? confirmation.member.email}</dd>
        </div>
        <div>
          <dt>Current status</dt>
          <dd>{confirmation.member.status}</dd>
        </div>
        <div>
          <dt>Resulting status</dt>
          <dd>{resultingStatus(confirmation.action)}</dd>
        </div>
        <div>
          <dt>Preserved role</dt>
          <dd>{confirmation.member.roleLabel}</dd>
        </div>
      </dl>
      {confirmation.action === 'revoke' ? (
        <p className="notice notice--warning">
          Revocation is terminal in FEAT-005. It preserves records but cannot be reversed here.
        </p>
      ) : null}
      <div className="field-group">
        <label htmlFor="status-reason">Reason category</label>
        <select
          id="status-reason"
          value={confirmation.reasonCode}
          disabled={busy}
          onChange={(event) => setConfirmation({ ...confirmation, reasonCode: event.target.value })}
        >
          {reasonOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="button-row">
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() => void confirmStatusAction()}
        >
          {busy ? 'Applying change' : `Confirm ${confirmation.action}`}
        </button>
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => setConfirmation(undefined)}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
