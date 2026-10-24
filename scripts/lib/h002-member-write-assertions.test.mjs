import { describe, expect, it } from 'vitest';
import { assertWrite, assertRetry } from './h002-member-write-assertions.mjs';
import { cases, authorities, tables, ids, name, contact } from './h002-member-write-fixture.mjs';

const time = '2026-10-01T00:00:00+00:00',
  later = '2026-10-02T00:00:00+00:00';
const empty = () => Object.fromEntries(tables.map((table) => [table, []]));
const role = { code: 'student_pilot', label: 'Student Pilot' };
function fixture(family = 'profile', action = 'complete') {
  const test = { family, action },
    before = empty();
  before.organization_member_profiles.push({
    id: ids.operation,
    organization_id: ids.org,
    membership_id: ids.member,
    display_name: action === 'complete' ? null : name,
    contact_number: action === 'complete' ? null : contact,
    version: 1,
    created_at: time,
    created_by: ids.admin,
    updated_at: time,
    updated_by: ids.admin,
  });
  before.aircraft_document_notifications.push({
    id: ids.notification,
    organization_id: ids.org,
    recipient_membership_id: ids.member,
    aircraft_document_id: ids.document,
    document_version_id: ids.version,
    event_kind: 'warning',
    due_date: '2026-09-27',
    notification_state: action,
    read_at: action === 'read' ? time : null,
    resolved_at: action === 'resolved' ? time : null,
    resolution_reason: action === 'resolved' ? 'suspended' : null,
    created_at: time,
  });
  const after = structuredClone(before);
  const event = {
    id: ids.invitation,
    occurred_at: later,
    organization_id: ids.org,
    actor_user_id: ids.actor,
    outcome: 'success',
    correlation_id: ids.correlation,
    idempotency_key_hash: null,
  };
  let result;
  if (family === 'profile') {
    Object.assign(after.organization_member_profiles[0], {
      display_name: name,
      contact_number: action === 'clear' ? null : contact,
      version: 2,
      updated_by: ids.actor,
      updated_at: later,
    });
    after.member_administration_events.push({
      ...event,
      target_membership_id: ids.member,
      event_name: 'member_profile.updated',
      reason_code: 'member_profile_updated',
      metadata: {
        changedFields:
          action === 'complete'
            ? ['displayName', 'contactNumber']
            : action === 'clear'
              ? ['contactNumber']
              : [],
        priorVersion: 1,
        newVersion: 2,
      },
    });
    result = {
      decision: 'updated',
      profile: {
        organizationId: ids.org,
        organizationName: 'Synthetic H002 review',
        membershipId: ids.member,
        displayName: name,
        contactNumber: action === 'clear' ? null : contact,
        email: 'h002-review-actor@example.test',
        roleCode: role.code,
        roleLabel: role.label,
        status: 'active',
        version: 2,
        complete: true,
      },
      correlationId: ids.correlation,
    };
  } else {
    if (action === 'open')
      Object.assign(after.aircraft_document_notifications[0], {
        notification_state: 'read',
        read_at: later,
      });
    after.aircraft_document_events.push({
      ...event,
      target_type: 'notification',
      target_id: ids.notification,
      event_name: 'aircraft_document.notification_opened',
      reason_code: 'notification_opened',
      metadata: {},
    });
    result = {
      decision: 'opened',
      notificationId: ids.notification,
      documentId: ids.document,
      state: action === 'open' ? 'read' : action,
      correlationId: ids.correlation,
    };
  }
  return { test, before, after, result };
}
describe('profile/notification write-wait evidence', () => {
  it('freezes 75 schedules with role-appropriate authority variants', () => {
    expect(cases).toHaveLength(25);
    expect(cases.reduce((sum, test) => sum + authorities(test).length, 0)).toBe(75);
    expect(new Set(cases.map((test) => test.name)).size).toBe(25);
    expect(authorities({ family: 'profile' })).toEqual(['membership', 'retained', 'student']);
  });
  it.each(['complete', 'clear', 'unchanged'])(
    'accepts exact profile %s effects and student response',
    (action) => {
      const f = fixture('profile', action);
      expect(() => assertWrite(f.test, f.result, f.before, f.after, false, role)).not.toThrow();
    },
  );
  it.each(['open', 'read', 'resolved'])('accepts exact notification %s effects', (action) => {
    const f = fixture('notification', action);
    expect(() => assertWrite(f.test, f.result, f.before, f.after, false)).not.toThrow();
  });
  it.each(['profile', 'notification'])(
    'requires non-disclosing %s denial and complete rollback',
    (family) => {
      const f = fixture(family, family === 'profile' ? 'complete' : 'open');
      const result = {
        decision: family === 'profile' ? 'not_found' : 'unauthorized',
        correlationId: ids.correlation,
      };
      expect(() => assertWrite(f.test, result, f.before, f.before, true)).not.toThrow();
      for (const table of tables) {
        const after = structuredClone(f.before);
        after[table].push({ id: ids.competingInvitation });
        expect(() => assertWrite(f.test, result, f.before, after, true)).toThrow();
      }
      expect(() =>
        assertWrite(f.test, { ...result, profile: {} }, f.before, f.before, true),
      ).toThrow();
    },
  );
  it('distinguishes surviving writes from an incorrect response after rollback', () => {
    const f = fixture();
    for (const [after, evidence] of [
      [f.after, 'rollback'],
      [f.before, 'response-after-verified-rollback'],
    ]) {
      try {
        assertWrite(f.test, f.result, f.before, after, true);
        expect.fail('Expected denial assertion');
      } catch (error) {
        expect(error.evidence).toBe(evidence);
      }
    }
  });
  it.each(['version', 'display_name', 'contact_number', 'updated_by', 'created_by'])(
    'rejects wrong profile %s',
    (field) => {
      const f = fixture();
      f.after.organization_member_profiles[0][field] = 'wrong';
      expect(() => assertWrite(f.test, f.result, f.before, f.after, false, role)).toThrow();
    },
  );
  it.each([
    'actor_user_id',
    'target_membership_id',
    'event_name',
    'correlation_id',
    'metadata',
    'idempotency_key_hash',
  ])('rejects wrong profile audit %s', (field) => {
    const f = fixture();
    f.after.member_administration_events[0][field] = 'wrong';
    expect(() => assertWrite(f.test, f.result, f.before, f.after, false, role)).toThrow();
  });
  it('rejects extra profile data and changes to unrelated or revocation rows', () => {
    const f = fixture();
    expect(() =>
      assertWrite(f.test, { ...f.result, secret: 'unexpected' }, f.before, f.after, false, role),
    ).toThrow();
    f.before.member_administration_events.push({
      id: ids.competingInvitation,
      event_name: 'member_status.revoked',
    });
    expect(() => assertWrite(f.test, f.result, f.before, f.after, false, role)).toThrow();
  });
  it.each(['notification_state', 'read_at', 'resolved_at', 'recipient_membership_id'])(
    'rejects wrong notification %s',
    (field) => {
      const f = fixture('notification', 'resolved');
      f.after.aircraft_document_notifications[0][field] = 'wrong';
      expect(() => assertWrite(f.test, f.result, f.before, f.after, false)).toThrow();
    },
  );
  it('requires an unchanged profile on version-conflict retry', () => {
    const f = fixture(),
      retry = { decision: 'state_conflict', correlationId: ids.correlation };
    expect(() => assertRetry(f.test, retry, f.after, f.after, false)).not.toThrow();
    expect(() => assertRetry(f.test, retry, f.before, f.after, false)).toThrow();
  });
  it('requires a fresh audit on notification reopen', () => {
    const f = fixture('notification', 'read');
    expect(() => assertRetry(f.test, f.result, f.before, f.after, false)).not.toThrow();
    expect(() => assertRetry(f.test, f.result, f.before, f.before, false)).toThrow();
  });
});
