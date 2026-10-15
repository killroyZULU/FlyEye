import assert from 'node:assert/strict';
import {
  postgresSession,
  waitForSql,
  failureDetail,
  H002SqlError,
} from './lib/h002-postgres-session.mjs';
import {
  q,
  users,
  seed,
  reset,
  unchangedRoles,
  cleanupSql,
  residueSql,
} from './lib/h002-acceptance-fixture.mjs';
import { cases, command, setup, competing, expectedDecision } from './lib/h002-recipient-cases.mjs';
import {
  changes,
  snapshot,
  resetIdentity,
  spareUser,
  spareMember,
  auditProbe,
  dropProbe,
  cleanCase,
} from './lib/h002-recipient-fixture.mjs';
import { assertRecipient } from './lib/h002-recipient-assertions.mjs';

if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Recipient concurrency requires the disposable GitHub Actions database.');
}
const probe = process.argv.includes('--cleanup-probe');
const observer = postgresSession('h002_recipient_observer');
const names = ['blocker', 'peer', 'worker'].map((name) => `h002_recipient_${name}`);
let owned = false;
let originalRoles;
let stage = 'preflight';
let phase = 'setup';
let injected = false;
const pending = (session, sql) =>
  session.query(sql).then(
    (value) => ({ value: JSON.parse(value) }),
    (error) => ({ error }),
  );
async function valueOf(task) {
  const result = await task;
  if (result.error) throw result.error;
  return result.value;
}
const blocked = (waiter, holder) => `select exists(select 1 from pg_stat_activity w
  join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
  where w.application_name='h002_recipient_${waiter}'
  and b.application_name='h002_recipient_${holder}' and w.wait_event_type='Lock');`;
const snap = (session = observer) => session.query(snapshot).then(JSON.parse);

async function closeCase(sessions, tasks, test) {
  // Close holders together before waiting for workers; EOF rolls back open fixture transactions.
  const closed = await Promise.allSettled(sessions.map((session) => session.close()));
  const settled = await Promise.allSettled(tasks);
  const unexpected = settled.filter(
    (entry) =>
      entry.status === 'rejected' ||
      (entry.value.error &&
        !(
          test.auditFails &&
          entry.value.error instanceof H002SqlError &&
          entry.value.error.sqlState === '23514'
        )),
  );
  assert.ok(closed.every((result) => result.status === 'fulfilled'));
  assert.equal(
    await observer.query(`select count(*) from pg_stat_activity
    where application_name in (${names.map((name) => `'${name}'`).join(',')});`),
    '0',
  );
  await observer.query(`begin; ${reset} ${resetIdentity} commit;`);
  assert.equal(await observer.query(cleanCase), '0');
  assert.equal(await observer.query(unchangedRoles), originalRoles);
  if (unexpected.length) throw new Error('Recipient worker did not settle safely.');
}

async function runCase(test) {
  stage = test.name;
  phase = 'prepare';
  await observer.query(`begin; ${reset} ${resetIdentity} ${setup(test)} commit;`);
  const before = await snap();
  const [blocker, peer, worker] = names.map(postgresSession);
  const tasks = [];
  let result;
  let after;
  let peerState;
  let passed = true;
  try {
    await worker.query('set role service_role;');
    if (test.auditFails)
      await worker.query(
        `set flyeye.recipient_reject_event='member_invitation.${test.auditFails}';`,
      );
    phase = 'block';
    if (test.lock) await blocker.query(`begin; ${test.lock}`);
    if (test.kind === 'identity') await blocker.query(changes[test.change]);
    if (['insert', 'reassign'].includes(test.kind)) {
      await peer.query(`begin; ${competing(test)}`);
      peerState = await snap(peer);
    }
    const work = pending(worker, command(test));
    tasks.push(work);
    if (test.lock || ['insert', 'reassign'].includes(test.kind)) {
      phase =
        test.kind === 'insert'
          ? 'observe-organization-fk'
          : test.kind === 'reassign'
            ? 'observe-recipient-unique'
            : 'observe-identity-or-domain';
      await waitForSql(observer, blocked('worker', test.lock ? 'blocker' : 'peer'));
      if (probe) {
        phase = 'inject-observer-failure';
        const failingObserver = postgresSession('h002_recipient_probe');
        try {
          await failingObserver.query('select 1/0;');
        } finally {
          await failingObserver.close();
        }
        assert.fail('Expected controlled observer failure');
      }
    }
    let change;
    if (test.kind === 'command') {
      phase = 'observe-auth-update';
      change = pending(peer, `begin; ${changes.email} select '{}'::json;`);
      tasks.push(change);
      await waitForSql(observer, blocked('peer', 'worker'));
    }
    phase = 'release';
    if (test.lock)
      await blocker.query(test.kind === 'identity' && test.commit ? 'commit;' : 'rollback;');
    if (['insert', 'reassign'].includes(test.kind))
      await peer.query(test.commit ? 'commit;' : 'rollback;');
    result = await work;
    if (
      result.error &&
      !(
        test.auditFails &&
        result.error instanceof H002SqlError &&
        result.error.sqlState === '23514'
      )
    )
      throw result.error;
    if (change) {
      await valueOf(change);
      await peer.query('commit;');
    }
    phase = 'assert-state';
    after = await snap();
    await assertRecipient(test, result, before, after, peerState);
  } catch (error) {
    if (
      probe &&
      phase === 'inject-observer-failure' &&
      error instanceof H002SqlError &&
      error.sqlState === '22012'
    ) {
      injected = true;
      process.stdout.write('H002 recipient: controlled observer failure observed.\n');
    } else if (error?.code === 'ERR_ASSERTION') {
      passed = false;
      const decision = ['accepted', 'prepared', 'not_available', 'conflict'].includes(
        result?.value?.decision,
      )
        ? result.value.decision
        : 'none';
      process.stderr.write(
        `H002 recipient failed: case=${stage} phase=${phase} detail=assertion decision=${decision} expected=${expectedDecision(test)} audit-count=${after?.events?.length ?? 0}.\n`,
      );
      process.exitCode = 1;
    } else throw error;
  } finally {
    phase = 'case-cleanup';
    await closeCase([blocker, peer, worker], tasks, test);
  }
  return passed;
}

async function preflight() {
  assert.equal(await observer.query('select count(*) from public.organizations;'), '0');
  assert.equal(
    await observer.query(`select count(*) from auth.users where id in (${users},${spareUser});`),
    '0',
  );
  assert.equal(
    await observer.query(
      `select count(*) from public.roles where id=${q('role')} or code='h002_acceptance_synthetic';`,
    ),
    '0',
  );
  assert.equal(
    await observer.query("select to_regprocedure('public.h002_recipient_audit_probe()') is null;"),
    't',
  );
  assert.equal(await observer.query('show transaction_isolation;'), 'read committed');
  assert.equal(
    await observer.query(
      "select count(*) from pg_trigger where tgrelid='public.member_invitation_events'::regclass and tgname='h002_recipient_audit_probe';",
    ),
    '0',
  );
  originalRoles = await observer.query(unchangedRoles);
  owned = true;
  await observer.query(`begin; ${seed}
    insert into auth.users(id,email,email_confirmed_at) values(${spareUser},'h002-spare@example.test',now());
    ${auditProbe} commit;`);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const allowed = role === 'service_role' ? 't' : 'f';
    for (const signature of [
      'accept_member_invitation(uuid,text,bigint,uuid,bigint,text,uuid)',
      'prepare_member_invitation_acceptance(uuid,text,uuid,bigint,uuid)',
    ]) {
      assert.equal(
        await observer.query(
          `select has_function_privilege('${role}','public.${signature}','EXECUTE');`,
        ),
        allowed,
      );
    }
    assert.equal(
      await observer.query(
        `select has_table_privilege('${role}','public.organization_memberships','INSERT');`,
      ),
      'f',
    );
  }
}

try {
  await preflight();
  const selected = probe
    ? [cases.find((item) => item.kind === 'identity' && item.action === 'accept')]
    : process.argv.includes('--baseline')
      ? cases.filter((item) => ['stale', 'insert', 'reassign'].includes(item.kind))
      : cases;
  for (const test of selected) {
    const passed = await runCase(test);
    // A success line is only valid when that case's assertion and cleanup passed.
    if (passed) process.stdout.write(`H002 recipient: ${test.name} passed.\n`);
  }
} catch (error) {
  process.stderr.write(
    `H002 recipient failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
  );
  process.exitCode = 1;
} finally {
  await cleanFixture();
}

async function cleanFixture() {
  const cleanupFailures = [];
  const attempt = async (operation) => {
    try {
      await operation();
    } catch (error) {
      cleanupFailures.push(error);
    }
  };
  const withCleanup = async (suffix, operation) => {
    const session = postgresSession(`h002_recipient_cleanup_${suffix}`);
    try {
      await operation(session);
    } finally {
      await session.close();
    }
  };
  try {
    await attempt(() => observer.close());
    if (owned) {
      // Separate connections let every cleanup stage run after another stage fails.
      await attempt(() => withCleanup('probe', (session) => session.query(dropProbe)));
      await attempt(() =>
        withCleanup('rows', (session) =>
          session.query(
            `begin; ${cleanupSql} delete from auth.users where id=${spareUser}; commit;`,
          ),
        ),
      );
      await attempt(() =>
        withCleanup('verify', async (session) => {
          assert.equal(await session.query(residueSql), '0');
          assert.equal(
            await session.query(`select (select count(*) from auth.users where id=${spareUser})
        +(select count(*) from public.organization_memberships where id=${spareMember});`),
            '0',
          );
          assert.equal(await session.query(unchangedRoles), originalRoles);
          assert.equal(
            await session.query(
              "select to_regprocedure('public.h002_recipient_audit_probe()') is null;",
            ),
            't',
          );
          assert.equal(
            await session.query(
              "select count(*) from pg_trigger where tgname='h002_recipient_audit_probe';",
            ),
            '0',
          );
          assert.equal(
            await session.query(
              "select count(*) from pg_stat_activity where application_name like 'h002_recipient_%' and pid<>pg_backend_pid();",
            ),
            '0',
          );
        }),
      );
      if (cleanupFailures.length) throw cleanupFailures[0];
      process.stdout.write(
        'H002 recipient cleanup passed: owned domain/Auth/probe rows absent; existing roles unchanged.\n',
      );
    }
    if (cleanupFailures.length) throw cleanupFailures[0];
  } catch (error) {
    process.stderr.write(`H002 recipient failed: phase=cleanup detail=${failureDetail(error)}.\n`);
    process.exitCode = 1;
  }
  if (probe && !injected) process.exitCode = 1;
}
