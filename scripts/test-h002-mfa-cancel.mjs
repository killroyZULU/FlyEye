import assert from 'node:assert/strict';
import {
  postgresSession,
  waitForSql,
  failureDetail,
  H002SqlError,
} from './lib/h002-postgres-session.mjs';
import {
  seed,
  reset,
  snapshot,
  signatures,
  permissions,
  cleanupSql,
  residueSql,
} from './lib/h002-mfa-cancel-fixture.mjs';
import { cases } from './lib/h002-mfa-cancel-cases.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('H002 MFA cancellation requires the disposable GitHub Actions database job.');
}
const cleanupProbe = process.argv.includes('--cleanup-probe');
const sessions = [];
const tasks = [];
let owned = false;
let injected = false;
let closeFailed = false;
let phase = 'preflight';
let stage = 'setup';
let originalPermissions;
function connect(label) {
  const name = `h002_mfa_cancel_${label}_${sessions.length}`;
  const connection = postgresSession(name);
  sessions.push({ name, connection });
  return { name, connection };
}
const { connection: observer } = connect('observer');
const json = async (session, sql) => JSON.parse(await session.query(sql));
function pending(session, sql) {
  const result = session
    .query(sql)
    .then((value) => ({ value: JSON.parse(value) }))
    .catch((error) => ({ error }));
  tasks.push(result);
  return { result };
}
async function value(task) {
  const result = await task.result;
  if (result.error) throw result.error;
  return result.value;
}
async function preflight() {
  assert.equal(await observer.query('select count(*) from public.organizations;'), '0');
  assert.equal(await observer.query(residueSql), '0');
  assert.equal(
    await observer.query(
      "select count(*) from pg_constraint where conname='h002_mfa_cancel_audit_fault';",
    ),
    '0',
  );
  originalPermissions = await observer.query(permissions);
  for (const signature of signatures) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(
        await observer.query(`select has_function_privilege('${role}','${signature}','EXECUTE');`),
        role === 'service_role' ? 't' : 'f',
      );
    }
  }
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['member_mfa_enrollment_operations', 'member_mfa_readiness']) {
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
        assert.equal(
          await observer.query(
            `select has_table_privilege('${role}','public.${table}','${privilege}');`,
          ),
          'f',
        );
      }
    }
  }
  owned = true;
  phase = 'seed';
  await observer.query(`begin; ${seed} commit;`);
}
async function run(name, execute) {
  stage = name;
  phase = 'prepare';
  await observer.query(`begin; ${reset} commit;`);
  const owner = connect('leader');
  const waiter = connect('worker');
  for (const { connection } of [owner, waiter]) {
    assert.equal(await connection.query('show transaction_isolation;'), 'read committed');
    await connection.query('set role service_role;');
    assert.equal(await connection.query('select current_user;'), 'service_role');
  }
  await execute({
    observer,
    leader: owner.connection,
    worker: waiter.connection,
    json,
    pending,
    value,
    async captureLeader() {
      const state = await json(owner.connection, `reset role; ${snapshot}`);
      await owner.connection.query('set role service_role;');
      return state;
    },
    async observe() {
      phase = 'observe-worker';
      await waitForSql(
        observer,
        `select exists(select 1 from pg_stat_activity w
        join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
        where w.application_name='${waiter.name}' and b.application_name='${owner.name}'
        and w.wait_event_type='Lock');`,
      );
      if (cleanupProbe) {
        phase = 'inject-observer-failure';
        await observer.query('select 1/0;');
        assert.fail('Observer failure must abort');
      }
      phase = 'result-and-state';
    },
  });
  try {
    await owner.connection.close();
    await waiter.connection.close();
  } catch (error) {
    closeFailed = true;
    throw error;
  }
  process.stdout.write(`H002 MFA cancellation: ${name} passed.\n`);
}
async function cleanup() {
  let passed = !closeFailed;
  // Release lock owners first, then settle waiters before deleting owned rows.
  const ordered = ['_leader_', '_worker_', '_observer_'].flatMap((kind) =>
    sessions.filter(({ name }) => name.includes(kind)),
  );
  for (const { connection } of ordered) {
    try {
      await connection.close();
    } catch (error) {
      process.stderr.write(
        `H002 MFA cancellation failed: phase=close-sessions detail=${failureDetail(error)}.\n`,
      );
      process.exitCode = 1;
      passed = false;
    }
  }
  await Promise.all(tasks);
  const connection = postgresSession('h002_mfa_cancel_cleanup');
  try {
    assert.equal(
      await connection.query(
        "select count(*) from pg_constraint where conname='h002_mfa_cancel_audit_fault';",
      ),
      '0',
    );
    if (owned) {
      await connection.query(`begin; ${cleanupSql} commit;`);
      assert.equal(await connection.query(residueSql), '0');
      assert.equal(await connection.query(permissions), originalPermissions);
    }
    assert.equal(
      await connection.query(
        `select count(*) from pg_stat_activity where application_name in (${sessions.map(({ name }) => `'${name}'`).join(',')});`,
      ),
      '0',
    );
  } catch (error) {
    process.stderr.write(
      `H002 MFA cancellation failed: phase=cleanup detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
    passed = false;
  } finally {
    try {
      await connection.close();
    } catch (error) {
      process.stderr.write(
        `H002 MFA cancellation failed: phase=close-cleanup detail=${failureDetail(error)}.\n`,
      );
      process.exitCode = 1;
      passed = false;
    }
  }
  if (owned && passed)
    process.stdout.write(
      'H002 MFA cancellation cleanup passed: owned rows/Auth records and sessions absent; roles/permissions unchanged; audit fault absent.\n',
    );
}
try {
  await preflight();
  for (const [name, execute] of cases) await run(name, execute);
} catch (error) {
  if (
    cleanupProbe &&
    phase === 'inject-observer-failure' &&
    error instanceof H002SqlError &&
    error.sqlState === '22012'
  ) {
    injected = true;
    process.stdout.write('H002 MFA cancellation: controlled observer failure observed.\n');
  } else {
    process.stderr.write(
      `H002 MFA cancellation failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await cleanup();
  if (cleanupProbe && !injected) process.exitCode = 1;
}
