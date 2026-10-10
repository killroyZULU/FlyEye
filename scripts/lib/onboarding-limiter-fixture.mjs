import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const policies = {
  status: { capacity: 4, refill: 5 },
  start: { capacity: 2, refill: 15 },
  complete: { capacity: 1, refill: 20 },
  cancel: { capacity: 2, refill: 10 },
};
export const keys = ['9'.repeat(64), '8'.repeat(64)];
export const frozen = '2100-01-01T00:00:00+00:00';
export const stateTable = 'public.admin_onboarding_rate_limit_state';
export const eventTable = 'public.admin_onboarding_rate_limit_events';
export const signature = 'public.consume_admin_onboarding_rate_limit(text,text,uuid)';
export const ownedWhere = `limiter_key_hash in (${keys.map((key) => `'${key}'`).join(',')})`;
export const clear = `delete from ${eventTable} where ${ownedWhere};
  delete from ${stateTable} where ${ownedWhere};`;
export const snapshot = `select jsonb_build_object(
  'state',(select coalesce(jsonb_agg(to_jsonb(s) order by limiter_key_hash,action),'[]'::jsonb) from ${stateTable} s),
  'events',(select coalesce(jsonb_agg(to_jsonb(e) order by correlation_id),'[]'::jsonb) from ${eventTable} e));`;
export const request = (action = 'complete', key = keys[0], correlation = randomUUID()) => ({
  action,
  key,
  correlation,
});
export const consume = ({ key, action, correlation }) =>
  `select public.consume_admin_onboarding_rate_limit('${key}','${action}','${correlation}');`;
export const begin = async (session) =>
  JSON.parse(await session.query('begin; select to_jsonb(transaction_timestamp());'));
export const read = async (session) => JSON.parse(await session.query(snapshot));
export function seed(action, tokens = 1000, key = keys[0], time = frozen) {
  return `insert into ${stateTable}(limiter_key_hash,action,tokens_milli,last_refill_at,last_decision_at)
    values('${key}','${action}',${tokens},'${time}','${time}');`;
}
export function row(action, tokens, time, key = keys[0]) {
  return {
    limiter_key_hash: key,
    action,
    tokens_milli: tokens,
    last_refill_at: time,
    last_decision_at: time,
  };
}

// Attach rejection handling immediately, including COMMIT, so interrupted fixtures
// can release the blocker and settle all requests before owned-row cleanup.
export async function finish(session, input, time) {
  try {
    const result = JSON.parse(await session.query(consume(input)));
    await session.query('commit;');
    return { ...input, time, result };
  } catch (error) {
    return { error };
  }
}

export function assertRecords(actual, records, rows) {
  assert.deepEqual(
    actual.state,
    rows.toSorted((a, b) =>
      `${a.limiter_key_hash}:${a.action}`.localeCompare(`${b.limiter_key_hash}:${b.action}`),
    ),
  );
  assert.equal(actual.events.length, records.length);
  assert.equal(new Set(actual.events.map((event) => event.id)).size, records.length);
  for (const record of records) {
    if (record.error) throw record.error;
    const { result, correlation, action, key, time } = record;
    assert.equal(typeof result.allowed, 'boolean');
    const retry = result.allowed ? null : (record.expectedRetry ?? policies[action].refill);
    assert.deepEqual(result, {
      allowed: result.allowed,
      retryAfterSeconds: retry,
      correlationId: correlation,
      networkSourceUsed: false,
      policyVersion: 'subject-action-v1',
    });
    const event = actual.events.find((item) => item.correlation_id === correlation);
    assert.ok(event);
    assert.match(event.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(event, {
      id: event.id,
      correlation_id: correlation,
      limiter_key_hash: key,
      action,
      outcome: result.allowed ? 'allowed' : 'rate_limited',
      status_code: result.allowed ? 200 : 429,
      retry_after_seconds: retry,
      network_source_used: false,
      occurred_at: time,
      policy_version: 'subject-action-v1',
    });
  }
}
