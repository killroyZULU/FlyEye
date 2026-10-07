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
  complete,
  locks,
  snapshot,
  unchangedRoles,
  cleanupSql,
  residueSql,
  signature,
} from './lib/h002-onboarding-fixture.mjs';
import { assertOutcome } from './lib/h002-onboarding-assertions.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('H002 onboarding requires the disposable GitHub Actions database job.');
}
const cleanupProbe = process.argv.includes('--cleanup-probe');
const names = ['observer', 'blocker', 'worker'].map((name) => `h002_onboarding_${name}`);
const [observer, blocker, worker] = names.map(postgresSession);
const blocked = `select exists(select 1 from pg_stat_activity w
  join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
  where w.application_name='h002_onboarding_worker'
  and b.application_name='h002_onboarding_blocker' and w.wait_event_type='Lock');`;
let owned = false;
let injected = false;
let phase = 'preflight';
let stage = 'setup';
let originalRoles;
let adminRole;
let violations = 0;

async function preflight() {
  assert.equal(await observer.query('select count(*) from public.organizations;'), '0');
  assert.equal(
    await observer.query(`select count(*) from auth.users where id=${q('actor')};`),
    '0',
  );
  assert.equal(
    await observer.query(`select count(*) from public.organization_admin_bootstrap_grants
    where id=${q('grant')};`),
    '0',
  );
  originalRoles = await observer.query(unchangedRoles);
  adminRole = await observer.query("select id from public.roles where code='admin' and is_active;");
  assert.match(adminRole, /^[0-9a-f-]{36}$/);
  for (const session of [observer, blocker, worker])
    assert.equal(await session.query('show transaction_isolation;'), 'read committed');
  owned = true;
  phase = 'seed';
  await observer.query(`begin; ${seed} commit;`);
  await worker.query('set role service_role;');
  assert.equal(await worker.query('select current_user;'), 'service_role');
  assert.equal(
    await worker.query(`select has_table_privilege(current_user,
    'public.organization_memberships','INSERT');`),
    'f',
  );
  assert.equal(
    await worker.query(`select has_function_privilege(current_user,'${signature}','EXECUTE');`),
    't',
  );
  for (const role of ['anon', 'authenticated'])
    assert.equal(
      await observer.query(`select has_function_privilege('${role}','${signature}','EXECUTE');`),
      'f',
    );
}

async function run(lock, boundary) {
  stage = `${lock ?? 'direct'}-${boundary}`;
  phase = 'prepare';
  await observer.query(`begin; ${reset} commit;`);
  const start = Number(
    await worker.query('begin; select extract(epoch from transaction_timestamp());'),
  );
  assert.ok(Number.isFinite(start));
  const password =
    Math.floor(start) - (boundary === 'password' ? 596 : boundary === 'stale' ? 601 : 0);
  let deadline;
  if (boundary === 'expiry' || boundary === 'expired') {
    deadline = start + (boundary === 'expiry' ? 4 : -1);
    await observer.query(`update public.organization_admin_bootstrap_grants
      set issued_at=to_timestamp(${deadline})-interval '30 minutes',expires_at=to_timestamp(${deadline})
      where id=${q('grant')};`);
  } else if (boundary === 'password') deadline = password + 600;
  const before = JSON.parse(await observer.query(snapshot));
  if (lock) {
    phase = 'block';
    await blocker.query(`begin; ${locks[lock]}`);
  }
  const pending = worker
    .query(complete(password))
    .then((value) => ({ value: JSON.parse(value) }))
    .catch((error) => ({ error }));
  if (lock) {
    phase = 'observe-worker';
    await waitForSql(observer, blocked);
    if (cleanupProbe) {
      phase = 'inject-observer-failure';
      await observer.query('select 1/0;');
      assert.fail('Observer failure must abort');
    }
    if (deadline) {
      phase = 'cross-boundary';
      // Prove the command reached its lock before expiry, then release only after expiry.
      assert.equal(
        await observer.query(`select clock_timestamp()<to_timestamp(${deadline});`),
        't',
      );
      await waitForSql(
        observer,
        `select clock_timestamp()>to_timestamp(${deadline})+interval '100 milliseconds';`,
      );
      assert.equal(await observer.query(blocked), 't');
    }
    phase = 'release';
    await blocker.query('rollback;');
  }
  phase = 'result';
  const outcome = await pending;
  if (outcome.error) throw outcome.error;
  await worker.query('commit;');
  const result = outcome.value;
  phase = 'assert-state';
  const after = await assertOutcome(observer, result, before, adminRole);
  const expected =
    boundary === 'expiry' || boundary === 'expired'
      ? 'expired'
      : boundary === 'password' || boundary === 'stale'
        ? 'recent_authentication_required'
        : 'completed';
  if (result.decision !== expected) {
    // Characterize every selected schedule, but never let a violation make the gate green.
    violations++;
    process.stdout.write(
      `H002 onboarding: ${stage} violation expected=${expected} actual=${result.decision}.\n`,
    );
  } else process.stdout.write(`H002 onboarding: ${stage} passed.\n`);
  if (boundary === 'control') {
    phase = 'replay';
    const replay = JSON.parse(await worker.query(complete(password)));
    assert.deepEqual(replay, { ...result, decision: 'already_completed' });
    assert.deepEqual(JSON.parse(await observer.query(snapshot)), after);
  }
}

async function cleanup() {
  for (const session of [blocker, worker, observer]) {
    try {
      await session.close();
    } catch (error) {
      process.stderr.write(
        `H002 onboarding failed: phase=close-sessions detail=${failureDetail(error)}.\n`,
      );
      process.exitCode = 1;
    }
  }
  const connection = postgresSession('h002_onboarding_cleanup');
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
        'H002 onboarding cleanup passed: owned rows, users, factors and original sessions absent; existing roles unchanged.\n',
      );
  } catch (error) {
    process.stderr.write(`H002 onboarding failed: phase=cleanup detail=${failureDetail(error)}.\n`);
    process.exitCode = 1;
  } finally {
    try {
      await connection.close();
    } catch (error) {
      process.stderr.write(
        `H002 onboarding failed: phase=close-cleanup detail=${failureDetail(error)}.\n`,
      );
      process.exitCode = 1;
    }
  }
}

try {
  await preflight();
  for (const lock of ['org', 'grant'])
    for (const boundary of ['control', 'expiry', 'password']) await run(lock, boundary);
  for (const boundary of ['expired', 'stale']) await run(null, boundary);
  assert.equal(violations, 0, 'Onboarding completion violated an existing time boundary');
} catch (error) {
  if (
    cleanupProbe &&
    phase === 'inject-observer-failure' &&
    error instanceof H002SqlError &&
    error.sqlState === '22012'
  ) {
    injected = true;
    process.stdout.write('H002 onboarding: controlled observer failure observed.\n');
  } else {
    process.stderr.write(
      `H002 onboarding failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await cleanup();
  if (cleanupProbe && !injected) process.exitCode = 1;
}
