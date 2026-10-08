import assert from 'node:assert/strict';
import {
  postgresSession,
  waitForSql,
  failureDetail,
  H002SqlError,
} from './lib/h002-postgres-session.mjs';
import { unchangedRoles } from './lib/h002-onboarding-fixture.mjs';
import {
  policies,
  keys,
  stateTable,
  eventTable,
  signature,
  ownedWhere,
  clear,
  request,
  consume,
  begin,
  read,
  seed,
  row,
  finish,
  assertRecords,
} from './lib/invitation-limiter-fixture.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('Invitation limiter requires the disposable GitHub Actions database job.');
}
const cleanupProbe = process.argv.includes('--cleanup-probe');
const sessions = [];
function session(name) {
  const value = postgresSession(`invitation_limiter_${name}`);
  sessions.push({ name: `invitation_limiter_${name}`, value });
  return value;
}
const observer = session('observer');
const blocker = session('blocker');
const workers = Array.from({ length: 8 }, (_, index) => session(`worker_${index}`));
let owned = false;
let injected = false;
let phase = 'preflight';
let stage = 'setup';
let originalRoles;
let pending;
const waiters = (count) => `with recursive waiting as (
  select a.pid, b.pid as blocker, array[a.pid] as path
  from pg_stat_activity a cross join lateral unnest(pg_blocking_pids(a.pid)) b(pid)
  where a.application_name like 'invitation_limiter_worker_%' and a.wait_event_type='Lock'
  union all
  select w.pid,b.pid,w.path||w.blocker from waiting w
  cross join lateral unnest(pg_blocking_pids(w.blocker)) b(pid)
  where not w.blocker=any(w.path)
) select count(distinct w.pid)=${count} from waiting w join pg_stat_activity a on a.pid=w.blocker
  where a.application_name='invitation_limiter_blocker';`;

async function reset() {
  await observer.query(`begin; ${clear} commit;`);
  assert.deepEqual(await read(observer), { state: [], events: [] });
}
async function locked(action = 'resend') {
  await blocker.query(`begin; reset role; select 1 from ${stateTable}
    where limiter_key_hash='${keys[0]}' and action='${action}' for update; set role service_role;`);
}
async function preflight() {
  assert.deepEqual(await read(observer), { state: [], events: [] });
  originalRoles = await observer.query(unchangedRoles);
  for (const { value } of sessions)
    assert.equal(await value.query('show transaction_isolation;'), 'read committed');
  for (const role of ['anon', 'authenticated']) {
    assert.equal(
      await observer.query(`select has_function_privilege('${role}','${signature}','EXECUTE');`),
      'f',
    );
    for (const table of [stateTable, eventTable])
      assert.equal(
        await observer.query(
          `select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE');`,
        ),
        'f',
      );
  }
  for (const worker of [blocker, ...workers]) await worker.query('set role service_role;');
  assert.equal(
    await workers[0].query(`select has_function_privilege(current_user,'${signature}','EXECUTE');`),
    't',
  );
  owned = true;
}
async function contention(action, insertion) {
  stage = `${action}-${insertion ? 'insertion' : 'final-token'}`;
  phase = 'prepare';
  await reset();
  const records = [];
  // Older worker transaction times ensure genuine insertion cannot refill the
  // owner's new bucket. The first inserted row remains uncommitted until observed.
  const times = await Promise.all(workers.map(begin));
  let expectedTime;
  if (insertion) {
    expectedTime = await begin(blocker);
    const input = request(action);
    const result = JSON.parse(await blocker.query(consume(input)));
    assert.equal(result.allowed, true);
    records.push({ ...input, time: expectedTime, result });
  } else {
    expectedTime = JSON.parse(await observer.query('select to_jsonb(clock_timestamp());'));
    await observer.query(seed(action, 1000, expectedTime));
    await locked(action);
  }
  assert.equal(
    await observer.query(`select bool_and(t < '${expectedTime}'::timestamptz)
    from unnest(array[${times.map((time) => `'${time}'::timestamptz`).join(',')}]) t;`),
    't',
  );
  pending = Promise.all(
    workers.map((worker, index) => finish(worker, request(action), times[index])),
  );
  phase = 'observe';
  await waitForSql(observer, waiters(8));
  if (cleanupProbe && insertion) {
    phase = 'inject-observer-failure';
    await observer.query('select 1/0;');
    assert.fail('Injected failure must abort');
  }
  phase = 'release';
  await blocker.query('commit;');
  records.push(...(await pending));
  const errors = records.filter((record) => record.error);
  if (errors.length && action === 'resend' && insertion) {
    assert.equal(errors.length, workers.length);
    for (const record of errors) assert.equal(record.error.sqlState, '23514');
    assertRecords(await read(observer), [records[0]], [row(action, 0, expectedTime)]);
    process.stdout.write(
      'Invitation limiter: exhausted older waiters failed atomically with 23514; owner bucket/event unchanged.\n',
    );
  }
  if (errors.length) throw errors[0].error;
  phase = 'assert';
  assert.equal(
    records.filter((record) => record.result.allowed).length,
    insertion ? policies[action].capacity : 1,
  );
  assertRecords(await read(observer), records, [row(action, 0, expectedTime)]);
  process.stdout.write(`Invitation limiter: ${stage} passed.\n`);
}
async function isolation(otherAction, otherKey) {
  stage = otherKey === keys[0] ? 'action-isolation' : 'key-isolation';
  phase = 'prepare';
  await reset();
  const time = await begin(workers[0]);
  await observer.query(seed('resend', 1000, time));
  await locked();
  pending = finish(workers[0], request(), time);
  await waitForSql(observer, waiters(1));
  const otherTime = await begin(workers[1]);
  const other = await finish(workers[1], request(otherAction, otherKey), otherTime);
  if (other.error) throw other.error;
  assert.equal(other.result.allowed, true);
  assert.equal(await observer.query(waiters(1)), 't');
  const otherRow = row(
    otherAction,
    (policies[otherAction].capacity - 1) * 1000,
    otherTime,
    otherKey,
  );
  assertRecords(await read(observer), [other], [row('resend', 1000, time), otherRow]);
  await blocker.query('rollback;');
  const result = await pending;
  assert.equal(result.result?.allowed, true);
  assertRecords(await read(observer), [other, result], [row('resend', 0, time), otherRow]);
  process.stdout.write(`Invitation limiter: ${stage} passed.\n`);
}
async function eventFailure(tokens) {
  stage = tokens === null ? 'event-failure-new' : `event-failure-${tokens ? 'allowed' : 'denied'}`;
  phase = 'prepare';
  await reset();
  const sentinelTime = await begin(workers[0]);
  const sentinel = await finish(workers[0], request('create', keys[1]), sentinelTime);
  if (sentinel.error) throw sentinel.error;
  assert.equal(sentinel.result.allowed, true);
  const recoveredTime = await begin(workers[0]);
  const seedTime = JSON.parse(await observer.query('select to_jsonb(clock_timestamp());'));
  if (tokens !== null) await observer.query(seed('resend', tokens, seedTime));
  const before = await read(observer);
  assertRecords(
    before,
    [sentinel],
    [
      row('create', 1000, sentinelTime, keys[1]),
      ...(tokens === null ? [] : [row('resend', tokens, seedTime)]),
    ],
  );
  const failing = session(stage);
  await failing.query('set role service_role;');
  const time = await begin(failing);
  phase = 'failed-event';
  const failed = await finish(failing, request('resend', keys[0], sentinel.correlation), time);
  assert.ok(failed.error instanceof H002SqlError);
  assert.equal(failed.error.sqlState, '23505');
  assert.deepEqual(await read(observer), before);
  phase = 'recover';
  const recovered = await finish(workers[0], request(), recoveredTime);
  assert.equal(recovered.result?.allowed, tokens !== 0);
  const after = await read(observer);
  assert.deepEqual(
    after.events.find((event) => event.correlation_id === sentinel.correlation),
    before.events[0],
  );
  assertRecords(
    after,
    [sentinel, recovered],
    [
      row('create', 1000, sentinelTime, keys[1]),
      row('resend', 0, tokens === null ? recoveredTime : seedTime),
    ],
  );
  process.stdout.write(`Invitation limiter: ${stage} and unchanged-quota retry passed.\n`);
}
async function timeout() {
  stage = 'bounded-lock-failure';
  phase = 'prepare';
  await reset();
  const recoveredTime = await begin(workers[0]);
  const seedTime = JSON.parse(await observer.query('select to_jsonb(clock_timestamp());'));
  await observer.query(seed('resend', 1000, seedTime));
  const before = await read(observer);
  await locked();
  const failing = session('timeout');
  await failing.query("set role service_role; set statement_timeout='2s';");
  const time = await begin(failing);
  pending = finish(failing, request(), time);
  await waitForSql(
    observer,
    `select exists(select 1 from pg_stat_activity w
    join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
    where w.application_name='invitation_limiter_timeout' and w.wait_event_type='Lock'
    and b.application_name='invitation_limiter_blocker');`,
  );
  const failed = await pending;
  assert.ok(failed.error instanceof H002SqlError);
  assert.equal(failed.error.sqlState, '57014');
  await blocker.query('rollback;');
  assert.deepEqual(await read(observer), before);
  const recovered = await finish(workers[0], request(), recoveredTime);
  assert.equal(recovered.result?.allowed, true);
  assertRecords(await read(observer), [recovered], [row('resend', 0, seedTime)]);
  process.stdout.write('Invitation limiter: bounded lock failure and recovery passed.\n');
}
async function forwardRefill(action) {
  stage = action + '-forward-refill';
  phase = 'prepare';
  await reset();
  const time = await begin(workers[0]);
  const prior = JSON.parse(
    await observer.query(
      `select to_jsonb('${time}'::timestamptz - interval '${policies[action].refill} seconds');`,
    ),
  );
  await observer.query(seed(action, 0, prior));
  const result = await finish(workers[0], request(action), time);
  assert.equal(result.result?.allowed, true);
  assertRecords(await read(observer), [result], [row(action, 0, time)]);
  process.stdout.write('Invitation limiter: ' + stage + ' passed.\n');
}
async function cleanup() {
  let cleanupPassed = true;
  function failed(detail) {
    cleanupPassed = false;
    process.stderr.write(`Invitation limiter cleanup failed: ${detail}.\n`);
    process.exitCode = 1;
  }
  try {
    await blocker.close();
  } catch {
    failed('close-blocker');
  }
  if (pending) await pending;
  for (const { value } of sessions.filter(({ value }) => value !== blocker)) {
    try {
      await value.close();
    } catch {
      failed('close-session');
    }
  }
  const connection = postgresSession('invitation_limiter_cleanup');
  try {
    if (owned) {
      await connection.query(`begin; ${clear} commit;`);
      assert.equal(
        await connection.query(`select (select count(*) from ${stateTable} where ${ownedWhere})+
        (select count(*) from ${eventTable} where ${ownedWhere});`),
        '0',
      );
      assert.equal(await connection.query(unchangedRoles), originalRoles);
    }
    assert.equal(
      await connection.query(`select count(*) from pg_stat_activity
      where application_name in (${sessions.map(({ name }) => `'${name}'`).join(',')});`),
      '0',
    );
  } catch (error) {
    failed(failureDetail(error));
  } finally {
    try {
      await connection.close();
    } catch {
      failed('close-cleanup');
    }
  }
  if (owned && cleanupPassed)
    process.stdout.write(
      'Invitation limiter cleanup passed: owned buckets/events and original sessions absent; roles/permissions unchanged.\n',
    );
}
try {
  await preflight();
  for (const action of Object.keys(policies)) {
    await contention(action, true);
    await contention(action, false);
    await forwardRefill(action);
  }
  await isolation('list', keys[0]);
  await isolation('resend', keys[1]);
  for (const tokens of [null, 1000, 0]) await eventFailure(tokens);
  await timeout();
} catch (error) {
  if (
    cleanupProbe &&
    phase === 'inject-observer-failure' &&
    error instanceof H002SqlError &&
    error.sqlState === '22012'
  ) {
    injected = true;
    process.stdout.write('Invitation limiter: controlled observer failure observed.\n');
  } else {
    process.stderr.write(
      `Invitation limiter failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await cleanup();
  if (cleanupProbe && !injected) process.exitCode = 1;
}
