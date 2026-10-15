import assert from 'node:assert/strict';

export function sessionIdentity(token, userId) {
  const value = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(value.sub, userId);
  assert.match(value.session_id, /^[0-9a-f-]{36}$/);
  return value.session_id;
}

export function assertCurrentFactorDenial(before, after, result, details) {
  for (const part of ['grant', 'members', 'profiles', 'roles'])
    assert.deepEqual(after[part], before[part]);
  for (const prior of before.events)
    assert.deepEqual(
      after.events.find((event) => event.id === prior.id),
      prior,
    );
  assert.equal(result.status, 403);
  const correlationId = result.payload.correlationId;
  assert.match(correlationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(result.payload, {
    error: {
      code: 'admin_onboarding.recent_authentication_required',
      message: 'Sign in with your password again to continue.',
    },
    correlationId,
  });
  const added = after.events.filter(
    (event) => !before.events.some((prior) => prior.id === event.id),
  );
  assert.equal(added.length, 1);
  const event = added[0];
  assert.match(event.id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(event.occurred_at)));
  assert.deepEqual(event, {
    id: event.id,
    occurred_at: event.occurred_at,
    organization_id: null,
    organization_ids: [],
    actor_user_id: details.userId,
    actor_subject_id: details.userId,
    actor_kind: 'authenticated_subject',
    event_name: 'admin_onboarding.denied',
    outcome: 'denied',
    correlation_id: correlationId,
    reason_code: 'recent_authentication_required',
    source_code: null,
    source_instance_id: null,
    target_kind: 'organization_admin_bootstrap_grant',
    target_id: details.grantId,
    idempotency_key_hash: null,
    metadata: { currentAssuranceLevel: 'aal2' },
  });
}

export function currentFactorState(evidence, userId) {
  assert.match(userId, /^[0-9a-f-]{36}$/);
  return evidence.json(`select jsonb_build_object(
    'factors',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from
      (select id,user_id,factor_type,status from auth.mfa_factors where user_id='${userId}') t),
    'sessions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from
      (select id,user_id,aal,factor_id from auth.sessions where user_id='${userId}') t),
    'bindings',(select coalesce(jsonb_agg(to_jsonb(t) order by session_id),'[]')
      from public.admin_session_factor_bindings t where actor_user_id='${userId}'));`);
}

export async function verifyCurrentFactor(context, actor, factor) {
  const deadline = Date.now() + 35_000;
  while (context.currentTotp(factor.secret) === factor.usedCode && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 250));
  const code = context.currentTotp(factor.secret);
  assert.notEqual(code, factor.usedCode);
  context.evidence.captureParents();
  const result = await actor.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  assert.equal(Boolean(result.error), false);
  factor.usedCode = code;
  context.evidence.captureParents();
  const session = await actor.client.auth.getSession();
  assert.equal(Boolean(session.error), false);
  assert.ok(session.data.session);
  return { ...actor, session: session.data.session, factorId: factor.id };
}

export async function replaceCurrentFactor(context, user, original, useOriginalSession = false) {
  context.evidence.captureParents();
  const removed = await context.admin.auth.admin.mfa.deleteFactor({
    userId: user.id,
    id: original.factorId,
  });
  assert.equal(Boolean(removed.error), false);
  const actor = useOriginalSession ? original : await context.signIn(user);
  const enrolled = await actor.client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Synthetic current factor',
  });
  assert.equal(Boolean(enrolled.error), false);
  const factor = { id: enrolled.data.id, secret: enrolled.data.totp.secret };
  const verified = await verifyCurrentFactor(context, actor, factor);
  assert.deepEqual(currentFactorState(context.evidence, user.id).factors, [
    { id: factor.id, user_id: user.id, factor_type: 'totp', status: 'verified' },
  ]);
  return { factor, actor: verified };
}
