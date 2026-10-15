import assert from 'node:assert/strict';
import { assertPasswordOnly } from './onboarding-challenge-evidence.mjs';
import { providerAuthenticationMethods } from './onboarding-provider-evidence.mjs';

export function assertVerifiedDelivery(passwordToken, verifiedToken, userId, readSession) {
  assertPasswordOnly(passwordToken, userId);
  providerAuthenticationMethods(verifiedToken, userId);
  const claims = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const sessionId = claims(verifiedToken).session_id;
  assert.match(sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(sessionId, claims(passwordToken).session_id);
  const session = readSession(sessionId);
  assert.equal(session.user_id, userId);
  assert.equal(session.aal, 'aal2');
  assert.match(session.factor_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(session.methods, ['password', 'totp']);
}

export function assertUncertaintyDenial(before, after, result, context) {
  const { userId, organizationId, grantId, kind } = context;
  for (const part of ['grant', 'members', 'profiles', 'roles'])
    assert.deepEqual(after[part], before[part]);
  if (kind === 'authentication') {
    assert.equal(result.status, 401);
    assert.equal(result.payload.error.code, 'admin_onboarding.authentication_required');
    assert.deepEqual(after.events, before.events);
    return;
  }
  const bootstrap = kind === 'bootstrap';
  assert.equal(result.status, 503);
  assert.equal(
    result.payload.error.code,
    bootstrap ? 'auth.factor_inventory_unavailable' : 'admin_onboarding.provider_unavailable',
  );
  assert.equal(result.payload.memberships, undefined);
  for (const prior of before.events)
    assert.deepEqual(
      after.events.find((event) => event.id === prior.id),
      prior,
    );
  const added = after.events.filter(
    (event) => !before.events.some((prior) => prior.id === event.id),
  );
  assert.equal(added.length, 1);
  const event = added[0];
  assert.match(event.id, /^[0-9a-f-]{36}$/);
  assert.match(event.correlation_id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(event.occurred_at)));
  if (!bootstrap) assert.equal(event.correlation_id, result.payload.correlationId);
  assert.deepEqual(event, {
    id: event.id,
    occurred_at: event.occurred_at,
    organization_id: bootstrap ? organizationId : null,
    organization_ids: bootstrap ? [organizationId] : [],
    actor_user_id: userId,
    actor_subject_id: userId,
    actor_kind: 'authenticated_subject',
    event_name: bootstrap ? 'authentication.access_denied' : 'admin_onboarding.conflict',
    outcome: 'denied',
    correlation_id: event.correlation_id,
    reason_code: 'factor_inventory_unavailable',
    source_code: null,
    source_instance_id: null,
    target_kind: bootstrap ? null : 'organization_admin_bootstrap_grant',
    target_id: bootstrap ? null : grantId,
    idempotency_key_hash: null,
    metadata: bootstrap
      ? { membershipCount: 1, currentAssuranceLevel: 'aal2' }
      : { currentAssuranceLevel: 'aal2' },
  });
}

export function assertUnchangedAuthority(before, after) {
  for (const part of ['grant', 'members', 'profiles', 'roles'])
    assert.deepEqual(after[part], before[part]);
  assert.deepEqual(
    after.events.filter((event) => event.event_name === 'admin_onboarding.completed'),
    before.events.filter((event) => event.event_name === 'admin_onboarding.completed'),
  );
}
