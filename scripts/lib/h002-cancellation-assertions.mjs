import assert from 'node:assert/strict';
import { ids, q, snapshot } from './h002-onboarding-fixture.mjs';

export const signature = 'public.cancel_organization_admin_onboarding(uuid,uuid,text,uuid)';
export const cancel = (key = 'b', actor = 'actor', grant = 'grant', correlation = 'correlation') =>
  `select public.cancel_organization_admin_onboarding(${q(actor)},${q(grant)},repeat('${key}',64),${q(correlation)});`;
export const complete = (version = 1, correlation = 'correlation') =>
  `select public.complete_first_organization_admin_bootstrap(${q('actor')},${q('actor')},
    ${q('session')},floor(extract(epoch from transaction_timestamp()))::bigint,
    'aal2',array['password','totp'],${q('factor')},1,${q('grant')},${version},repeat('a',64),${q(correlation)});`;
export const read = async (observer) => JSON.parse(await observer.query(snapshot));
export function addedEvents(before, after) {
  for (const event of before.events)
    assert.deepEqual(
      after.events.find((candidate) => candidate.id === event.id),
      event,
    );
  return after.events.filter((event) => !before.events.some((prior) => prior.id === event.id));
}
export function assertCancellation(
  result,
  before,
  after,
  replayed = false,
  key = 'b',
  correlation = 'correlation',
  requireFence = true,
) {
  assert.deepEqual(result, {
    decision: 'cancelled',
    cleanupOutcome: 'not_attempted',
    replayed,
    correlationId: ids[correlation],
  });
  const grant = { ...before.grant };
  if (!replayed && grant.status === 'pending') {
    if (requireFence) grant.version++;
    else {
      // Baseline characterization still requires exact audited state, without assuming the new fence exists.
      assert.ok([grant.version, grant.version + 1].includes(after.grant.version));
      grant.version = after.grant.version;
    }
  }
  assert.deepEqual(after.grant, grant);
  for (const table of ['members', 'profiles', 'roles'])
    assert.deepEqual(after[table], before[table]);
  const events = addedEvents(before, after);
  assert.equal(events.length, replayed ? 0 : 1);
  if (replayed) return;
  const event = events[0];
  assert.deepEqual(event, {
    ...event,
    organization_id: ids.org,
    organization_ids: [ids.org],
    actor_user_id: ids.actor,
    actor_subject_id: ids.actor,
    actor_kind: 'authenticated_subject',
    event_name: 'admin_onboarding.cancelled',
    outcome: 'success',
    correlation_id: ids[correlation],
    reason_code: 'onboarding_cancelled',
    target_kind: 'organization_admin_bootstrap_grant',
    target_id: ids.grant,
    idempotency_key_hash: key.repeat(64),
    metadata: { grantVersion: grant.version, cleanupOutcome: 'not_attempted' },
  });
}
export function assertConflict(result, before, after) {
  assert.deepEqual(result, { decision: 'conflict', correlationId: ids.correlation });
  for (const key of ['grant', 'members', 'profiles', 'roles'])
    assert.deepEqual(after[key], before[key]);
  const events = addedEvents(before, after);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    ...events[0],
    organization_id: ids.org,
    organization_ids: [ids.org],
    actor_user_id: ids.actor,
    actor_subject_id: ids.actor,
    actor_kind: 'authenticated_subject',
    event_name: 'admin_onboarding.conflict',
    outcome: 'denied',
    correlation_id: ids.correlation,
    reason_code: 'grant_state_conflict',
    target_kind: 'organization_admin_bootstrap_grant',
    target_id: ids.grant,
    idempotency_key_hash: null,
    metadata: { grantVersion: before.grant.version },
  });
}
export function assertCompletion(result, before, after, adminRole) {
  assert.deepEqual(before.members, []);
  assert.deepEqual(before.roles, []);
  assert.deepEqual(before.profiles, []);
  assert.equal(after.members.length, 1);
  const member = after.members[0];
  assert.equal(member.organization_id, ids.org);
  assert.equal(member.user_id, ids.actor);
  assert.equal(member.status, 'active');
  assert.equal(member.version, 1);
  assert.equal(member.created_by, ids.actor);
  assert.equal(member.updated_by, ids.actor);
  assert.equal(after.roles.length, 1);
  assert.deepEqual(after.roles[0], {
    ...after.roles[0],
    organization_id: ids.org,
    membership_id: member.id,
    role_id: adminRole,
    assigned_by: ids.actor,
  });
  assert.equal(after.profiles.length, 1);
  assert.deepEqual(after.profiles[0], {
    id: after.profiles[0].id,
    organization_id: ids.org,
    membership_id: member.id,
    display_name: null,
    contact_number: null,
    version: 1,
    created_at: member.created_at,
    updated_at: member.created_at,
    created_by: ids.actor,
    updated_by: ids.actor,
  });
  const version = before.grant.version + 1;
  assert.deepEqual(after.grant, {
    ...before.grant,
    status: 'completed',
    version,
    completed_at: after.grant.completed_at,
    completed_membership_id: member.id,
    completion_idempotency_key_hash: 'a'.repeat(64),
  });
  assert.ok(after.grant.completed_at);
  assert.deepEqual(result, {
    decision: 'completed',
    bootstrapGrantId: ids.grant,
    organizationId: ids.org,
    organizationName: 'Synthetic onboarding',
    membershipId: member.id,
    grantVersion: version,
    correlationId: ids.correlation,
  });
  const events = addedEvents(before, after);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    ...events[0],
    organization_id: ids.org,
    organization_ids: [ids.org],
    actor_user_id: ids.actor,
    actor_subject_id: ids.actor,
    actor_kind: 'authenticated_subject',
    event_name: 'admin_onboarding.completed',
    outcome: 'success',
    correlation_id: ids.correlation,
    reason_code: 'first_admin_created',
    target_kind: 'organization_admin_bootstrap_grant',
    target_id: ids.grant,
    idempotency_key_hash: null,
    metadata: {
      grantVersion: version,
      membershipId: member.id,
      assuranceLevel: 'aal2',
      authenticationMethods: ['password', 'totp'],
      factorCount: 1,
    },
  });
}
