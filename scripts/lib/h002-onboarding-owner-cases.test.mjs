import { describe, expect, it } from 'vitest';
import { ids } from './h002-onboarding-fixture.mjs';
import { assertOwnerDenied, cases } from './h002-onboarding-owner-cases.mjs';

function fixture(action = 'complete') {
  const before = {
    grant: { status: 'completed', version: 2, eligible_user_id: ids.session },
    members: [{ id: 'member', user_id: ids.actor }],
    profiles: [{ id: 'profile', membership_id: 'member' }],
    roles: [{ membership_id: 'member', role_id: 'admin' }],
    events: [{ id: 'original-completion', metadata: { grantVersion: 2 } }],
  };
  const event = {
    id: 'denial',
    organization_id: null,
    organization_ids: [],
    actor_user_id: ids.actor,
    actor_subject_id: ids.actor,
    actor_kind: 'authenticated_subject',
    event_name: 'admin_onboarding.denied',
    outcome: 'denied',
    correlation_id: ids.correlation,
    reason_code: 'grant_not_available',
    target_kind: null,
    target_id: null,
    idempotency_key_hash: null,
    metadata: {},
  };
  const after = structuredClone(before);
  if (action !== 'cancel') after.events.push(event);
  const result = {
    decision: 'not_available',
    ...(action === 'cancel' ? { cleanupOutcome: 'not_attempted' } : {}),
    correlationId: ids.correlation,
  };
  return { before, after, result };
}

describe('Onboarding owner denial evidence', () => {
  it.each(['start', 'complete', 'cancel'])('accepts exact %s denial', (action) => {
    const { before, after, result } = fixture(action);
    expect(() => assertOwnerDenied(action, result, before, after)).not.toThrow();
  });
  it.each(['organizationId', 'organizationName', 'bootstrapGrantId', 'membershipId'])(
    'rejects response disclosure: %s',
    (field) => {
      const { before, after, result } = fixture();
      result[field] = 'disclosed';
      expect(() => assertOwnerDenied('complete', result, before, after)).toThrow();
    },
  );
  it.each([
    ['organization_id', ids.org],
    ['organization_ids', [ids.org]],
    ['target_id', ids.grant],
    ['target_kind', 'organization_admin_bootstrap_grant'],
    ['actor_user_id', ids.session],
    ['actor_subject_id', ids.session],
    ['actor_kind', 'system'],
    ['event_name', 'admin_onboarding.completed'],
    ['outcome', 'success'],
    ['correlation_id', ids.issuance],
    ['reason_code', 'other'],
    ['idempotency_key_hash', 'a'.repeat(64)],
    ['metadata', { grantVersion: 2 }],
  ])('rejects incorrect denial audit %s', (field, value) => {
    const { before, after, result } = fixture();
    after.events[1][field] = value;
    expect(() => assertOwnerDenied('complete', result, before, after)).toThrow();
  });
  it.each(['grant', 'members', 'profiles', 'roles'])('rejects changed %s', (field) => {
    const { before, after, result } = fixture();
    after[field] = null;
    expect(() => assertOwnerDenied('complete', result, before, after)).toThrow();
  });
  it('rejects a missing or duplicated denial event', () => {
    for (const count of [0, 2]) {
      const { before, after, result } = fixture();
      after.events = [after.events[0], ...Array(count).fill(after.events[1])];
      expect(() => assertOwnerDenied('complete', result, before, after)).toThrow();
    }
  });
  it('preserves prior completion audit fields', () => {
    const { before, after, result } = fixture();
    after.events[0].metadata.grantVersion = 3;
    expect(() => assertOwnerDenied('complete', result, before, after)).toThrow();
  });
  it('rejects an audit event on denied cancellation', () => {
    const { before, after, result } = fixture('cancel');
    after.events.push({ id: 'unexpected' });
    expect(() => assertOwnerDenied('cancel', result, before, after)).toThrow();
  });
  it('keeps nineteen unique cases and reuses the existing cancellation grant-commit case', () => {
    expect(cases).toHaveLength(19);
    expect(new Set(cases.map(([name]) => name)).size).toBe(19);
    expect(cases.some(([name]) => name === 'cancel-grant-commit')).toBe(false);
  });
});
