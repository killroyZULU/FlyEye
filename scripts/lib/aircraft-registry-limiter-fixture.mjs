import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const groups = {
  general: { actions: ['general'], capacity: 60, rate: '2' },
  read: { actions: ['read'], capacity: 30, rate: '1' },
  mutation: { actions: ['mutation'], capacity: 6, rate: '0.1' },
  lifecycle: { actions: ['lifecycle'], capacity: 3, rate: '(1.0 / 30.0)' },
};
export const keys = ['9'.repeat(64), '8'.repeat(64)];
export const stateTable = 'public.aircraft_registry_rate_limit_state';
export const eventTable = 'public.aircraft_registry_rate_limit_events';
export const signature = 'public.consume_aircraft_registry_rate_limit(text,text,uuid)';
export const ownedWhere = `limiter_key_hash in (${keys.map((key) => `'${key}'`).join(',')})`;
export const clear = `delete from ${eventTable} where ${ownedWhere}; delete from ${stateTable} where ${ownedWhere};`;
export const noFault = `select not exists(select 1 from pg_trigger where tgname='sec013_event_fault')
  and not exists(select 1 from pg_proc where proname='sec013_event_fault');`;
export const snapshot = `select jsonb_build_object(
  'state',(select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('tokens',trim_scale(tokens)::text)
    order by limiter_key_hash,bucket),'[]'::jsonb) from ${stateTable} s),
  'events',(select coalesce(jsonb_agg(to_jsonb(e) order by correlation_id),'[]'::jsonb) from ${eventTable} e));`;
export const request = (action = 'lifecycle', key = keys[0]) => ({
  action,
  key,
  correlation: randomUUID(),
});
export const groupFor = (action) =>
  Object.keys(groups).find((group) => groups[group].actions.includes(action));
export const consume = ({ key, action, correlation }) =>
  `select public.consume_aircraft_registry_rate_limit('${key}','${action}','${correlation}');`;
export const read = async (session) => JSON.parse(await session.query(snapshot));
export const begin = async (session) =>
  JSON.parse(await session.query('begin; select to_jsonb(transaction_timestamp());'));
export const now = async (session) =>
  JSON.parse(await session.query('select to_jsonb(clock_timestamp());'));
export const seed = (group, tokens, time, key = keys[0]) =>
  `insert into ${stateTable}(limiter_key_hash,bucket,tokens,updated_at) values('${key}','${group}',${tokens},'${time}');`;
export const row = (group, tokens, time, key = keys[0]) => ({
  limiter_key_hash: key,
  bucket: group,
  tokens: String(tokens),
  updated_at: time,
});

// Read the decision while its transaction still owns the bucket lock. Privileged
// fixture readback is separate from the service_role RPC under test.
export async function finish(session, input, time) {
  try {
    const result = JSON.parse(await session.query(consume(input)));
    await session.query('reset role;');
    const state = (await read(session)).state.find(
      (item) => item.limiter_key_hash === input.key && item.bucket === groupFor(input.action),
    );
    await session.query('commit; set role service_role;');
    return { ...input, time, result, state };
  } catch (error) {
    return { error };
  }
}

// All refill/rounding expectations use PostgreSQL numeric arithmetic. JavaScript
// never rounds a fractional bucket balance or estimates elapsed wall-clock time.
export async function assertTransition(
  observer,
  record,
  prior,
  effectiveTime = record.state?.updated_at,
) {
  if (record.error) throw record.error;
  const group = groupFor(record.action);
  const { capacity, rate } = groups[group];
  const tokens = prior?.tokens ?? String(capacity);
  const previous = prior?.updated_at ?? effectiveTime;
  const expected = JSON.parse(
    await observer.query(`with refill as (
    select least(${capacity}::numeric,${tokens}::numeric +
      greatest(0,extract(epoch from ('${effectiveTime}'::timestamptz-'${previous}'::timestamptz)))*${rate}::numeric) as n
  ) select jsonb_build_object('allowed',n>=1,'tokens',trim_scale(case when n>=1 then n-1 else n end)::text,
    'retry',case when n>=1 then null else least(3600,greatest(1,ceil((1-n)/${rate})::integer)) end) from refill;`),
  );
  assert.deepEqual(record.result, {
    allowed: expected.allowed,
    retryAfterSeconds: expected.retry,
    correlationId: record.correlation,
    policyVersion: 'aircraft-registry-v1',
  });
  assert.deepEqual(record.state, row(group, expected.tokens, effectiveTime, record.key));
}

export function assertRecords(actual, records, rows) {
  assert.deepEqual(
    actual.state,
    rows.toSorted((a, b) =>
      `${a.limiter_key_hash}:${a.bucket}`.localeCompare(`${b.limiter_key_hash}:${b.bucket}`),
    ),
  );
  assert.equal(actual.events.length, records.length);
  assert.equal(new Set(actual.events.map((event) => event.id)).size, records.length);
  for (const record of records) {
    if (record.error) throw record.error;
    const event = actual.events.find((item) => item.correlation_id === record.correlation);
    assert.ok(event);
    assert.match(event.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(event, {
      id: event.id,
      limiter_key_hash: record.key,
      bucket: groupFor(record.action),
      outcome: record.result.allowed ? 'allowed' : 'rate_limited',
      retry_after_seconds: record.result.retryAfterSeconds,
      correlation_id: record.correlation,
      occurred_at: record.time,
    });
  }
}

// The trigger and temporary function exist only inside the transaction that must
// fail. No uniqueness constraint or permission change is used to inject failure.
export const eventFault = ({ key, correlation }) => `
  create temporary table sec013_temp_init(id integer) on commit drop;
  create function pg_temp.sec013_event_fault() returns trigger language plpgsql as $fault$
  begin
    if new.limiter_key_hash='${key}' and new.correlation_id='${correlation}'::uuid then
      raise exception using errcode='23514', message='Synthetic event failure';
    end if;
    return new;
  end; $fault$;
  create trigger sec013_event_fault before insert on ${eventTable}
    for each row execute function pg_temp.sec013_event_fault();`;
