import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authCleanupScope, authScopeSql } from './auth-runtime-scope.mjs';

export function assertMfaCompletionAudit(
  audit,
  { userId, organizationId, membershipId, operation },
) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(audit.id, uuid);
  assert.match(audit.correlation_id, uuid);
  assert.ok(Number.isFinite(Date.parse(audit.occurred_at)));
  assert.match(audit.idempotency_key_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(audit, {
    id: audit.id,
    occurred_at: audit.occurred_at,
    source_code: null,
    source_instance_id: null,
    organization_id: organizationId,
    organization_ids: [organizationId],
    actor_user_id: userId,
    actor_subject_id: userId,
    actor_kind: 'authenticated_subject',
    event_name: 'member_mfa.enrollment_completed',
    outcome: 'success',
    correlation_id: audit.correlation_id,
    reason_code: 'enrollment_completed',
    target_kind: 'member_mfa_enrollment_operation',
    target_id: operation.id,
    idempotency_key_hash: audit.idempotency_key_hash,
    metadata: {
      membershipId,
      factorReferenceHash: operation.factor_reference_hash,
      readinessVersion: 1,
    },
  });
}

export function memberMfaBrowserEvidence({
  psql,
  admin,
  userId,
  email,
  organizationId,
  membershipId,
}) {
  const scope = authCleanupScope({ identities: [{ id: userId, email }], organizationId });
  const parents = { sessions: [], factors: [] };
  const json = (sql) => JSON.parse(psql(sql, true));
  const authoritySql = `select jsonb_build_array(
    (select jsonb_agg(to_jsonb(t) order by id) from public.roles t),
    (select jsonb_agg(to_jsonb(t) order by id) from public.permissions t),
    (select jsonb_agg(to_jsonb(t) order by role_id,permission_id) from public.role_permissions t),
    (select jsonb_agg(to_jsonb(t) order by role_id) from public.membership_roles t where membership_id='${membershipId}'),
    (select to_jsonb(t) from public.organization_memberships t where id='${membershipId}'));`;
  const authority = json(authoritySql);
  const foreignSql = `select coalesce(jsonb_agg(to_jsonb(t) order by actor_user_id),'[]')
    from public.auth_bootstrap_rate_limit_state t where actor_user_id<>'${userId}';`;
  const foreign = psql(foreignSql, true);
  const limiterSql = `select jsonb_build_array(
    (select coalesce(jsonb_agg(to_jsonb(t) order by limiter_key_hash,action),'[]') from public.member_mfa_rate_limit_state t),
    (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.member_mfa_rate_limit_events t));`;
  const limiterBaseline = psql(limiterSql, true);
  function inventoryParents() {
    const current = json(`select jsonb_build_object(
      'sessions',(select coalesce(jsonb_agg(id),'[]') from auth.sessions where user_id='${userId}'),
      'factors',(select coalesce(jsonb_agg(id),'[]') from auth.mfa_factors where user_id='${userId}'));`);
    for (const key of ['sessions', 'factors'])
      parents[key] = [...new Set([...parents[key], ...current[key]])];
    authScopeSql(scope, parents);
  }
  return {
    inventoryParents,
    async inspect(state, before) {
      inventoryParents();
      const inventory = await admin.auth.admin.mfa.listFactors({ userId });
      assert.equal(Boolean(inventory.error), false);
      assert.equal(inventory.data.factors.length, 1);
      const factor = inventory.data.factors[0];
      assert.equal(factor.factor_type, 'totp');
      const operations = json(`select coalesce(jsonb_agg(to_jsonb(t)),'[]')
        from public.member_mfa_enrollment_operations t where subject_user_id='${userId}';`);
      assert.equal(operations.length, 1);
      const operation = operations[0];
      const readiness = json(`select coalesce(jsonb_agg(to_jsonb(t)),'[]')
        from public.member_mfa_readiness t where subject_user_id='${userId}';`);
      const events = json(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')
        from public.authentication_events t where actor_subject_id='${userId}' and event_name like 'member_mfa.%';`);
      assert.deepEqual(json(authoritySql), authority);
      assert.equal(operation.organization_id, organizationId);
      assert.equal(operation.membership_id, membershipId);
      assert.equal(
        operation.factor_reference_hash,
        createHash('sha256').update(factor.id).digest('hex'),
      );
      for (const event of before?.events ?? [])
        assert.deepEqual(
          events.find((item) => item.id === event.id),
          event,
        );
      if (state !== 'completed') {
        assert.equal(operation.status, 'bound');
        assert.equal(operation.version, 2);
        assert.equal(factor.status, 'unverified');
        assert.deepEqual(readiness, []);
        assert.equal(
          events.filter((event) => event.event_name === 'member_mfa.enrollment_completed').length,
          0,
        );
        if (before) {
          assert.deepEqual(operation, before.operation);
          assert.equal(factor.id, before.factorId);
        }
      } else {
        assert.equal(factor.id, before.factorId);
        assert.equal(factor.status, 'verified');
        const completion = events.filter(
          (event) => event.event_name === 'member_mfa.enrollment_completed',
        );
        assert.equal(completion.length, 1);
        const audit = completion[0];
        assertMfaCompletionAudit(audit, { userId, organizationId, membershipId, operation });
        assert.deepEqual(operation, {
          ...before.operation,
          status: 'completed',
          version: 3,
          complete_idempotency_key_hash: audit.idempotency_key_hash,
          completed_at: audit.occurred_at,
        });
        assert.deepEqual(readiness, [
          {
            organization_id: organizationId,
            membership_id: membershipId,
            subject_user_id: userId,
            factor_reference_hash: operation.factor_reference_hash,
            version: 1,
            verified_at: audit.occurred_at,
            updated_at: audit.occurred_at,
          },
        ]);
      }
      return { operation, factorId: factor.id, events };
    },
    cleanupBootstrap() {
      psql(`delete from public.auth_bootstrap_rate_limit_state where actor_user_id='${userId}';`);
    },
    assertClean() {
      assert.equal(psql(authScopeSql(scope, parents).residue, true), '0');
      assert.equal(
        psql(
          `select
        (select count(*) from public.member_mfa_readiness where subject_user_id='${userId}') +
        (select count(*) from public.member_mfa_enrollment_operations where subject_user_id='${userId}');`,
          true,
        ),
        '0',
      );
      assert.equal(psql(foreignSql, true), foreign);
      assert.equal(psql(limiterSql, true), limiterBaseline);
    },
  };
}
