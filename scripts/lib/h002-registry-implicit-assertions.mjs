import assert from 'node:assert/strict';
import { ids, peerId, success } from './h002-registry-implicit-fixture.mjs';

export function assertRegistry(test, result, before, after, peerState, denied) {
  const baseline = test.kind === 'unique' && test.commit ? peerState : before;
  const conflict = test.kind === 'unique' && test.commit;
  assert.equal(result.correlationId, ids.correlation);
  assert.equal(
    result.decision,
    denied ? 'unauthorized' : conflict ? 'duplicate_registration' : success(test),
  );
  if (denied) {
    assert.deepEqual(after, baseline);
    return;
  }
  const audits = after.aircraft_registry_events;
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor_user_id, ids.actor);
  assert.equal(audits[0].organization_id, ids.org);
  assert.equal(audits[0].correlation_id, ids.correlation);
  assert.equal(
    audits[0].event_name,
    conflict ? 'aircraft_registry.conflicted' : `aircraft_record.${success(test)}`,
  );
  assert.equal(audits[0].outcome, conflict ? 'conflict' : 'success');
  if (conflict) {
    assert.deepEqual({ ...after, aircraft_registry_events: [] }, baseline);
    assert.equal(audits[0].reason_code, 'duplicate_registration');
    assert.equal(audits[0].target_record_id, null);
    assert.equal(audits[0].idempotency_key_hash, null);
    assert.deepEqual(audits[0].metadata, { action: test.action });
    return;
  }
  const records = after.aircraft_records.filter((row) => row.id !== peerId.slice(1, -1));
  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.id, result.record.id);
  assert.equal(record.organization_id, ids.org);
  assert.equal(record.version, test.action === 'create' ? 1 : 2);
  assert.equal(record.registry_state, test.action === 'archive' ? 'archived' : 'tracked');
  assert.equal(
    record.registration_mark,
    ['create', 'update'].includes(test.action) ? 'SYN-NEW' : 'SYN-H003',
  );
  assert.equal(record.updated_by, ids.actor);
  assert.equal(
    record.registration_key,
    ['create', 'update'].includes(test.action) ? 'synnew' : 'synh003',
  );
  assert.equal(
    record.manufacturer,
    ['create', 'update'].includes(test.action) ? 'Synthetic changed' : 'Synthetic',
  );
  assert.equal(
    record.model,
    ['create', 'update'].includes(test.action) ? 'Model changed' : 'Model',
  );
  assert.equal(record.archive_reason, test.action === 'archive' ? 'no_longer_tracked' : null);
  assert.equal(record.archived_by, test.action === 'archive' ? ids.actor : null);
  assert.equal(record.archived_at === null, test.action !== 'archive');
  if (test.action !== 'create') {
    const prior = before.aircraft_records.find((row) => row.id === ids.aircraft);
    for (const field of ['id', 'organization_id', 'created_at', 'created_by'])
      assert.equal(record[field], prior[field]);
  }
  assert.deepEqual(
    after.aircraft_records.filter((row) => row.id === peerId.slice(1, -1)),
    baseline.aircraft_records.filter((row) => row.id === peerId.slice(1, -1)),
  );
  assert.equal(audits[0].target_record_id, record.id);
  const identity = (row) => ({
    registrationMark: row.registration_mark,
    manufacturer: row.manufacturer,
    model: row.model,
  });
  const prior = before.aircraft_records.find((row) => row.id === ids.aircraft);
  const reason =
    test.action === 'archive'
      ? 'no_longer_tracked'
      : test.action === 'reactivate'
        ? 'tracking_resumed'
        : success(test);
  const metadata =
    test.action === 'create'
      ? { priorVersion: null, newVersion: 1, registryState: 'tracked', ...identity(record) }
      : test.action === 'update'
        ? {
            priorVersion: 1,
            newVersion: 2,
            registryState: 'tracked',
            before: identity(prior),
            after: identity(record),
          }
        : {
            priorVersion: 1,
            newVersion: 2,
            priorState: prior.registry_state,
            newState: record.registry_state,
            reason,
          };
  assert.equal(audits[0].reason_code, reason);
  assert.equal(audits[0].idempotency_key_hash, 'a'.repeat(64));
  assert.deepEqual(audits[0].metadata, metadata);
  assert.equal(after.aircraft_registry_idempotency.length, 1);
  const saved = after.aircraft_registry_idempotency[0];
  assert.equal(saved.target_record_id, record.id);
  assert.equal(saved.actor_user_id, ids.actor);
  assert.equal(saved.organization_id, ids.org);
  assert.equal(saved.action, test.action);
  assert.equal(saved.idempotency_key_hash, 'a'.repeat(64));
  assert.equal(saved.request_hash, 'b'.repeat(64));
  assert.equal(saved.expected_version, test.action === 'create' ? null : 1);
  assert.deepEqual(
    saved.result,
    Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'correlationId')),
  );
  for (const table of [
    'aircraft_documents',
    'aircraft_document_versions',
    'aircraft_document_requirements',
    'aircraft_document_categories',
  ])
    assert.deepEqual(after[table], before[table]);
  if (test.kind !== 'trigger') {
    assert.deepEqual(after.aircraft_document_notifications, before.aircraft_document_notifications);
    assert.deepEqual(after.aircraft_document_events, before.aircraft_document_events);
  } else {
    const prior = before.aircraft_document_notifications[0];
    const existing = after.aircraft_document_notifications.find(
      (row) => row.id === ids.notification,
    );
    assert.equal(existing.notification_state, test.action === 'archive' ? 'resolved' : 'open');
    assert.equal(after.aircraft_document_notifications.length, test.action === 'archive' ? 1 : 2);
    assert.equal(
      after.aircraft_document_events.length - before.aircraft_document_events.length,
      test.action === 'archive' ? 1 : 2,
    );
    assert.equal(
      after.aircraft_document_notifications.filter(
        (row) => row.recipient_membership_id === ids.member,
      ).length,
      1,
    );
    assert.deepEqual(existing, {
      ...prior,
      notification_state: test.action === 'archive' ? 'resolved' : 'open',
      read_at: null,
      resolved_at: test.action === 'archive' ? existing.resolved_at : null,
      resolution_reason: test.action === 'archive' ? 'aircraft_archived' : null,
    });
    if (test.action === 'archive') assert.ok(existing.resolved_at);
    const priorIds = new Set(before.aircraft_document_events.map((row) => row.id));
    assert.deepEqual(
      after.aircraft_document_events.filter((row) => priorIds.has(row.id)),
      before.aircraft_document_events,
    );
    const added = after.aircraft_document_events.filter((row) => !priorIds.has(row.id));
    const expectedNames =
      test.action === 'archive'
        ? ['aircraft_document.notification_resolved']
        : ['aircraft_document.notification_created', 'aircraft_document.notification_reopened'];
    assert.deepEqual(added.map((row) => row.event_name).sort(), expectedNames.sort());
    assert.equal(new Set(added.map((row) => row.correlation_id)).size, 1);
    for (const event of added) {
      assert.equal(event.actor_user_id, ids.actor);
      assert.equal(event.organization_id, ids.org);
      assert.equal(event.outcome, 'success');
      assert.equal(event.target_type, 'notification');
      assert.equal(event.idempotency_key_hash, null);
      const notification = after.aircraft_document_notifications.find(
        (row) => row.id === event.target_id,
      );
      assert.ok(notification);
      assert.equal(notification.organization_id, ids.org);
      assert.equal(notification.aircraft_document_id, ids.document);
      assert.equal(notification.document_version_id, ids.version);
      assert.equal(notification.event_kind, 'warning');
      assert.equal(notification.due_date, prior.due_date);
      const created = event.event_name.endsWith('_created');
      assert.equal(notification.recipient_membership_id, created ? ids.adminMember : ids.member);
      assert.equal(
        notification.notification_state,
        test.action === 'archive' ? 'resolved' : 'open',
      );
      assert.equal(
        event.reason_code,
        test.action === 'archive'
          ? 'aircraft_archived'
          : created
            ? 'warning_created'
            : 'warning_reopened',
      );
      const metadata = {
        documentId: ids.document,
        documentVersionId: ids.version,
        eventKind: 'warning',
        previousState: test.action === 'archive' ? 'open' : created ? null : 'resolved',
        newState: test.action === 'archive' ? 'resolved' : 'open',
        ...(test.action === 'archive'
          ? { resolutionReason: 'aircraft_archived' }
          : { calculatedOn: event.metadata.calculatedOn }),
      };
      assert.deepEqual(event.metadata, metadata);
      if (test.action === 'reactivate')
        assert.match(event.metadata.calculatedOn, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
}
