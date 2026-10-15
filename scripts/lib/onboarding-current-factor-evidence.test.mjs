import { describe, expect, it } from 'vitest';
import {
  assertCurrentFactorDenial,
  sessionIdentity,
} from './onboarding-current-factor-evidence.mjs';

const id = (n) => `a2600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const before = {
    grant: { version: 1 },
    members: [],
    profiles: [],
    roles: [],
    events: [{ id: id(9), unchanged: true }],
  };
  const after = structuredClone(before);
  after.events.push({
    id: id(3),
    occurred_at: '2026-10-15T00:00:00Z',
    organization_id: null,
    organization_ids: [],
    actor_user_id: id(1),
    actor_subject_id: id(1),
    actor_kind: 'authenticated_subject',
    event_name: 'admin_onboarding.denied',
    outcome: 'denied',
    correlation_id: id(4),
    reason_code: 'recent_authentication_required',
    source_code: null,
    source_instance_id: null,
    target_kind: 'organization_admin_bootstrap_grant',
    target_id: id(2),
    idempotency_key_hash: null,
    metadata: { currentAssuranceLevel: 'aal2' },
  });
  const result = {
    status: 403,
    payload: {
      error: {
        code: 'admin_onboarding.recent_authentication_required',
        message: 'Sign in with your password again to continue.',
      },
      correlationId: id(4),
    },
  };
  return { before, after, result, details: { userId: id(1), grantId: id(2) } };
}
const check = (v) => assertCurrentFactorDenial(v.before, v.after, v.result, v.details);
describe('current-factor denial evidence', () => {
  it('accepts exact denial and preserves a committed administrator', () => {
    const v = fixture();
    v.before.members = [{ id: id(8), status: 'active' }];
    v.after.members = structuredClone(v.before.members);
    expect(() => check(v)).not.toThrow();
  });
  it.each([
    ['grant', (v) => v.after.grant.version++],
    ['member', (v) => v.after.members.push({ id: id(8) })],
    ['profile', (v) => v.after.profiles.push({ id: id(8) })],
    ['role', (v) => v.after.roles.push({ role: 'admin' })],
    ['prior audit', (v) => (v.after.events[0].unchanged = false)],
    ['actor', (v) => (v.after.events[1].actor_subject_id = id(8))],
    ['tenant disclosure', (v) => (v.after.events[1].organization_id = id(8))],
    ['target', (v) => (v.after.events[1].target_id = id(8))],
    ['audit correlation', (v) => (v.after.events[1].correlation_id = id(8))],
    ['reason', (v) => (v.after.events[1].reason_code = 'factor_state_conflict')],
    ['missing audit', (v) => v.after.events.pop()],
    ['extra audit', (v) => v.after.events.push({ id: id(8) })],
    ['quota', (v) => (v.result.status = 429)],
    ['outage', (v) => (v.result.status = 503)],
    ['wrong denial', (v) => (v.result.payload.error.code = 'admin_onboarding.mfa_required')],
    ['extra response', (v) => (v.result.payload.membershipId = id(8))],
  ])('rejects misleading %s evidence', (_name, mutate) => {
    const v = fixture();
    mutate(v);
    expect(() => check(v)).toThrow();
  });
  it('compares real token subject and session identifiers without logging the token', () => {
    const token = `synthetic.${Buffer.from(JSON.stringify({ sub: id(1), session_id: id(2) })).toString('base64url')}.synthetic`;
    expect(sessionIdentity(token, id(1))).toBe(id(2));
    expect(() => sessionIdentity(token, id(3))).toThrow();
  });
});
