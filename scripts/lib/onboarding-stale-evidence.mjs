import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function assertStaleTransition(kind, before, after, result, context) {
  const { userId, organizationId, grantId, key } = context;
  const checkpoint = context.checkpoint ?? (() => {});
  checkpoint('transition-authority');
  for (const part of ['members', 'profiles', 'roles']) {
    assert.deepEqual(before[part], []);
    assert.deepEqual(after[part], []);
  }
  const grant = { ...before.grant };
  checkpoint('transition-grant');
  if (kind === 'cancel') grant.version++;
  assert.deepEqual(after.grant, grant);
  checkpoint('transition-prior-audit');
  for (const prior of before.events)
    assert.deepEqual(
      after.events.find((event) => event.id === prior.id),
      prior,
    );
  const added = after.events.filter(
    (event) => !before.events.some((prior) => prior.id === event.id),
  );
  checkpoint('transition-status');
  assert.equal(result.status, kind === 'entry' ? 409 : 200);
  checkpoint('transition-response');
  const correlationId = result.payload.correlationId;
  assert.match(correlationId, /^[0-9a-f-]{36}$/);
  if (kind === 'entry')
    assert.deepEqual(result.payload, {
      error: {
        code: 'admin_onboarding.conflict',
        message: 'Your administrator onboarding information needs review.',
      },
      correlationId,
    });
  else if (kind === 'start')
    assert.deepEqual(result.payload, {
      decision: 'ready',
      bootstrapGrantId: grantId,
      organizationId,
      organizationName: 'FEAT-003 Synthetic Flight School',
      grantVersion: grant.version,
      replayed: false,
      correlationId,
      factorState: context.factorState ?? 'enrollment_required',
    });
  else
    assert.deepEqual(result.payload, {
      decision: 'cancelled',
      cleanupOutcome: 'not_attempted',
      replayed: kind === 'replay',
      correlationId,
    });
  checkpoint('transition-audit-count');
  assert.equal(added.length, kind === 'replay' ? 0 : 1);
  if (kind === 'replay') return;
  const event = added[0];
  assert.match(event.id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(event.occurred_at)));
  const denied = kind === 'entry';
  checkpoint('transition-audit');
  assert.deepEqual(event, {
    id: event.id,
    occurred_at: event.occurred_at,
    organization_id: denied ? null : organizationId,
    organization_ids: denied ? [] : [organizationId],
    actor_user_id: userId,
    actor_subject_id: userId,
    actor_kind: 'authenticated_subject',
    event_name: `admin_onboarding.${denied ? 'conflict' : kind === 'start' ? 'started' : 'cancelled'}`,
    outcome: denied ? 'denied' : 'success',
    correlation_id: correlationId,
    reason_code: denied
      ? 'factor_state_conflict'
      : kind === 'start'
        ? 'onboarding_started'
        : 'onboarding_cancelled',
    source_code: null,
    source_instance_id: null,
    target_kind: 'organization_admin_bootstrap_grant',
    target_id: grantId,
    idempotency_key_hash: denied ? null : createHash('sha256').update(key).digest('hex'),
    metadata: denied
      ? { currentAssuranceLevel: context.assuranceLevel ?? 'aal1' }
      : {
          grantVersion: grant.version,
          ...(kind === 'cancel' ? { cleanupOutcome: 'not_attempted' } : {}),
        },
  });
}

export function assertFactorRequests(counts, expectedEnrollments) {
  assert.deepEqual(counts, {
    enroll: expectedEnrollments,
    challenge: 0,
    verify: 0,
    remove: 0,
    complete: 0,
  });
}
