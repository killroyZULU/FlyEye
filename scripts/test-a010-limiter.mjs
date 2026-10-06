import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { postgresSession, waitForSql, failureDetail } from './lib/h002-postgres-session.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('A010 requires the disposable GitHub Actions database job.');
}

const actor = randomUUID();
const other = randomUUID();
const observer = postgresSession('a010_observer');
const blocker = postgresSession('a010_blocker');
const workers = Array.from({ length: 8 }, (_, i) => postgresSession(`a010_worker_${i}`));
const timeoutWorker = postgresSession('a010_timeout');
const cleanupProbe = process.argv.includes('--cleanup-probe');
let owned = false;
let stage = 'setup';
let probeObserved = false;
const consume = (user = actor) =>
  `select public.consume_auth_bootstrap_rate_limit('${user}', '${randomUUID()}');`;
const workerWait = `select count(*) >= 8 from pg_stat_activity
  where application_name like 'a010_worker_%' and wait_event_type = 'Lock';`;

async function decisions() {
  return Promise.all(
    workers.map(async (worker) => {
      try {
        return JSON.parse(await worker.query(consume()));
      } catch (error) {
        return { failure: error };
      }
    }),
  );
}

try {
  assert.equal(
    await observer.query(`select count(*) from auth.users where id in ('${actor}','${other}');`),
    '0',
  );
  owned = true;
  await observer.query(`insert into auth.users(id) values('${actor}'),('${other}');`);
  await Promise.all(
    [blocker, timeoutWorker, ...workers].map((session) => session.query('set role service_role;')),
  );
  stage = 'concurrent-insertion';
  await blocker.query('begin;');
  assert.equal(JSON.parse(await blocker.query(consume())).allowed, true);
  // The first decision remains uncommitted while other backends race to insert.
  // Freeze refill for exact budget assertions; production never accepts a caller clock.
  await blocker.query(`reset role; update public.auth_bootstrap_rate_limit_state
    set last_refill_at=clock_timestamp()+interval '1 hour' where actor_user_id='${actor}'; set role service_role;`);
  const first = decisions();
  await waitForSql(observer, workerWait);
  await blocker.query('commit;');
  assert.equal((await first).filter((decision) => decision.allowed === true).length, 8);
  assert.equal(
    await observer.query(
      `select tokens::integer from public.auth_bootstrap_rate_limit_state where actor_user_id='${actor}';`,
    ),
    '21',
  );

  stage = 'final-token';
  await blocker.query(`begin; reset role; update public.auth_bootstrap_rate_limit_state
    set tokens=1 where actor_user_id='${actor}'; set role service_role;`);
  const last = decisions();
  await waitForSql(observer, workerWait);
  if (cleanupProbe) {
    stage = 'controlled-failure';
    probeObserved = true;
    throw new Error('Synthetic interrupted fixture');
  }
  await blocker.query('commit;');
  const results = await last;
  assert.equal(results.filter((decision) => decision.allowed === true).length, 1);
  assert.equal(
    results.filter((decision) => decision.allowed === false && decision.retryAfterSeconds === 2)
      .length,
    7,
  );
  assert.equal(
    await observer.query(`select count(*) from public.authentication_events
    where actor_subject_id='${actor}' and reason_code='bootstrap_rate_limited';`),
    '7',
  );
  assert.equal(JSON.parse(await workers[0].query(consume(other))).allowed, true);

  stage = 'bounded-lock-failure';
  await blocker.query(`begin; reset role; select actor_user_id from public.auth_bootstrap_rate_limit_state
    where actor_user_id='${actor}' for update; set role service_role;`);
  const failed = timeoutWorker.query(consume()).then(
    () => false,
    () => true,
  );
  await waitForSql(
    observer,
    `select exists(select 1 from pg_stat_activity
    where application_name='a010_timeout' and wait_event_type='Lock');`,
  );
  assert.equal(await failed, true);
  await blocker.query('rollback;');
  assert.equal(
    await observer.query(
      `select tokens::integer from public.auth_bootstrap_rate_limit_state where actor_user_id='${actor}';`,
    ),
    '0',
  );
  assert.equal(
    await observer.query(
      `select count(*) from public.authentication_events where actor_subject_id='${actor}';`,
    ),
    '7',
  );
  stage = 'recovery';
  await observer.query(`update public.auth_bootstrap_rate_limit_state set last_refill_at=clock_timestamp()-interval '2 seconds'
    where actor_user_id='${actor}';`);
  assert.equal(JSON.parse(await workers[0].query(consume())).allowed, true);
  process.stdout.write(
    'A010 concurrent insertion, final-token race, subject isolation, bounded failure and recovery passed.\n',
  );
} catch (error) {
  if (!(cleanupProbe && probeObserved && stage === 'controlled-failure')) {
    process.stderr.write(`A010 failed: stage=${stage} detail=${failureDetail(error)}.\n`);
    process.exitCode = 1;
  }
} finally {
  // Release the blocker before joining all workers, even for interrupted assertions.
  for (const session of [blocker, ...workers, timeoutWorker, observer]) {
    try {
      await session.close();
    } catch {
      process.stderr.write('A010 cleanup failed: close-session.\n');
      process.exitCode = 1;
    }
  }
  const cleanup = postgresSession('a010_cleanup');
  try {
    if (owned) {
      await cleanup.query(`begin;
        delete from public.authentication_events where actor_subject_id in ('${actor}','${other}');
        delete from auth.users where id in ('${actor}','${other}'); commit;`);
      assert.equal(
        await cleanup.query(`select
        (select count(*) from auth.users where id in ('${actor}','${other}')) +
        (select count(*) from public.auth_bootstrap_rate_limit_state where actor_user_id in ('${actor}','${other}')) +
        (select count(*) from public.authentication_events where actor_subject_id in ('${actor}','${other}')) +
        (select count(*) from pg_stat_activity where application_name like 'a010_%' and application_name <> 'a010_cleanup');`),
        '0',
      );
      process.stdout.write(
        'A010 cleanup passed: fixture users, buckets, events and original sessions absent.\n',
      );
    }
  } catch {
    process.stderr.write('A010 cleanup failed: rows-or-residue.\n');
    process.exitCode = 1;
  } finally {
    try {
      await cleanup.close();
    } catch {
      process.stderr.write('A010 cleanup failed: close-cleanup.\n');
      process.exitCode = 1;
    }
  }
  if (cleanupProbe && !probeObserved) process.exitCode = 1;
  if (cleanupProbe && probeObserved && !process.exitCode)
    process.stdout.write('A010 interrupted-fixture cleanup regression passed.\n');
}
