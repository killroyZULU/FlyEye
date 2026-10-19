import { accept, locks, q } from './h002-acceptance-fixture.mjs';
import {
  changes,
  identityLock,
  insertMember,
  prepare,
  reassignMember,
  spareUser,
} from './h002-recipient-fixture.mjs';

export const cases = [];
for (const action of ['prepare', 'accept']) {
  for (const change of ['email', 'confirmation']) {
    cases.push({ name: `${action}-stale-${change}`, action, change, kind: 'stale' });
  }
}
for (const [action, change] of [
  ['prepare', 'email'],
  ['accept', 'email'],
  ['accept', 'confirmation'],
]) {
  for (const commit of [true, false]) {
    cases.push({
      name: `${action}-${change}-${commit ? 'commit' : 'rollback'}-first`,
      action,
      change,
      commit,
      kind: 'identity',
      lock: identityLock,
    });
  }
}
for (const action of ['prepare', 'accept']) {
  cases.push({
    name: `${action}-before-email-change`,
    action,
    change: 'email',
    kind: 'command',
    lock: action === 'accept' ? locks.org : locks.invitation,
  });
}
for (const kind of ['insert', 'reassign']) {
  for (const commit of [true, false]) {
    cases.push({
      name: `recipient-${kind}-${commit ? 'commit' : 'rollback'}`,
      action: 'accept',
      kind,
      commit,
    });
  }
}
cases.push(
  {
    name: 'stale-identity-audit-failure',
    action: 'accept',
    change: 'email',
    kind: 'stale',
    auditFails: 'denied',
  },
  {
    name: 'recipient-conflict-audit-failure',
    action: 'accept',
    kind: 'reassign',
    commit: true,
    auditFails: 'conflicted',
  },
);
export function command(test) {
  return test.action === 'prepare' ? prepare : accept();
}
export function setup(test) {
  return (
    (test.kind === 'stale' ? changes[test.change] : '') +
    (test.kind === 'reassign' ? insertMember(spareUser) : '')
  );
}
export function competing(test) {
  return test.kind === 'insert' ? insertMember(q('recipient')) : reassignMember;
}
export function expectedDecision(test) {
  if (test.kind === 'stale' || (test.kind === 'identity' && test.commit)) return 'not_available';
  if (['insert', 'reassign'].includes(test.kind) && test.commit) return 'conflict';
  return test.action === 'prepare' ? 'prepared' : 'accepted';
}
