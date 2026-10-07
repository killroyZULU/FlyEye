import assert from 'node:assert/strict';
import { ids, q, snapshot } from './h002-onboarding-fixture.mjs';

export async function assertOutcome(observer, result, before, adminRole) {
  const after = JSON.parse(await observer.query(snapshot));
  assert.equal(result.correlationId, ids.correlation);
  assert.equal(after.events.length, 1);
  const event = after.events[0];
  assert.equal(event.actor_user_id, ids.actor);
  assert.equal(event.actor_subject_id, ids.actor);
  assert.equal(event.actor_kind, 'authenticated_subject');
  assert.equal(event.correlation_id, ids.correlation);
  assert.equal(event.target_kind, 'organization_admin_bootstrap_grant');
  assert.equal(event.target_id, ids.grant);
  assert.equal(event.idempotency_key_hash, null);
  const grant = { ...before.grant };
  if (result.decision === 'completed') {
    assert.equal(after.members.length, 1);
    const member = after.members[0];
    assert.equal(member.organization_id, ids.org);
    assert.equal(member.user_id, ids.actor);
    assert.equal(member.status, 'active');
    assert.equal(member.created_by, ids.actor);
    assert.equal(member.updated_by, ids.actor);
    assert.equal(after.profiles.length, 1);
    assert.deepEqual(after.profiles[0], {
      id: after.profiles[0].id,
      organization_id: ids.org,
      membership_id: member.id,
      display_name: null,
      contact_number: null,
      version: 1,
      created_at: member.created_at,
      updated_at: member.created_at,
      created_by: ids.actor,
      updated_by: ids.actor,
    });
    assert.equal(after.roles.length, 1);
    assert.equal(after.roles[0].membership_id, member.id);
    assert.equal(after.roles[0].organization_id, ids.org);
    assert.equal(after.roles[0].role_id, adminRole);
    assert.equal(after.roles[0].assigned_by, ids.actor);
    assert.deepEqual(result, {
      decision: 'completed',
      bootstrapGrantId: ids.grant,
      organizationId: ids.org,
      organizationName: 'Synthetic onboarding',
      membershipId: member.id,
      grantVersion: 2,
      correlationId: ids.correlation,
    });
    assert.equal(event.event_name, 'admin_onboarding.completed');
    assert.equal(event.outcome, 'success');
    assert.equal(event.reason_code, 'first_admin_created');
    assert.deepEqual(event.metadata, {
      grantVersion: 2,
      membershipId: member.id,
      assuranceLevel: 'aal2',
      authenticationMethods: ['password', 'totp'],
      factorCount: 1,
    });
    assert.ok(after.grant.completed_at);
    Object.assign(grant, {
      status: 'completed',
      version: 2,
      completed_at: after.grant.completed_at,
      completed_membership_id: member.id,
      completion_idempotency_key_hash: 'a'.repeat(64),
    });
  } else {
    assert.deepEqual(after.members, before.members);
    assert.deepEqual(after.profiles, before.profiles);
    assert.deepEqual(after.roles, before.roles);
    assert.deepEqual(result, { decision: result.decision, correlationId: ids.correlation });
    assert.equal(event.outcome, 'denied');
    if (result.decision === 'expired') {
      assert.equal(event.event_name, 'admin_onboarding.grant_expired');
      assert.equal(event.reason_code, 'grant_expired');
      assert.deepEqual(event.metadata, { grantVersion: 2 });
      Object.assign(grant, { status: 'expired', version: 2 });
    } else {
      assert.equal(result.decision, 'recent_authentication_required');
      assert.equal(event.event_name, 'admin_onboarding.denied');
      assert.equal(event.reason_code, 'recent_authentication_required');
      assert.deepEqual(event.metadata, {});
    }
  }
  const unscoped = result.decision === 'recent_authentication_required';
  assert.equal(event.organization_id, unscoped ? null : ids.org);
  assert.deepEqual(event.organization_ids, unscoped ? [] : [ids.org]);
  assert.deepEqual(after.grant, grant);
  assert.equal(
    await observer.query(`select count(*) from public.organization_memberships
    where organization_id=${q('org')};`),
    result.decision === 'completed' ? '1' : '0',
  );
  return after;
}
