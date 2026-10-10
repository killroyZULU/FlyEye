import assert from 'node:assert/strict';
import { H002SqlError } from './h002-postgres-session.mjs';
export function createPruningCases(fixture, config) {
  const {
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
    policies,
  } = fixture;
  const { subjectAction, sentinelAction, otherAction, retention } = config;
  const refill = policies[subjectAction].refill;
  assert.equal(policies[subjectAction].capacity, 1);

  const shifted = async (observer, time, interval) =>
    JSON.parse(
      await observer.query(`select to_jsonb('${time}'::timestamptz - interval '${interval}');`),
    );

  async function sentinel(h) {
    const time = await begin(h.workers[2]);
    const record = await finish(h.workers[2], request(sentinelAction, keys[1]), time);
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
    const exact = await shifted(h.observer, time, retention);
    const expired = await shifted(h.observer, time, `${retention} 1 microsecond`);
    await h.observer.query(seed(subjectAction, 0, exact));
    // Age a real event's bucket; pruning must preserve its decision history.
    await h.observer.query(`update ${stateTable} set last_refill_at='${expired}',
    last_decision_at='${expired}' where limiter_key_hash='${keys[1]}' and action='${sentinelAction}';`);
    const result = await h.track(finish(h.workers[0], request(otherAction), time));
    assert.equal(result.result?.allowed, true);
    const actual = await read(h.observer);
    assertHistory(actual, history);
    assertRecords(
      actual,
      [history, result],
      [
        row(subjectAction, 0, exact),
        row(otherAction, (policies[otherAction].capacity - 1) * 1000, time),
      ],
    );
  }

  async function refresh(h, commit) {
    const ownerTime = await begin(h.blocker);
    const prior = await shifted(h.observer, ownerTime, retention);
    await h.observer.query(seed(subjectAction, 0, prior));
    const input = request(subjectAction);
    const owner = {
      ...input,
      time: ownerTime,
      result: JSON.parse(await h.blocker.query(consume(input))),
    };
    assert.equal(owner.result.allowed, true);
    const time = await begin(h.workers[0]);
    assert.equal(await h.observer.query(`select '${time}'::timestamptz > '${ownerTime}';`), 't');
    h.mark('schedule-precondition');
    const partialTokens = Number(
      await h.observer.query(`select floor(
    extract(epoch from ('${time}'::timestamptz - '${ownerTime}'::timestamptz))*1000/${refill});`),
    );
    // A delayed fixture is not evidence that production incorrectly granted quota.
    assert.ok(
      partialTokens >= 0 && partialTokens < 1000,
      'Selected schedule requires less than one full refill interval',
    );
    // Observer sees the old, now-expired row while the owner holds its refresh.
    assertRecords(await read(h.observer), [], [row(subjectAction, 0, prior)]);
    const pending = h.track(finish(h.workers[0], request(subjectAction), time));
    await h.observe('worker_0', true);
    await h.blocker.query(commit ? 'commit;' : 'rollback;');
    const result = await pending;
    assert.equal(result.result?.allowed, !commit);
    const tokens = commit ? partialTokens : 0;
    if (commit) result.expectedRetry = Math.ceil(((1000 - tokens) * refill) / 1000);
    assertRecords(
      await read(h.observer),
      [...(commit ? [owner] : []), result],
      [row(subjectAction, tokens, time)],
    );
  }

  async function recreate(h, commit) {
    const time = await begin(h.workers[0]);
    const prior = await shifted(h.observer, time, retention);
    await h.observer.query(seed(subjectAction, 0, prior));
    const ownerTime = await begin(h.blocker);
    assert.equal(await h.observer.query(`select '${ownerTime}'::timestamptz > '${time}';`), 't');
    const input = request(subjectAction);
    const owner = {
      ...input,
      time: ownerTime,
      result: JSON.parse(await h.blocker.query(consume(input))),
    };
    assert.equal(owner.result.allowed, true);
    assertRecords(await read(h.observer), [], [row(subjectAction, 0, prior)]);
    // The older caller retains the boundary row at DELETE, then waits at INSERT
    // against the newer owner's uncommitted deletion/replacement of that key.
    const pending = h.track(finish(h.workers[0], request(subjectAction), time));
    await h.observe('worker_0');
    await h.blocker.query(commit ? 'commit;' : 'rollback;');
    const result = await pending;
    assert.equal(result.result?.allowed, !commit);
    assertRecords(
      await read(h.observer),
      [...(commit ? [owner] : []), result],
      [row(subjectAction, 0, commit ? ownerTime : time)],
    );
  }

  async function failureSetup(h) {
    const history = await sentinel(h);
    const expired = await shifted(h.observer, history.time, `${retention} 1 second`);
    await h.observer.query(seed(otherAction, 0, expired));
    return { history, before: await read(h.observer) };
  }

  async function recover(h, history) {
    const time = await begin(h.workers[0]);
    const result = await h.track(finish(h.workers[0], request(subjectAction), time));
    assert.equal(result.result?.allowed, true);
    const actual = await read(h.observer);
    assertHistory(actual, history);
    assertRecords(
      actual,
      [history, result],
      [
        row(sentinelAction, (policies[sentinelAction].capacity - 1) * 1000, history.time, keys[1]),
        row(subjectAction, 0, time),
      ],
    );
  }

  async function eventFailure(h) {
    const { history, before } = await failureSetup(h);
    const failing = h.session('pruning_event_failure');
    await failing.query('set role service_role;');
    const time = await begin(failing);
    const result = await h.track(
      finish(failing, request(subjectAction, keys[0], history.correlation), time),
    );
    assert.ok(result.error instanceof H002SqlError);
    assert.equal(result.error.sqlState, '23505');
    assert.deepEqual(await read(h.observer), before);
    await recover(h, history);
  }

  async function timeout(h) {
    const { history, before } = await failureSetup(h);
    await h.blocker.query(`begin; reset role; select 1 from ${stateTable}
    where limiter_key_hash='${keys[0]}' and action='${otherAction}' for update; set role service_role;`);
    const failing = h.session('worker_pruning_timeout');
    await failing.query("set role service_role; set statement_timeout='2s';");
    const time = await begin(failing);
    const pending = h.track(finish(failing, request(subjectAction), time));
    // The subject bucket is absent: the locked, stale other-action row blocks pruning.
    await h.observe('worker_pruning_timeout');
    const result = await pending;
    assert.ok(result.error instanceof H002SqlError);
    assert.equal(result.error.sqlState, '57014');
    await h.blocker.query('rollback;');
    assert.deepEqual(await read(h.observer), before);
    await recover(h, history);
  }

  return [
    ['pruning-strict-boundary', boundary],
    ['pruning-refresh-commit', (h) => refresh(h, true)],
    ['pruning-refresh-rollback', (h) => refresh(h, false)],
    ['pruning-recreate-insert-commit', (h) => recreate(h, true)],
    ['pruning-recreate-insert-rollback', (h) => recreate(h, false)],
    ['pruning-event-failure-retry', eventFailure],
    ['pruning-timeout-retry', timeout],
  ];
}
