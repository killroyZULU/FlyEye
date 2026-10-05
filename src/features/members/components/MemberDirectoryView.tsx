import type { ReactNode } from 'react';
import type { MemberStatus } from '../member-administration';
import type { MemberDirectory } from './useMemberDirectory';

type MemberDirectoryViewProps = { directory: MemberDirectory; children: ReactNode };
export function MemberDirectoryView({ directory, children }: MemberDirectoryViewProps) {
  const {
    members,
    status,
    setStatus,
    searchInput,
    setSearchInput,
    search,
    setSearch,
    nextCursor,
    busy,
    message,
    loadMembers,
    submitSearch,
    loadDetail,
  } = directory;
  return (
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
              <span className={`status-chip status-chip--${member.status}`}>{member.status}</span>
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
      {children}
    </>
  );
}
