import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { authenticationEvidenceFromVerifiedToken } from '../../supabase/functions/_shared/authentication-evidence.ts';
import { reconcileLocalInstructor } from './local-instructor-provisioning.mjs';
import { lifecycleMigrationDigest } from './local-lifecycle-migrations.mjs';
import { isHeldLocalFixtureJournal, studentUuid } from './local-student-journal.mjs';
import { isOwnedLocalStudentTarget } from './no-send-local-project.mjs';
import { createNoSendHttpClient } from './no-send-http-client.mjs';

const origin = 'http://127.0.0.1:58321';
const project = 'flyeye-nosend-p3d1';
const schoolId = '00000000-0000-4000-8000-000000000099';
const candidateEmail = 'instructor_pilot@school.invalid';
const adminEmail = 'admin@school.invalid';
const phases = [
  'create-candidate',
  'establish-student',
  'create-admin-subject',
  'issue-local-grant',
  'protected-admin-onboarding',
  'protected-self-enrollment',
  'protected-role-assignment',
];
const hash = (v) => createHash('sha256').update(v).digest('hex');
const readSql = (name) =>
  readFileSync(new URL('../sql/' + name + '.sql', import.meta.url), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );
const snapshotSql = readSql('local-instructor-evidence');
const grantSql = readSql('local-instructor-grant');
const studentSql = readSql('local-student-fixture');
function requireEvidence(value) {
  if (!value) throw new Error('Local Instructor fixture evidence rejected.');
}
// Preserve the historical Student journal revision. Specialize exactly one address
// predicate in the reviewed transaction, retaining every ownership and write guard.
requireEvidence(
  hash(studentSql) === 'b830d5597855864c1412b90d2b413e6c0557eb2df0ddc5ed57c26f1e47834d71',
);
const candidateSql = studentSql.replace(
  "email = 'student_pilot@school.invalid'",
  "email = 'instructor_pilot@school.invalid'",
);
requireEvidence(candidateSql !== studentSql);
const revision = hash([lifecycleMigrationDigest, snapshotSql, candidateSql, grantSql].join('\0'));
const active = new WeakSet();

// Validate only public digests and the presence of private operation methods.
// Preflight must never obtain passwords, sessions or idempotency keys.
export function checkInstructorOperator(keys, operator) {
  const names = ['adminCompleteHash', 'enrollmentCompleteHash', 'assignmentKeyHash'];
  requireEvidence(keys && Object.keys(keys).length === names.length);
  const digests = names.map((name) => Object.getOwnPropertyDescriptor(keys, name)?.value);
  requireEvidence(
    digests.every((d) => typeof d === 'string' && d.length === 64 && /^[a-f0-9]+$/.test(d)) &&
      new Set(digests).size === names.length &&
      operator &&
      ['passwordFor', 'privateSession', ...phases.slice(4)].every(
        (name) => typeof Object.getOwnPropertyDescriptor(operator, name)?.value === 'function',
      ),
  );
}

function loadState(journal) {
  const record = journal.read('instructor-intent');
  requireEvidence(record?.revision === revision && record.intent?.runId === journal.runId);
  const confirmed = [];
  let pending = null;
  for (const [index, phase] of phases.entries()) {
    const attempt = journal.read('instructor-pending-' + index);
    const receipt = journal.read('instructor-receipt-' + index);
    if (attempt !== null) {
      requireEvidence(
        confirmed.length === index && isDeepStrictEqual(attempt, { phase, runId: journal.runId }),
      );
      pending = phase;
    }
    if (receipt !== null) {
      requireEvidence(
        attempt !== null && receipt.runId === journal.runId && receipt.phase === phase,
      );
      confirmed.push(receipt.receipt);
      pending = null;
    }
  }
  return { intent: record.intent, confirmed, pending };
}

function snapshot(transport, sessionId = '') {
  requireEvidence(sessionId === '' || studentUuid(sessionId));
  const raw = transport.sql(`begin isolation level repeatable read read only;
set local statement_timeout = '10s';
set local fixture.session_id = '${sessionId}';
${snapshotSql}
commit;`);
  requireEvidence(typeof raw === 'string' && raw.length <= 65536);
  const data = JSON.parse(raw);
  requireEvidence(Number.isSafeInteger(data.nowSeconds) && data.nowSeconds > 0);
  return data;
}

async function verifiedSession(accessToken, publicKey, expectedId, expectedEmail) {
  requireEvidence(
    typeof accessToken === 'string' && typeof publicKey === 'string' && accessToken && publicKey,
  );
  const client = createNoSendHttpClient();
  try {
    const response = await client.request(origin + '/auth/v1/user', {
      method: 'GET',
      headers: { apikey: publicKey, authorization: 'Bearer ' + accessToken },
    });
    requireEvidence(
      response.status === 200 &&
        response.body?.id === expectedId &&
        response.body.email === expectedEmail,
    );
    return (now) => authenticationEvidenceFromVerifiedToken(accessToken, expectedId, now);
  } finally {
    await client.close();
  }
}

function sessionProjection(verified, actor, now) {
  requireEvidence(
    actor?.sessionId === verified.sessionId &&
      actor.userId === verified.actorUserId &&
      actor.assurance === verified.assuranceLevel &&
      actor.passwordMethod === true &&
      actor.totpMethod === (verified.totpAuthenticatedAt !== null) &&
      (actor.notAfter === null || (Number.isSafeInteger(actor.notAfter) && actor.notAfter > now)),
  );
  const { canAssignRole, ...adminBinding } = actor;
  return {
    adminBinding,
    session: {
      userId: actor.userId,
      subjectId: verified.actorSubjectId,
      sessionId: actor.sessionId,
      schoolId,
      assurance: actor.assurance,
      passwordAuthenticatedAt: verified.passwordAuthenticatedAt,
      totpAt: verified.totpAuthenticatedAt,
      currentFactorHash: actor.sessionFactorHash,
      canAssignRole,
    },
  };
}

async function createSubject(serviceKey, password, id, email, marker) {
  requireEvidence(
    typeof password === 'string' &&
      password.length >= 15 &&
      typeof serviceKey === 'string' &&
      serviceKey,
  );
  const client = createNoSendHttpClient();
  try {
    const response = await client.request(origin + '/auth/v1/admin/users', {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        authorization: 'Bearer ' + serviceKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id,
        email,
        password,
        email_confirm: true,
        app_metadata: { flyeye_fixture_create_operation: marker },
      }),
    });
    requireEvidence(response.status >= 200 && response.status < 300);
  } finally {
    await client.close();
  }
}

// Owned local capabilities only. Private protected workflow results are never receipts.
export function localInstructorFixture(transport, journal) {
  function guard() {
    requireEvidence(isOwnedLocalStudentTarget(transport) && isHeldLocalFixtureJournal(journal));
    journal.check();
    requireEvidence(['intent', 'attempt', 'confirmed'].every((key) => journal.read(key) === null));
    const { systemId, instance, daemon, network, containers } = transport.instructorWitness();
    return {
      target: {
        project,
        schoolId,
        apiOrigin: origin,
        dockerSocket: 'unix:///var/run/docker.sock',
        migrationDigest: lifecycleMigrationDigest,
        systemId,
        instance,
      },
      witness: {
        runId: journal.runId,
        lockHeld: true,
        loopbackVerified: true,
        noSendVerified: true,
        daemon,
        network,
        containers,
      },
    };
  }
  function observe(state, evidence = null, captureInventory) {
    const boundary = guard();
    requireEvidence(isDeepStrictEqual(state.intent.target, boundary.target));
    journal.bindInstance(boundary.target.instance, false);
    const data = snapshot(transport, evidence?.sessionId);
    requireEvidence(
      data.systemId === boundary.target.systemId && isDeepStrictEqual(boundary, guard()),
    );
    const subject = evidence
      ? sessionProjection(evidence, data.actor, data.nowSeconds)
      : { session: null, adminBinding: null };
    const verdict = reconcileLocalInstructor(
      state,
      { ...boundary, inventory: data.inventory, ...subject },
      data.nowSeconds,
    );
    if (verdict.decision === 'prepare') captureInventory?.(data.inventory);
    return verdict;
  }
  function directWrite(intent, settings, body, inventory) {
    const expected = Buffer.from(JSON.stringify(inventory)).toString('hex');
    // Re-read after acquiring locks. The independently accepted pre-state must
    // still hold inside the transaction that establishes membership or issues a grant.
    const query = snapshotSql.trimEnd().replace(/;$/, '');
    const setup = Object.entries(settings)
      .map(([k, v]) => `set local fixture.${k} = '${v}';`)
      .join('\n');
    transport.sql(`begin; set local lock_timeout = '3s'; set local statement_timeout = '10s';
set local fixture.session_id = '';
${setup}
lock table public.organizations, auth.users, public.organization_memberships, public.membership_roles,
  public.roles, public.organization_member_profiles, public.organization_admin_bootstrap_grants,
  staging_private.student_fixture_receipts, auth.mfa_factors, public.member_mfa_enrollment_operations,
  public.member_mfa_readiness, public.authentication_events, public.member_administration_events in share row exclusive mode;
do $precheck$ declare observed jsonb; begin
  select s.data into strict observed from (${query}) as s(data);
  if observed->>'systemId' is distinct from '${intent.target.systemId}' or
     (observed->'inventory') is distinct from convert_from(decode('${expected}','hex'),'UTF8')::jsonb then
     raise exception 'Local precondition changed.';
  end if;
end; $precheck$;
${body}
commit;`);
  }
  async function exclusive(work) {
    requireEvidence(!active.has(journal));
    active.add(journal);
    try {
      return await work();
    } catch {
      throw new Error('Local Instructor fixture stopped; inspect the retained journal.');
    } finally {
      active.delete(journal);
    }
  }
  guard();
  return {
    initialize(keys) {
      return exclusive(() => {
        const boundary = guard();
        requireEvidence(journal.read('instructor-intent') === null);
        for (const index of phases.keys())
          requireEvidence(
            journal.read('instructor-pending-' + index) === null &&
              journal.read('instructor-receipt-' + index) === null,
          );
        const intent = {
          target: boundary.target,
          runId: journal.runId,
          candidateId: randomUUID(),
          adminId: randomUUID(),
          candidateCreateId: randomUUID(),
          adminCreateId: randomUUID(),
          membershipId: randomUUID(),
          membershipAttemptId: randomUUID(),
          grantId: randomUUID(),
          grantSourceId: randomUUID(),
          grantCorrelationId: randomUUID(),
          adminCompleteHash: keys.adminCompleteHash,
          enrollmentCompleteHash: keys.enrollmentCompleteHash,
          assignmentKeyHash: keys.assignmentKeyHash,
        };
        const data = snapshot(transport);
        requireEvidence(
          data.systemId === boundary.target.systemId &&
            isDeepStrictEqual(boundary, guard()) &&
            reconcileLocalInstructor(
              { intent, confirmed: [], pending: null },
              { ...boundary, inventory: data.inventory, session: null },
              data.nowSeconds,
            ).phase === phases[0],
        );
        journal.bindInstance(boundary.target.instance, true);
        journal.record('instructor-intent', { revision, intent });
        return journal.runId;
      });
    },
    adminBrowserBinding() {
      return exclusive(() => {
        const state = loadState(journal);
        requireEvidence(state.confirmed.length === 5 && state.pending === null);
        const receipt = state.confirmed[4];
        // Independently reconstruct the onboarding receipt from the current database.
        const checked = observe({
          ...state,
          confirmed: state.confirmed.slice(0, 4),
          pending: phases[4],
        });
        requireEvidence(
          isDeepStrictEqual(checked, { decision: 'record', phase: phases[4], receipt }),
        );
        return { intent: state.intent, receipt };
      });
    },
    advance(operator) {
      return exclusive(async () => {
        guard();
        const state = loadState(journal);
        const n = state.confirmed.length;
        const i = state.intent;
        let inventory;
        let decision = observe(state, null, (rows) => {
          inventory = rows;
        });
        let accessToken;
        // A valid full inventory, local target and journal precede private credential access.
        if (state.pending === null && n >= 4 && n <= 6 && decision.reason === 'actor-conflict') {
          const candidate = n === 5;
          const actorId = candidate ? i.candidateId : i.adminId;
          const email = candidate ? candidateEmail : adminEmail;
          accessToken = await operator.privateSession({ phase: phases[n], id: actorId, email });
          requireEvidence(
            isDeepStrictEqual(state, loadState(journal)) &&
              observe(state).reason === 'actor-conflict',
          );
          const read = await verifiedSession(
            accessToken,
            transport.instructorKeys().publicKey,
            actorId,
            email,
          );
          const evidence = read(Math.floor(Date.now() / 1000));
          requireEvidence(isDeepStrictEqual(state, loadState(journal)));
          decision = observe(state, evidence);
        }
        if (decision.decision === 'complete') return decision;
        if (decision.decision === 'prepare') {
          const phase = decision.phase;
          journal.record('instructor-pending-' + n, { runId: journal.runId, phase });
          const pending = { ...state, pending: phase };
          requireEvidence(
            isDeepStrictEqual(loadState(journal), pending) &&
              isDeepStrictEqual(guard().target, i.target),
          );
          if (n === 1) {
            // Inputs have just passed the strict journal schema. No caller-provided SQL or address.
            const settings = {
              database_system_id: i.target.systemId,
              instance_digest: i.target.instance,
              run_id: i.runId,
              user_id: i.candidateId,
              operation_id: i.candidateCreateId,
              membership_id: i.membershipId,
              attempt_id: i.membershipAttemptId,
            };
            directWrite(i, settings, candidateSql, inventory);
          } else if (n === 0 || n === 2) {
            const candidate = n === 0;
            const id = candidate ? i.candidateId : i.adminId;
            const email = candidate ? candidateEmail : adminEmail;
            const password = await operator.passwordFor(Object.freeze({ id, email }));
            requireEvidence(
              isDeepStrictEqual(loadState(journal), pending) && observe(state).phase === phase,
            );
            await createSubject(
              transport.instructorKeys().serviceKey,
              password,
              id,
              email,
              candidate ? i.candidateCreateId : i.adminCreateId,
            );
          } else if (n === 3) {
            directWrite(
              i,
              {
                schoolid: schoolId,
                userid: i.adminId,
                grantid: i.grantId,
                sourceid: i.grantSourceId,
                correlationid: i.grantCorrelationId,
                system_id: i.target.systemId,
                marker: i.adminCreateId,
              },
              grantSql,
              inventory,
            );
          } else {
            // Same verified bearer is the starting session for the protected
            // workflow. The operator retains its private idempotency key.
            const commands = {
              'protected-admin-onboarding': {
                organizationId: schoolId,
                userId: i.adminId,
                grantId: i.grantId,
                keyHash: i.adminCompleteHash,
              },
              'protected-self-enrollment': {
                organizationId: schoolId,
                userId: i.candidateId,
                membershipId: i.membershipId,
                keyHash: i.enrollmentCompleteHash,
              },
              'protected-role-assignment': {
                action: 'assign_role',
                organizationId: schoolId,
                membershipId: i.membershipId,
                expectedVersion: 1,
                roleCode: 'instructor_pilot',
                reasonCode: 'responsibility_changed',
                keyHash: i.assignmentKeyHash,
              },
            };
            await operator[phase](Object.freeze(commands[phase]), accessToken);
          }
          requireEvidence(isDeepStrictEqual(loadState(journal), pending));
          decision = observe(pending);
        }
        if (decision.decision === 'record') {
          journal.record('instructor-receipt-' + n, {
            runId: i.runId,
            phase: decision.phase,
            receipt: decision.receipt,
          });
          return { decision: 'record', phase: decision.phase };
        }
        requireEvidence(false);
      });
    },
  };
}
