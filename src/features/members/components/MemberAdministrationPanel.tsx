import { useEffect, useRef, useState } from 'react';

import { AuthGatewayError, type AuthGateway } from '../../auth/services/auth-gateway';
import {
  createMemberIdempotencyKey,
  memberSearchSchema,
  type MemberDetail,
  type MemberStatus,
  type MemberStatusAction,
  type MemberSummary,
} from '../member-administration';

type MemberAdministrationPanelProps = {
  gateway: AuthGateway;
  organizationId: string;
  organizationName: string;
  currentMembershipId: string;
  onClose: () => void;
  onRequirePassword: (message: string) => void;
};

type Confirmation = {
  action: MemberStatusAction;
  member: MemberDetail;
  reasonCode: string;
  idempotencyKey: string;
};

function safeMessage(error: unknown): string {
  return error instanceof AuthGatewayError
    ? error.message
    : 'Member administration is temporarily unavailable. Try again.';
}

function resultingStatus(action: MemberStatusAction): MemberStatus {
  if (action === 'suspend') return 'suspended';
  if (action === 'reactivate') return 'active';
  return 'revoked';
}

function availableActions(member: MemberDetail): MemberStatusAction[] {
  return [...new Set(member.statusReasonOptions.map((option) => option.action))];
}

export function MemberAdministrationPanel({
  gateway,
  organizationId,
  organizationName,
  currentMembershipId,
  onClose,
  onRequirePassword,
}: MemberAdministrationPanelProps) {
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [selected, setSelected] = useState<MemberDetail>();
  const [status, setStatus] = useState<MemberStatus | 'all'>('active');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const membersHeading = useRef<HTMLHeadingElement>(null);
  const confirmationReturnAction = useRef<MemberStatusAction | null>(null);

  useEffect(() => {
    if (confirmation) {
      confirmationHeading.current?.focus();
    } else if (confirmationReturnAction.current) {
      const action = confirmationReturnAction.current;
      confirmationReturnAction.current = null;
      const target = document.querySelector<HTMLElement>(`[data-member-action="${action}"]`);
      (target ?? membersHeading.current)?.focus();
    }
  }, [confirmation]);

  async function loadMembers(cursor?: string, append = false): Promise<boolean> {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await gateway.loadOrganizationMembers({
        organizationId,
        status: status === 'all' ? undefined : status,
        search,
        cursor,
      });
      if (!mounted.current || sequence !== requestSequence.current) return false;
      setMembers((current) => (append ? [...current, ...result.members] : result.members));
      setNextCursor(result.nextCursor);
      if (!append) setSelected(undefined);
      return true;
    } catch (error) {
      if (mounted.current && sequence === requestSequence.current) setMessage(safeMessage(error));
      return false;
    } finally {
      if (mounted.current && sequence === requestSequence.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    const loadTimer = window.setTimeout(() => void loadMembers(), 0);
    return () => {
      window.clearTimeout(loadTimer);
      mounted.current = false;
      requestSequence.current += 1;
    };
    // Loading is intentionally keyed to the approved filter state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, organizationId, status, search]);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const normalized = searchInput.trim();
    if (!normalized) {
      setSearch(undefined);
      return;
    }
    const parsed = memberSearchSchema.safeParse(normalized);
    if (!parsed.success) {
      setMessage('Search requires 2 to 80 characters, or leave it empty.');
      return;
    }
    setSearch(parsed.data);
  }

  async function loadDetail(member: MemberSummary) {
    setBusy(true);
    setMessage(undefined);
    try {
      const detail = await gateway.loadOrganizationMember(organizationId, member.membershipId);
      if (mounted.current) setSelected(detail);
    } catch (error) {
      if (mounted.current) setMessage(safeMessage(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

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

  const reasonOptions = confirmation
    ? confirmation.member.statusReasonOptions.filter(
        (option) => option.action === confirmation.action,
      )
    : [];

  return (
    <section className="member-workspace" aria-labelledby="members-heading">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h2 id="members-heading" tabIndex={-1} ref={membersHeading}>
            Organization members
          </h2>
          <p>{organizationName}</p>
        </div>
        <button className="text-button" type="button" onClick={onClose}>
          Back to workspace
        </button>
      </div>

      {confirmation ? (
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
              onChange={(event) =>
                setConfirmation({ ...confirmation, reasonCode: event.target.value })
              }
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
      ) : null}

      {!confirmation ? (
        <>
          <form className="member-filters" onSubmit={(event) => void submitSearch(event)}>
            <div className="field-group">
              <label htmlFor="member-status-filter">Membership status</label>
              <select
                id="member-status-filter"
                value={status}
                disabled={busy}
                onChange={(event) => setStatus(event.target.value as MemberStatus | 'all')}
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="revoked">Revoked</option>
                <option value="all">All statuses</option>
              </select>
            </div>
            <div className="field-group member-search">
              <label htmlFor="member-search">Search display name or email</label>
              <div className="inline-field">
                <input
                  id="member-search"
                  value={searchInput}
                  maxLength={80}
                  disabled={busy}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
                <button className="primary-button" type="submit" disabled={busy}>
                  Search
                </button>
              </div>
            </div>
          </form>

          {search ? (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setSearchInput('');
                setSearch(undefined);
              }}
            >
              Clear search for “{search}”
            </button>
          ) : null}

          {busy && members.length === 0 ? (
            <div className="loading-line" role="status" aria-label="Loading members" />
          ) : null}

          {!busy && members.length === 0 && !message ? (
            <p className="empty-state">No members match this bounded organization view.</p>
          ) : null}

          <ul className="member-list" aria-label="Organization members">
            {members.map((member) => (
              <li key={member.membershipId}>
                <button type="button" disabled={busy} onClick={() => void loadDetail(member)}>
                  <span>
                    <strong>{member.displayName ?? 'Incomplete profile'}</strong>
                    <small>{member.email}</small>
                  </span>
                  <span className={`status-chip status-chip--${member.status}`}>
                    {member.status}
                  </span>
                  <small>{member.roleLabel}</small>
                </button>
              </li>
            ))}
          </ul>

          {nextCursor ? (
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void loadMembers(nextCursor, true)}
            >
              {busy ? 'Loading' : 'Load more members'}
            </button>
          ) : null}

          {selected ? (
            <article className="member-detail" aria-labelledby="member-detail-heading">
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">Member detail</span>
                  <h3 id="member-detail-heading">{selected.displayName ?? 'Incomplete profile'}</h3>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setSelected(undefined)}
                >
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
                <p className="notice">
                  This is your membership. Self-status actions are not available.
                </p>
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
                </div>
              )}
            </article>
          ) : null}
        </>
      ) : null}

      <p className="status-message" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
