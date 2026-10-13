import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { postgresSession, waitForSql } from './h002-postgres-session.mjs';
import {
  assertProviderCompletion,
  assertProviderBootstrap,
  providerAuthenticationMethods,
} from './onboarding-provider-evidence.mjs';

export const providerCases = [
  ['org', false],
  ['org', true],
  ['grant', false],
  ['grant', true],
];
const interruption = Symbol('owned provider interruption');

async function settleProviderWork(blocker, observer, pending) {
  const closed = await Promise.allSettled([blocker.close(), observer.close()]);
  const settled = pending ? await pending : undefined;
  assert.ok(closed.every((result) => result.status === 'fulfilled'));
  if (settled?.error) throw settled.error;
}

function issueGrant(psql, organizationId, userId, grantId, sourceInstanceId) {
  psql(`begin;
    insert into public.organization_admin_bootstrap_grants
      (id,organization_id,eligible_user_id,authorization_source_kind,
       authorization_source_code,authorization_source_instance_id,issuance_correlation_id)
    values ('${grantId}','${organizationId}','${userId}','local_fixture',
      'feat-003-local-cli-fixture','${sourceInstanceId}','${randomUUID()}');
    insert into public.authentication_events
      (organization_id,organization_ids,actor_kind,event_name,outcome,correlation_id,
       reason_code,source_code,source_instance_id,target_kind,target_id,metadata)
    select organization_id,array[organization_id],'local_fixture','admin_bootstrap.grant_issued',
      'success',issuance_correlation_id,'local_fixture_grant_issued',authorization_source_code,
      authorization_source_instance_id,'organization_admin_bootstrap_grant',id,
      jsonb_build_object('grantVersion',version)
    from public.organization_admin_bootstrap_grants where id='${grantId}'; commit;`);
}

export async function runOnboardingProviderCases(context) {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const {
    users,
    organizationId,
    sourceInstanceId,
    psql,
    admin,
    signIn,
    promoteToAal2,
    invoke,
    evidence,
    clearScenario,
    enterStage,
    reportDiagnostic,
    cleanupProbe,
  } = context;
  const adminRoleId = evidence.json("select to_jsonb(id) from public.roles where code='admin';");
  const selected = cleanupProbe ? [1] : providerCases.map((_value, index) => index);
  for (const index of selected) {
    const [lock, remove] = providerCases[index];
    const caseStage = `provider-${lock}-${remove ? 'removed' : 'retained'}`;
    reportDiagnostic(caseStage, 'enter');
    const user = users[index];
    const grantId = randomUUID();
    enterStage('provider-grant-issuance', 'provider grant issuance');
    issueGrant(psql, organizationId, user.id, grantId, sourceInstanceId);
    enterStage('provider-password', 'provider password sign-in');
    const signedIn = await signIn(user);
    const actor = await promoteToAal2(signedIn);
    const authenticationMethods = providerAuthenticationMethods(
      actor.session.access_token,
      user.id,
    );
    enterStage('provider-parents', 'provider Auth parent capture');
    evidence.captureParents();
    enterStage('provider-inventory', 'provider factor inventory');
    const inventory = async () => {
      const result = await admin.auth.admin.mfa.listFactors({ userId: user.id });
      assert.equal(Boolean(result.error), false);
      return result.data.factors.map(({ id, factor_type, status }) => ({
        id,
        factor_type,
        status,
      }));
    };
    const originalFactors = [{ id: actor.factorId, factor_type: 'totp', status: 'verified' }];
    assert.deepEqual(await inventory(), originalFactors);
    enterStage('provider-start', 'provider onboarding start');
    const start = await invoke('organization-admin-onboarding', actor.session.access_token, {
      action: 'start',
      bootstrapGrantId: grantId,
      expectedVersion: 1,
      idempotencyKey: randomBytes(16).toString('hex'),
    });
    assert.equal(start.status, 200);
    assert.equal(start.payload.factorState, 'challenge_required');
    enterStage('provider-snapshot', 'provider initial database snapshot');
    const before = evidence.snapshot(user.id, grantId);
    assert.deepEqual(before.members, []);
    assert.deepEqual(before.profiles, []);
    assert.deepEqual(before.roles, []);
    const key = randomBytes(16).toString('hex');
    const blocker = postgresSession('r3_provider_blocker');
    const observer = postgresSession('r3_provider_observer');
    let pending;
    let interrupted = false;
    try {
      enterStage('provider-lock-acquisition', 'provider blocker acquisition');
      const table = lock === 'org' ? 'organizations' : 'organization_admin_bootstrap_grants';
      await blocker.query(
        `begin; select 1 from public.${table} where id='${lock === 'org' ? organizationId : grantId}' for update;`,
      );
      const blocked = `select exists(select 1 from pg_stat_activity w
        join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
        where b.application_name='r3_provider_blocker' and w.wait_event_type='Lock'
        and w.query like '%complete_first_organization_admin_bootstrap%');`;
      pending = invoke('organization-admin-onboarding', actor.session.access_token, {
        action: 'complete',
        bootstrapGrantId: grantId,
        expectedVersion: 1,
        idempotencyKey: key,
      }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      enterStage('provider-observed-wait', 'provider observed completion wait');
      await waitForSql(observer, blocked);
      evidence.captureParents();
      if (remove) {
        enterStage('provider-factor-removal', 'provider owned factor removal');
        const deletion = await admin.auth.admin.mfa.deleteFactor({
          userId: user.id,
          id: actor.factorId,
        });
        assert.equal(Boolean(deletion.error), false);
        assert.deepEqual(await inventory(), []);
      }
      assert.equal(await observer.query(blocked), 't');
      if (cleanupProbe) {
        enterStage('provider-interruption', 'provider interruption after removal');
        throw interruption;
      }
      await blocker.query('rollback;');
      enterStage('provider-completion', 'provider completion state');
      const settled = await pending;
      if (settled.error) throw settled.error;
      const after = evidence.snapshot(user.id, grantId);
      assertProviderCompletion(before, after, settled.value, {
        userId: user.id,
        organizationId,
        grantId,
        key,
        adminRoleId,
        authenticationMethods,
        checkpoint: (stage) => enterStage(stage, stage),
      });
      assert.deepEqual(await inventory(), remove ? [] : originalFactors);
      evidence.assertAuthority();
      enterStage('provider-final-bootstrap', 'provider final protected bootstrap');
      const access = await invoke('auth-bootstrap', actor.session.access_token, {});
      const final = evidence.snapshot(user.id, grantId);
      assertProviderBootstrap(after, final, access, {
        userId: user.id,
        organizationId,
        removed: remove,
      });
      evidence.captureParents();
      clearScenario(grantId, user.id);
      reportDiagnostic(caseStage, 'passed');
    } catch (error) {
      if (error !== interruption) throw error;
      interrupted = true;
    } finally {
      // Closing the owner rolls back its lock; settle the real request before domain cleanup.
      await settleProviderWork(blocker, observer, pending);
    }
    if (cleanupProbe) {
      assert.equal(interrupted, true);
      reportDiagnostic('provider-interruption', 'passed');
    }
  }
}
