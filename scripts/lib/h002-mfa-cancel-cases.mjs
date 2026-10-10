import assert from 'node:assert/strict';
import { ids, q, command } from './h002-mfa-cancel-fixture.mjs';
import { read, transition, unchanged, replay } from './h002-mfa-cancel-assertions.mjs';

async function bind(h) {
  const before = await read(h.observer);
  const result = await h.json(h.worker, command('bind', { correlation: 'setup' }));
  transition('bind', result, before, await read(h.observer), 'setup');
  return result;
}
const races = [
  { name: 'cancel-bind', leader: 'cancel', worker: 'bind', outcomes: ['bind-conflict', 'bind'] },
  { name: 'bind-cancel', leader: 'bind', worker: 'cancel', outcomes: ['conflict', 'cancel'] },
  {
    name: 'complete-cancel',
    bound: true,
    leader: 'complete',
    worker: 'cancel',
    outcomes: ['conflict', 'conflict'],
  },
  {
    name: 'bound-cancel-complete',
    bound: true,
    leader: 'cancel',
    worker: 'complete',
    outcomes: ['complete', 'complete'],
  },
  { name: 'duplicate-cancel', leader: 'cancel', worker: 'cancel', outcomes: ['replay', 'cancel'] },
];
async function race(h, test, commit) {
  if (test.bound) await bind(h);
  const before = await read(h.observer);
  const version = test.bound ? 2 : 1;
  const first = await h.json(h.leader, `begin; ${command(test.leader, { version })}`);
  const accepted = await h.captureLeader();
  if (test.bound && test.leader === 'cancel')
    unchanged(first, before, accepted, 'conflict', 'first');
  else transition(test.leader, first, before, accepted);
  const pending = h.pending(h.worker, command(test.worker, { correlation: 'second', version }));
  await h.observe();
  await h.leader.query(commit ? 'commit;' : 'rollback;');
  const result = await h.value(pending);
  const after = await read(h.observer);
  const base = commit ? accepted : before;
  const expected = test.outcomes[commit ? 0 : 1];
  if (expected === 'conflict') unchanged(result, base, after, 'conflict');
  else if (expected === 'replay') replay(result, first, base, after);
  else transition(expected, result, base, after, 'second');
}
async function resume(h) {
  const bound = await bind(h);
  const before = await read(h.observer);
  replay(
    await h.json(h.worker, command('bind', { correlation: 'second' })),
    bound,
    before,
    await read(h.observer),
  );
  unchanged(
    await h.json(h.worker, command('cancel', { version: 2 })),
    before,
    await read(h.observer),
    'conflict',
    'first',
  );
  const completed = await h.json(h.worker, command('complete'));
  const after = await read(h.observer);
  transition('complete', completed, before, after);
  replay(
    await h.json(h.worker, command('complete', { correlation: 'second' })),
    completed,
    after,
    await read(h.observer),
  );
}
async function differentKey(h) {
  const before = await read(h.observer);
  const first = await h.json(h.worker, command('cancel'));
  const cancelled = await read(h.observer);
  transition('cancel', first, before, cancelled);
  unchanged(
    await h.json(h.worker, command('cancel', { key: 'e', correlation: 'second' })),
    cancelled,
    await read(h.observer),
    'conflict',
  );
}
async function negatives(h) {
  const before = await read(h.observer);
  for (const [options, decision] of [
    [{ actor: 'other' }, 'not_available'],
    [{ operation: 'missing' }, 'not_available'],
    [{ version: 2 }, 'conflict'],
    [{ factor: "repeat('f',64)" }, 'conflict'],
  ]) {
    const result = await h.json(h.worker, command('cancel', { ...options, correlation: 'second' }));
    unchanged(result, before, await read(h.observer), decision);
  }
}
async function changedOwner(h) {
  const before = await read(h.observer);
  await h.leader.query(
    `begin; reset role; select 1 from public.member_mfa_enrollment_operations where id=${q('operation')} for update;`,
  );
  const work = h.pending(h.worker, command('cancel', { correlation: 'second' }));
  await h.observe();
  await h.leader.query(
    `update public.member_mfa_enrollment_operations set subject_user_id=${q('other')},membership_id=${q('otherMember')} where id=${q('operation')}; commit;`,
  );
  const expected = {
    ...before,
    operation: { ...before.operation, subject_user_id: ids.other, membership_id: ids.otherMember },
  };
  unchanged(await h.value(work), expected, await read(h.observer), 'not_available');
}
async function revokedMembership(h) {
  // Synthetic precondition only; this does not model a public revocation request.
  await h.observer.query(
    `update public.organization_memberships set status='revoked' where id=${q('member')};`,
  );
  const before = await read(h.observer);
  const result = await h.json(h.worker, command('cancel'));
  transition('cancel', result, before, await read(h.observer));
}
async function auditFailure(h) {
  const before = await read(h.observer);
  const failed = await h.pending(
    h.leader,
    `begin; reset role;
    alter table public.authentication_events add constraint h002_mfa_cancel_audit_fault
      check (not(event_name='member_mfa.enrollment_cancelled' and actor_subject_id=${q('actor')})) not valid;
    set local role service_role; ${command('cancel')}`,
  ).result;
  assert.equal(failed.error?.sqlState, '23514');
  await h.leader.close();
  assert.deepEqual(await read(h.observer), before);
  assert.equal(
    await h.observer.query(
      "select count(*) from pg_constraint where conname='h002_mfa_cancel_audit_fault';",
    ),
    '0',
  );
  const retried = await h.json(h.worker, command('cancel'));
  transition('cancel', retried, before, await read(h.observer));
}
export const cases = [
  ...races.flatMap((test) => [
    [`${test.name}-commit`, (h) => race(h, test, true)],
    [`${test.name}-rollback`, (h) => race(h, test, false)],
  ]),
  ['bound-resume-and-replay', resume],
  ['different-cancel-key', differentKey],
  ['ownership-state-negatives', negatives],
  ['owner-changed-during-wait', changedOwner],
  ['revoked-membership-sql-cancel', revokedMembership],
  ['audit-failure-explicit-retry', auditFailure],
];
