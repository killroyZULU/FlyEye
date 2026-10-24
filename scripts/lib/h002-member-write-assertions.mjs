import assert from 'node:assert/strict';
import { ids, tables, name, contact } from './h002-member-write-fixture.mjs';

const timestamp = (value) =>
  assert.ok(typeof value === 'string' && Number.isFinite(Date.parse(value)));
const uuid = (value) =>
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const sorted = (rows) =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function unchanged(before, after) {
  for (const table of tables) assert.deepEqual(sorted(after[table]), sorted(before[table]));
}
export function assertWrite(test, result, before, after, denied, role) {
  if (denied) {
    let evidence = 'rollback';
    try {
      unchanged(before, after);
      evidence = 'response-after-verified-rollback';
      assert.deepEqual(result, {
        decision: test.family === 'profile' ? 'not_found' : 'unauthorized',
        correlationId: ids.correlation,
      });
    } catch (error) {
      error.evidence = evidence;
      throw error;
    }
    return;
  }
  const expected = structuredClone(before);
  const table =
    test.family === 'profile' ? 'member_administration_events' : 'aircraft_document_events';
  const previous = new Set(before[table].map((row) => row.id));
  const added = after[table].filter((row) => !previous.has(row.id));
  assert.equal(added.length, 1);
  const event = added[0];
  uuid(event.id);
  timestamp(event.occurred_at);
  const audit = {
    id: event.id,
    occurred_at: event.occurred_at,
    organization_id: ids.org,
    actor_user_id: ids.actor,
    outcome: 'success',
    correlation_id: ids.correlation,
    idempotency_key_hash: null,
  };
  if (test.family === 'profile') {
    const profile = expected.organization_member_profiles.find(
      (row) => row.membership_id === ids.member,
    );
    assert.ok(profile);
    Object.assign(profile, {
      display_name: name,
      contact_number: test.action === 'clear' ? null : contact,
      version: profile.version + 1,
      updated_by: ids.actor,
      updated_at: event.occurred_at,
    });
    assert.deepEqual(result, {
      decision: 'updated',
      profile: {
        organizationId: ids.org,
        organizationName: 'Synthetic H002 review',
        membershipId: ids.member,
        displayName: name,
        contactNumber: profile.contact_number,
        email: 'h002-review-actor@example.test',
        roleCode: role.code,
        roleLabel: role.label,
        status: 'active',
        version: profile.version,
        complete: true,
      },
      correlationId: ids.correlation,
    });
    Object.assign(audit, {
      target_membership_id: ids.member,
      event_name: 'member_profile.updated',
      reason_code: 'member_profile_updated',
      metadata: {
        changedFields:
          test.action === 'complete'
            ? ['displayName', 'contactNumber']
            : test.action === 'clear'
              ? ['contactNumber']
              : [],
        priorVersion: 1,
        newVersion: 2,
      },
    });
  } else {
    const notification = expected.aircraft_document_notifications.find(
      (row) => row.id === ids.notification,
    );
    assert.ok(notification);
    if (notification.notification_state === 'open')
      Object.assign(notification, { notification_state: 'read', read_at: event.occurred_at });
    assert.deepEqual(result, {
      decision: 'opened',
      notificationId: ids.notification,
      documentId: ids.document,
      state: notification.notification_state,
      correlationId: ids.correlation,
    });
    Object.assign(audit, {
      target_type: 'notification',
      target_id: ids.notification,
      event_name: 'aircraft_document.notification_opened',
      reason_code: 'notification_opened',
      metadata: {},
    });
  }
  expected[table].push(audit);
  unchanged(expected, after);
}
export function assertRetry(test, retry, before, after, denied) {
  if (denied || test.family === 'profile') {
    unchanged(before, after);
    assert.deepEqual(retry, {
      decision: denied
        ? test.family === 'profile'
          ? 'not_found'
          : 'unauthorized'
        : 'state_conflict',
      correlationId: ids.correlation,
    });
  } else assertWrite(test, retry, before, after, false);
}
