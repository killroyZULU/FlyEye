// Invoked only by the ownership-checked disposable test driver. No connection or hosted entrypoint.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture as packageFixture } from './staging-package-test-data.mjs';
import { fixture as accountsFixture, own } from './staging-account-test-data.mjs';
import { generateStagingBrowserConfiguration } from './feat-003-staging-browser-package.mjs';
import { reconcileRetainedMembership } from './retained-membership.mjs';

export async function seedDisposableRetainedAccounts(query, verifiedSystemId) {
  assert.match(verifiedSystemId, /^[1-9][0-9]{0,19}$/);
  assert.equal(await query('select count(*) from auth.users'), '0');
  assert.equal(await query('select count(*) from public.organizations'), '0');
  const accounts = accountsFixture();
  const [student, candidate, admin] = accounts.ledger.slots;
  accounts.ledger.slots.forEach((_, i) => own(accounts, i));
  const school = accounts.ledger.schoolId;
  const { configuration, input, rebind } = packageFixture();
  const selection = {
    publishableKey: 'sb_publishable_synthetic-disposable-only',
    callbackPaths: [],
  };
  configuration.browser = JSON.parse(generateStagingBrowserConfiguration(selection));
  Object.assign(configuration.stagingGrant, {
    organizationId: school,
    eligibleUserId: admin.authId,
    grantId: admin.grantId,
  });
  rebind();
  const bound = {
    runId: randomUUID(),
    systemId: verifiedSystemId,
    projectRef: accounts.ledger.projectRef,
    packageSha256: JSON.parse(input.reviewText).packageSha256,
    exclusiveRun: true,
    noSendVerified: true,
  };
  const initial = {
    runId: bound.runId,
    systemId: bound.systemId,
    packageSha256: bound.packageSha256,
    ledger: accounts.ledger,
  };
  await query(
    "insert into public.organizations(id,name) values ('" +
      school +
      "','Synthetic retained check');" +
      accounts.ledger.slots
        .map(
          (s) =>
            "insert into auth.users(id,email,email_confirmed_at,is_anonymous,raw_app_meta_data) values ('" +
            s.authId +
            "','" +
            s.email +
            "',now(),false,jsonb_build_object('flyeye_fixture_create_operation','" +
            s.operationId +
            "'));",
        )
        .join('\n'),
  );
  return { initial, bound, input, selection, configuration, admin, student, candidate, school };
}

export async function checkDisposableMembership(query, verifiedSystemId) {
  const { initial, bound, input, selection, configuration, admin, student, candidate, school } =
    await seedDisposableRetainedAccounts(query, verifiedSystemId);
  let record = initial;
  const withLockedJournal = async (work) =>
    work({
      read: () => structuredClone(record),
      save(next) {
        record = structuredClone(next);
      },
      check() {},
    });
  const changes = [];
  let concurrent = false;
  let loseAck = false;
  const options = {
    input,
    selection,
    witness: () => bound,
    withLockedJournal,
    query: async (sql) => {
      if (!sql.includes('do $establish$')) return query(sql);
      changes.push(sql);
      if (concurrent) {
        concurrent = false;
        const both = await Promise.allSettled([query(sql), query(sql)]);
        assert.deepEqual(both.map((x) => x.status).sort(), ['fulfilled', 'rejected']);
      } else await query(sql);
      if (loseAck) throw new Error('synthetic lost acknowledgement');
    },
  };
  const plan = () => reconcileRetainedMembership(options);
  const establish = (slot) => reconcileRetainedMembership(options, slot.role);
  const before = await plan();
  assert.equal(before.decision, 'plan', JSON.stringify(before));
  assert.equal(before.slots.admin.step, 'issue-pending-grant');
  assert.equal(before.slots.student_pilot.step, 'establish-audited-student-membership');
  const savedBeforeFailure = structuredClone(record);
  await query(
    "create function staging_private.proof_audit_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure'; end$$; create trigger proof_failure before insert on staging_private.retained_membership_receipts for each row execute function staging_private.proof_audit_failure()",
  );
  await assert.rejects(establish(student));
  assert.equal(
    await query(
      'select (select count(*) from public.organization_memberships)+(select count(*) from public.membership_roles)+(select count(*) from public.organization_member_profiles)+(select count(*) from staging_private.retained_membership_receipts)',
    ),
    '0',
  );
  assert.equal((await establish(student)).reason, 'database-uncertain');
  assert.equal(changes.length, 1);
  await query(
    'drop trigger proof_failure on staging_private.retained_membership_receipts; drop function staging_private.proof_audit_failure()',
  );
  // End the failure-injection scenario. A distinct synthetic test journal begins the
  // success scenario after independent zero-row verification in this disposable DB.
  record = structuredClone(savedBeforeFailure);
  concurrent = true;
  await establish(student);
  assert.equal(record.ledger.slots[0].databaseAttempt, 'committed');
  loseAck = true;
  await assert.rejects(establish(candidate), /synthetic lost acknowledgement/);
  loseAck = false;
  assert.equal(record.ledger.slots[1].databaseAttempt, 'unacknowledged');
  await establish(candidate);
  assert.equal(record.ledger.slots[1].databaseAttempt, 'committed');
  assert.equal(changes.length, 3);
  assert.equal(
    await query('select count(*) from staging_private.retained_membership_receipts'),
    '2',
  );
  await establish(student);
  const saved = structuredClone(record);
  await establish(student);
  await establish(candidate);
  assert.deepEqual(record, saved);
  assert.equal(changes.length, 3);
  return {
    readRecord: () => structuredClone(record),
    options,
    plan,
    configuration,
    admin,
    student,
    candidate,
    school,
    recordGrantAttempt: () => {
      const adminSlot = record.ledger.slots.find((s) => s.role === 'admin');
      adminSlot.databaseAttemptId = configuration.stagingGrant.sourceInstanceId;
      adminSlot.databaseAttempt = 'unacknowledged';
    },
  };
}
