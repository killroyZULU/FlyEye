import { accept, locks, q, revoke } from './h002-acceptance-fixture.mjs';

export const cases = Object.entries(locks).map(([name, lock]) => ({
  name: `${name}-retained`,
  lock,
  decision: 'accepted',
  accepted: true,
}));
cases.push(
  {
    name: 'revoke-before-accept',
    lock: locks.org,
    change: `set local role service_role; ${revoke}`,
    changeDecision: 'revoked',
    decision: 'not_available',
    status: 'revoked',
    events: ['revoked', 'denied'],
  },
  {
    name: 'accept-before-revoke',
    lock: locks.invitation,
    peer: revoke,
    peerDecision: 'conflict',
    decision: 'accepted',
    accepted: true,
  },
  {
    name: 'same-key-concurrent-replay',
    lock: locks.invitation,
    peer: accept(),
    peerDecision: 'accepted',
    replay: true,
    decision: 'accepted',
    accepted: true,
  },
  {
    name: 'different-key-concurrent-conflict',
    lock: locks.invitation,
    peer: accept({ key: 'd' }),
    peerDecision: 'not_available',
    decision: 'accepted',
    accepted: true,
    events: ['accepted', 'denied'],
  },
  {
    name: 'suspended-school-before-accept',
    suspended: true,
    lock: locks.org,
    change: `update public.organizations set status='suspended' where id=${q('org')};`,
    decision: 'not_available',
    events: ['denied'],
  },
);
for (const field of ['is_active', 'is_invitation_assignable']) {
  const change = `update public.roles set ${field}=false where id=${q('role')};`;
  cases.push(
    {
      name: `${field}-before-accept`,
      changedRoleField: field,
      lock: locks.role,
      change,
      decision: 'conflict',
      events: ['conflicted'],
    },
    // Keep acceptance's transaction open: the role update must wait for its FOR SHARE.
    {
      name: `${field}-after-accept`,
      changedRoleField: field,
      afterAccept: change,
      decision: 'accepted',
      accepted: true,
    },
  );
}
export const negatives = [
  {
    name: 'wrong-confirmed-email',
    sql: accept({ email: 'other@example.test' }),
    decision: 'not_available',
    events: ['denied'],
  },
  {
    name: 'stale-invitation-version',
    sql: accept({ version: 2 }),
    decision: 'not_available',
    events: ['denied'],
  },
  {
    name: 'stale-password-evidence',
    sql: accept({ age: 601 }),
    decision: 'recent_authentication_required',
    events: [],
  },
  {
    name: 'expired-invitation',
    setup: `update public.organization_invitations
    set issued_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${q('invitation')};`,
    decision: 'not_available',
    status: 'expired',
    events: ['expired', 'denied'],
  },
  {
    name: 'existing-membership',
    setup: `insert into public.organization_memberships(organization_id,user_id,status)
    values(${q('org')},${q('recipient')},'suspended');`,
    existing: true,
    decision: 'conflict',
    events: ['conflicted'],
  },
];
