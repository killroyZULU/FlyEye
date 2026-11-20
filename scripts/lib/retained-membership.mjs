import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { feat003StagingTarget } from '../../config/feat-003-staging-target.mjs';
import { ledgerSchema } from './staging-account-evidence.mjs';
import { reconcilePackagedStagingAccounts } from './feat-003-staging-account-package.mjs';
import { readStagingGrantConfiguration } from './feat-003-staging-issuer.mjs';
import { readStagingBrowserConfiguration } from './feat-003-staging-browser-package.mjs';
import { withRetainedAccountJournal } from './staging-account-journal.mjs';
import { readRetainedInstructorPolicy } from '../../supabase/functions/_shared/retained-instructor-policy.ts';

const sql = (file) =>
  readFileSync(new URL('../sql/' + file + '.sql', import.meta.url), 'utf8').trim();
const inventorySql = sql('retained-account-inventory');
const membershipSql = sql('retained-student-membership');
const authorizationSql = sql('retained-instructor-authorization');
const grantSql = readFileSync(
  new URL('../sql/feat-003-staging-grant.sql', import.meta.url),
  'utf8',
);
const stop = () => {
  throw new Error('Retained account verification incomplete. Preserve the private journal.');
};
const check = (value) => {
  if (!value) stop();
};
const hex = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('hex');
const boundary = z.strictObject({
  projectRef: z.literal(feat003StagingTarget.projectRef),
  systemId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  runId: z.uuidv4(),
  packageSha256: z.hash('sha256'),
  noSendVerified: z.literal(true),
  exclusiveRun: z.literal(true),
  assignmentPolicySha256: z.hash('sha256').optional(),
});

// Private operator ports. withLockedJournal holds one inventory lock through the final
// readback and durable journal save. witness independently checks the connected target,
// no-send configuration and lock. This module cannot open a network connection.
export async function reconcileRetainedMembership(
  {
    input,
    selection,
    withLockedJournal = withRetainedAccountJournal,
    witness,
    query,
    assignment,
    issuePolicy,
  },
  slotCode,
) {
  check(
    slotCode === undefined || ['admin', 'student_pilot', 'instructor_pilot'].includes(slotCode),
  );
  const config = readStagingGrantConfiguration(input, grantSql);
  readStagingBrowserConfiguration(JSON.stringify(config.browser), selection);
  return withLockedJournal(async (journal) => {
    const original = journal.read();
    const ledger = ledgerSchema.parse(original.ledger);
    const pending = original.pendingMembership ?? null;
    if (pending !== null) {
      const s = ledger.slots.find((s) => s.role === pending.slot);
      check(
        s &&
          ['student_pilot', 'instructor_pilot'].includes(pending.slot) &&
          !s.complete &&
          s.databaseAttempt === 'unacknowledged' &&
          s.databaseAttemptId === pending.attemptId &&
          s.operationId === pending.operationId &&
          !s.membershipId &&
          !s.profileId &&
          z.uuidv4().safeParse(pending.membershipId).success,
      );
    }
    const bound = boundary.parse(await witness());
    const assertBoundary = async () => {
      journal.check();
      check(isDeepStrictEqual(boundary.parse(await witness()), bound));
    };
    check(
      original.systemId === bound.systemId &&
        original.runId === bound.runId &&
        original.packageSha256 === bound.packageSha256 &&
        bound.packageSha256 === JSON.parse(input.reviewText).packageSha256 &&
        ledger.projectRef === bound.projectRef &&
        config.stagingGrant.organizationId === ledger.schoolId,
    );
    function binding() {
      return { ...bound, ...config.stagingGrant, schoolId: ledger.schoolId, slots: ledger.slots };
    }
    function settings() {
      return "set local fixture.binding = '" + hex(binding()) + "';";
    }
    async function inspect() {
      await assertBoundary();
      const raw = await query(
        "begin isolation level repeatable read read only; set local statement_timeout='10s';\n" +
          settings() +
          '\n' +
          inventorySql +
          ';\ncommit;',
      );
      // The transport returns only the JSON result of the snapshot, never the settings.
      check(typeof raw === 'string' && Buffer.byteLength(raw) <= 65536);
      const inventory = JSON.parse(raw);
      const view = {
        ...inventory,
        noSendVerified: bound.noSendVerified,
        exclusiveRun: bound.exclusiveRun,
      };
      const result = reconcilePackagedStagingAccounts(
        input,
        selection,
        JSON.stringify(ledger),
        JSON.stringify(view),
        grantSql,
      );
      await assertBoundary();
      return { result, inventory };
    }
    let { result, inventory } = await inspect();
    if (issuePolicy && slotCode === 'instructor_pilot') {
      const policy = readRetainedInstructorPolicy('staging-synthetic-v1', issuePolicy);
      check(
        typeof issuePolicy === 'string' &&
          createHash('sha256').update(issuePolicy).digest('hex') === bound.assignmentPolicySha256 &&
          policy &&
          policy.packageSha256 === bound.packageSha256 &&
          policy.schoolId === ledger.schoolId &&
          policy.adminId === config.stagingGrant.eligibleUserId &&
          Date.parse(policy.expiresAt) > Date.now(),
      );
      const candidate = ledger.slots.find((s) => s.role === slotCode);
      const observed = inventory.slots.find((s) => s.role === slotCode);
      const expected = {
        id: policy.authorizationId,
        schoolId: policy.schoolId,
        adminId: policy.adminId,
        candidateId: policy.candidateId,
        membershipId: policy.membershipId,
        factorId: observed.factor?.id,
        keyHash: policy.keyHash,
        usable: true,
      };
      check(
        candidate.authId === policy.candidateId &&
          candidate.membershipId === policy.membershipId &&
          observed.factor?.state === 'verified-bound' &&
          !original.pendingMembership &&
          !candidate.assignmentKeyHash,
      );
      if (original.assignmentAuthorizationIntent) {
        check(
          isDeepStrictEqual(original.assignmentAuthorizationIntent, policy) &&
            isDeepStrictEqual(observed.assignmentPermit, expected),
        );
        return result;
      }
      check(
        result.decision === 'stop' &&
          result.reason === 'staging-assignment-unavailable' &&
          observed.assignmentPermit === null,
      );
      // Evaluate all three slots against the proposed permit before issuing it. Only an
      // independently re-read private row can authorize a subsequent protected request.
      const projected = structuredClone(inventory);
      projected.slots.find((s) => s.role === slotCode).assignmentPermit = expected;
      const planned = reconcilePackagedStagingAccounts(
        input,
        selection,
        JSON.stringify(ledger),
        JSON.stringify({ ...projected, noSendVerified: true, exclusiveRun: true }),
        grantSql,
      );
      check(
        planned.decision === 'plan' &&
          planned.slots.admin.decision === 'already-complete' &&
          planned.slots.student_pilot.decision === 'already-complete' &&
          planned.slots[slotCode].step === 'protected-one-time-instructor-assignment',
      );
      journal.save({ ...original, assignmentAuthorizationIntent: policy });
      check(isDeepStrictEqual(journal.read().assignmentAuthorizationIntent, policy));
      await assertBoundary();
      await lockedWrite(
        "set local fixture.assignment_policy = '" +
          hex(policy) +
          "'; set local fixture.candidate_factor = '" +
          z.uuid().parse(expected.factorId) +
          "';\n" +
          authorizationSql,
        inventory,
      );
      const fresh = await inspect();
      check(
        isDeepStrictEqual(
          fresh.inventory.slots.find((s) => s.role === slotCode).assignmentPermit,
          expected,
        ),
      );
      return fresh.result;
    }
    if (result.decision !== 'plan' || !slotCode) return result;
    const slot = ledger.slots.find((s) => s.role === slotCode);
    if (pending) {
      check(
        pending.slot === slotCode &&
          slot.databaseAttempt === 'unacknowledged' &&
          slot.databaseAttemptId === pending.attemptId &&
          pending.operationId === slot.operationId,
      );
    }
    if (!pending && result.slots[slotCode].step === 'establish-audited-student-membership') {
      check(slot.databaseAttempt === 'none' && slot.authId && slot.authId === slot.plannedAuthId);
      const attemptId = randomUUID(),
        membershipId = randomUUID();
      Object.assign(slot, { databaseAttempt: 'unacknowledged', databaseAttemptId: attemptId });
      const intent = { slot: slotCode, operationId: slot.operationId, attemptId, membershipId };
      journal.save({ ...original, ledger, pendingMembership: intent });
      check(
        isDeepStrictEqual(journal.read().pendingMembership, intent) &&
          isDeepStrictEqual(journal.read().ledger, ledger),
      );
      await assertBoundary();
      await lockedWrite(
        "set local fixture.slot = '" +
          slotCode +
          "'; set local fixture.membership = '" +
          membershipId +
          "';\n" +
          membershipSql,
        inventory,
      );
      ({ result, inventory } = await inspect());
    }
    async function lockedWrite(body, previous) {
      await query(
        "begin; set local lock_timeout='3s'; set local statement_timeout='15s';\n" +
          'lock table public.organizations,auth.users,public.organization_memberships,public.organization_member_profiles,' +
          'public.membership_roles,public.roles,public.organization_admin_bootstrap_grants,staging_private.retained_membership_receipts,' +
          'staging_private.student_fixture_receipts,auth.mfa_factors,public.member_mfa_readiness,public.member_mfa_enrollment_operations,' +
          'public.admin_session_factor_bindings,public.authentication_events,public.member_administration_events,' +
          'staging_private.instructor_assignment_uses,staging_private.instructor_assignment_authorizations in share row exclusive mode;\n' +
          settings() +
          '\n' +
          'do $recheck$ begin if (' +
          inventorySql +
          ") is distinct from convert_from(decode('" +
          hex(previous) +
          "','hex'),'UTF8')::jsonb then raise exception 'retained inventory changed'; end if; end $recheck$;\n" +
          body +
          '\ncommit;',
      );
    }
    if (
      result.decision === 'plan' &&
      result.slots[slotCode].step === 'record-confirmed-membership' &&
      slotCode !== 'admin'
    ) {
      const saved = journal.read(),
        intent = saved.pendingMembership;
      const member = inventory.slots.find((s) => s.role === slotCode).memberships[0];
      check(
        isDeepStrictEqual(saved.ledger, ledger) &&
          intent?.slot === slotCode &&
          intent.operationId === slot.operationId &&
          intent.attemptId === slot.databaseAttemptId &&
          member.id === intent.membershipId &&
          member.databaseAttemptId === intent.attemptId &&
          member.auditedOperationId === intent.operationId &&
          member.authId === slot.authId,
      );
      Object.assign(slot, {
        databaseAttempt: 'committed',
        membershipId: member.id,
        profileId: member.profileId,
      });
      journal.save({ ...saved, ledger, pendingMembership: null });
      check(
        isDeepStrictEqual(journal.read().ledger, ledger) &&
          journal.read().pendingMembership === null,
      );
      return (await inspect()).result;
    }
    if (slotCode === 'admin' && result.slots.admin.step === 'record-confirmed-grant') {
      check(
        !pending &&
          slot.databaseAttempt === 'unacknowledged' &&
          slot.databaseAttemptId === config.stagingGrant.sourceInstanceId,
      );
      slot.databaseAttempt = 'committed';
      journal.save({ ...original, ledger });
      return (await inspect()).result;
    }
    if (slotCode === 'admin' && result.slots.admin.step === 'record-confirmed-membership') {
      const observed = inventory.slots.find((s) => s.role === 'admin');
      check(
        !pending &&
          slot.databaseAttempt === 'committed' &&
          observed.grant?.status === 'completed' &&
          observed.factor?.state === 'verified-bound' &&
          observed.memberships.length === 1,
      );
      const member = observed.memberships[0];
      Object.assign(slot, {
        membershipId: member.id,
        profileId: member.profileId,
        factorId: observed.factor.id,
      });
      journal.save({ ...original, ledger });
      return (await inspect()).result;
    }
    if (result.slots[slotCode].step === 'protected-one-time-instructor-assignment' && assignment) {
      const observed = inventory.slots.find((s) => s.role === slotCode);
      const permit = observed.assignmentPermit;
      check(
        slotCode === 'instructor_pilot' &&
          !pending &&
          !slot.assignmentKeyHash &&
          original.assignmentAuthorizationIntent?.authorizationId === permit.id &&
          original.assignmentAuthorizationIntent.keyHash === permit.keyHash &&
          permit.id === assignment.authorizationId &&
          permit.keyHash === assignment.keyHash &&
          permit.factorId === observed.factor.id &&
          typeof assignment.sendProtected === 'function',
      );
      slot.assignmentKeyHash = permit.keyHash;
      slot.factorId = permit.factorId;
      journal.save({ ...original, ledger });
      check(isDeepStrictEqual(journal.read().ledger, ledger));
      await assertBoundary();
      // Exactly one send. A thrown or lost acknowledgement leaves this intent in place.
      await assignment.sendProtected();
      return (await inspect()).result;
    }
    if (result.slots[slotCode].step === 'record-completion') {
      const observed = inventory.slots.find((s) => s.role === slotCode);
      check(
        !pending &&
          observed.memberships.length === 1 &&
          slot.membershipId === observed.memberships[0].id,
      );
      slot.factorId = observed.factor?.id ?? null;
      slot.complete = true;
      journal.save({ ...original, ledger });
      return (await inspect()).result;
    }
    return result;
  });
}
