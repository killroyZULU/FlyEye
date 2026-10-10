import { describe, expect, it } from 'vitest';
import { ids } from './h002-mfa-cancel-fixture.mjs';
import { transition, addedEvents, replay } from './h002-mfa-cancel-assertions.mjs';

const result = {
  decision: 'cancelled',
  cleanupOutcome: 'not_required',
  replayed: false,
  correlationId: ids.first,
};
function fixture() {
  const time = '2026-10-10T00:00:00+00:00';
  const before = {
    operation: {
      status: 'started',
      version: 1,
      cancelled_at: null,
      cancel_idempotency_key_hash: null,
    },
    readiness: [],
    events: [],
    members: [{ status: 'active' }],
    roles: ['student_pilot'],
  };
  const event = {
    id: ids.first,
    occurred_at: time,
    source_code: null,
    source_instance_id: null,
    organization_id: ids.org,
    organization_ids: [ids.org],
    actor_user_id: ids.actor,
    actor_subject_id: ids.actor,
    actor_kind: 'authenticated_subject',
    event_name: 'member_mfa.enrollment_cancelled',
    outcome: 'success',
    correlation_id: ids.first,
    reason_code: 'enrollment_cancelled',
    target_kind: 'member_mfa_enrollment_operation',
    target_id: ids.operation,
    idempotency_key_hash: 'd'.repeat(64),
    metadata: { cleanupOutcome: 'not_required', membershipId: ids.member },
  };
  const after = {
    ...structuredClone(before),
    operation: {
      ...before.operation,
      status: 'cancelled',
      version: 2,
      cancelled_at: time,
      cancel_idempotency_key_hash: 'd'.repeat(64),
    },
    events: [event],
  };
  return { before, after };
}
describe('Member-MFA cancellation evidence assertions', () => {
  it('requires cancellation version and complete audit without altering authority', () => {
    const { before, after } = fixture();
    expect(() => transition('cancel', result, before, after)).not.toThrow();
    for (const mutate of [
      (state) => {
        state.operation.version = 1;
      },
      (state) => {
        state.events = [];
      },
      (state) => {
        state.events[0].metadata.membershipId = ids.otherMember;
      },
      (state) => {
        state.readiness = [{ version: 1 }];
      },
      (state) => {
        state.roles = ['admin'];
      },
    ]) {
      const changed = structuredClone(after);
      mutate(changed);
      expect(() => transition('cancel', result, before, changed)).toThrow();
    }
  });
  it('rejects rewritten audit identity and missing historical events', () => {
    const { after } = fixture();
    const changed = structuredClone(after);
    changed.events[0].reason_code = 'different';
    expect(() => addedEvents(after, changed)).toThrow();
    changed.events[0] = { ...after.events[0], id: ids.second };
    expect(() => addedEvents(after, changed)).toThrow();
  });
  it('requires an unchanged replay with the new request correlation', () => {
    const { before, after } = fixture();
    const response = { ...result, replayed: true, correlationId: ids.second };
    expect(() => replay(response, result, after, after)).not.toThrow();
    expect(() => replay(response, result, before, after)).toThrow();
    expect(() => replay({ ...response, correlationId: ids.first }, result, after, after)).toThrow();
  });
});
