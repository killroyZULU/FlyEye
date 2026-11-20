import { feat003StagingTarget } from '../../config/feat-003-staging-target.mjs';
import { reconcileStagingAccounts } from './staging-account-reconciliation.mjs';

const roles = ['student_pilot', 'instructor_pilot', 'admin'];
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const schoolId = id(99);
function fixture() {
  const slots = roles.map((role, i) => ({
    role,
    operationId: id(i + 1),
    email: role + '@school.invalid',
    grantId: role === 'admin' ? id(10) : null,
    authId: null,
    plannedAuthId: null,
    authIntentRecorded: false,
    databaseAttempt: 'none',
    databaseAttemptId: null,
    membershipId: null,
    profileId: null,
    factorId: null,
    complete: false,
  }));
  const ledger = { projectRef: feat003StagingTarget.projectRef, schoolId, slots };
  const view = {
    projectRef: ledger.projectRef,
    schools: [{ id: schoolId, active: true }],
    exclusiveRun: true,
    inventoryComplete: true,
    noSendVerified: true,
    otherAdminOrLiveGrant: false,
    slots: slots.map(({ role, operationId }) => ({
      role,
      operationId,
      confirmedRollback: null,
      users: [],
      memberships: [],
      grant: null,
      factor: null,
    })),
  };
  const run = () => reconcileStagingAccounts(JSON.stringify(ledger), JSON.stringify(view));
  return { ledger, view, run };
}

function own(data, i) {
  const s = data.ledger.slots[i],
    v = data.view.slots[i];
  s.authIntentRecorded = true;
  s.authId = id(20 + i);
  s.plannedAuthId = s.authId;
  v.users.push({ id: s.authId, email: s.email, operationId: s.operationId, eligible: true });
  return { s, v };
}
function grant(s, status) {
  return {
    id: s.grantId,
    schoolId,
    authId: s.authId,
    auditedOperationId: s.operationId,
    issuanceAttemptId: id(85),
    provenance: {
      source: 'staging_fixture',
      sourceCode: 'feat-003-staging-synthetic-cli',
      actorKind: 'staging_fixture',
      actorId: null,
      actorSubjectId: null,
      authorizedBySubjectId: null,
      correlationId: id(86),
    },
    status,
  };
}
function completed() {
  const data = fixture();
  roles.forEach((role, i) => {
    const { s, v } = own(data, i);
    Object.assign(s, {
      membershipId: id(30 + i),
      profileId: id(40 + i),
      complete: true,
      databaseAttempt: 'committed',
      databaseAttemptId: id(70 + i),
    });
    v.memberships.push({
      id: s.membershipId,
      profileId: s.profileId,
      schoolId,
      authId: s.authId,
      role,
      active: true,
      auditedOperationId: s.operationId,
      databaseAttemptId: s.databaseAttemptId,
    });
    if (role !== 'student_pilot') {
      s.factorId = id(50 + i);
      v.factor = {
        id: s.factorId,
        authId: s.authId,
        slotOperationId: s.operationId,
        state: 'verified-bound',
      };
    }
    if (role === 'admin') v.grant = grant(s, 'completed');
    if (role === 'instructor_pilot') {
      s.assignmentKeyHash = '7'.repeat(64);
      v.assignments = [
        {
          event: 'member_role.changed',
          outcome: 'success',
          schoolId,
          actorId: id(22),
          membershipId: s.membershipId,
          priorRole: 'student_pilot',
          newRole: role,
          priorVersion: 1,
          newVersion: 2,
          reason: 'responsibility_changed',
          mfaReadinessVerified: true,
          keyHash: s.assignmentKeyHash,
          correlationId: id(98),
        },
      ];
    }
  });
  return data;
}

export { completed, fixture, grant, id, own, roles, schoolId };
