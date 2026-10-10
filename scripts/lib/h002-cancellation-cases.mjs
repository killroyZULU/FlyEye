import assert from 'node:assert/strict';
import { ids, q } from './h002-onboarding-fixture.mjs';
import { assertOutcome } from './h002-onboarding-assertions.mjs';
import {
  cancel,
  complete,
  read,
  assertCancellation,
  assertConflict,
  assertCompletion,
} from './h002-cancellation-assertions.mjs';

async function cancellationFirst(h, commit) {
  const before = await read(h.observer);
  const result = await h.json(h.leader, `begin; ${cancel()}`);
  const acceptedState = await h.captureLeader();
  assertCancellation(result, before, acceptedState, false, 'b', 'correlation', false);
  const work = h.pending(h.worker, complete());
  await h.observe();
  await h.leader.query(commit ? 'commit;' : 'rollback;');
  const completion = await h.value(work);
  const after = await read(h.observer);
  if (commit && completion.decision === 'completed') {
    assertCompletion(completion, acceptedState, after, h.adminRole);
    process.stdout.write(
      'H002 cancellation: cancel-commit completion-after-accepted-cancellation REPRODUCED.\n',
    );
  }
  assert.equal(
    completion.decision,
    commit ? 'conflict' : 'completed',
    'Completion must respect accepted cancellation',
  );
  if (commit) {
    assertCancellation(result, before, acceptedState);
    assertConflict(completion, acceptedState, after);
  } else await assertOutcome(h.observer, completion, before, h.adminRole);
}
async function completionFirst(h, commit) {
  const before = await read(h.observer);
  const completed = await h.json(h.leader, `begin; ${complete()}`);
  const committedState = await h.captureLeader();
  assertCompletion(completed, before, committedState, h.adminRole);
  const work = h.pending(h.worker, cancel('b', 'actor', 'grant', 'issuance'));
  await h.observe();
  await h.leader.query(commit ? 'commit;' : 'rollback;');
  const result = await h.value(work);
  const after = await read(h.observer);
  assertCancellation(result, commit ? committedState : before, after, false, 'b', 'issuance');
  if (commit) {
    const replay = await h.json(h.worker, complete(1, 'issuance'));
    assert.deepEqual(replay, {
      ...completed,
      decision: 'already_completed',
      correlationId: ids.issuance,
    });
    assert.deepEqual(await read(h.observer), after);
  }
}
async function duplicate(h, commit) {
  const before = await read(h.observer);
  const first = await h.json(h.leader, `begin; ${cancel()}`);
  const leaderState = await h.captureLeader();
  const work = h.pending(h.worker, cancel('b', 'actor', 'grant', 'issuance'));
  await h.observe();
  await h.leader.query(commit ? 'commit;' : 'rollback;');
  const second = await h.value(work);
  const after = await read(h.observer);
  if (commit) {
    assertCancellation(first, before, leaderState);
    assertCancellation(second, leaderState, after, true, 'b', 'issuance');
  } else assertCancellation(second, before, after, false, 'b', 'issuance');
}
async function auditFailure(h) {
  const before = await read(h.observer);
  const failure = await h.pending(
    h.leader,
    `begin;
    reset role;
    alter table public.authentication_events add constraint h002_cancel_audit_fault
      check (not(event_name='admin_onboarding.cancelled' and actor_subject_id=${q('actor')})) not valid;
    set local role service_role; ${cancel()}`,
  ).result;
  assert.equal(failure.error?.sqlState, '23514');
  await h.leader.close();
  assert.deepEqual(await read(h.observer), before);
  assert.equal(
    await h.observer.query(
      "select count(*) from pg_constraint where conname='h002_cancel_audit_fault';",
    ),
    '0',
  );
  const result = await h.json(h.worker, cancel());
  assertCancellation(result, before, await read(h.observer));
}
async function negatives(h) {
  const before = await read(h.observer);
  for (const sql of [cancel('b', 'session'), cancel('b', 'actor', 'factor')]) {
    assert.deepEqual(await h.json(h.worker, sql), {
      decision: 'not_available',
      cleanupOutcome: 'not_attempted',
      correlationId: ids.correlation,
    });
    assert.deepEqual(await read(h.observer), before);
  }
}
async function terminal(h, status) {
  await h.observer.query(
    `update public.organization_admin_bootstrap_grants set status='${status}'${status === 'revoked' ? ',revoked_at=now()' : ''} where id=${q('grant')};`,
  );
  const before = await read(h.observer);
  const result = await h.json(h.worker, cancel());
  const after = await read(h.observer);
  assertCancellation(result, before, after);
  assertCancellation(
    await h.json(h.worker, cancel('b', 'actor', 'grant', 'issuance')),
    after,
    await read(h.observer),
    true,
    'b',
    'issuance',
  );
}
async function restart(h) {
  const before = await read(h.observer);
  const result = await h.json(h.worker, cancel());
  const cancelled = await read(h.observer);
  assertCancellation(result, before, cancelled);
  const start = await h.json(
    h.worker,
    `select public.start_organization_admin_onboarding(${q('actor')},${q('grant')},2,repeat('c',64),${q('correlation')});`,
  );
  assert.equal(start.decision, 'ready');
  assert.equal(start.grantVersion, 2);
  const started = await read(h.observer);
  assertCancellation(
    await h.json(h.worker, cancel('b', 'actor', 'grant', 'issuance')),
    started,
    await read(h.observer),
    true,
    'b',
    'issuance',
  );
  const completed = await h.json(h.worker, complete(2));
  assert.equal(completed.decision, 'completed');
  const after = await read(h.observer);
  assertCompletion(completed, started, after, h.adminRole);
  const replay = await h.json(h.worker, complete(2, 'issuance'));
  assert.deepEqual(replay, {
    ...completed,
    decision: 'already_completed',
    correlationId: ids.issuance,
  });
  assert.deepEqual(await read(h.observer), after);
}
async function newKey(h) {
  const before = await read(h.observer);
  const first = await h.json(h.worker, cancel());
  const once = await read(h.observer);
  assertCancellation(first, before, once);
  const second = await h.json(h.worker, cancel('c', 'actor', 'grant', 'issuance'));
  const twice = await read(h.observer);
  assertCancellation(second, once, twice, false, 'c', 'issuance');
  assert.equal(twice.grant.version, 3);
}
export const cases = [
  ['cancel-commit', (h) => cancellationFirst(h, true)],
  ['cancel-rollback', (h) => cancellationFirst(h, false)],
  ['complete-commit', (h) => completionFirst(h, true)],
  ['complete-rollback', (h) => completionFirst(h, false)],
  ['duplicate-commit', (h) => duplicate(h, true)],
  ['duplicate-rollback', (h) => duplicate(h, false)],
  ['new-key-fence', newKey],
  ['audit-failure-retry', auditFailure],
  ['wrong-owner-missing-grant', negatives],
  ['revoked-grant', (h) => terminal(h, 'revoked')],
  ['expired-grant', (h) => terminal(h, 'expired')],
  ['fresh-start-after-cancel-replay', restart],
];
