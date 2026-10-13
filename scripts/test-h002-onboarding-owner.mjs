import assert from 'node:assert/strict';
import {
  postgresSession,
  waitForSql,
  failureDetail,
  H002SqlError,
} from './lib/h002-postgres-session.mjs';
import {
  q,
  seed,
  reset,
  snapshot,
  unchangedRoles,
  cleanupSql,
  residueSql,
  signature as completeSignature,
} from './lib/h002-onboarding-fixture.mjs';
import { signature as startSignature } from './lib/h002-onboarding-start-assertions.mjs';
import { signature as cancelSignature } from './lib/h002-cancellation-assertions.mjs';
import { cases } from './lib/h002-onboarding-owner-cases.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('H002 ownership requires the disposable GitHub Actions database job.');
}
const cleanupProbe = process.argv.includes('--cleanup-probe');
const names = ['observer', 'leader', 'worker'].map((name) => `h002_owner_${name}`);
const [observer, leader, worker] = names.map(postgresSession);
const tasks = [];
const bothActors = `actor_subject_id in (${q('actor')},${q('session')})`;
const ownerSnapshot = snapshot.replace(`actor_subject_id=${q('actor')}`, bothActors);
const outsiderResidue = `select
  (select count(*) from auth.users where id=${q('session')})+
  (select count(*) from auth.sessions where user_id=${q('session')})+
  (select count(*) from auth.mfa_factors where user_id=${q('session')})+
  (select count(*) from public.authentication_events where actor_subject_id=${q('session')});`;
let owned = false;
let injected = false;
let phase = 'preflight';
let stage = 'setup';
let originalRoles;
let adminRole;
const json = async (session, sql) => JSON.parse(await session.query(sql));
const read = (session = observer) => json(session, ownerSnapshot);

async function preflight() {
  assert.equal(await observer.query('select count(*) from public.organizations;'), '0');
  assert.equal(await observer.query(residueSql), '0');
  assert.equal(await observer.query(outsiderResidue), '0');
  originalRoles = await observer.query(unchangedRoles);
  adminRole = await observer.query("select id from public.roles where code='admin' and is_active;");
  assert.match(adminRole, /^[0-9a-f-]{36}$/);
  for (const session of [observer, leader, worker])
    assert.equal(await session.query('show transaction_isolation;'), 'read committed');
  for (const signature of [startSignature, completeSignature, cancelSignature])
    for (const role of ['anon', 'authenticated', 'service_role'])
      assert.equal(
        await observer.query(`select has_function_privilege('${role}','${signature}','EXECUTE');`),
        role === 'service_role' ? 't' : 'f',
      );
  for (const role of ['anon', 'authenticated', 'service_role'])
    for (const table of ['organization_admin_bootstrap_grants', 'organization_memberships'])
      for (const operation of ['INSERT', 'UPDATE', 'DELETE'])
        assert.equal(
          await observer.query(
            `select has_table_privilege('${role}','public.${table}','${operation}');`,
          ),
          'f',
        );
  owned = true;
  phase = 'seed';
  await observer.query(`begin; ${seed}
    insert into auth.users(id,email,email_confirmed_at)
    values(${q('session')},'h002-owner-outsider@example.test',now()); commit;`);
  await worker.query('set role service_role;');
  assert.equal(await worker.query('select current_user;'), 'service_role');
}

const harness = {
  observer,
  leader,
  worker,
  json,
  read,
  get adminRole() {
    return adminRole;
  },
  pending(sql) {
    const task = worker
      .query(sql)
      .then((value) => ({ value: JSON.parse(value) }))
      .catch((error) => ({ error }));
    tasks.push(task);
    return task;
  },
  async value(task) {
    const result = await task;
    if (result.error) throw result.error;
    return result.value;
  },
  async observe() {
    phase = 'observe-worker';
    await waitForSql(
      observer,
      `select exists(select 1 from pg_stat_activity w
      join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
      where w.application_name='h002_owner_worker' and b.application_name='h002_owner_leader'
      and w.wait_event_type='Lock');`,
    );
    if (cleanupProbe) {
      phase = 'inject-observer-failure';
      await observer.query('select 1/0;');
      assert.fail('Observer failure must abort');
    }
    phase = 'owner-change-and-result';
  },
};

async function cleanup() {
  let passed = true;
  for (const session of [leader, worker, observer]) {
    try {
      await session.close();
    } catch (error) {
      passed = false;
      process.stderr.write(
        `H002 ownership failed: phase=close-sessions detail=${failureDetail(error)}.\n`,
      );
    }
  }
  await Promise.all(tasks);
  const connection = postgresSession('h002_owner_cleanup');
  try {
    if (owned) {
      await connection.query(`begin;
        delete from public.authentication_events where actor_subject_id=${q('session')};
        ${cleanupSql} delete from auth.users where id=${q('session')}; commit;`);
      assert.equal(await connection.query(residueSql), '0');
      assert.equal(await connection.query(outsiderResidue), '0');
      assert.equal(await connection.query(unchangedRoles), originalRoles);
    }
    assert.equal(
      await connection.query(`select count(*) from pg_stat_activity
      where application_name in (${names.map((name) => `'${name}'`).join(',')});`),
      '0',
    );
  } catch (error) {
    passed = false;
    process.stderr.write(`H002 ownership failed: phase=cleanup detail=${failureDetail(error)}.\n`);
  } finally {
    try {
      await connection.close();
    } catch (error) {
      passed = false;
      process.stderr.write(
        `H002 ownership failed: phase=close-cleanup detail=${failureDetail(error)}.\n`,
      );
    }
  }
  if (!passed) process.exitCode = 1;
  else if (owned)
    process.stdout.write(
      'H002 ownership cleanup passed: owned rows/Auth records and sessions absent; roles/permissions unchanged.\n',
    );
}

try {
  await preflight();
  for (const [name, execute] of cases) {
    stage = name;
    phase = 'prepare';
    await observer.query(`begin; ${reset}
      delete from public.authentication_events where actor_subject_id=${q('session')}; commit;`);
    await execute(harness);
    process.stdout.write(`H002 ownership: ${name} passed.\n`);
  }
} catch (error) {
  if (
    cleanupProbe &&
    phase === 'inject-observer-failure' &&
    error instanceof H002SqlError &&
    error.sqlState === '22012'
  ) {
    injected = true;
    process.stdout.write('H002 ownership: controlled observer failure observed.\n');
  } else {
    process.stderr.write(
      `H002 ownership failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await cleanup();
  if (cleanupProbe && !injected) process.exitCode = 1;
}
