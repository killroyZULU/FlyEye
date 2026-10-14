import { describe, expect, it } from 'vitest';
import {
  assertVerifiedDelivery,
  assertUncertaintyDenial,
  assertUnchangedAuthority,
} from './onboarding-uncertainty-evidence.mjs';

it('requires real-session assurance before substituting or discarding verification delivery', () => {
  const token = (aal, methods, subject = uuid(1)) =>
    `e30.${Buffer.from(
      JSON.stringify({
        sub: subject,
        aal,
        amr: methods.map((method) => ({ method })),
        session_id: uuid(8),
      }),
    ).toString('base64url')}.synthetic`;
  const password = token('aal1', ['password']);
  const verified = token('aal2', ['password', 'totp']);
  const session = {
    user_id: uuid(1),
    aal: 'aal2',
    factor_id: uuid(9),
    methods: ['password', 'totp'],
  };
  expect(() => assertVerifiedDelivery(password, verified, uuid(1), () => session)).not.toThrow();
  expect(() => assertVerifiedDelivery(password, password, uuid(1), () => session)).toThrow();
  expect(() =>
    assertVerifiedDelivery(
      password,
      token('aal2', ['password', 'totp'], uuid(99)),
      uuid(1),
      () => session,
    ),
  ).toThrow();
  for (const changed of [
    { ...session, aal: 'aal1' },
    { ...session, methods: ['password'] },
    { ...session, user_id: uuid(99) },
    null,
  ])
    expect(() => assertVerifiedDelivery(password, verified, uuid(1), () => changed)).toThrow();
});

const uuid = (i) => `e5000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
function fixture(kind) {
  const bootstrap = kind === 'bootstrap';
  const context = { kind, userId: uuid(1), organizationId: uuid(2), grantId: uuid(3) };
  const before = {
    grant: { status: bootstrap ? 'completed' : 'pending' },
    members: bootstrap ? [{ id: uuid(4) }] : [],
    profiles: [],
    roles: [],
    events: [{ id: uuid(5), event_name: 'admin_onboarding.completed' }],
  };
  const after = structuredClone(before);
  const result = {
    status: kind === 'authentication' ? 401 : 503,
    payload: {
      correlationId: uuid(7),
      error: {
        code:
          kind === 'authentication'
            ? 'admin_onboarding.authentication_required'
            : bootstrap
              ? 'auth.factor_inventory_unavailable'
              : 'admin_onboarding.provider_unavailable',
      },
    },
  };
  if (kind !== 'authentication')
    after.events.push({
      id: uuid(6),
      occurred_at: '2026-10-14T00:00:00Z',
      organization_id: bootstrap ? uuid(2) : null,
      organization_ids: bootstrap ? [uuid(2)] : [],
      actor_user_id: uuid(1),
      actor_subject_id: uuid(1),
      actor_kind: 'authenticated_subject',
      event_name: bootstrap ? 'authentication.access_denied' : 'admin_onboarding.conflict',
      outcome: 'denied',
      correlation_id: uuid(7),
      reason_code: 'factor_inventory_unavailable',
      source_code: null,
      source_instance_id: null,
      target_kind: bootstrap ? null : 'organization_admin_bootstrap_grant',
      target_id: bootstrap ? null : uuid(3),
      idempotency_key_hash: null,
      metadata: bootstrap
        ? { membershipCount: 1, currentAssuranceLevel: 'aal2' }
        : { currentAssuranceLevel: 'aal2' },
    });
  return { before, after, result, context };
}
describe.each(['authentication', 'factors', 'bootstrap'])('uncertainty evidence: %s', (kind) => {
  it('accepts only preserved authority and exact denial evidence', () => {
    const v = fixture(kind);
    expect(() => assertUncertaintyDenial(v.before, v.after, v.result, v.context)).not.toThrow();
  });
  it.each([
    ['membership', (v) => v.after.members.push({ id: uuid(99) })],
    ['grant', (v) => (v.after.grant.status = 'unexpected')],
    ['prior audit', (v) => (v.after.events[0].event_name = 'changed')],
    ['status', (v) => (v.result.status = 200)],
  ])('rejects changed %s', (_label, mutate) => {
    const v = fixture(kind);
    mutate(v);
    expect(() => assertUncertaintyDenial(v.before, v.after, v.result, v.context)).toThrow();
  });
});
it.each(['actor_user_id', 'organization_id', 'reason_code', 'target_id'])(
  'rejects wrong denial %s',
  (field) => {
    const v = fixture('factors');
    v.after.events[1][field] = 'wrong';
    expect(() => assertUncertaintyDenial(v.before, v.after, v.result, v.context)).toThrow();
  },
);
it('rejects duplicate or removed completion evidence during bootstrap recovery', () => {
  const v = fixture('bootstrap');
  expect(() => assertUnchangedAuthority(v.before, v.after)).not.toThrow();
  v.after.events.push(v.after.events[0]);
  expect(() => assertUnchangedAuthority(v.before, v.after)).toThrow();
  v.after.events = [];
  expect(() => assertUnchangedAuthority(v.before, v.after)).toThrow();
});
