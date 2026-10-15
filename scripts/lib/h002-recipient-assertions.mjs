import assert from 'node:assert/strict';
import { ids } from './h002-acceptance-fixture.mjs';
import { assertAcceptance } from './h002-acceptance-assertions.mjs';
import { changedEmail, email } from './h002-recipient-fixture.mjs';
import { expectedDecision } from './h002-recipient-cases.mjs';

export async function assertRecipient(test, result, before, after, peerState) {
  const decision = expectedDecision(test);
  const changed =
    test.kind === 'stale' || test.kind === 'command' || (test.kind === 'identity' && test.commit);
  assert.deepEqual(after.identity, {
    ...before.identity,
    email: changed && test.change === 'email' ? changedEmail : email,
    confirmed: changed && test.change === 'confirmation' ? null : before.identity.confirmed,
  });
  const peerCommitted = ['insert', 'reassign'].includes(test.kind) && test.commit;
  assert.deepEqual(after.peerMember, peerCommitted ? peerState.peerMember : before.peerMember);
  const expectedBefore = peerCommitted
    ? { ...before, members: peerState.members, profiles: peerState.profiles }
    : before;
  if (test.auditFails) {
    assert.equal(result.error?.sqlState, '23514');
    assert.deepEqual(after.invitation, before.invitation);
    assert.deepEqual(after.members, expectedBefore.members);
    assert.deepEqual(after.roles, before.roles);
    assert.deepEqual(after.profiles, expectedBefore.profiles);
    assert.deepEqual(after.events, before.events);
    return;
  }
  if (result.error) throw result.error;
  assert.equal(result.value.correlationId, ids.correlation);
  assert.equal(result.value.decision, decision);
  if (decision === 'prepared') {
    assert.deepEqual(result.value, {
      decision: 'prepared',
      invitationId: ids.invitation,
      credentialMode: 'existing',
      version: 1,
      correlationId: ids.correlation,
    });
    for (const field of ['invitation', 'members', 'roles', 'profiles', 'events']) {
      assert.deepEqual(after[field], before[field]);
    }
    return;
  }
  await assertAcceptance(
    { query: async () => JSON.stringify(after) },
    {
      decision,
      accepted: decision === 'accepted',
      events:
        decision === 'not_available'
          ? ['denied']
          : decision === 'conflict'
            ? ['conflicted']
            : ['accepted'],
    },
    result.value,
    expectedBefore,
  );
  if (decision === 'accepted') {
    const newProfiles = after.profiles.filter(
      (profile) => profile.membership_id === result.value.membershipId,
    );
    assert.equal(newProfiles.length, 1);
    assert.equal(newProfiles[0].organization_id, ids.org);
    assert.equal(newProfiles[0].created_by, ids.recipient);
    assert.deepEqual(
      after.profiles.filter((profile) => profile.membership_id !== result.value.membershipId),
      before.profiles,
    );
  } else assert.deepEqual(after.profiles, expectedBefore.profiles);
}
