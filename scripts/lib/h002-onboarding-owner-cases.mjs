import assert from 'node:assert/strict';
import { ids, q, locks } from './h002-onboarding-fixture.mjs';
import { start, assertOutcome as assertStart } from './h002-onboarding-start-assertions.mjs';
import {
  cancel,
  complete,
  addedEvents,
  assertCancellation,
  assertCompletion,
} from './h002-cancellation-assertions.mjs';

export function assertOwnerDenied(action, result, before, after) {
  assert.deepEqual(result, {
    decision: 'not_available',
    ...(action === 'cancel' ? { cleanupOutcome: 'not_attempted' } : {}),
    correlationId: ids.correlation,
  });
  for (const key of ['grant', 'members', 'profiles', 'roles'])
    assert.deepEqual(after[key], before[key]);
  const events = addedEvents(before, after);
  assert.equal(events.length, action === 'cancel' ? 0 : 1);
  if (action === 'cancel') return;
  assert.deepEqual(events[0], {
    ...events[0],
    organization_id: null,
    organization_ids: [],
    actor_user_id: ids.actor,
    actor_subject_id: ids.actor,
    actor_kind: 'authenticated_subject',
    event_name: 'admin_onboarding.denied',
    outcome: 'denied',
    correlation_id: ids.correlation,
    reason_code: 'grant_not_available',
    target_kind: null,
    target_id: null,
    idempotency_key_hash: null,
    metadata: {},
  });
}

async function ownershipWait(h, action, lock, commit, replay) {
  const sql = action === 'start' ? start() : action === 'complete' ? complete() : cancel();
  let initialResult;
  if (replay) {
    const initial = await h.read();
    initialResult = await h.json(h.worker, sql);
    if (action === 'start') await assertStart(h.observer, initialResult, initial, false);
    else assertCompletion(initialResult, initial, await h.read(), h.adminRole);
  }
  const before = await h.read();
  await h.leader.query(`begin; ${locks[lock]}`);
  const task = h.pending(sql);
  await h.observe();
  await h.leader.query(`update public.organization_admin_bootstrap_grants
    set eligible_user_id=${q('session')} where id=${q('grant')};`);
  const changed = await h.read(h.leader);
  assert.deepEqual(changed, {
    ...before,
    grant: { ...before.grant, eligible_user_id: ids.session },
  });
  await h.leader.query(commit ? 'commit;' : 'rollback;');
  const result = await h.value(task);
  const after = await h.read();
  if (commit) assertOwnerDenied(action, result, changed, after);
  else if (action === 'start') await assertStart(h.observer, result, before, replay);
  else if (action === 'cancel') assertCancellation(result, before, after);
  else if (replay) {
    assert.deepEqual(result, { ...initialResult, decision: 'already_completed' });
    assert.deepEqual(after, before);
  } else assertCompletion(result, before, after, h.adminRole);
}

export const cases = [];
for (const action of ['start', 'complete'])
  for (const replay of [false, true])
    for (const lock of ['org', 'grant'])
      for (const commit of [true, false])
        cases.push([
          `${action}-${replay ? 'replay' : 'new'}-${lock}-${commit ? 'commit' : 'rollback'}`,
          (h) => ownershipWait(h, action, lock, commit, replay),
        ]);
// SEC-017 already covers cancellation's grant-lock committed owner change.
for (const [lock, commit] of [
  ['org', true],
  ['org', false],
  ['grant', false],
])
  cases.push([
    `cancel-${lock}-${commit ? 'commit' : 'rollback'}`,
    (h) => ownershipWait(h, 'cancel', lock, commit, false),
  ]);
