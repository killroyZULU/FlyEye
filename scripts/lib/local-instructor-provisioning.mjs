import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { passwordAuthenticationIsRecent } from '../../supabase/functions/_shared/authentication-evidence.ts';
import { lifecycleMigrationDigest } from './local-lifecycle-migrations.mjs';

// Offline, non-authoritative model. Inputs are the private locked run journal and
// complete projections from independently witnessed local Auth/DB reads. No
// callback, connection, token, factor ID or executable command crosses this API.
const obj = z.strictObject;
const id = z.uuidv4().refine((v) => v === v.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.int().positive();
const target = obj({
  project: z.literal('flyeye-nosend-p3d1'),
  apiOrigin: z.literal('http://127.0.0.1:58321'),
  dockerSocket: z.literal('unix:///var/run/docker.sock'),
  schoolId: z.literal('00000000-0000-4000-8000-000000000099'),
  migrationDigest: z.literal(lifecycleMigrationDigest),
  instance: hash,
  systemId: z.string().regex(/^[1-9][0-9]{0,19}$/),
});
const intentSchema = obj({
  target,
  runId: id,
  candidateId: id,
  adminId: id,
  candidateCreateId: id,
  adminCreateId: id,
  membershipId: id,
  membershipAttemptId: id,
  grantId: id,
  grantSourceId: id,
  grantCorrelationId: id,
  adminCompleteHash: hash,
  enrollmentCompleteHash: hash,
  assignmentKeyHash: hash,
});
const phases = [
  'create-candidate',
  'establish-student',
  'create-admin-subject',
  'issue-local-grant',
  'protected-admin-onboarding',
  'protected-self-enrollment',
  'protected-role-assignment',
];
const receiptSchemas = [
  obj({}),
  obj({ profileId: id }),
  obj({}),
  obj({ expiresAt: timestamp }),
  obj({ membershipId: id, profileId: id, factorHash: hash }),
  obj({ operationId: id, factorHash: hash }),
  obj({ correlationId: id }),
];
const journalSchema = obj({
  intent: intentSchema,
  confirmed: z.array(z.unknown()).max(phases.length),
  pending: z.enum(phases).nullable(),
});
const sessionSchema = obj({
  userId: id,
  subjectId: id,
  sessionId: id,
  schoolId: id,
  assurance: z.enum(['aal1', 'aal2']),
  passwordAuthenticatedAt: timestamp,
  totpAt: timestamp.nullable(),
  currentFactorHash: hash.nullable(),
  canAssignRole: z.boolean(),
});
const witnessSchema = obj({
  runId: id,
  lockHeld: z.literal(true),
  loopbackVerified: z.literal(true),
  noSendVerified: z.literal(true),
  daemon: z.string().regex(/^[a-zA-Z0-9:-]{16,100}$/),
  network: hash,
  containers: obj({ db: hash, auth: hash, kong: hash, inbucket: hash, rest: hash }),
});
// Private projection of the current auth.sessions row, its AMR evidence and
// the SEC-026 binding. Read these separately from the caller's session claims.
const currentAdminBinding = obj({
  sessionId: id,
  userId: id,
  notAfter: timestamp.nullable(),
  assurance: z.literal('aal2'),
  passwordMethod: z.literal(true),
  totpMethod: z.literal(true),
  sessionFactorHash: hash,
  bindingSessionId: id,
  bindingUserId: id,
  boundFactorHash: hash,
});
const stop = (reason) => ({ decision: 'stop', reason });
const unique = (xs) => new Set(xs).size === xs.length;

function bindingsAreDistinct(i, receipts) {
  const ids = [
    i.runId,
    i.target.schoolId,
    i.candidateId,
    i.adminId,
    i.candidateCreateId,
    i.adminCreateId,
    i.membershipId,
    i.membershipAttemptId,
    i.grantId,
    i.grantSourceId,
    i.grantCorrelationId,
    receipts[1]?.profileId,
    receipts[4]?.membershipId,
    receipts[4]?.profileId,
    receipts[5]?.operationId,
    receipts[6]?.correlationId,
  ].filter(Boolean);
  const hashes = [
    i.adminCompleteHash,
    i.enrollmentCompleteHash,
    i.assignmentKeyHash,
    receipts[4]?.factorHash,
    receipts[5]?.factorHash,
  ].filter(Boolean);
  return unique(ids) && unique(hashes);
}

// Each collection is the full relevant inventory, not a first match. Events
// project all successes of the four outcome types below in the disposable DB.
// Membership, profile and role are separate
// reads so orphaned rows and duplicate roles cannot disappear in an inner join.
function expectedInventory(i, receipts) {
  const schoolId = i.target.schoolId;
  const state = {
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
  const n = receipts.length;
  const user = (userId, email, createOperationId) => ({
    userId,
    email,
    createOperationId,
    eligible: true,
  });
  const addMember = (userId, membershipId, profileId, role, version) => {
    const createdBy = userId === i.adminId ? i.adminId : null;
    const updatedBy = version === 2 ? i.adminId : createdBy;
    state.memberships.push({
      schoolId,
      userId,
      membershipId,
      status: 'active',
      version,
      createdBy,
      updatedBy,
    });
    state.profiles.push({ schoolId, membershipId, profileId, createdBy, updatedBy: createdBy });
    state.roles.push({ schoolId, membershipId, role, assignedBy: updatedBy });
  };
  // This disposable candidate needs its own fixed address guard in any future
  // writer. The Student-only writer accepts a different address. Preserve its
  // invariant that the Auth create marker is also the private receipt key.
  if (n >= 1)
    state.users.push(user(i.candidateId, 'instructor_pilot@school.invalid', i.candidateCreateId));
  if (n >= 2) {
    addMember(
      i.candidateId,
      i.membershipId,
      receipts[1].profileId,
      n === 7 ? 'instructor_pilot' : 'student_pilot',
      n === 7 ? 2 : 1,
    );
    state.candidateReceipts.push({
      event: 'fixture.local_student_established',
      runId: i.runId,
      instance: i.target.instance,
      systemId: i.target.systemId,
      schoolId,
      userId: i.candidateId,
      membershipId: i.membershipId,
      profileId: receipts[1].profileId,
      role: 'student_pilot',
      operationId: i.candidateCreateId,
      attemptId: i.membershipAttemptId,
    });
  }
  if (n >= 3) state.users.push(user(i.adminId, 'admin@school.invalid', i.adminCreateId));
  if (n >= 4) {
    state.grants.push({
      schoolId,
      grantId: i.grantId,
      eligibleUserId: i.adminId,
      expiresAt: receipts[3].expiresAt,
      source: 'local_fixture',
      sourceCode: 'feat-003-local-cli-fixture',
      sourceId: i.grantSourceId,
      correlationId: i.grantCorrelationId,
      status: n >= 5 ? 'completed' : 'pending',
      membershipId: receipts[4]?.membershipId ?? null,
      completionKeyHash: n >= 5 ? i.adminCompleteHash : null,
    });
    state.events.push({
      event: 'admin_bootstrap.grant_issued',
      outcome: 'success',
      schoolId,
      grantId: i.grantId,
      actorKind: 'local_fixture',
      actorId: null,
      sourceId: i.grantSourceId,
      correlationId: i.grantCorrelationId,
    });
  }
  if (n >= 5) {
    const admin = receipts[4];
    addMember(i.adminId, admin.membershipId, admin.profileId, 'admin', 1);
    state.factors.push({
      userId: i.adminId,
      type: 'totp',
      status: 'verified',
      referenceHash: admin.factorHash,
    });
    state.events.push({
      event: 'admin_onboarding.completed',
      outcome: 'success',
      schoolId,
      actorId: i.adminId,
      membershipId: admin.membershipId,
      grantId: i.grantId,
      assurance: 'aal2',
    });
  }
  if (n >= 6) {
    const { operationId, factorHash } = receipts[5];
    const member = { schoolId, userId: i.candidateId, membershipId: i.membershipId };
    state.factors.push({
      userId: i.candidateId,
      type: 'totp',
      status: 'verified',
      referenceHash: factorHash,
    });
    state.enrollments.push({
      ...member,
      operationId,
      status: 'completed',
      completeKeyHash: i.enrollmentCompleteHash,
      factorHash,
    });
    state.readiness.push({ ...member, factorHash, version: 1 });
    state.events.push({
      event: 'member_mfa.enrollment_completed',
      outcome: 'success',
      ...member,
      operationId,
      factorHash,
      version: 1,
      keyHash: i.enrollmentCompleteHash,
    });
  }
  if (n === 7)
    state.events.push({
      event: 'member_role.changed',
      outcome: 'success',
      schoolId,
      actorId: i.adminId,
      membershipId: i.membershipId,
      priorRole: 'student_pilot',
      newRole: 'instructor_pilot',
      priorVersion: 1,
      newVersion: 2,
      reason: 'responsibility_changed',
      mfaReadinessVerified: true,
      keyHash: i.assignmentKeyHash,
      correlationId: receipts[6].correlationId,
    });
  return state;
}

function matches(actual, expected) {
  if (!actual || !isDeepStrictEqual(Object.keys(actual).sort(), Object.keys(expected).sort()))
    return false;
  return Object.entries(expected).every(([name, rows]) => {
    const found = actual[name];
    return (
      Array.isArray(found) &&
      found.length === rows.length &&
      rows.every((row) => found.some((v) => isDeepStrictEqual(v, row)))
    );
  });
}

// Capture server-generated identifiers only from the completed, independently
// read operation. The complete inventory is compared before returning a receipt.
function readReceipt(index, i, state) {
  switch (index) {
    case 1:
      return {
        profileId: state.profiles.find((p) => p.membershipId === i.membershipId)?.profileId,
      };
    case 3:
      return { expiresAt: state.grants[0]?.expiresAt };
    case 4: {
      const membershipId = state.grants[0]?.membershipId;
      return {
        membershipId,
        profileId: state.profiles.find((p) => p.membershipId === membershipId)?.profileId,
        factorHash: state.factors.find((f) => f.userId === i.adminId)?.referenceHash,
      };
    }
    case 5:
      return {
        operationId: state.enrollments[0]?.operationId,
        factorHash: state.readiness[0]?.factorHash,
      };
    case 6:
      return {
        correlationId: state.events.find((e) => e.event === 'member_role.changed')?.correlationId,
      };
    default:
      return {};
  }
}

function protectedActorMatches(index, i, receipts, observation, now) {
  const { session, adminBinding } = observation;
  if (index < 4) return session === null;
  const parsed = sessionSchema.safeParse(session);
  if (!parsed.success) return false;
  const actor = parsed.data;
  if (
    actor.subjectId !== actor.userId ||
    actor.userId !== (index === 5 ? i.candidateId : i.adminId) ||
    actor.schoolId !== i.target.schoolId ||
    !passwordAuthenticationIsRecent(actor, now)
  )
    return false;
  if (index === 6) {
    const binding = currentAdminBinding.safeParse(adminBinding);
    return (
      binding.success &&
      binding.data.sessionId === actor.sessionId &&
      binding.data.bindingSessionId === actor.sessionId &&
      binding.data.userId === i.adminId &&
      (binding.data.notAfter === null || binding.data.notAfter > now) &&
      binding.data.bindingUserId === i.adminId &&
      binding.data.sessionFactorHash === receipts[4].factorHash &&
      binding.data.boundFactorHash === receipts[4].factorHash &&
      actor.canAssignRole &&
      actor.assurance === 'aal2' &&
      actor.totpAt !== null &&
      actor.totpAt <= now &&
      actor.currentFactorHash === receipts[4].factorHash
    );
  }
  return (
    !actor.canAssignRole &&
    actor.assurance === 'aal1' &&
    actor.currentFactorHash === null &&
    actor.totpAt === null
  );
}

// A "prepare" result describes the next protected workflow. The future
// fixture must persist the pending intent under its inventory lock BEFORE the
// first mutation. With a pending intent this model can only record or stop.
export function reconcileLocalInstructor(journal, observation, nowSeconds) {
  try {
    const { intent: i, confirmed, pending } = journalSchema.parse(journal);
    const n = confirmed.length;
    const receipts = confirmed.map((r, k) => receiptSchemas[k].parse(r));
    if (
      !bindingsAreDistinct(i, receipts) ||
      !timestamp.safeParse(nowSeconds).success ||
      (pending !== null && pending !== phases[n])
    )
      return stop('journal-conflict');
    if (!isDeepStrictEqual(observation.target, i.target)) return stop('target-conflict');
    const witness = witnessSchema.parse(observation.witness);
    const ids = ['db', 'auth', 'kong', 'inbucket', 'rest'].map((role) => witness.containers[role]);
    const digest = createHash('sha256')
      .update([witness.daemon, witness.network, ...ids, i.target.systemId].join('/'))
      .digest('hex');
    if (witness.runId !== i.runId || !unique(ids) || digest !== i.target.instance)
      return stop('target-conflict');
    const state = observation.inventory;
    if (pending !== null) {
      const receipt = receiptSchemas[n].parse(readReceipt(n, i, state));
      const next = [...receipts, receipt];
      if (!bindingsAreDistinct(i, next) || !matches(state, expectedInventory(i, next)))
        return stop('unconfirmed-operation');
      return { decision: 'record', phase: pending, receipt };
    }
    if (!matches(state, expectedInventory(i, receipts))) return stop('inventory-conflict');
    if (n === phases.length) return { decision: 'complete' };
    if (n === 4 && receipts[3].expiresAt <= nowSeconds) return stop('grant-expired');
    if (!protectedActorMatches(n, i, receipts, observation, nowSeconds))
      return stop('actor-conflict');
    return { decision: 'prepare', phase: phases[n] };
  } catch {
    return stop('invalid-evidence');
  }
}
