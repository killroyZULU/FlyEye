import assert from 'node:assert/strict';
import { ids, date, notifying } from './h002-document-implicit-fixture.mjs';
import { uuid, timestamp } from './h002-document-implicit-domain.mjs';

export function expectedNotifications(test, before, after, model) {
  const table = 'aircraft_document_notifications';
  const expected = model.expected[table];
  const events = [];
  const resolution = {
    renew: 'version_superseded',
    correct: 'version_superseded',
    suspend: 'suspended',
    archive_category: 'category_archived',
    remove_category: 'requirement_removed',
  }[test.action];
  if (resolution) {
    for (const row of expected) {
      if (row.aircraft_document_id !== ids.document || row.notification_state === 'resolved')
        continue;
      const actual = after[table].find((item) => item.id === row.id);
      assert.ok(actual);
      timestamp(actual.resolved_at);
      events.push({
        target_type: 'notification',
        target_id: row.id,
        event_name: 'aircraft_document.notification_resolved',
        reason_code: resolution,
        idempotency_key_hash: null,
        metadata: {
          documentId: ids.document,
          documentVersionId: row.document_version_id,
          eventKind: row.event_kind,
          previousState: row.notification_state,
          newState: 'resolved',
          resolutionReason: resolution,
        },
      });
      Object.assign(row, {
        notification_state: 'resolved',
        resolved_at: actual.resolved_at,
        resolution_reason: resolution,
      });
    }
  }
  const reopen = ['restore', 'reassign'].includes(test.action);
  const insert = ['create', 'renew', 'correct'].includes(test.action) && notifying(test);
  if (reopen || insert) {
    for (const member of [ids.member, ids.adminMember]) {
      const actual = after[table].find(
        (row) =>
          row.recipient_membership_id === member && row.document_version_id === model.version.id,
      );
      assert.ok(actual);
      uuid(actual.id);
      timestamp(actual.created_at);
      const prior = before[table].find((row) => row.id === actual.id);
      if (reopen) assert.equal(prior?.notification_state, 'resolved');
      else assert.equal(prior, undefined);
      const row = reopen
        ? expected.find((item) => item.id === actual.id)
        : {
            id: actual.id,
            organization_id: ids.org,
            recipient_membership_id: member,
            aircraft_document_id: model.document.id,
            document_version_id: model.version.id,
            event_kind: 'warning',
            created_at: actual.created_at,
          };
      Object.assign(row, {
        notification_state: 'open',
        due_date: reopen ? '2026-09-27' : '2026-09-29',
        read_at: null,
        resolved_at: null,
        resolution_reason: null,
      });
      if (insert) expected.push(row);
      events.push({
        target_type: 'notification',
        target_id: row.id,
        event_name: `aircraft_document.notification_${reopen ? 'reopened' : 'created'}`,
        reason_code: `warning_${reopen ? 'reopened' : 'created'}`,
        idempotency_key_hash: null,
        metadata: {
          documentId: model.document.id,
          documentVersionId: model.version.id,
          eventKind: 'warning',
          previousState: reopen ? 'resolved' : null,
          newState: 'open',
          calculatedOn: date,
        },
      });
    }
  }
  return events;
}
