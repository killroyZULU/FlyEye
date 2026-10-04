import type { RefObject } from 'react';
import type { RoleConfirmation } from './member-administration-ui';

type MemberRoleConfirmationProps = {
  organizationName: string;
  roleConfirmation: RoleConfirmation;
  busy: boolean;
  confirmationHeading: RefObject<HTMLHeadingElement | null>;
  setRoleConfirmation: (value: RoleConfirmation | undefined) => void;
  confirmRoleAction: () => Promise<void>;
};
export function MemberRoleConfirmation({
  organizationName,
  roleConfirmation,
  busy,
  confirmationHeading,
  setRoleConfirmation,
  confirmRoleAction,
}: MemberRoleConfirmationProps) {
  const selectedRole = roleConfirmation.member.roleOptions.find(
    (role) => role.code === roleConfirmation.roleCode,
  );
  return (
    <section className="confirmation-card" aria-labelledby="role-confirmation-heading">
      <span className="eyebrow">Confirm role change</span>
      <h3 id="role-confirmation-heading" tabIndex={-1} ref={confirmationHeading}>
        Replace this member&apos;s FlyEye role?
      </h3>
      <dl className="detail-grid">
        <div>
          <dt>Organization</dt>
          <dd>{organizationName}</dd>
        </div>
        <div>
          <dt>Member</dt>
          <dd>{roleConfirmation.member.displayName ?? roleConfirmation.member.email}</dd>
        </div>
        <div>
          <dt>Current role</dt>
          <dd>{roleConfirmation.member.roleLabel}</dd>
        </div>
        <div>
          <dt>New role</dt>
          <dd>{selectedRole?.label ?? 'Select a role'}</dd>
        </div>
      </dl>
      <div className="field-group">
        <label htmlFor="replacement-role">New FlyEye role</label>
        <select
          id="replacement-role"
          value={roleConfirmation.roleCode}
          disabled={busy}
          onChange={(event) =>
            setRoleConfirmation({ ...roleConfirmation, roleCode: event.target.value })
          }
        >
          {roleConfirmation.member.roleOptions.map((role) => (
            <option key={role.code} value={role.code}>
              {role.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-group">
        <label htmlFor="role-reason">Reason category</label>
        <select
          id="role-reason"
          value={roleConfirmation.reasonCode}
          disabled={busy}
          onChange={(event) =>
            setRoleConfirmation({
              ...roleConfirmation,
              reasonCode: event.target.value as RoleConfirmation['reasonCode'],
            })
          }
        >
          {roleConfirmation.member.roleReasonOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {selectedRole?.requiresMfa ? (
        <p className="notice notice--warning">
          This privileged portal role requires the member&apos;s current verified authenticator.
        </p>
      ) : null}
      <p className="notice">
        A FlyEye portal role does not verify aviation qualification or grant operational authority.
      </p>
      <div className="button-row">
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() => void confirmRoleAction()}
        >
          {busy ? 'Applying change' : 'Confirm role change'}
        </button>
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => setRoleConfirmation(undefined)}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
