import { feat003StagingTarget } from '../../config/feat-003-staging-target.mjs';
import { ledgerSchema, observationSchema, roles } from './staging-account-evidence.mjs';

const stop = (reason) => ({ decision: 'stop', reason });
const resume = (step) => ({ decision: 'resume', step });
const unique = (values) => new Set(values).size === values.length;

function decideMembership(slot, member, grant, factor, permit) {
  if (!member) {
    if (slot.membershipId || slot.profileId || slot.complete) return stop('membership-conflict');
    if (grant?.status === 'live' && !factor && grant.issuanceAttemptId === slot.databaseAttemptId) {
      if (slot.databaseAttempt === 'unacknowledged') return resume('record-confirmed-grant');
      if (slot.databaseAttempt === 'committed') return resume('protected-admin-onboarding');
    }
    if (grant || factor || slot.databaseAttempt === 'committed') return stop('database-conflict');
    if (slot.databaseAttempt === 'unacknowledged') return stop('database-uncertain');
    return resume(
      slot.role === 'admin' ? 'issue-pending-grant' : 'establish-audited-student-membership',
    );
  }
  if (
    slot.databaseAttempt === 'rolled-back' ||
    !member.active ||
    !member.profileId ||
    member.auditedOperationId !== slot.operationId ||
    member.databaseAttemptId !== slot.databaseAttemptId ||
    (slot.membershipId && slot.membershipId !== member.id) ||
    (slot.profileId && slot.profileId !== member.profileId)
  )
    return stop('membership-conflict');
  if (slot.role === 'admin' && grant?.status !== 'completed') return stop('grant-conflict');
  if (slot.role === 'admin' && factor?.state !== 'verified-bound') return stop('factor-conflict');
  if (
    !slot.complete &&
    (!slot.membershipId || !slot.profileId || slot.databaseAttempt !== 'committed')
  )
    return resume('record-confirmed-membership');
  if (slot.role === 'instructor_pilot' && member.role === 'student_pilot' && slot.assignmentKeyHash)
    return stop('assignment-uncertain');
  if (slot.role === 'instructor_pilot' && !factor) {
    return slot.complete ? stop('factor-conflict') : resume('protected-mfa-enrollment');
  }
  if (factor?.state === 'protected-resumable') {
    return slot.complete || slot.role !== 'instructor_pilot'
      ? stop('factor-conflict')
      : resume('protected-mfa-enrollment');
  }
  if (slot.role === 'instructor_pilot' && member.role === 'student_pilot')
    return permit?.usable
      ? resume('protected-one-time-instructor-assignment')
      : stop('staging-assignment-unavailable');
  if (
    slot.complete &&
    slot.membershipId === member.id &&
    slot.profileId === member.profileId &&
    slot.factorId === (factor?.id ?? null) &&
    slot.databaseAttempt === 'committed'
  ) {
    return { decision: 'already-complete' };
  }
  return slot.complete ? stop('ledger-conflict') : resume('record-completion');
}

function decide(slot, observed, schoolId, admin, pendingRead = false) {
  const { users, memberships, grant, factor } = observed;
  if (observed.operationId !== slot.operationId || users.length > 1 || memberships.length > 1)
    return stop('ownership-conflict');
  const user = users[0];
  const member = memberships[0];
  const assignment = observed.assignments?.[0];
  const permit = observed.assignmentPermit;
  if (
    permit &&
    (slot.role !== 'instructor_pilot' ||
      permit.schoolId !== schoolId ||
      permit.adminId !== admin.authId ||
      !admin.complete ||
      permit.adminId === permit.candidateId ||
      permit.candidateId !== slot.authId ||
      permit.membershipId !== member?.id ||
      permit.factorId !== factor?.id ||
      factor.state !== 'verified-bound' ||
      (slot.assignmentKeyHash && slot.assignmentKeyHash !== permit.keyHash))
  )
    return stop('assignment-conflict');
  if (slot.role !== 'instructor_pilot' && (assignment || slot.assignmentKeyHash))
    return stop('assignment-conflict');
  if (
    slot.assignmentKeyHash &&
    (!slot.authId || !slot.membershipId || !slot.profileId || slot.databaseAttempt !== 'committed')
  )
    return stop('assignment-conflict');
  if (assignment && member?.role !== 'instructor_pilot') return stop('assignment-conflict');
  if (
    slot.authIntentRecorded !== Boolean(slot.plannedAuthId) ||
    (slot.authId && slot.authId !== slot.plannedAuthId)
  )
    return stop('ledger-conflict');
  if ((slot.databaseAttempt === 'none') !== (slot.databaseAttemptId === null))
    return stop('ledger-conflict');
  if (slot.databaseAttempt === 'none' && (member || grant)) return stop('ledger-conflict');
  if (slot.databaseAttempt === 'rolled-back') {
    if (
      observed.confirmedRollback?.operationId !== slot.operationId ||
      observed.confirmedRollback.attemptId !== slot.databaseAttemptId ||
      member ||
      grant
    )
      return stop('database-conflict');
  } else if (observed.confirmedRollback) return stop('database-conflict');
  if (!user) {
    if (
      slot.authIntentRecorded ||
      slot.authId ||
      slot.databaseAttempt !== 'none' ||
      slot.membershipId ||
      slot.profileId ||
      slot.factorId ||
      slot.complete ||
      member ||
      grant ||
      factor
    )
      return stop('auth-uncertain');
    return { decision: 'create', step: 'record-intent-before-auth' };
  }
  if (
    !slot.authIntentRecorded ||
    !user.eligible ||
    user.email !== slot.email ||
    user.id !== slot.plannedAuthId ||
    (user.operationId !== slot.operationId && !(pendingRead && user.operationId === null)) ||
    (slot.authId && slot.authId !== user.id)
  )
    return stop('ownership-conflict');
  const candidateStudent =
    slot.role === 'instructor_pilot' && member?.role === 'student_pilot' && !slot.complete;
  if (
    member &&
    (member.schoolId !== schoolId ||
      member.authId !== user.id ||
      (member.role !== slot.role && !candidateStudent))
  )
    return stop('membership-conflict');
  if (
    member?.role === 'instructor_pilot' &&
    (!assignment ||
      !slot.assignmentKeyHash ||
      assignment.keyHash !== slot.assignmentKeyHash ||
      assignment.schoolId !== schoolId ||
      assignment.membershipId !== member.id ||
      assignment.actorId !== admin.authId ||
      !admin.complete ||
      admin.authId === user.id ||
      factor?.state !== 'verified-bound')
  )
    return stop('assignment-conflict');
  if (
    grant &&
    (slot.role !== 'admin' ||
      grant.id !== slot.grantId ||
      grant.authId !== user.id ||
      grant.schoolId !== schoolId ||
      grant.auditedOperationId !== slot.operationId ||
      !['live', 'completed'].includes(grant.status))
  )
    return stop('grant-conflict');
  if (
    (factor &&
      (factor.authId !== user.id ||
        factor.slotOperationId !== slot.operationId ||
        factor.state === 'conflict')) ||
    (slot.factorId && slot.factorId !== factor?.id)
  )
    return stop('factor-conflict');
  if (!slot.authId) {
    return member ||
      grant ||
      factor ||
      slot.complete ||
      slot.membershipId ||
      slot.profileId ||
      slot.databaseAttempt !== 'none'
      ? stop('ledger-conflict')
      : resume('record-confirmed-auth');
  }
  return decideMembership(slot, member, grant, factor, permit);
}

function prerequisites(ledger, view, expectedProject) {
  if (ledger.projectRef !== expectedProject || view.projectRef !== ledger.projectRef)
    return 'target-mismatch';
  if (!view.inventoryComplete || !view.noSendVerified || !view.exclusiveRun)
    return 'preconditions-unverified';
  if (
    view.schools.length !== 1 ||
    !view.schools[0].active ||
    view.schools[0].id !== ledger.schoolId
  )
    return 'school-conflict';
  if (view.otherAdminOrLiveGrant) return 'grant-conflict';
  if (
    expectedProject === feat003StagingTarget.projectRef &&
    view.slots.some(({ grant }) => grant && (!grant.provenance || !grant.issuanceAttemptId))
  )
    return 'grant-conflict';
  if (
    !unique(view.slots.map((s) => s.role)) ||
    !unique(ledger.slots.map((s) => s.role)) ||
    ledger.slots.some((s) => s.email !== s.role + '@school.invalid') ||
    !unique(ledger.slots.flatMap((s) => [s.operationId, s.plannedAuthId].filter(Boolean))) ||
    ledger.slots.some((s) => (s.role === 'admin') !== Boolean(s.grantId))
  )
    return 'slot-conflict';
  for (const key of ['authId', 'membershipId', 'profileId', 'factorId', 'databaseAttemptId']) {
    if (!unique(ledger.slots.map((s) => s[key]).filter(Boolean))) return 'slot-conflict';
  }
  for (const ids of [
    view.slots.flatMap((s) => s.users.map((u) => u.id)),
    view.slots.flatMap((s) => s.memberships.map((m) => m.id)),
    view.slots.flatMap((s) => s.memberships.map((m) => m.profileId).filter(Boolean)),
    view.slots.flatMap((s) => (s.factor ? [s.factor.id] : [])),
  ]) {
    if (!unique(ids)) return 'slot-conflict';
  }
}

// Bounded JSON data only. A later reader must independently establish provenance,
// consistent snapshots and serialization. This function cannot authorize execution.
function reconcile(ledgerText, observationText, expectedProject, readRole) {
  try {
    const parse = (schema, text) => {
      if (typeof text !== 'string' || text.length > 65536) throw new Error();
      return schema.parse(JSON.parse(text));
    };
    const ledger = parse(ledgerSchema, ledgerText);
    const view = parse(observationSchema, observationText);
    const problem = prerequisites(ledger, view, expectedProject);
    if (problem) return stop(problem);
    const slots = {};
    for (const role of roles) {
      const result = decide(
        ledger.slots.find((s) => s.role === role),
        view.slots.find((s) => s.role === role),
        ledger.schoolId,
        ledger.slots.find((s) => s.role === 'admin'),
        role === readRole,
      );
      if (result.decision === 'stop') return { ...result, role };
      slots[role] = result;
    }
    if (readRole !== undefined) {
      if (slots[readRole]?.step !== 'record-confirmed-auth') return stop('auth-uncertain');
      const slot = ledger.slots.find((s) => s.role === readRole);
      return {
        decision: 'read-local-auth',
        id: slot.plannedAuthId,
        email: slot.email,
        operationId: slot.operationId,
      };
    }
    return { decision: 'plan', slots };
  } catch {
    return stop('invalid-evidence');
  }
}

export function reconcileStagingAccounts(ledgerText, observationText) {
  return reconcile(ledgerText, observationText, feat003StagingTarget.projectRef);
}

export const localAccountProject = 'flyeye-nosend-p3d1';

// This preflight returns only the identity to read, never a confirmation. The
// caller supplies the locked local fixture inventory (including email collisions).
export function prepareLocalAuthReadback(ledgerText, observationText, role) {
  if (!roles.includes(role)) return stop('invalid-evidence');
  return reconcile(ledgerText, observationText, localAccountProject, role);
}
