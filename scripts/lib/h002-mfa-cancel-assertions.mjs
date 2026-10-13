import assert from 'node:assert/strict';
import { ids, snapshot } from './h002-mfa-cancel-fixture.mjs';

export const read = async (session) => JSON.parse(await session.query(snapshot));
export function addedEvents(before, after) {
  for (const event of before.events)
    assert.deepEqual(
      after.events.find((item) => item.id === event.id),
      event,
    );
  return after.events.filter((event) => !before.events.some((item) => item.id === event.id));
}
function event(before, after, correlation, name, reason, metadata, key = null) {
  const events = addedEvents(before, after);
  assert.equal(events.length, 1);
  const actual = events[0];
  assert.match(actual.id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(actual.occurred_at)));
  assert.deepEqual(actual, {
    id: actual.id,
    occurred_at: actual.occurred_at,
    source_code: null,
    source_instance_id: null,
    organization_id: ids.org,
    organization_ids: [ids.org],
    actor_user_id: ids.actor,
    actor_subject_id: ids.actor,
    actor_kind: 'authenticated_subject',
    event_name: `member_mfa.${name}`,
    outcome: name === 'conflict' ? 'denied' : 'success',
    correlation_id: ids[correlation],
    reason_code: reason,
    target_kind: 'member_mfa_enrollment_operation',
    target_id: ids.operation,
    idempotency_key_hash: key?.repeat(64) ?? null,
    metadata: { ...metadata, membershipId: ids.member },
  });
  return actual;
}
export function unchanged(result, before, after, decision, correlation = 'second') {
  assert.deepEqual(result, { decision, correlationId: ids[correlation] });
  assert.deepEqual(after, before);
}
export function transition(action, result, before, after, correlation = 'first') {
  assert.deepEqual(
    { ...after, operation: before.operation, readiness: before.readiness, events: before.events },
    before,
  );
  const version = before.operation.version + 1;
  if (action === 'bind-conflict') {
    assert.deepEqual(result, { decision: 'conflict', correlationId: ids[correlation] });
    assert.deepEqual(after.operation, before.operation);
    assert.deepEqual(after.readiness, before.readiness);
    event(before, after, correlation, 'conflict', 'operation_state_conflict', {});
    return;
  }
  if (action === 'cancel') {
    assert.equal(before.operation.status, 'started');
    assert.deepEqual(result, {
      decision: 'cancelled',
      cleanupOutcome: 'not_required',
      replayed: false,
      correlationId: ids[correlation],
    });
    const audit = event(
      before,
      after,
      correlation,
      'enrollment_cancelled',
      'enrollment_cancelled',
      { cleanupOutcome: 'not_required' },
      'd',
    );
    assert.deepEqual(after.operation, {
      ...before.operation,
      status: 'cancelled',
      version,
      cancel_idempotency_key_hash: 'd'.repeat(64),
      cancelled_at: audit.occurred_at,
    });
    assert.deepEqual(after.readiness, before.readiness);
  } else if (action === 'bind') {
    assert.equal(before.operation.status, 'started');
    assert.deepEqual(result, {
      decision: 'bound',
      operationId: ids.operation,
      operationVersion: version,
      replayed: false,
      correlationId: ids[correlation],
    });
    assert.deepEqual(after.operation, {
      ...before.operation,
      status: 'bound',
      version,
      factor_reference_hash: 'f'.repeat(64),
      bind_idempotency_key_hash: 'b'.repeat(64),
    });
    assert.deepEqual(after.readiness, before.readiness);
    event(
      before,
      after,
      correlation,
      'factor_bound',
      'factor_bound',
      { factorReferenceHash: 'f'.repeat(64), operationVersion: version },
      'b',
    );
  } else {
    assert.equal(action, 'complete');
    assert.equal(before.operation.status, 'bound');
    assert.deepEqual(before.readiness, []);
    assert.deepEqual(result, {
      decision: 'completed',
      organizationId: ids.org,
      membershipId: ids.member,
      readinessVersion: 1,
      replayed: false,
      correlationId: ids[correlation],
    });
    const audit = event(
      before,
      after,
      correlation,
      'enrollment_completed',
      'enrollment_completed',
      { factorReferenceHash: 'f'.repeat(64), readinessVersion: 1 },
      'c',
    );
    assert.deepEqual(after.operation, {
      ...before.operation,
      status: 'completed',
      version,
      complete_idempotency_key_hash: 'c'.repeat(64),
      completed_at: audit.occurred_at,
    });
    assert.deepEqual(after.readiness, [
      {
        organization_id: ids.org,
        membership_id: ids.member,
        subject_user_id: ids.actor,
        factor_reference_hash: 'f'.repeat(64),
        verified_at: audit.occurred_at,
        updated_at: audit.occurred_at,
        version: 1,
      },
    ]);
  }
}
export function replay(result, original, before, after, correlation = 'second') {
  assert.deepEqual(result, { ...original, replayed: true, correlationId: ids[correlation] });
  assert.deepEqual(after, before);
}
