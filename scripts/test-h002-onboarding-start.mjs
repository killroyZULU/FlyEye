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
  locks,
  snapshot,
  unchangedRoles,
  cleanupSql,
  residueSql,
} from './lib/h002-onboarding-fixture.mjs';
import { assertOutcome, start, signature } from './lib/h002-onboarding-start-assertions.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('H002 onboarding start requires the disposable GitHub Actions database job.');
}
const cleanupProbe = process.argv.includes('--cleanup-probe');
const names = ['observer', 'blocker', 'worker'].map((name) => `h002_start_${name}`);
const [observer, blocker, worker] = names.map(postgresSession);
const blocked = `select exists(select 1 from pg_stat_activity w
  join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
  where w.application_name='h002_start_worker'
  and b.application_name='h002_start_blocker' and w.wait_event_type='Lock');`;
let owned = false;
let injected = false;
let phase = 'preflight';
let stage = 'setup';
let originalRoles;
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

async function run(lock, boundary, replayed = false) {
  stage = `${lock ?? 'direct'}-${boundary}-${replayed ? 'replay' : 'new'}`;
  phase = 'prepare';
  await observer.query(`begin; ${reset} commit;`);
  if (replayed) {
    phase = 'seed-replay';
    const initial = JSON.parse(await observer.query(snapshot));
    const result = JSON.parse(await worker.query(start('issuance')));
    assert.equal(result.decision, 'ready');
    await assertOutcome(observer, result, initial, false, 'issuance');
  }
  const began = Number(
    await worker.query('begin; select extract(epoch from transaction_timestamp());'),
  );
  assert.ok(Number.isFinite(began));
  let deadline;
  if (boundary !== 'control') {
    deadline = began + (boundary === 'expiry' ? 4 : -1);
    await observer.query(`update public.organization_admin_bootstrap_grants
      set issued_at=to_timestamp(${deadline})-interval '30 minutes',expires_at=to_timestamp(${deadline})
      where id=${q('grant')};`);
  }
  const before = JSON.parse(await observer.query(snapshot));
  if (lock) {
    phase = 'block';
    await blocker.query(`begin; ${locks[lock]}`);
  }
  const pending = worker
    .query(start())
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
  const after = await assertOutcome(observer, result, before, replayed);
  const expected = boundary === 'control' ? 'ready' : 'expired';
  if (result.decision !== expected) {
    // Capture every selected schedule without allowing violations to pass the gate.
    violations++;
    process.stdout.write(
      `H002 onboarding start: ${stage} violation expected=${expected} actual=${result.decision}.\n`,
    );
  } else process.stdout.write(`H002 onboarding start: ${stage} passed.\n`);
  if (boundary === 'control') {
    phase = 'replay';
    const replay = JSON.parse(await worker.query(start()));
    assert.equal(replay.decision, 'ready');
    await assertOutcome(observer, replay, after, true);
  }
}

async function cleanup() {
  for (const session of [blocker, worker, observer]) {
    try {
      await session.close();
    } catch (error) {
      process.stderr.write(
        `H002 onboarding start failed: phase=close-sessions detail=${failureDetail(error)}.\n`,
      );
      process.exitCode = 1;
    }
  }
  const connection = postgresSession('h002_start_cleanup');
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
        'H002 onboarding start cleanup passed: owned rows, users, factors and original sessions absent; existing roles unchanged.\n',
      );
  } catch (error) {
    process.stderr.write(
      `H002 onboarding start failed: phase=cleanup detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
  } finally {
    try {
      await connection.close();
    } catch (error) {
      process.stderr.write(
        `H002 onboarding start failed: phase=close-cleanup detail=${failureDetail(error)}.\n`,
      );
      process.exitCode = 1;
    }
  }
}

try {
  await preflight();
  for (const lock of ['org', 'grant']) {
    await run(lock, 'control');
    await run(lock, 'expiry');
    await run(lock, 'expiry', true);
  }
  for (const replayed of [false, true]) await run(null, 'expired', replayed);
  stage = 'matrix';
  phase = 'contract-summary';
  assert.equal(violations, 0, 'Onboarding start violated grant expiry');
} catch (error) {
  if (
    cleanupProbe &&
    phase === 'inject-observer-failure' &&
    error instanceof H002SqlError &&
    error.sqlState === '22012'
  ) {
    injected = true;
    process.stdout.write('H002 onboarding start: controlled observer failure observed.\n');
  } else {
    process.stderr.write(
      `H002 onboarding start failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await cleanup();
  if (cleanupProbe && !injected) process.exitCode = 1;
}
