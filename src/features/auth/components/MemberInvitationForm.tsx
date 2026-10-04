import type { useMemberInvitations } from './useMemberInvitations';

type Props = {
  flow: Pick<
    ReturnType<typeof useMemberInvitations>,
    | 'result'
    | 'email'
    | 'setEmail'
    | 'roleCode'
    | 'setRoleCode'
    | 'confirmation'
    | 'setConfirmation'
    | 'busy'
    | 'submit'
    | 'confirmInvitation'
  >;
  organizationName: string;
};

export function MemberInvitationForm({ flow, organizationName }: Props) {
  const {
    result,
    email,
    setEmail,
    roleCode,
    setRoleCode,
    confirmation,
    setConfirmation,
    busy,
    submit,
    confirmInvitation,
  } = flow;
  return confirmation ? (
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
        Sending does not create membership. The verified recipient must explicitly accept within one
        hour.
      </p>
      <button className="primary-button" type="submit" disabled={busy || !result}>
        Review invitation
      </button>
    </form>
  );
}
