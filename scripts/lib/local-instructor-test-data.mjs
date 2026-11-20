import { createHash } from 'node:crypto';
import { lifecycleMigrationDigest } from './local-lifecycle-migrations.mjs';

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const now = 2000,
  schoolId = id(99);
const containers = {
  db: hash('db'),
  auth: hash('auth'),
  kong: hash('kong'),
  inbucket: hash('inbucket'),
  rest: hash('rest'),
};
const witness = {
  runId: id(1),
  lockHeld: true,
  loopbackVerified: true,
  noSendVerified: true,
  daemon: 'synthetic-local-daemon',
  network: hash('network'),
  containers,
};
const systemId = '12345678';
const target = {
  project: 'flyeye-nosend-p3d1',
  apiOrigin: 'http://127.0.0.1:58321',
  dockerSocket: 'unix:///var/run/docker.sock',
  schoolId,
  migrationDigest: lifecycleMigrationDigest,
  systemId,
  instance: hash(
    [witness.daemon, witness.network, ...Object.values(containers), systemId].join('/'),
  ),
};
const intent = {
  target,
  runId: id(1),
  candidateId: id(2),
  adminId: id(3),
  candidateCreateId: id(4),
  adminCreateId: id(5),
  membershipId: id(6),
  membershipAttemptId: id(8),
  grantId: id(9),
  grantSourceId: id(10),
  grantCorrelationId: id(11),
  adminCompleteHash: hash('admin completion'),
  enrollmentCompleteHash: hash('target completion'),
  assignmentKeyHash: hash('role replacement'),
};
const phases = [
  'create-candidate',
  'establish-student',
  'create-admin-subject',
  'issue-local-grant',
  'protected-admin-onboarding',
  'protected-self-enrollment',
  'protected-role-assignment',
];
const receipts = [
  {},
  { profileId: id(12) },
  {},
  { expiresAt: now + 60 },
  { membershipId: id(13), profileId: id(14), factorHash: hash('admin verified factor') },
  { operationId: id(15), factorHash: hash('target verified factor') },
  { correlationId: id(16) },
];

function setup(n, pending = null, observed = n) {
  const journal = { intent, confirmed: receipts.slice(0, n), pending };
  const inventory = {
    schools: [{ schoolId, status: 'active' }],
    users: [],
    memberships: [],
    profiles: [],
    roles: [],
    grants: [],
    candidateReceipts: [],
    factors: [],
    enrollments: [],
    readiness: [],
    events: [],
  };
  const { users, memberships, roles, profiles, events, grants, factors } = inventory;
  if (observed >= 1)
    users.push({
      userId: id(2),
      email: 'instructor_pilot@school.invalid',
      createOperationId: id(4),
      eligible: true,
    });
  if (observed >= 2) {
    memberships.push({
      schoolId,
      membershipId: id(6),
      userId: id(2),
      status: 'active',
      version: 1,
      createdBy: null,
      updatedBy: null,
    });
    roles.push({ schoolId, membershipId: id(6), role: 'student_pilot', assignedBy: null });
    profiles.push({
      schoolId,
      membershipId: id(6),
      profileId: id(12),
      createdBy: null,
      updatedBy: null,
    });
    inventory.candidateReceipts.push({
      event: 'fixture.local_student_established',
      runId: id(1),
      instance: target.instance,
      systemId,
      schoolId,
      userId: id(2),
      membershipId: id(6),
      profileId: id(12),
      role: 'student_pilot',
      operationId: id(4),
      attemptId: id(8),
    });
  }
  if (observed >= 3)
    users.push({
      userId: id(3),
      email: 'admin@school.invalid',
      createOperationId: id(5),
      eligible: true,
    });
  if (observed >= 4) {
    grants.push({
      schoolId,
      grantId: id(9),
      eligibleUserId: id(3),
      expiresAt: 2060,
      source: 'local_fixture',
      sourceCode: 'feat-003-local-cli-fixture',
      sourceId: id(10),
      correlationId: id(11),
      status: 'pending',
      membershipId: null,
      completionKeyHash: null,
    });
    events.push({
      event: 'admin_bootstrap.grant_issued',
      outcome: 'success',
      schoolId,
      grantId: id(9),
      actorKind: 'local_fixture',
      actorId: null,
      sourceId: id(10),
      correlationId: id(11),
    });
  }
  if (observed >= 5) {
    Object.assign(grants[0], {
      status: 'completed',
      membershipId: id(13),
      completionKeyHash: intent.adminCompleteHash,
    });
    memberships.push({
      schoolId,
      membershipId: id(13),
      userId: id(3),
      status: 'active',
      version: 1,
      createdBy: id(3),
      updatedBy: id(3),
    });
    roles.push({ schoolId, membershipId: id(13), role: 'admin', assignedBy: id(3) });
    profiles.push({
      schoolId,
      membershipId: id(13),
      profileId: id(14),
      createdBy: id(3),
      updatedBy: id(3),
    });
    factors.push({
      userId: id(3),
      type: 'totp',
      status: 'verified',
      referenceHash: receipts[4].factorHash,
    });
    events.push({
      event: 'admin_onboarding.completed',
      outcome: 'success',
      schoolId,
      actorId: id(3),
      membershipId: id(13),
      grantId: id(9),
      assurance: 'aal2',
    });
  }
  if (observed >= 6) {
    const common = {
      schoolId,
      userId: id(2),
      membershipId: id(6),
      factorHash: receipts[5].factorHash,
    };
    factors.push({
      userId: id(2),
      type: 'totp',
      status: 'verified',
      referenceHash: common.factorHash,
    });
    inventory.enrollments.push({
      ...common,
      operationId: id(15),
      status: 'completed',
      completeKeyHash: intent.enrollmentCompleteHash,
    });
    inventory.readiness.push({ ...common, version: 1 });
    events.push({
      ...common,
      event: 'member_mfa.enrollment_completed',
      outcome: 'success',
      operationId: id(15),
      version: 1,
      keyHash: intent.enrollmentCompleteHash,
    });
  }
  if (observed === 7) {
    roles[0].role = 'instructor_pilot';
    roles[0].assignedBy = id(3);
    memberships[0].version = 2;
    memberships[0].updatedBy = id(3);
    events.push({
      event: 'member_role.changed',
      outcome: 'success',
      schoolId,
      actorId: id(3),
      membershipId: id(6),
      priorRole: 'student_pilot',
      newRole: 'instructor_pilot',
      priorVersion: 1,
      newVersion: 2,
      reason: 'responsibility_changed',
      mfaReadinessVerified: true,
      keyHash: intent.assignmentKeyHash,
      correlationId: id(16),
    });
  }
  const subject = n === 5 ? id(2) : id(3);
  const session =
    n >= 4 && n < 7 && !pending
      ? {
          userId: subject,
          subjectId: subject,
          schoolId,
          sessionId: id(17),
          assurance: n === 6 ? 'aal2' : 'aal1',
          passwordAuthenticatedAt: now - 600,
          currentFactorHash: n === 6 ? receipts[4].factorHash : null,
          totpAt: n === 6 ? now : null,
          canAssignRole: n === 6,
        }
      : null;
  const adminBinding =
    n === 6 && !pending
      ? {
          sessionId: id(17),
          userId: id(3),
          notAfter: null,
          assurance: 'aal2',
          passwordMethod: true,
          totpMethod: true,
          sessionFactorHash: receipts[4].factorHash,
          bindingSessionId: id(17),
          bindingUserId: id(3),
          boundFactorHash: receipts[4].factorHash,
        }
      : null;
  return structuredClone([journal, { target, witness, inventory, session, adminBinding }]);
}
export { id, hash, now, phases, receipts, setup, intent, schoolId };
