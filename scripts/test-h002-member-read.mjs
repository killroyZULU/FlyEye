import assert from 'node:assert/strict';
import {
  postgresSession,
  waitForSql,
  failureDetail,
  H002SqlError,
} from './lib/h002-postgres-session.mjs';
import { revokeSql } from './lib/h002-review-fixture.mjs';
import {
  ids,
  q,
  scope,
  seed,
  users,
  cases,
  authorities,
  denied,
  reset,
  permissions,
  snapshot,
  setup,
  relation,
  lock,
  command,
  signatures,
  context,
} from './lib/h002-member-read-fixture.mjs';
import { assertRead } from './lib/h002-member-read-assertions.mjs';
import { quiesce } from './lib/h002-registry-implicit-cleanup.mjs';
import { finishCleanup } from './lib/h002-member-read-cleanup.mjs';

if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true')
  throw new Error('Member read waits require the disposable GitHub Actions database.');
const probe = process.argv.includes('--cleanup-probe');
const observer = postgresSession('h002_member_read_observer');
const names = ['blocker', 'worker'].map((name) => `h002_member_read_${name}`);
let owned = false,
  safe = true,
  originalPermissions;
let stage = 'setup',
  phase = 'preflight',
  injected = false,
  passed = 0;
const snap = (session = observer) => session.query(snapshot).then(JSON.parse);
function pending(session, sql) {
  const state = { done: false };
  state.result = session
    .query(sql)
    .then(
      (value) => ({ value: JSON.parse(value) }),
      (error) => ({ error }),
    )
    .then((result) => {
      state.done = true;
      return result;
    });
  return state;
}
async function valueOf(task) {
  const result = await task.result;
  if (result.error) throw result.error;
  return result.value;
}
const blocked = (waiter, holder) => `select exists(select 1 from pg_stat_activity w
  join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
  where w.application_name='h002_member_read_${waiter}'
  and b.application_name='h002_member_read_${holder}' and w.wait_event_type='Lock');`;
async function closeCase(sessions, tasks) {
  safe = false;
  await quiesce(
    sessions,
    tasks,
    (sql) => observer.query(sql),
    `select count(*) from pg_stat_activity where application_name in (${names.map((name) => `'${name}'`).join(',')});`,
  );
  await observer.query(`begin; ${reset} commit;`);
  assert.equal(
    await observer.query(`select
    (select count(*) from public.member_administration_events where ${scope})+
    (select count(*) from public.aircraft_document_events where ${scope})+
    (select count(*) from public.aircraft_documents where ${scope})+
    (select count(*) from public.organization_member_profiles where ${scope}
      and (version<>1 or display_name is not null or contact_number is not null));`),
    '0',
  );
  assert.equal(await observer.query(permissions), originalPermissions);
  safe = true;
}
async function runCase(test, authority) {
  stage = `${test.name}-${authority}`;
  phase = 'prepare';
  await observer.query(`begin; ${reset} ${setup(test, authority)} commit;`);
  let expected = await snap();
  const readContext = JSON.parse(await observer.query(context));
  const [blocker, worker] = names.map(postgresSession);
  const tasks = [];
  let result,
    committed = false;
  try {
    for (const session of [worker]) await session.query('set role service_role;');
    phase = 'block';
    await blocker.query(`begin; ${lock(test)}`);
    const work = pending(worker, command(test));
    tasks.push(work);
    phase = 'observe-worker';
    await waitForSql(observer, blocked('worker', 'blocker'));
    if (relation(test))
      assert.equal(
        await observer.query(`select exists(select 1 from pg_locks l
      join pg_stat_activity a on a.pid=l.pid where a.application_name='h002_member_read_worker'
      and l.relation='public.${relation(test)}'::regclass and l.mode='RowExclusiveLock' and not l.granted);`),
        't',
      );
    if (probe) {
      phase = 'inject-observer-failure';
      const failing = postgresSession('h002_member_read_probe');
      try {
        await failing.query('select 1/0;');
      } finally {
        await failing.close();
      }
      assert.fail('Expected controlled observer failure');
    }
    if (denied(authority)) {
      phase = 'revoke';
      const revoked = JSON.parse(
        await blocker.query(`set local role service_role; ${revokeSql(authority)}`),
      );
      assert.equal(revoked.decision, authority === 'membership' ? 'revoked' : 'changed');
      await blocker.query('reset role;');
      expected = await snap(blocker);
      // The snapshot is precommit. COMMIT must succeed before observing the result.
      phase = 'commit-revocation';
      await blocker.query('commit;');
      committed = true;
    } else await blocker.query('rollback;');
    phase = 'result';
    result = await valueOf(work);
    phase = 'assert-state';
    const after = await snap();
    if (denied(authority)) {
      const membership = after.organization_memberships.find((row) => row.id === ids.member);
      assert.equal(membership.status, authority === 'membership' ? 'revoked' : 'active');
      assert.equal(membership.version, 2);
      const revoked = expected.member_administration_events;
      assert.equal(revoked.length, 1);
      assert.equal(revoked[0].actor_user_id, ids.admin);
      assert.equal(revoked[0].target_membership_id, ids.member);
      assert.equal(
        revoked[0].event_name,
        authority === 'membership' ? 'member_status.revoked' : 'member_role.changed',
      );
      assert.equal(revoked[0].outcome, 'success');
      assert.equal(
        await observer.query(
          `select public.member_administration_actor_is_authorized(${q('actor')},${q('org')},'membership.member.review');`,
        ),
        'f',
      );
    }
    assertRead(test, result, expected, after, denied(authority), readContext);
    phase = 'assert-retry';
    const retry = JSON.parse(await worker.query(command(test)));
    assertRead(test, retry, after, await snap(), denied(authority), readContext);
    passed++;
    process.stdout.write(
      `H002 member read: ${stage} ${denied(authority) ? 'denied-after-revocation' : 'authorized-control'}.\n`,
    );
  } catch (error) {
    if (
      probe &&
      phase === 'inject-observer-failure' &&
      error instanceof H002SqlError &&
      error.sqlState === '22012'
    ) {
      injected = true;
      process.stdout.write('H002 member read: controlled observer failure observed.\n');
    } else if (error?.code === 'ERR_ASSERTION') {
      const decision = ['listed', 'found', 'not_found', 'unauthorized', 'state_conflict'].includes(
        result?.decision,
      )
        ? result.decision
        : 'other';
      process.stderr.write(
        `H002 member read failed: case=${stage} phase=${phase} detail=assertion decision=${decision} ordering=${committed ? 'revocation-committed' : 'not-established'} evidence=${['rollback', 'response-after-verified-rollback'].includes(error.evidence) ? error.evidence : 'other'}.\n`,
      );
      process.exitCode = 1;
    } else throw error;
  } finally {
    phase = 'case-cleanup';
    await closeCase([blocker, worker], tasks);
  }
}
try {
  assert.equal(await observer.query('select count(*) from public.organizations;'), '0');
  assert.equal(
    await observer.query(`select count(*) from auth.users where id in (${users});`),
    '0',
  );
  assert.equal(
    await observer.query(`select count(*) from public.aircraft_records where id=${q('aircraft')};`),
    '0',
  );
  assert.equal(await observer.query('show transaction_isolation;'), 'read committed');
  originalPermissions = await observer.query(permissions);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const signature of signatures)
      assert.equal(
        await observer.query(`select has_function_privilege('${role}','${signature}','EXECUTE');`),
        role === 'service_role' ? 't' : 'f',
      );
    assert.equal(
      await observer.query(
        `select has_table_privilege('${role}','public.organization_memberships','SELECT');`,
      ),
      'f',
    );
  }
  owned = true;
  await observer.query(`begin; ${seed} commit;`);
  for (const test of probe ? [cases[0]] : cases)
    for (const authority of probe ? ['retained'] : authorities(test))
      await runCase(test, authority);
  phase = 'matrix-summary';
  if (probe) assert.equal(injected, true);
  else assert.equal(passed, 33);
} catch (error) {
  process.stderr.write(
    `H002 member read failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
  );
  process.exitCode = 1;
} finally {
  await observer.close().catch(() => {
    safe = false;
    process.exitCode = 1;
  });
  const cleaner = postgresSession('h002_member_read_cleanup');
  let cleaned = false;
  try {
    cleaned = await finishCleanup(cleaner, { owned, safe, originalPermissions });
  } catch (error) {
    process.stderr.write(
      `H002 member read failed: phase=final-owned-cleanup detail=${failureDetail(error)} cleanup-unverified.\n`,
    );
    process.exitCode = 1;
  } finally {
    await cleaner.close().catch(() => {
      cleaned = false;
      process.exitCode = 1;
    });
  }
  if (cleaned)
    process.stdout.write(
      'H002 member read cleanup passed: fixture rows, users and sessions absent; permissions unchanged.\n',
    );
}
