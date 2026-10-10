import { describe, expect, it } from 'vitest';
import { ids } from './h002-onboarding-fixture.mjs';
import { assertCancellation, addedEvents } from './h002-cancellation-assertions.mjs';

const result = {
  decision: 'cancelled',
  cleanupOutcome: 'not_attempted',
  replayed: false,
  correlationId: ids.correlation,
};
function fixture() {
  const before = {
    grant: { status: 'pending', version: 1 },
    members: [],
    profiles: [],
    roles: [],
    events: [],
  };
  const event = {
    id: 'synthetic-event',
    organization_id: ids.org,
    organization_ids: [ids.org],
    actor_user_id: ids.actor,
    actor_subject_id: ids.actor,
    actor_kind: 'authenticated_subject',
    event_name: 'admin_onboarding.cancelled',
    outcome: 'success',
    correlation_id: ids.correlation,
    reason_code: 'onboarding_cancelled',
    target_kind: 'organization_admin_bootstrap_grant',
    target_id: ids.grant,
    idempotency_key_hash: 'b'.repeat(64),
    metadata: { grantVersion: 2, cleanupOutcome: 'not_attempted' },
  };
  return {
    before,
    after: {
      ...structuredClone(before),
      grant: { status: 'pending', version: 2 },
      events: [event],
    },
  };
}
describe('Cancellation evidence assertions', () => {
  it('requires a version fence and matching atomic audit', () => {
    const { before, after } = fixture();
    expect(() => assertCancellation(result, before, after)).not.toThrow();
    after.grant.version = 1;
    expect(() => assertCancellation(result, before, after)).toThrow();
    after.grant.version = 2;
    after.events[0].metadata.grantVersion = 1;
    expect(() => assertCancellation(result, before, after)).toThrow();
  });
  it('rejects missing audit or unexpected authority and preserves replay state', () => {
    const { before, after } = fixture();
    expect(() => assertCancellation(result, before, { ...after, events: [] })).toThrow();
    expect(() => assertCancellation(result, before, { ...after, members: [{}] })).toThrow();
    expect(() =>
      assertCancellation({ ...result, replayed: true }, after, after, true),
    ).not.toThrow();
    expect(() => assertCancellation({ ...result, replayed: true }, before, after, true)).toThrow();
  });
  it('rejects rewritten historical audit identity or metadata', () => {
    const { after } = fixture();
    const changed = structuredClone(after);
    changed.events[0].metadata.grantVersion = 3;
    expect(() => addedEvents(after, changed)).toThrow();
    changed.events[0] = { ...after.events[0], id: 'replacement' };
    expect(() => addedEvents(after, changed)).toThrow();
  });
});
