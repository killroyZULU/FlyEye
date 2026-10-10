import assert from 'node:assert/strict';
import { H002SqlError } from './h002-postgres-session.mjs';
import {
  keys,
  stateTable,
  request,
  consume,
  begin,
  read,
  seed,
  row,
  finish,
  assertRecords,
} from './invitation-limiter-fixture.mjs';

const shifted = async (observer, time, interval) =>
  JSON.parse(
    await observer.query(`select to_jsonb('${time}'::timestamptz - interval '${interval}');`),
  );

async function sentinel(h) {
  const time = await begin(h.workers[2]);
  const record = await finish(h.workers[2], request('create', keys[1]), time);
  assert.equal(record.result?.allowed, true);
  record.originalEvent = (await read(h.observer)).events.find(
    (event) => event.correlation_id === record.correlation,
  );
  assert.ok(record.originalEvent);
  return record;
}

function assertHistory(actual, history) {
  assert.deepEqual(
    actual.events.find((event) => event.correlation_id === history.correlation),
    history.originalEvent,
  );
}

async function boundary(h) {
  const history = await sentinel(h);
  const time = await begin(h.workers[0]);
  const exact = await shifted(h.observer, time, '2 hours');
  const expired = await shifted(h.observer, time, '2 hours 1 microsecond');
  await h.observer.query(seed('resend', 0, exact));
  // Age a real event's bucket; pruning must preserve its decision history.
  await h.observer.query(`update ${stateTable} set last_refill_at='${expired}',
    last_decision_at='${expired}' where limiter_key_hash='${keys[1]}' and action='create';`);
  const result = await h.track(finish(h.workers[0], request('list'), time));
  assert.equal(result.result?.allowed, true);
  const actual = await read(h.observer);
  assertHistory(actual, history);
  assertRecords(actual, [history, result], [row('resend', 0, exact), row('list', 3000, time)]);
}

async function refresh(h, commit) {
  const ownerTime = await begin(h.blocker);
  const prior = await shifted(h.observer, ownerTime, '2 hours');
  await h.observer.query(seed('resend', 0, prior));
  const input = request();
  const owner = {
    ...input,
    time: ownerTime,
    result: JSON.parse(await h.blocker.query(consume(input))),
  };
  assert.equal(owner.result.allowed, true);
  const time = await begin(h.workers[0]);
  assert.equal(await h.observer.query(`select '${time}'::timestamptz > '${ownerTime}';`), 't');
  // Observer sees the old, now-expired row while the owner holds its refresh.
  assertRecords(await read(h.observer), [], [row('resend', 0, prior)]);
  const pending = h.track(finish(h.workers[0], request(), time));
  await h.observe('worker_0', true);
  await h.blocker.query(commit ? 'commit;' : 'rollback;');
  const result = await pending;
  assert.equal(result.result?.allowed, !commit);
  let tokens = 0;
  if (commit) {
    // Calculate exact partial refill from server timestamps, retaining microseconds.
    tokens = Number(
      await h.observer.query(`select floor(
      extract(epoch from ('${time}'::timestamptz - '${ownerTime}'::timestamptz))*1000/1200);`),
    );
    assert.ok(tokens >= 0 && tokens < 1000);
    result.expectedRetry = Math.ceil(((1000 - tokens) * 1200) / 1000);
  }
  assertRecords(
    await read(h.observer),
    [...(commit ? [owner] : []), result],
    [row('resend', tokens, time)],
  );
}

async function recreate(h, commit) {
  const time = await begin(h.workers[0]);
  const prior = await shifted(h.observer, time, '2 hours');
  await h.observer.query(seed('resend', 0, prior));
  const ownerTime = await begin(h.blocker);
  assert.equal(await h.observer.query(`select '${ownerTime}'::timestamptz > '${time}';`), 't');
  const input = request();
  const owner = {
    ...input,
    time: ownerTime,
    result: JSON.parse(await h.blocker.query(consume(input))),
  };
  assert.equal(owner.result.allowed, true);
  assertRecords(await read(h.observer), [], [row('resend', 0, prior)]);
  // The older caller retains the boundary row at DELETE, then waits at INSERT
  // against the newer owner's uncommitted deletion/replacement of that key.
  const pending = h.track(finish(h.workers[0], request(), time));
  await h.observe('worker_0');
  await h.blocker.query(commit ? 'commit;' : 'rollback;');
  const result = await pending;
  assert.equal(result.result?.allowed, !commit);
  assertRecords(
    await read(h.observer),
    [...(commit ? [owner] : []), result],
    [row('resend', 0, commit ? ownerTime : time)],
  );
}

async function failureSetup(h) {
  const history = await sentinel(h);
  const expired = await shifted(h.observer, history.time, '3 hours');
  await h.observer.query(seed('list', 0, expired));
  return { history, before: await read(h.observer) };
}

async function recover(h, history) {
  const time = await begin(h.workers[0]);
  const result = await h.track(finish(h.workers[0], request(), time));
  assert.equal(result.result?.allowed, true);
  const actual = await read(h.observer);
  assertHistory(actual, history);
  assertRecords(
    actual,
    [history, result],
    [row('create', 1000, history.time, keys[1]), row('resend', 0, time)],
  );
}

async function eventFailure(h) {
  const { history, before } = await failureSetup(h);
  const failing = h.session('pruning_event_failure');
  await failing.query('set role service_role;');
  const time = await begin(failing);
  const result = await h.track(
    finish(failing, request('resend', keys[0], history.correlation), time),
  );
  assert.ok(result.error instanceof H002SqlError);
  assert.equal(result.error.sqlState, '23505');
  assert.deepEqual(await read(h.observer), before);
  await recover(h, history);
}

async function timeout(h) {
  const { history, before } = await failureSetup(h);
  await h.blocker.query(`begin; reset role; select 1 from ${stateTable}
    where limiter_key_hash='${keys[0]}' and action='list' for update; set role service_role;`);
  const failing = h.session('worker_pruning_timeout');
  await failing.query("set role service_role; set statement_timeout='2s';");
  const time = await begin(failing);
  const pending = h.track(finish(failing, request(), time));
  // The requested resend bucket is absent: the locked, stale list row blocks pruning.
  await h.observe('worker_pruning_timeout');
  const result = await pending;
  assert.ok(result.error instanceof H002SqlError);
  assert.equal(result.error.sqlState, '57014');
  await h.blocker.query('rollback;');
  assert.deepEqual(await read(h.observer), before);
  await recover(h, history);
}

export const pruningCases = [
  ['pruning-strict-boundary', boundary],
  ['pruning-refresh-commit', (h) => refresh(h, true)],
  ['pruning-refresh-rollback', (h) => refresh(h, false)],
  ['pruning-recreate-insert-commit', (h) => recreate(h, true)],
  ['pruning-recreate-insert-rollback', (h) => recreate(h, false)],
  ['pruning-event-failure-retry', eventFailure],
  ['pruning-timeout-retry', timeout],
];
