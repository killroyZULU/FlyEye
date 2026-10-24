import { describe, expect, it } from 'vitest';
import { assertRegistry } from './h002-registry-implicit-assertions.mjs';
import { ids, cases, tables, peerId } from './h002-registry-implicit-fixture.mjs';

const empty = () => Object.fromEntries(tables.map((table) => [table, []]));
const denied = { decision: 'unauthorized', correlationId: ids.correlation };
function control(trigger = false) {
  const test = { action: trigger ? 'archive' : 'create', kind: trigger ? 'trigger' : 'domain' };
  const before = empty();
  const record = {
    id: ids.aircraft,
    organization_id: ids.org,
    created_at: 'time',
    created_by: trigger ? ids.admin : ids.actor,
    updated_by: ids.actor,
    registration_mark: trigger ? 'SYN-H003' : 'SYN-NEW',
    registration_key: trigger ? 'synh003' : 'synnew',
    manufacturer: trigger ? 'Synthetic' : 'Synthetic changed',
    model: trigger ? 'Model' : 'Model changed',
    version: trigger ? 2 : 1,
    registry_state: trigger ? 'archived' : 'tracked',
    archive_reason: trigger ? 'no_longer_tracked' : null,
    archived_by: trigger ? ids.actor : null,
    archived_at: trigger ? 'time' : null,
  };
  if (trigger) {
    before.aircraft_records.push({
      ...record,
      version: 1,
      registry_state: 'tracked',
      archive_reason: null,
      archived_by: null,
      archived_at: null,
    });
    before.aircraft_document_notifications.push({
      id: ids.notification,
      organization_id: ids.org,
      recipient_membership_id: ids.member,
      aircraft_document_id: ids.document,
      document_version_id: ids.version,
      event_kind: 'warning',
      due_date: '2026-10-15',
      notification_state: 'open',
      read_at: null,
      resolved_at: null,
      resolution_reason: null,
    });
  }
  const after = structuredClone(before);
  after.aircraft_records = [record];
  const result = {
    decision: trigger ? 'archived' : 'created',
    record: { id: record.id },
    replayed: false,
    correlationId: ids.correlation,
  };
  after.aircraft_registry_idempotency.push({
    organization_id: ids.org,
    actor_user_id: ids.actor,
    target_record_id: record.id,
    action: test.action,
    idempotency_key_hash: 'a'.repeat(64),
    request_hash: 'b'.repeat(64),
    expected_version: trigger ? 1 : null,
    result: { decision: result.decision, record: result.record, replayed: false },
  });
  after.aircraft_registry_events.push({
    actor_user_id: ids.actor,
    organization_id: ids.org,
    correlation_id: ids.correlation,
    event_name: `aircraft_record.${result.decision}`,
    outcome: 'success',
    target_record_id: record.id,
    reason_code: trigger ? 'no_longer_tracked' : 'created',
    idempotency_key_hash: 'a'.repeat(64),
    metadata: trigger
      ? {
          priorVersion: 1,
          newVersion: 2,
          priorState: 'tracked',
          newState: 'archived',
          reason: 'no_longer_tracked',
        }
      : {
          priorVersion: null,
          newVersion: 1,
          registryState: 'tracked',
          registrationMark: 'SYN-NEW',
          manufacturer: 'Synthetic changed',
          model: 'Model changed',
        },
  });
  if (trigger) {
    Object.assign(after.aircraft_document_notifications[0], {
      notification_state: 'resolved',
      resolved_at: 'time',
      resolution_reason: 'aircraft_archived',
    });
    after.aircraft_document_events.push({
      id: 'event',
      actor_user_id: ids.actor,
      organization_id: ids.org,
      correlation_id: 'trigger-correlation',
      outcome: 'success',
      target_type: 'notification',
      target_id: ids.notification,
      idempotency_key_hash: null,
      event_name: 'aircraft_document.notification_resolved',
      reason_code: 'aircraft_archived',
      metadata: {
        documentId: ids.document,
        documentVersionId: ids.version,
        eventKind: 'warning',
        previousState: 'open',
        newState: 'resolved',
        resolutionReason: 'aircraft_archived',
      },
    });
  }
  return { test, result, before, after };
}
const check = (x) => assertRegistry(x.test, x.result, x.before, x.after, x.peer, false);
describe('registry implicit-wait evidence assertions', () => {
  it.each([false, true])(
    'accepts exact authorized state and audit effects (trigger=%s)',
    (trigger) => {
      expect(() => check(control(trigger))).not.toThrow();
    },
  );
  it.each([
    [
      'registration key',
      (x) => {
        x.after.aircraft_records[0].registration_key = 'wrong';
      },
    ],
    [
      'audit reason',
      (x) => {
        x.after.aircraft_registry_events[0].reason_code = 'wrong';
      },
    ],
    [
      'audit key',
      (x) => {
        x.after.aircraft_registry_events[0].idempotency_key_hash = null;
      },
    ],
    [
      'audit metadata',
      (x) => {
        x.after.aircraft_registry_events[0].metadata.newVersion = 3;
      },
    ],
    [
      'wrong trigger event',
      (x) => {
        x.after.aircraft_document_events[0].target_id = ids.version;
      },
    ],
    [
      'extra trigger event',
      (x) => {
        x.after.aircraft_document_events.push(x.after.aircraft_document_events[0]);
      },
    ],
  ])('rejects malformed positive evidence: %s', (_, mutate) => {
    const x = control(true);
    mutate(x);
    expect(() => check(x)).toThrow();
  });
  it('rejects changes to an independent uniqueness peer', () => {
    const x = control();
    x.test.kind = 'unique';
    x.test.commit = false;
    x.before.aircraft_records.push({ id: peerId.slice(1, -1), registration_key: 'synpeer' });
    x.after.aircraft_records.push({ id: peerId.slice(1, -1), registration_key: 'wrong' });
    expect(() => check(x)).toThrow();
  });
  it('accepts only the exact authorized uniqueness-conflict audit', () => {
    const x = {
      test: { kind: 'unique', commit: true, action: 'create' },
      before: empty(),
      peer: empty(),
      after: empty(),
      result: { decision: 'duplicate_registration', correlationId: ids.correlation },
    };
    x.after.aircraft_registry_events.push({
      actor_user_id: ids.actor,
      organization_id: ids.org,
      correlation_id: ids.correlation,
      event_name: 'aircraft_registry.conflicted',
      outcome: 'conflict',
      reason_code: 'duplicate_registration',
      target_record_id: null,
      idempotency_key_hash: null,
      metadata: { action: 'create' },
    });
    expect(() => check(x)).not.toThrow();
    for (const [field, value] of [
      ['target_record_id', ids.aircraft],
      ['idempotency_key_hash', 'a'.repeat(64)],
      ['metadata', { action: 'update' }],
    ]) {
      const changed = structuredClone(x);
      changed.after.aircraft_registry_events[0][field] = value;
      expect(() => check(changed)).toThrow();
    }
  });
  it('freezes 21 distinct base cases and 63 authority schedules', () => {
    expect(cases).toHaveLength(21);
    expect(new Set(cases.map((test) => test.name)).size).toBe(21);
    expect(cases.length * 3).toBe(63);
  });
  it('accepts a denied command with exact rollback', () => {
    expect(() => assertRegistry(cases[0], denied, empty(), empty(), undefined, true)).not.toThrow();
  });
  it.each(tables)('rejects a denied command retaining a write in %s', (table) => {
    const after = empty();
    after[table].push({ id: 'unexpected' });
    expect(() => assertRegistry(cases[0], denied, empty(), after, undefined, true)).toThrow();
  });
  it('rejects stale authority success even when the state snapshot is unchanged', () => {
    expect(() =>
      assertRegistry(
        cases[0],
        { ...denied, decision: 'created' },
        empty(),
        empty(),
        undefined,
        true,
      ),
    ).toThrow();
  });
  it('preserves only the committed uniqueness peer on denial', () => {
    const test = cases.find((item) => item.kind === 'unique' && item.commit);
    const peer = empty();
    peer.aircraft_records.push({ id: peerId.slice(1, -1), registration_key: 'synnew' });
    expect(() =>
      assertRegistry(test, denied, empty(), structuredClone(peer), peer, true),
    ).not.toThrow();
    expect(() => assertRegistry(test, denied, empty(), empty(), peer, true)).toThrow();
  });
});
