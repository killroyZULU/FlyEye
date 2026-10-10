import assert from 'node:assert/strict';
import {
  postgresSession,
  waitForSql,
  failureDetail,
  H002SqlError,
} from './lib/h002-postgres-session.mjs';
import { unchangedRoles } from './lib/h002-onboarding-fixture.mjs';
import {
  groups,
  keys,
  stateTable,
  eventTable,
  signature,
  ownedWhere,
  clear,
  noFault,
  request,
  consume,
  read,
  begin,
  now,
  seed,
  row,
  finish,
  assertTransition,
  assertRecords,
  eventFault,
} from './lib/aircraft-registry-limiter-fixture.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('Aircraft registry limiter requires the disposable GitHub Actions database job.');
}
const cleanupProbe = process.argv.includes('--cleanup-probe');
const sessions = [];
function session(name) {
  const value = postgresSession(`registry_limiter_${name}`);
  sessions.push({ name: `registry_limiter_${name}`, value });
  return value;
}
const observer = session('observer');
const blocker = session('blocker');
const worker = session('worker');
const other = session('other');
let owned = false;
let injected = false;
let originalRoles;
let pending;
let stage = 'preflight';
let phase = 'setup';
const waiting = (name = 'worker') => `select exists(select 1 from pg_stat_activity w
  join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
  where w.application_name='registry_limiter_${name}' and w.wait_event_type='Lock'
  and b.application_name='registry_limiter_blocker');`;
async function reset() {
  await observer.query(`begin; ${clear} commit;`);
  assert.deepEqual(await read(observer), { state: [], events: [] });
  assert.equal(await observer.query(noFault), 't');
}
async function locked(group) {
  await blocker.query(`begin; reset role; select 1 from ${stateTable}
    where limiter_key_hash='${keys[0]}' and bucket='${group}' for update; set role service_role;`);
}
async function call(connection, input) {
  const result = await finish(connection, input, await begin(connection));
  if (result.error) throw result.error;
  return result;
}
async function preflight() {
  assert.deepEqual(await read(observer), { state: [], events: [] });
  assert.equal(await observer.query(noFault), 't');
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
  for (const connection of [blocker, worker, other])
    await connection.query('set role service_role;');
  assert.equal(
    await worker.query(`select has_function_privilege(current_user,'${signature}','EXECUTE');`),
    't',
  );
  owned = true;
}
async function ordered(group, action) {
  stage = `${action}-older-waiter`;
  phase = 'prepare';
  await reset();
  const { capacity, actions } = groups[group];
  const initial = row(group, capacity, await now(observer));
  await observer.query(seed(group, capacity, initial.updated_at));
  await locked(group);
  const time = await begin(worker);
  pending = finish(worker, request(action), time);
  phase = 'observe';
  await waitForSql(observer, waiting());
  if (cleanupProbe) {
    phase = 'inject-observer-failure';
    await observer.query('select 1/0;');
    assert.fail('Injected failure must abort');
  }
  // The owner invokes the real RPC only after observing the older RPC blocked.
  const ownerInput = request(actions[(actions.indexOf(action) + 1) % actions.length]);
  const ownerTime = JSON.parse(await blocker.query('select to_jsonb(transaction_timestamp());'));
  const owner = await finish(blocker, ownerInput, ownerTime);
  if (owner.error) throw owner.error;
  const waiter = await pending;
  if (waiter.error) throw waiter.error;
  phase = 'assert';
  await assertTransition(observer, owner, initial);
  assert.equal(owner.state.tokens, String(capacity - 1));
  assert.equal(waiter.state.tokens, String(capacity - 2));
  assertRecords(await read(observer), [owner, waiter], [waiter.state]);
  await assertTransition(observer, waiter, owner.state);
  if (waiter.state.updated_at !== owner.state.updated_at) {
    assert.equal(
      await observer.query(
        `select '${waiter.state.updated_at}'::timestamptz < '${owner.state.updated_at}'::timestamptz;`,
      ),
      't',
    );
    process.stdout.write(
      'Registry limiter: observed older waiter rewound bucket time; exact tokens, responses and two atomic events retained.\n',
    );
  }
  await assertTransition(observer, waiter, owner.state, owner.state.updated_at);
  process.stdout.write(`Registry limiter: ${stage} passed.\n`);
}
async function insertion(group) {
  stage = `${group}-first-insertion`;
  phase = 'prepare';
  await reset();
  const [action] = groups[group].actions;
  const ownerTime = await begin(blocker);
  const ownerInput = request(action);
  const result = JSON.parse(await blocker.query(consume(ownerInput)));
  await blocker.query('reset role;');
  const owner = { ...ownerInput, time: ownerTime, result, state: (await read(blocker)).state[0] };
  pending = finish(worker, request(action), await begin(worker));
  await waitForSql(observer, waiting());
  await blocker.query('commit; set role service_role;');
  const waiter = await pending;
  await assertTransition(observer, owner, null);
  await assertTransition(observer, waiter, owner.state);
  assert.equal(
    await observer.query(
      `select '${waiter.state.updated_at}'::timestamptz > '${owner.state.updated_at}'::timestamptz;`,
    ),
    't',
  );
  assert.equal(waiter.result.allowed, true);
  assertRecords(await read(observer), [owner, waiter], [waiter.state]);
  process.stdout.write(`Registry limiter: ${stage} passed.\n`);
}
async function finalToken(group) {
  stage = `${group}-final-token`;
  phase = 'prepare';
  await reset();
  await observer.query(seed(group, 1, await now(observer)));
  await locked(group);
  const racers = Array.from({ length: 8 }, (_, index) => session(`race_${index}`));
  for (const connection of racers) await connection.query('set role service_role;');
  const times = await Promise.all(racers.map(begin));
  pending = Promise.all(
    racers.map((connection, index) => finish(connection, request(group), times[index])),
  );
  const allBlocked = `with recursive waiting as (
    select a.pid,b.pid as blocker,array[a.pid] as path from pg_stat_activity a
    cross join lateral unnest(pg_blocking_pids(a.pid)) b(pid)
    where a.application_name like 'registry_limiter_race_%' and a.wait_event_type='Lock'
    union all select w.pid,b.pid,w.path||w.blocker from waiting w
    cross join lateral unnest(pg_blocking_pids(w.blocker)) b(pid) where not w.blocker=any(w.path)
  ) select count(distinct w.pid)=8 from waiting w join pg_stat_activity a on a.pid=w.blocker
    where a.application_name='registry_limiter_blocker';`;
  phase = 'observe';
  await waitForSql(observer, allBlocked);
  // All RPC clocks were sampled before their observed lock waits. Advance only
  // the owned synthetic bucket under its lock; this is not a production RPC.
  await blocker.query('reset role;');
  const time = JSON.parse(
    await blocker.query(`update ${stateTable} set updated_at=clock_timestamp()
    where limiter_key_hash='${keys[0]}' and bucket='${group}' returning to_jsonb(updated_at);`),
  );
  await blocker.query('commit; set role service_role;');
  const records = await pending;
  for (const connection of racers) await connection.close();
  for (const record of records) if (record.error) throw record.error;
  phase = 'assert';
  assert.equal(records.filter((record) => record.result.allowed).length, 1);
  for (const record of records) {
    assert.equal(record.state.updated_at, time);
    await assertTransition(observer, record, row(group, record.result.allowed ? 1 : 0, time));
  }
  assertRecords(await read(observer), records, [row(group, 0, time)]);
  process.stdout.write(`Registry limiter: ${stage} passed.\n`);
}
async function isolation(action, key) {
  stage = key === keys[0] ? 'group-isolation' : 'key-isolation';
  phase = 'prepare';
  await reset();
  const initial = row('lifecycle', 2, await now(observer));
  await observer.query(seed('lifecycle', 2, initial.updated_at));
  await locked('lifecycle');
  pending = finish(worker, request(), await begin(worker));
  await waitForSql(observer, waiting());
  const independent = await call(other, request(action, key));
  await assertTransition(observer, independent, null);
  assert.equal(await observer.query(waiting()), 't');
  assertRecords(await read(observer), [independent], [initial, independent.state]);
  await blocker.query('rollback;');
  const waiter = await pending;
  await assertTransition(observer, waiter, initial);
  assertRecords(await read(observer), [independent, waiter], [waiter.state, independent.state]);
  process.stdout.write(`Registry limiter: ${stage} passed.\n`);
}
async function refill(group) {
  stage = `${group}-forward-refill`;
  phase = 'prepare';
  await reset();
  const { capacity, rate, actions } = groups[group];
  const records = [];
  for (const [index, count] of [2, capacity + 1].entries()) {
    const key = keys[index];
    const priorTime = JSON.parse(
      await observer.query(
        `select to_jsonb(clock_timestamp()-(${count}::numeric / ${rate}) * interval '1 second');`,
      ),
    );
    const prior = row(group, 0, priorTime, key);
    await observer.query(seed(group, 0, priorTime, key));
    const result = await call(worker, request(actions[0], key));
    await assertTransition(observer, result, prior);
    assert.equal(result.result.allowed, true);
    if (index === 1) assert.equal(result.state.tokens, String(capacity - 1));
    const actual = await read(observer);
    records.push(result);
    assertRecords(
      actual,
      records,
      records.map((record) => record.state),
    );
  }
  process.stdout.write(`Registry limiter: ${stage} and capacity clamp passed.\n`);
}
async function eventFailure(tokens) {
  stage = tokens === null ? 'event-failure-new' : `event-failure-${tokens ? 'allowed' : 'denied'}`;
  phase = 'prepare';
  await reset();
  const sentinel = await call(other, request('read', keys[1]));
  await assertTransition(observer, sentinel, null);
  let prior;
  if (tokens !== null) {
    prior = row('lifecycle', tokens, await now(observer));
    await observer.query(seed('lifecycle', tokens, prior.updated_at));
  }
  const before = await read(observer);
  assertRecords(before, [sentinel], [sentinel.state, ...(prior ? [prior] : [])]);
  const failing = session(stage);
  const time = await begin(failing);
  const input = request();
  await failing.query(eventFault(input));
  await failing.query('set role service_role;');
  const failed = await finish(failing, input, time);
  assert.ok(failed.error instanceof H002SqlError);
  assert.equal(failed.error.sqlState, '23514');
  await failing.close();
  assert.equal(await observer.query(noFault), 't');
  assert.deepEqual(await read(observer), before);
  const recovered = await call(worker, request());
  await assertTransition(observer, recovered, prior);
  assert.equal(recovered.result.allowed, tokens !== 0);
  assertRecords(await read(observer), [sentinel, recovered], [sentinel.state, recovered.state]);
  process.stdout.write(`Registry limiter: ${stage} and unchanged-quota retry passed.\n`);
}
async function timeout() {
  stage = 'bounded-lock-failure';
  phase = 'prepare';
  await reset();
  const prior = row('lifecycle', 2, await now(observer));
  await observer.query(seed('lifecycle', 2, prior.updated_at));
  const before = await read(observer);
  await locked('lifecycle');
  const failing = session('timeout');
  await failing.query("set role service_role; set statement_timeout='2s';");
  pending = finish(failing, request(), await begin(failing));
  await waitForSql(observer, waiting('timeout'));
  const failed = await pending;
  assert.ok(failed.error instanceof H002SqlError);
  assert.equal(failed.error.sqlState, '57014');
  await blocker.query('rollback;');
  assert.deepEqual(await read(observer), before);
  const recovered = await call(worker, request());
  await assertTransition(observer, recovered, prior);
  assertRecords(await read(observer), [recovered], [recovered.state]);
  process.stdout.write('Registry limiter: bounded lock failure and recovery passed.\n');
}
async function cleanup() {
  let passed = true;
  function failed(detail) {
    passed = false;
    process.stderr.write(`Registry limiter cleanup failed: ${detail}.\n`);
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
  const connection = postgresSession('registry_limiter_cleanup');
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
    assert.equal(await connection.query(noFault), 't');
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
  if (owned && passed)
    process.stdout.write(
      'Registry limiter cleanup passed: owned buckets/events, fault objects and sessions absent; roles/permissions unchanged.\n',
    );
}
try {
  await preflight();
  for (const [group, { actions }] of Object.entries(groups))
    for (const action of actions) await ordered(group, action);
  for (const group of Object.keys(groups)) {
    await insertion(group);
    await refill(group);
    await finalToken(group);
  }
  await isolation('read', keys[0]);
  await isolation('lifecycle', keys[1]);
  for (const tokens of [null, 2, 0]) await eventFailure(tokens);
  await timeout();
} catch (error) {
  if (
    cleanupProbe &&
    phase === 'inject-observer-failure' &&
    error instanceof H002SqlError &&
    error.sqlState === '22012'
  ) {
    injected = true;
    process.stdout.write('Registry limiter: controlled observer failure observed.\n');
  } else {
    process.stderr.write(
      `Registry limiter failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await cleanup();
  if (cleanupProbe && !injected) process.exitCode = 1;
}
