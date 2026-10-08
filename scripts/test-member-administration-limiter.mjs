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
} from './lib/member-administration-limiter-fixture.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error(
    'Member administration limiter requires the disposable GitHub Actions database job.',
  );
}
const cleanupProbe = process.argv.includes('--cleanup-probe');
const sessions = [];
function session(name) {
  const value = postgresSession(`member_limiter_${name}`);
  sessions.push({ name: `member_limiter_${name}`, value });
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
  where w.application_name='member_limiter_${name}' and w.wait_event_type='Lock'
  and b.application_name='member_limiter_blocker');`;
async function reset() {
  await observer.query(`begin; ${clear} commit;`);
  assert.deepEqual(await read(observer), { state: [], events: [] });
  assert.equal(await observer.query(noFault), 't');
}
async function locked(group) {
  await blocker.query(`begin; reset role; select 1 from ${stateTable}
    where limiter_key_hash='${keys[0]}' and action_group='${group}' for update; set role service_role;`);
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
      'Member limiter: observed older waiter rewound bucket time; exact tokens, responses and two atomic events retained.\n',
    );
  }
  await assertTransition(observer, waiter, owner.state, owner.state.updated_at);
  process.stdout.write(`Member limiter: ${stage} passed.\n`);
}
async function insertion(group) {
  stage = `${group}-first-insertion`;
  phase = 'prepare';
  await reset();
  const [action, shared] = groups[group].actions;
  const ownerTime = await begin(blocker);
  const ownerInput = request(action);
  const result = JSON.parse(await blocker.query(consume(ownerInput)));
  await blocker.query('reset role;');
  const owner = { ...ownerInput, time: ownerTime, result, state: (await read(blocker)).state[0] };
  pending = finish(worker, request(shared), await begin(worker));
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
  process.stdout.write(`Member limiter: ${stage} passed.\n`);
}
async function isolation(action, key) {
  stage = key === keys[0] ? 'group-isolation' : 'key-isolation';
  phase = 'prepare';
  await reset();
  const initial = row('status', 2, await now(observer));
  await observer.query(seed('status', 2, initial.updated_at));
  await locked('status');
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
  process.stdout.write(`Member limiter: ${stage} passed.\n`);
}
async function refill(group) {
  stage = `${group}-forward-refill`;
  phase = 'prepare';
  await reset();
  const { capacity, rate, actions } = groups[group];
  const records = [];
  for (const [index, elapsed] of [1 / Number(rate), (capacity + 1) / Number(rate)].entries()) {
    const key = keys[index];
    const priorTime = JSON.parse(
      await observer.query(`select to_jsonb(clock_timestamp()-interval '${elapsed} seconds');`),
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
  process.stdout.write(`Member limiter: ${stage} and capacity clamp passed.\n`);
}
async function eventFailure(tokens) {
  stage = tokens === null ? 'event-failure-new' : `event-failure-${tokens ? 'allowed' : 'denied'}`;
  phase = 'prepare';
  await reset();
  const sentinel = await call(other, request('list', keys[1]));
  await assertTransition(observer, sentinel, null);
  let prior;
  if (tokens !== null) {
    prior = row('status', tokens, await now(observer));
    await observer.query(seed('status', tokens, prior.updated_at));
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
  process.stdout.write(`Member limiter: ${stage} and unchanged-quota retry passed.\n`);
}
async function timeout() {
  stage = 'bounded-lock-failure';
  phase = 'prepare';
  await reset();
  const prior = row('status', 2, await now(observer));
  await observer.query(seed('status', 2, prior.updated_at));
  const before = await read(observer);
  await locked('status');
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
  process.stdout.write('Member limiter: bounded lock failure and recovery passed.\n');
}
async function cleanup() {
  let passed = true;
  function failed(detail) {
    passed = false;
    process.stderr.write(`Member limiter cleanup failed: ${detail}.\n`);
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
  const connection = postgresSession('member_limiter_cleanup');
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
      'Member limiter cleanup passed: owned buckets/events, fault objects and sessions absent; roles/permissions unchanged.\n',
    );
}
try {
  await preflight();
  for (const [group, { actions }] of Object.entries(groups))
    for (const action of actions) await ordered(group, action);
  for (const group of Object.keys(groups)) {
    await insertion(group);
    await refill(group);
  }
  await isolation('list', keys[0]);
  await isolation('suspend', keys[1]);
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
    process.stdout.write('Member limiter: controlled observer failure observed.\n');
  } else {
    process.stderr.write(
      `Member limiter failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await cleanup();
  if (cleanupProbe && !injected) process.exitCode = 1;
}
