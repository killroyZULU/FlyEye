import assert from 'node:assert/strict';
import { ids, snapshot } from './h002-acceptance-fixture.mjs';

export async function assertAcceptance(observer, test, result, before) {
  assert.equal(result.decision, test.decision);
  const state = JSON.parse(await observer.query(snapshot));
  assert.deepEqual(state.roleState, {
    is_active: test.changedRoleField !== 'is_active',
    is_invitation_assignable: test.changedRoleField !== 'is_invitation_assignable',
  });
  assert.equal(state.organizationStatus, test.suspended ? 'suspended' : 'active');
  assert.equal(state.invitation.status, test.accepted ? 'accepted' : (test.status ?? 'pending'));
  assert.equal(state.invitation.version, test.accepted || test.status ? 2 : 1);
  assert.deepEqual(
    state.events.map((event) => event.event_name.replace('member_invitation.', '')).sort(),
    (test.events ?? (test.accepted ? ['accepted'] : [])).toSorted(),
  );
  for (const event of state.events) {
    assert.equal(event.organization_id, ids.org);
    assert.equal(event.invitation_id, ids.invitation);
    assert.equal(event.correlation_id, ids.correlation);
    assert.equal(
      event.actor_user_id,
      event.event_name === 'member_invitation.revoked' ? ids.admin : ids.recipient,
    );
    assert.equal(
      event.outcome,
      [
        'member_invitation.denied',
        'member_invitation.conflicted',
        'member_invitation.expired',
      ].includes(event.event_name)
        ? 'denied'
        : 'success',
    );
    const contracts = {
      'member_invitation.denied': ['invitation_not_available', null, {}],
      'member_invitation.conflicted': ['membership_state_conflict', null, {}],
      'member_invitation.expired': ['invitation_expired', null, { invitationVersion: 2 }],
      'member_invitation.revoked': ['invitation_revoked', 'c'.repeat(64), { invitationVersion: 2 }],
    };
    if (contracts[event.event_name]) {
      const [reason, key, metadata] = contracts[event.event_name];
      assert.equal(event.reason_code, reason);
      assert.equal(event.idempotency_key_hash, key);
      assert.deepEqual(event.metadata, metadata);
    }
  }
  const immutableInvitation = { ...state.invitation };
  const originalInvitation = { ...before.invitation };
  for (const field of [
    'status',
    'version',
    'updated_at',
    'accepted_at',
    'accepted_by',
    'accepted_membership_id',
    'acceptance_idempotency_key_hash',
    'expired_at',
    'revoked_at',
  ]) {
    delete immutableInvitation[field];
    delete originalInvitation[field];
  }
  assert.deepEqual(immutableInvitation, originalInvitation);
  assert.equal(state.invitation.expired_at !== null, test.status === 'expired');
  assert.equal(state.invitation.revoked_at !== null, test.status === 'revoked');
  assert.equal(state.invitation.accepted_at !== null, Boolean(test.accepted));
  if (test.accepted) {
    assert.equal(result.replayed, false);
    assert.equal(result.organizationId, ids.org);
    assert.equal(result.invitationId, ids.invitation);
    assert.equal(result.version, 2);
    assert.equal(state.members.length, 1);
    assert.equal(state.roles.length, 1);
    const member = state.members[0];
    assert.equal(member.id, result.membershipId);
    assert.equal(member.organization_id, ids.org);
    assert.equal(member.user_id, ids.recipient);
    assert.equal(member.status, 'active');
    assert.equal(member.created_by, ids.recipient);
    assert.equal(member.updated_by, ids.recipient);
    assert.equal(state.roles[0].membership_id, member.id);
    assert.equal(state.roles[0].role_id, ids.role);
    assert.equal(state.roles[0].organization_id, ids.org);
    assert.equal(state.roles[0].assigned_by, ids.recipient);
    assert.equal(state.invitation.accepted_membership_id, member.id);
    assert.equal(state.invitation.accepted_by, ids.recipient);
    assert.equal(state.invitation.acceptance_idempotency_key_hash, 'b'.repeat(64));
    const event = state.events.find((entry) => entry.event_name === 'member_invitation.accepted');
    assert.equal(event.idempotency_key_hash, 'b'.repeat(64));
    assert.equal(event.reason_code, 'membership_created');
    assert.deepEqual(event.metadata, {
      invitationVersion: 2,
      membershipId: member.id,
      roleId: ids.role,
    });
  } else {
    assert.deepEqual(state.members, before.members);
    assert.deepEqual(state.roles, before.roles);
    if (!test.status) assert.deepEqual(state.invitation, before.invitation);
    assert.equal(state.invitation.accepted_by, null);
    assert.equal(state.invitation.accepted_membership_id, null);
    assert.equal(state.invitation.acceptance_idempotency_key_hash, null);
  }
}
