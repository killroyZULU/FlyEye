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
  accept,
  snapshot,
  unchangedRoles,
  cleanupSql,
  residueSql,
} from './lib/h002-acceptance-fixture.mjs';
import { cases, negatives } from './lib/h002-acceptance-cases.mjs';
import { assertAcceptance } from './lib/h002-acceptance-assertions.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('H002 acceptance requires the disposable GitHub Actions database job.');
}
const cleanupProbe = process.argv.includes('--cleanup-probe');
const names = ['observer', 'blocker', 'worker', 'peer'].map((name) => `h002_acceptance_${name}`);
const [observer, blocker, worker, peer] = names.map(postgresSession);
let owned = false;
let injected = false;
let phase = 'preflight';
let stage = 'setup';
let originalRoles;
const blocked = (waiter, holder) => `select exists(select 1 from pg_stat_activity w
  join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
  where w.application_name='h002_acceptance_${waiter}'
  and b.application_name='h002_acceptance_${holder}' and w.wait_event_type='Lock');`;
// Attach rejection handling immediately, including when another session is being observed.
function pending(session, sql) {
  return session
    .query(sql)
    .then((value) => ({ value: JSON.parse(value) }))
    .catch((error) => ({ error }));
}
async function valueOf(task) {
  const result = await task;
  if (result.error) throw result.error;
  return result.value;
}
async function prepare(test) {
  stage = test.name;
  phase = 'prepare';
  await observer.query(`begin; ${reset} ${test.setup ?? ''} commit;`);
  return JSON.parse(await observer.query(snapshot));
}
async function race(test) {
  const before = await prepare(test);
  phase = 'block';
  await blocker.query(`begin; ${test.lock}`);
  const work = pending(worker, accept());
  phase = 'observe-worker';
  await waitForSql(observer, blocked('worker', 'blocker'));
  if (cleanupProbe) {
    phase = 'inject-observer-failure';
    await observer.query('select 1/0;');
    assert.fail('Observer failure must abort');
  }
  let competing;
  if (test.peer) {
    competing = pending(peer, test.peer);
    phase = 'observe-peer';
    await waitForSql(observer, blocked('peer', 'worker'));
  }
  phase = 'release';
  if (test.change) {
    const change = await blocker.query(test.change);
    if (test.changeDecision) assert.equal(JSON.parse(change).decision, test.changeDecision);
    await blocker.query('commit;');
  } else await blocker.query('rollback;');
  phase = 'result';
  const result = await valueOf(work);
  if (competing) {
    const other = await valueOf(competing);
    assert.equal(other.decision, test.peerDecision);
    if (test.replay) assert.deepEqual(other, { ...result, replayed: true });
  }
  phase = 'assert-state';
  await assertAcceptance(observer, test, result, before);
}
async function afterAcceptance(test) {
  const before = await prepare(test);
  phase = 'accept-in-transaction';
  await worker.query('begin;');
  const result = await valueOf(pending(worker, accept()));
  phase = 'observe-role-change';
  const change = pending(blocker, `begin; ${test.afterAccept} select '{}'::json;`);
  await waitForSql(observer, blocked('blocker', 'worker'));
  await worker.query('commit;');
  await valueOf(change);
  await blocker.query('commit;');
  phase = 'assert-state';
  await assertAcceptance(observer, test, result, before);
}
async function negative(test) {
  const before = await prepare(test);
  phase = 'negative-result';
  const result = await valueOf(pending(worker, test.sql ?? accept()));
  await assertAcceptance(observer, test, result, before);
}
async function preflight() {
  assert.equal(await observer.query('select count(*) from public.organizations;'), '0');
  assert.equal(
    await observer.query(`select count(*) from auth.users where id in (${users});`),
    '0',
  );
  assert.equal(
    await observer.query(`select count(*) from public.roles
    where id=${q('role')} or code='h002_acceptance_synthetic';`),
    '0',
  );
  for (const session of [observer, blocker, worker, peer])
    assert.equal(await session.query('show transaction_isolation;'), 'read committed');
  originalRoles = await observer.query(unchangedRoles);
  owned = true;
  phase = 'seed';
  await observer.query(`begin; ${seed} commit;`);
  for (const session of [worker, peer]) {
    await session.query('set role service_role;');
    assert.equal(await session.query('select current_user;'), 'service_role');
    assert.equal(
      await session.query(`select has_table_privilege(current_user,
      'public.organization_memberships','INSERT');`),
      'f',
    );
    assert.equal(
      await session.query(`select has_function_privilege(current_user,
      'public.accept_member_invitation(uuid,text,bigint,uuid,bigint,text,uuid)','EXECUTE');`),
      't',
    );
  }
  for (const role of ['anon', 'authenticated'])
    assert.equal(
      await observer.query(`select has_function_privilege('${role}',
      'public.accept_member_invitation(uuid,text,bigint,uuid,bigint,text,uuid)','EXECUTE');`),
      'f',
    );
}
async function cleanup() {
  for (const session of [blocker, worker, peer, observer]) {
    try {
      await session.close();
    } catch (error) {
      process.stderr.write(
        `H002 acceptance failed: phase=close-sessions detail=${failureDetail(error)}.\n`,
      );
      process.exitCode = 1;
    }
  }
  const connection = postgresSession('h002_acceptance_cleanup');
  try {
    if (owned) {
      await connection.query(`begin; ${cleanupSql} commit;`);
      assert.equal(await connection.query(residueSql), '0');
      assert.equal(await connection.query(unchangedRoles), originalRoles);
    }
    assert.equal(
      await connection.query(`select count(*) from pg_stat_activity
      where application_name in (${names.map((name) => `'${name}'`).join(',')});`),
      '0',
    );
    if (owned)
      process.stdout.write(
        'H002 acceptance cleanup passed: owned rows, users, roles and original sessions absent; existing roles unchanged.\n',
      );
  } catch (error) {
    process.stderr.write(`H002 acceptance failed: phase=cleanup detail=${failureDetail(error)}.\n`);
    process.exitCode = 1;
  } finally {
    try {
      await connection.close();
    } catch (error) {
      process.stderr.write(
        `H002 acceptance failed: phase=close-cleanup detail=${failureDetail(error)}.\n`,
      );
      process.exitCode = 1;
    }
  }
}
try {
  await preflight();
  for (const test of cases) {
    if (test.afterAccept) await afterAcceptance(test);
    else await race(test);
    process.stdout.write(`H002 acceptance: ${test.name} passed.\n`);
  }
  for (const test of negatives) {
    await negative(test);
    process.stdout.write(`H002 acceptance: ${test.name} passed.\n`);
  }
} catch (error) {
  if (
    cleanupProbe &&
    phase === 'inject-observer-failure' &&
    error instanceof H002SqlError &&
    error.sqlState === '22012'
  ) {
    injected = true;
    process.stdout.write('H002 acceptance: controlled observer failure observed.\n');
  } else {
    process.stderr.write(
      `H002 acceptance failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await cleanup();
  if (cleanupProbe && !injected) process.exitCode = 1;
}
