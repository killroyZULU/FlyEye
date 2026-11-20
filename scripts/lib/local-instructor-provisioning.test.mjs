// @vitest-environment node
import { expect, it } from 'vitest';
import { reconcileLocalInstructor } from './local-instructor-provisioning.mjs';
import { id, hash, now, phases, receipts, setup } from './local-instructor-test-data.mjs';

const decide = ([j, o], clock = now) => reconcileLocalInstructor(j, o, clock);

it('journals each intent once; exact readback acknowledges an ambiguous success without another write', () => {
  let confirmed = [];
  for (const [n, phase] of phases.entries()) {
    const start = setup(n);
    start[0].confirmed = confirmed;
    expect(decide(start)).toEqual({ decision: 'prepare', phase });
    const beforeAck = setup(n, phase);
    beforeAck[0].confirmed = confirmed;
    expect(decide(beforeAck).decision).toBe('stop');
    const after = setup(n, phase, n + 1);
    after[0].confirmed = confirmed;
    const recorded = decide(after);
    expect(recorded).toEqual({ decision: 'record', phase, receipt: receipts[n] });
    expect(decide(after)).toEqual(recorded);
    confirmed = [...confirmed, recorded.receipt];
  }
  const end = setup(7);
  end[0].confirmed = confirmed;
  end[1].inventory.events.reverse();
  expect(decide(end)).toEqual({ decision: 'complete' });
});
it.each(phases.map((phase, n) => [n, phase]))(
  'stops on an unjournalled or out-of-order transition %i %s',
  (n, phase) => {
    expect(decide(setup(n, null, n + 1)).decision).toBe('stop');
    expect(decide(setup(n, phases[(n + 1) % 7], n + 1)).decision).toBe('stop');
    expect(decide(setup(7, phase)).decision).toBe('stop');
  },
);
it.each([
  ['swapped daemon', (a) => (a[1].witness.daemon = 'different-local-daemon')],
  ['substituted container', (a) => (a[1].witness.containers.kong = hash('changed'))],
  ['foreign run', (a) => (a[1].witness.runId = id(50))],
  ['unlocked', (a) => (a[1].witness.lockHeld = false)],
  ['missing isolation', (a) => (a[1].witness.loopbackVerified = false)],
  ['unknown mail boundary', (a) => (a[1].witness.noSendVerified = null)],
  ['foreign cluster', (a) => (a[1].target.systemId = '7')],
  [
    'hosted substitutions',
    (a) => {
      a[1].target.apiOrigin = a[0].intent.target.apiOrigin = 'https://foreign.invalid';
    },
  ],
  ['extra school', (a) => a[1].inventory.schools.push({ schoolId: id(81), status: 'inactive' })],
  ['same identities', (a) => (a[0].intent.adminId = a[0].intent.candidateId)],
  ['shared operation key', (a) => (a[0].intent.adminCompleteHash = a[0].intent.assignmentKeyHash)],
  ['credential in journal', (a) => (a[0].intent.token = 'forbidden')],
  ['factor ID in checkpoint', (a) => (a[0].confirmed[4].factorId = id(60))],
  ['extra Auth account', (a) => a[1].inventory.users.push({ ...a[1].inventory.users[0] })],
  ['wrong operation marker', (a) => (a[1].inventory.users[0].createOperationId = id(71))],
  ['ineligible account', (a) => (a[1].inventory.users[1].eligible = false)],
  ['role seed', (a) => (a[1].inventory.roles[0].role = 'instructor_pilot')],
  [
    'dual role',
    (a) => a[1].inventory.roles.push({ ...a[1].inventory.roles[0], role: 'instructor_pilot' }),
  ],
  [
    'orphan profile',
    (a) => a[1].inventory.profiles.push({ ...a[1].inventory.profiles[0], membershipId: id(80) }),
  ],
  ['cross-school role', (a) => (a[1].inventory.roles[1].schoolId = id(81))],
  ['missing Admin grant', (a) => (a[1].inventory.grants = [])],
  ['wrong fixture grant source', (a) => (a[1].inventory.grants[0].source = 'hosted')],
  ['grant without audit', (a) => a[1].inventory.events.shift()],
  [
    'wrong admin completion key',
    (a) => (a[1].inventory.grants[0].completionKeyHash = hash('different')),
  ],
  ['foreign receipt attempt', (a) => (a[1].inventory.candidateReceipts[0].attemptId = id(70))],
  [
    'receipt unrelated to Auth marker',
    (a) => (a[1].inventory.candidateReceipts[0].operationId = id(7)),
  ],
  ['unbound factor', (a) => (a[1].inventory.factors[1].referenceHash = hash('other'))],
  ['duplicate factor', (a) => a[1].inventory.factors.push({ ...a[1].inventory.factors[0] })],
  ['unsupported factor', (a) => (a[1].inventory.factors[1].type = 'phone')],
  ['Admin enrolled candidate', (a) => (a[1].inventory.events.at(-1).userId = id(3))],
  ['partial enrollment', (a) => (a[1].inventory.enrollments[0].status = 'bound')],
  ['missing readiness', (a) => (a[1].inventory.readiness = [])],
  ['readiness without audit', (a) => a[1].inventory.events.pop()],
  [
    'wrong enrollment key',
    (a) => (a[1].inventory.enrollments[0].completeKeyHash = hash('different')),
  ],
  ['stale membership version', (a) => (a[1].inventory.memberships[0].version = 2)],
  ['self-assignment', (a) => (a[1].session.userId = a[0].intent.candidateId)],
  ['subject mismatch', (a) => (a[1].session.subjectId = id(22))],
  ['wrong school session', (a) => (a[1].session.schoolId = id(81))],
  ['missing permission', (a) => (a[1].session.canAssignRole = false)],
  ['unrelated signing session', (a) => (a[1].session.sessionId = id(75))],
  ['absent current binding', (a) => (a[1].adminBinding = null)],
  ['expired current session', (a) => (a[1].adminBinding.notAfter = now)],
  ['other Auth session', (a) => (a[1].adminBinding.sessionId = id(75))],
  ['other binding session', (a) => (a[1].adminBinding.bindingSessionId = id(75))],
  ['other binding actor', (a) => (a[1].adminBinding.bindingUserId = id(2))],
  ['other Auth actor', (a) => (a[1].adminBinding.userId = id(2))],
  ['expired factor binding', (a) => (a[1].adminBinding.boundFactorHash = hash('old factor'))],
  [
    'different current session factor',
    (a) => (a[1].adminBinding.sessionFactorHash = hash('old factor')),
  ],
  ['missing current session TOTP method', (a) => (a[1].adminBinding.totpMethod = false)],
  ['password older than 600s', (a) => a[1].session.passwordAuthenticatedAt--],
  ['future password', (a) => (a[1].session.passwordAuthenticatedAt = now + 1)],
  ['AAL1 Admin', (a) => (a[1].session.assurance = 'aal1')],
  ['missing TOTP', (a) => (a[1].session.totpAt = null)],
  ['unbound Admin session', (a) => (a[1].session.currentFactorHash = receipts[5].factorHash)],
])('fails closed before assignment: %s', (_, change) => {
  const args = setup(6);
  change(args);
  expect(decide(args).decision).toBe('stop');
});
it.each([
  ['missing role audit', (s) => s.events.pop()],
  ['duplicate success', (s) => s.events.push({ ...s.events.at(-1) })],
  ['wrong version', (s) => (s.memberships[0].version = 3)],
  ['wrong actor', (s) => (s.events.at(-1).actorId = id(2))],
  ['self-attributed role row', (s) => (s.roles[0].assignedBy = id(2))],
  ['wrong membership update attribution', (s) => (s.memberships[0].updatedBy = null)],
  ['wrong reason', (s) => (s.events.at(-1).reason = 'assignment_corrected')],
  ['foreign request', (s) => (s.events.at(-1).keyHash = hash('other'))],
  ['wrong role', (s) => (s.roles[0].role = 'admin')],
  ['readiness drift', (s) => (s.readiness[0].factorHash = hash('other'))],
])('does not record an uncertain assignment: %s', (_, change) => {
  const args = setup(6, phases[6], 7);
  change(args[1].inventory);
  expect(decide(args).decision).toBe('stop');
});
it('rejects expired grants, late acknowledgements with no grant completion, or the wrong setup subject', () => {
  expect(decide(setup(4), 2060).decision).toBe('stop');
  expect(decide(setup(4, phases[4]), 2060).decision).toBe('stop');
  expect(decide(setup(4, phases[4], 5), 2060).decision).toBe('record');
  for (const n of [4, 5]) {
    const a = setup(n);
    a[1].session.userId = n === 4 ? id(2) : id(3);
    a[1].session.subjectId = a[1].session.userId;
    expect(decide(a).decision).toBe('stop');
  }
});
