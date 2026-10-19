import { describe, expect, it } from 'vitest';
import { assertRecipient } from './h002-recipient-assertions.mjs';
import { ids } from './h002-acceptance-fixture.mjs';
import { changedEmail } from './h002-recipient-fixture.mjs';

function denied() {
  const before = {
    identity: { id: ids.recipient, email: changedEmail, confirmed: 'confirmed' },
    peerMember: null,
    profiles: [],
    members: [],
    roles: [],
    events: [],
    roleState: { is_active: true, is_invitation_assignable: true },
    organizationStatus: 'active',
    invitation: {
      status: 'pending',
      version: 1,
      expired_at: null,
      revoked_at: null,
      accepted_at: null,
      accepted_by: null,
      accepted_membership_id: null,
      acceptance_idempotency_key_hash: null,
    },
  };
  const after = structuredClone(before);
  after.events.push({
    organization_id: ids.org,
    invitation_id: ids.invitation,
    correlation_id: ids.correlation,
    actor_user_id: ids.recipient,
    event_name: 'member_invitation.denied',
    outcome: 'denied',
    reason_code: 'invitation_not_available',
    idempotency_key_hash: null,
    metadata: {},
  });
  return {
    test: { kind: 'stale', action: 'accept', change: 'email' },
    before,
    after,
    result: { value: { decision: 'not_available', correlationId: ids.correlation } },
  };
}
const check = ({ test, result, before, after, peer }) =>
  assertRecipient(test, result, before, after, peer);
describe('recipient concurrency evidence assertions', () => {
  it('accepts an exact audited stale-identity denial', async () => {
    await expect(check(denied())).resolves.toBeUndefined();
  });
  it.each([
    [
      'missing audit',
      (x) => {
        x.after.events = [];
      },
    ],
    [
      'duplicate audit',
      (x) => {
        x.after.events.push(x.after.events[0]);
      },
    ],
    [
      'foreign scope',
      (x) => {
        x.after.events[0].organization_id = 'foreign';
      },
    ],
    [
      'wrong reason',
      (x) => {
        x.after.events[0].reason_code = 'other';
      },
    ],
    [
      'wrong actor',
      (x) => {
        x.after.events[0].actor_user_id = ids.admin;
      },
    ],
    [
      'new membership',
      (x) => {
        x.after.members.push({ id: 'unexpected' });
      },
    ],
    [
      'new role',
      (x) => {
        x.after.roles.push({ id: 'unexpected' });
      },
    ],
    [
      'new profile',
      (x) => {
        x.after.profiles.push({ id: 'unexpected' });
      },
    ],
    [
      'invitation mutation',
      (x) => {
        x.after.invitation.version = 2;
      },
    ],
    [
      'identity mutation',
      (x) => {
        x.after.identity.email = 'other@example.test';
      },
    ],
    [
      'wrong decision',
      (x) => {
        x.result.value.decision = 'accepted';
      },
    ],
  ])('rejects %s', async (_, mutate) => {
    const x = denied();
    mutate(x);
    await expect(check(x)).rejects.toThrow();
  });
  it('requires a real audit failure and exact rollback', async () => {
    const x = denied();
    x.test.auditFails = 'denied';
    x.after.events = [];
    await expect(check(x)).rejects.toThrow();
    x.result = { error: { sqlState: '23514' } };
    await expect(check(x)).resolves.toBeUndefined();
    x.after.profiles.push({ id: 'partial-write' });
    await expect(check(x)).rejects.toThrow();
  });
  it('preserves the competing committed membership and its profile after audit failure', async () => {
    const x = denied();
    x.test = { kind: 'reassign', commit: true, action: 'accept', auditFails: 'conflicted' };
    x.before.identity.email = 'h002-accept-recipient@example.test';
    x.after = structuredClone(x.before);
    x.peer = {
      peerMember: { id: 'peer', user_id: ids.recipient },
      members: [{ id: 'peer' }],
      profiles: [{ membership_id: 'peer' }],
    };
    Object.assign(x.after, {
      peerMember: x.peer.peerMember,
      members: x.peer.members,
      profiles: x.peer.profiles,
    });
    x.result = { error: { sqlState: '23514' } };
    await expect(check(x)).resolves.toBeUndefined();
    x.after.members = [];
    await expect(check(x)).rejects.toThrow();
  });
});
