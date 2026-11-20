import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prepareStagingGrant } from './feat-003-staging-issuer.mjs';
import { reconcileRetainedMembership } from './retained-membership.mjs';
import { createMemberAdministrationHandler } from '../../supabase/functions/member-administration/handler.ts';
import { MemberAdministrationAuditWriteError } from '../../supabase/functions/member-administration/contracts.ts';

// All arguments are generated synthetic fixture values. Provider session rows supply
// controlled MFA evidence. Authentication at the HTTP test boundary is synthetic.
const hash = (value) => createHash('sha256').update(value).digest('hex');
const key = () => hash(randomUUID());
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
export async function checkDisposableAssignment(query, fixture) {
  const { options, readRecord, admin, candidate, school, configuration } = fixture;
  const rpc = async (fn, args) =>
    JSON.parse(await query('select public.' + fn + '(' + args.map(literal).join(',') + ')'));
  const now = Math.floor(Date.now() / 1000);
  async function factorSession(user) {
    const factor = randomUUID(),
      session = randomUUID();
    await query(
      "begin;insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values ('" +
        factor +
        "','" +
        user +
        "','totp','verified',now(),now()); insert into auth.sessions(id,user_id,factor_id,aal) values ('" +
        session +
        "','" +
        user +
        "','" +
        factor +
        "','aal2'); insert into auth.mfa_amr_claims(id,session_id,authentication_method,created_at,updated_at) " +
        "select gen_random_uuid(),'" +
        session +
        "',method,now(),now() from unnest(array['password','totp']) method;commit;",
    );
    return { factor, session };
  }
  fixture.recordGrantAttempt();
  const grantSql = readFileSync(
    new URL('../sql/feat-003-staging-grant.sql', import.meta.url),
    'utf8',
  );
  await query(prepareStagingGrant(options.input, grantSql).sql);
  assert.equal(
    (await reconcileRetainedMembership(options, 'admin')).slots.admin.step,
    'protected-admin-onboarding',
  );
  const grant = configuration.stagingGrant.grantId;
  const adminFactor = await factorSession(admin.authId);
  const start = await rpc('start_organization_admin_onboarding', [
    admin.authId,
    grant,
    1,
    key(),
    randomUUID(),
  ]);
  assert.equal(start.decision, 'ready');
  const completed = await rpc('complete_first_organization_admin_bootstrap', [
    admin.authId,
    admin.authId,
    adminFactor.session,
    now,
    'aal2',
    '{password,totp}',
    adminFactor.factor,
    1,
    grant,
    start.grantVersion,
    key(),
    randomUUID(),
  ]);
  assert.equal(completed.decision, 'completed');
  const adminPlan = await reconcileRetainedMembership(options, 'admin');
  assert.equal(adminPlan.slots?.admin.step, 'record-completion', JSON.stringify(adminPlan));
  assert.equal(
    (await reconcileRetainedMembership(options, 'admin')).slots.admin.decision,
    'already-complete',
  );
  const candidateFactor = await factorSession(candidate.authId);
  const factorHash = hash(candidateFactor.factor);
  const enrollment = await rpc('start_member_mfa_enrollment', [
    candidate.authId,
    factorHash,
    key(),
    randomUUID(),
  ]);
  assert.equal(enrollment.decision, 'ready');
  const enrolled = await rpc('complete_member_mfa_enrollment', [
    candidate.authId,
    candidateFactor.session,
    now,
    'aal2',
    '{password,totp}',
    enrollment.operationId,
    enrollment.operationVersion,
    factorHash,
    key(),
    randomUUID(),
  ]);
  assert.equal(enrolled.decision, 'completed');
  const idempotencyKey = key(),
    record = readRecord();
  const policy = {
    version: 'retained-instructor-once-v1',
    authorizationId: randomUUID(),
    packageSha256: record.packageSha256,
    schoolId: school,
    adminId: admin.authId,
    candidateId: candidate.authId,
    membershipId: record.ledger.slots.find((s) => s.role === 'instructor_pilot').membershipId,
    keyHash: hash(idempotencyKey),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
  const unapproved = () =>
    reconcileRetainedMembership(
      { ...options, issuePolicy: JSON.stringify(policy) },
      'instructor_pilot',
    );
  await assert.rejects(unapproved());
  const witness = options.witness;
  options.witness = () => ({ ...witness(), assignmentPolicySha256: key() });
  await assert.rejects(unapproved());
  options.witness = () => ({ ...witness(), assignmentPolicySha256: hash(JSON.stringify(policy)) });
  const issued = await reconcileRetainedMembership(
    { ...options, issuePolicy: JSON.stringify(policy) },
    'instructor_pilot',
  );
  assert.equal(
    issued.slots?.instructor_pilot.step,
    'protected-one-time-instructor-assignment',
    JSON.stringify(issued),
  );
  const args = [
    policy.authorizationId,
    policy.packageSha256,
    policy.adminId,
    adminFactor.session,
    school,
    policy.membershipId,
    policy.candidateId,
    policy.expiresAt,
    policy.keyHash,
  ];
  async function consume(values = args, correlation = randomUUID()) {
    return JSON.parse(
      await query(
        'begin;set local role service_role;select public.consume_retained_instructor_assignment(' +
          [...values, correlation].map(literal).join(',') +
          ');commit;',
      ),
    );
  }
  for (const [index, bad] of [
    [0, randomUUID()],
    [1, key()],
    [2, candidate.authId],
    [3, candidateFactor.session],
    [4, randomUUID()],
    [5, randomUUID()],
    [6, admin.authId],
    [7, new Date(0).toISOString()],
    [8, key()],
  ]) {
    const wrong = [...args];
    wrong[index] = bad;
    assert.equal((await consume(wrong)).decision, 'state_conflict');
  }
  const drift = await query(
    "begin; insert into auth.users(id,email) values(gen_random_uuid(),'unexpected@school.invalid');set local role service_role;select public.consume_retained_instructor_assignment(" +
      [...args, randomUUID()].map(literal).join(',') +
      ');rollback;',
  );
  assert.equal(JSON.parse(drift).decision, 'state_conflict');
  const cancelled = await query(
    "begin; insert into public.member_mfa_enrollment_operations(organization_id,membership_id,subject_user_id,status,start_idempotency_key_hash,cancelled_at) select organization_id,membership_id,subject_user_id,'cancelled'," +
      literal(key()) +
      ",now() from public.member_mfa_enrollment_operations where status='completed';set local role service_role;select public.consume_retained_instructor_assignment(" +
      [...args, randomUUID()].map(literal).join(',') +
      ');rollback;',
  );
  assert.equal(JSON.parse(cancelled).decision, 'state_conflict');
  await query(
    "create function staging_private.proof_use_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic use failure'; end$$; create trigger proof_use_failure before insert on staging_private.instructor_assignment_uses for each row execute function staging_private.proof_use_failure()",
  );
  await assert.rejects(consume());
  assert.equal(
    await query(
      "select version from public.organization_memberships where id='" + policy.membershipId + "'",
    ),
    '1',
  );
  assert.equal(
    await query(
      "select count(*) from public.member_administration_events where event_name='member_role.changed'",
    ),
    '0',
  );
  await query(
    'drop trigger proof_use_failure on staging_private.instructor_assignment_uses;drop function staging_private.proof_use_failure()',
  );
  const origin = 'https://flyeye-staging.pages.dev';
  let calls = 0,
    denials = 0,
    telemetry = 0,
    auditFailure = false,
    aal = 'aal2';
  const handler = createMemberAdministrationHandler({
    allowedOrigin: origin,
    runtimeProfile: 'staging-synthetic-v1',
    authenticate: async () => ({
      actorUserId: admin.authId,
      actorSubjectId: admin.authId,
      sessionId: adminFactor.session,
      assuranceLevel: aal,
      passwordAuthenticatedAt: now,
      totpAuthenticatedAt: now,
      authenticationMethods: ['password', 'totp'],
    }),
    resolveLimitScope: async () => school,
    consumeLimit: async ({ correlationId }) => ({
      allowed: true,
      retryAfterSeconds: null,
      networkSourceUsed: false,
      policyVersion: 'member-administration-subject-scope-v1',
      correlationId,
    }),
    recordDenied: async () => {
      denials++;
    },
    reportAuditFailure: ({ action, correlationId }) => {
      assert.equal(action, 'assign_role');
      assert.match(correlationId, /^[0-9a-f-]{36}$/);
      telemetry++;
    },
    retainedInstructor: {
      policy,
      consume: async (_actor, correlation) => {
        if (auditFailure) throw new MemberAdministrationAuditWriteError();
        calls++;
        return consume(args, correlation);
      },
    },
  });
  const request = (override = {}) =>
    handler(
      new Request(origin + '/functions/v1/member-administration', {
        method: 'POST',
        headers: {
          origin,
          authorization: 'Bearer synthetic-test-only',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: 'assign_role',
          organizationId: school,
          membershipId: policy.membershipId,
          roleCode: 'instructor_pilot',
          expectedVersion: 1,
          reasonCode: 'responsibility_changed',
          idempotencyKey,
          ...override,
        }),
      }),
    );
  for (const mismatch of [
    { expectedVersion: 2 },
    { roleCode: 'admin' },
    { reasonCode: 'assignment_corrected' },
    { idempotencyKey: key() },
  ])
    assert((await request(mismatch)).status >= 400);
  aal = 'aal1';
  assert.equal((await request()).status, 403);
  aal = 'aal2';
  assert.equal(calls, 0);
  assert.equal(denials, 5);
  auditFailure = true;
  assert.equal((await request()).status, 503);
  assert.equal(telemetry, 1);
  auditFailure = false;
  let sends = 0;
  const assigned = {
    ...options,
    assignment: {
      authorizationId: policy.authorizationId,
      keyHash: policy.keyHash,
      sendProtected: async () => {
        sends++;
        assert.equal((await request()).status, 200);
        throw new Error('synthetic lost assignment acknowledgement');
      },
    },
  };
  await assert.rejects(
    reconcileRetainedMembership(assigned, 'instructor_pilot'),
    /synthetic lost assignment/,
  );
  const done = await reconcileRetainedMembership(assigned, 'instructor_pilot');
  for (const slot of Object.values(done.slots)) assert.equal(slot.decision, 'already-complete');
  assert.equal(sends, 1);
  assert.equal(calls, 1);
  assert((await request()).status >= 400);
  const before = readRecord();
  assert.deepEqual(await fixture.plan(), done);
  assert.deepEqual(readRecord(), before);
  const corrupt = {
    ...before,
    pendingMembership: { slot: 'student_pilot', membershipId: randomUUID() },
  };
  for (const pendingMembership of [corrupt.pendingMembership, false, 0, ''])
    await assert.rejects(
      reconcileRetainedMembership({
        ...options,
        withLockedJournal: (work) =>
          work({
            read: () => ({ ...before, pendingMembership }),
            check() {},
            save() {
              assert.fail('unexpected journal write');
            },
          }),
      }),
    );
  assert.equal(await query('select count(*) from staging_private.instructor_assignment_uses'), '1');
  assert.equal(
    await query(
      "select count(*) from public.member_administration_events where event_name='member_role.changed'",
    ),
    '1',
  );
  assert.equal(await query('select count(*) from public.organization_memberships'), '3');
}
