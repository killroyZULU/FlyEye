import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authCleanupScope, authScopeSql } from './auth-runtime-scope.mjs';

export function providerAuthenticationMethods(token, userId) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(payload.sub, userId);
  assert.equal(payload.aal, 'aal2');
  const methods = [...new Set(payload.amr.map((entry) => entry.method))];
  assert.deepEqual([...methods].sort(), ['password', 'totp']);
  return methods;
}

export function assertProviderCompletion(before, after, result, context) {
  const {
    userId,
    organizationId,
    grantId,
    key,
    adminRoleId,
    authenticationMethods,
    checkpoint = () => {},
  } = context;
  checkpoint('provider-completion-response');
  assert.equal(result.status, 200);
  checkpoint('provider-completion-membership');
  assert.equal(after.members.length, 1);
  const member = after.members[0];
  assert.match(member.id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(member.created_at)));
  assert.deepEqual(member, {
    id: member.id,
    organization_id: organizationId,
    user_id: userId,
    status: 'active',
    version: 1,
    created_at: member.created_at,
    updated_at: member.created_at,
    created_by: userId,
    updated_by: userId,
  });
  checkpoint('provider-completion-response');
  assert.deepEqual(result.payload, {
    decision: 'completed',
    bootstrapGrantId: grantId,
    organizationId,
    organizationName: 'FEAT-003 Synthetic Flight School',
    membershipId: member.id,
    grantVersion: before.grant.version + 1,
    correlationId: result.payload.correlationId,
  });
  checkpoint('provider-completion-profile');
  assert.deepEqual(after.profiles, [
    {
      id: after.profiles[0]?.id,
      organization_id: organizationId,
      membership_id: member.id,
      display_name: null,
      contact_number: null,
      version: 1,
      created_at: member.created_at,
      updated_at: member.created_at,
      created_by: userId,
      updated_by: userId,
    },
  ]);
  checkpoint('provider-completion-role');
  assert.deepEqual(after.roles, [
    {
      organization_id: organizationId,
      membership_id: member.id,
      role_id: adminRoleId,
      assigned_at: member.created_at,
      assigned_by: userId,
    },
  ]);
  checkpoint('provider-completion-grant');
  assert.deepEqual(after.grant, {
    ...before.grant,
    status: 'completed',
    version: before.grant.version + 1,
    completed_at: member.created_at,
    completed_membership_id: member.id,
    completion_idempotency_key_hash: createHash('sha256').update(key).digest('hex'),
  });
  checkpoint('provider-completion-prior-audit');
  for (const event of before.events)
    assert.deepEqual(
      after.events.find((item) => item.id === event.id),
      event,
    );
  const added = after.events.filter((event) => !before.events.some((item) => item.id === event.id));
  assert.equal(added.length, 1);
  checkpoint('provider-completion-audit');
  assert.deepEqual(added[0], {
    id: added[0].id,
    occurred_at: member.created_at,
    organization_id: organizationId,
    organization_ids: [organizationId],
    actor_user_id: userId,
    actor_subject_id: userId,
    actor_kind: 'authenticated_subject',
    event_name: 'admin_onboarding.completed',
    outcome: 'success',
    correlation_id: result.payload.correlationId,
    reason_code: 'first_admin_created',
    source_code: null,
    source_instance_id: null,
    target_kind: 'organization_admin_bootstrap_grant',
    target_id: grantId,
    idempotency_key_hash: null,
    metadata: {
      grantVersion: before.grant.version + 1,
      membershipId: member.id,
      assuranceLevel: 'aal2',
      authenticationMethods,
      factorCount: 1,
    },
  });
}

export function assertProviderBootstrap(
  before,
  after,
  result,
  { userId, organizationId, removed },
) {
  if (removed) {
    assert.equal(result.status, 409);
    assert.equal(result.payload.error?.code, 'auth.access_context_conflict');
    assert.equal(result.payload.memberships, undefined);
  } else {
    assert.equal(result.status, 200);
    assert.equal(result.payload.decision, 'granted');
    assert.equal(result.payload.memberships.length, 1);
    assert.equal(result.payload.memberships[0].role, 'admin');
    assert.equal(result.payload.memberships[0].organizationId, organizationId);
  }
  for (const part of ['grant', 'members', 'profiles', 'roles'])
    assert.deepEqual(after[part], before[part]);
  for (const event of before.events)
    assert.deepEqual(
      after.events.find((item) => item.id === event.id),
      event,
    );
  const added = after.events.filter((event) => !before.events.some((item) => item.id === event.id));
  assert.equal(added.length, 1);
  const event = added[0];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  assert.match(event.id, uuid);
  assert.match(event.correlation_id, uuid);
  assert.ok(Number.isFinite(Date.parse(event.occurred_at)));
  if (!removed) assert.equal(event.correlation_id, result.payload.correlationId);
  assert.deepEqual(event, {
    id: event.id,
    occurred_at: event.occurred_at,
    organization_id: organizationId,
    organization_ids: [organizationId],
    actor_user_id: userId,
    actor_subject_id: userId,
    actor_kind: 'authenticated_subject',
    event_name: removed ? 'authentication.access_denied' : 'authentication.access_context_loaded',
    outcome: removed ? 'denied' : 'success',
    correlation_id: event.correlation_id,
    reason_code: removed ? 'factor_state_conflict' : 'access_context_granted',
    source_code: null,
    source_instance_id: null,
    target_kind: null,
    target_id: null,
    idempotency_key_hash: null,
    metadata: { membershipCount: 1, currentAssuranceLevel: 'aal2' },
  });
}

export function onboardingProviderEvidence({ users, organizationId, limiterSecret, psql }) {
  const scope = authCleanupScope({ identities: users, organizationId, limiterSecret });
  const parents = { sessions: [], factors: [] };
  const json = (sql) => JSON.parse(psql(sql, {}, true));
  const owned = authScopeSql(scope);
  assert.equal(psql(owned.residue, {}, true), '0');
  const authoritySql = `select jsonb_build_array(
    (select jsonb_agg(to_jsonb(t) order by id) from public.roles t),
    (select jsonb_agg(to_jsonb(t) order by id) from public.permissions t),
    (select jsonb_agg(to_jsonb(t) order by role_id,permission_id) from public.role_permissions t));`;
  const authority = json(authoritySql);
  const foreign = psql(owned.foreignLimiter, {}, true);
  const foreignBootstrapSql = `select coalesce(jsonb_agg(to_jsonb(t) order by actor_user_id),'[]')
    from public.auth_bootstrap_rate_limit_state t where actor_user_id not in (${owned.ids});`;
  const foreignBootstrap = psql(foreignBootstrapSql, {}, true);
  const foreignBindingsSql = `select coalesce(jsonb_agg(to_jsonb(t) order by session_id),'[]')
    from public.admin_session_factor_bindings t where actor_user_id not in (${owned.ids});`;
  const foreignBindings = psql(foreignBindingsSql, {}, true);
  return {
    json,
    captureParents() {
      const current = json(`select jsonb_build_object(
        'sessions',(select coalesce(jsonb_agg(id),'[]') from auth.sessions where user_id in (${owned.ids})),
        'factors',(select coalesce(jsonb_agg(id),'[]') from auth.mfa_factors where user_id in (${owned.ids})));`);
      for (const kind of ['sessions', 'factors'])
        parents[kind] = [...new Set([...parents[kind], ...current[kind]])];
      authScopeSql(scope, parents);
    },
    snapshot(userId, grantId) {
      assert.ok(scope.ids.includes(userId));
      assert.match(grantId, /^[0-9a-f-]{36}$/);
      return json(`select jsonb_build_object(
        'grant',(select to_jsonb(t) from public.organization_admin_bootstrap_grants t where id='${grantId}'),
        'members',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.organization_memberships t where user_id='${userId}'),
        'profiles',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.organization_member_profiles t where membership_id in(select id from public.organization_memberships where user_id='${userId}')),
        'roles',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.membership_roles t where membership_id in(select id from public.organization_memberships where user_id='${userId}')),
        'events',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.authentication_events t where actor_subject_id='${userId}' or target_id='${grantId}'));`);
    },
    assertAuthority() {
      assert.deepEqual(json(authoritySql), authority);
    },
    cleanupLimiter() {
      psql(owned.limiterCleanup);
    },
    assertClean() {
      assert.equal(psql(authScopeSql(scope, parents).residue, {}, true), '0');
      assert.equal(psql(owned.foreignLimiter, {}, true), foreign);
      assert.equal(psql(foreignBootstrapSql, {}, true), foreignBootstrap);
      assert.equal(psql(foreignBindingsSql, {}, true), foreignBindings);
      assert.equal(
        psql(
          `select count(*) from public.admin_session_factor_bindings where actor_user_id in (${owned.ids});`,
          {},
          true,
        ),
        '0',
      );
      assert.deepEqual(json(authoritySql), authority);
    },
  };
}
