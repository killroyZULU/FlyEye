import assert from 'node:assert/strict';
import { ids, q, snapshot } from './h002-onboarding-fixture.mjs';

export const signature = 'public.start_organization_admin_onboarding(uuid,uuid,bigint,text,uuid)';
export const start = (correlation = 'correlation') =>
  `select public.start_organization_admin_onboarding(${q('actor')},${q('grant')},1,
    repeat('a',64),${q(correlation)});`;

export async function assertOutcome(
  observer,
  result,
  before,
  replayed,
  correlation = 'correlation',
) {
  const after = JSON.parse(await observer.query(snapshot));
  for (const table of ['members', 'profiles', 'roles']) {
    assert.deepEqual(before[table], []);
    assert.deepEqual(after[table], []);
  }
  for (const prior of before.events)
    assert.deepEqual(
      after.events.find((event) => event.id === prior.id),
      prior,
    );
  const events = after.events.filter(
    (event) => !before.events.some((prior) => prior.id === event.id),
  );
  const grant = { ...before.grant };
  if (result.decision === 'ready') {
    assert.deepEqual(result, {
      decision: 'ready',
      bootstrapGrantId: ids.grant,
      organizationId: ids.org,
      organizationName: 'Synthetic onboarding',
      grantVersion: 1,
      replayed,
      correlationId: ids[correlation],
    });
    if (replayed) {
      assert.deepEqual(after, before);
      return after;
    }
  } else {
    assert.deepEqual(result, { decision: 'expired', correlationId: ids[correlation] });
    Object.assign(grant, { status: 'expired', version: 2 });
  }
  assert.deepEqual(after.grant, grant);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.actor_user_id, ids.actor);
  assert.equal(event.actor_subject_id, ids.actor);
  assert.equal(event.actor_kind, 'authenticated_subject');
  assert.equal(event.correlation_id, ids[correlation]);
  assert.equal(event.organization_id, ids.org);
  assert.deepEqual(event.organization_ids, [ids.org]);
  assert.equal(event.target_kind, 'organization_admin_bootstrap_grant');
  assert.equal(event.target_id, ids.grant);
  const ready = result.decision === 'ready';
  assert.equal(
    event.event_name,
    ready ? 'admin_onboarding.started' : 'admin_onboarding.grant_expired',
  );
  assert.equal(event.outcome, ready ? 'success' : 'denied');
  assert.equal(event.reason_code, ready ? 'onboarding_started' : 'grant_expired');
  assert.equal(event.idempotency_key_hash, ready ? 'a'.repeat(64) : null);
  assert.deepEqual(event.metadata, { grantVersion: ready ? 1 : 2 });
  return after;
}
