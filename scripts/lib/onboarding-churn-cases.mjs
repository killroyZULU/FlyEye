import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { issueGrant } from './onboarding-provider-cases.mjs';
import { postgresSession, waitForSql } from './h002-postgres-session.mjs';
import { assertStaleTransition } from './onboarding-stale-evidence.mjs';
import {
  assertProviderCompletion,
  assertProviderBootstrap,
  providerAuthenticationMethods,
} from './onboarding-provider-evidence.mjs';

export const churnCases = [
  ['start', 'mixed'],
  ['complete', 'mixed'],
  ['start', 'double'],
  ['complete', 'double'],
  ['complete', 'replacement'],
  ['org', 'mixed'],
  ['grant', 'mixed'],
  ['org', 'replacement'],
  ['grant', 'replacement'],
];
const interruption = Symbol('owned factor churn interruption');

async function settleWork(blocker, observer, pending) {
  const closed = await Promise.allSettled([blocker.close(), observer.close()]);
  const settled = pending ? await pending : undefined;
  assert.ok(closed.every((result) => result.status === 'fulfilled'));
  if (settled?.error) throw settled.error;
}

async function changeInventory(context, actor, kind, inventory) {
  const { admin, evidence, currentTotp, enterStage } = context;
  enterStage('churn-enroll', 'owned second factor enrollment');
  const enrolled = await actor.client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Synthetic second factor',
  });
  if (enrolled.error) throw enrolled.error;
  assert.match(enrolled.data.id, /^[0-9a-f-]{36}$/);
  const second = { id: enrolled.data.id, factor_type: 'totp', status: 'unverified' };
  const original = { id: actor.factorId, factor_type: 'totp', status: 'verified' };
  evidence.captureParents();
  if (kind === 'double') {
    enterStage('churn-verify', 'owned second factor verification');
    const verified = await actor.client.auth.mfa.challengeAndVerify({
      factorId: second.id,
      code: currentTotp(enrolled.data.totp.secret),
    });
    if (verified.error) throw verified.error;
    second.status = 'verified';
  }
  if (kind === 'replacement') {
    enterStage('churn-remove', 'owned original factor removal');
    const removed = await admin.auth.admin.mfa.deleteFactor({
      userId: context.userId,
      id: actor.factorId,
    });
    if (removed.error) throw removed.error;
  }
  enterStage('churn-inventory', 'exact changed factor inventory');
  const expected = (kind === 'replacement' ? [second] : [original, second]).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  assert.deepEqual(inventory(), expected);
  evidence.captureParents();
  return expected;
}

async function waitCase(context, actor, phase, kind, inventory, before, details) {
  const { organizationId, grantId, key } = details;
  const { evidence, enterStage, invoke, cleanupProbe } = context;
  const blocker = postgresSession('r3_churn_blocker');
  const observer = postgresSession('r3_churn_observer');
  let pending;
  let interrupted = false;
  try {
    enterStage('churn-lock', 'completion blocker acquisition');
    const table = phase === 'org' ? 'organizations' : 'organization_admin_bootstrap_grants';
    await blocker.query(
      `begin; select 1 from public.${table} where id='${phase === 'org' ? organizationId : grantId}' for update;`,
    );
    const blocked = `select exists(select 1 from pg_stat_activity w
      join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
      where b.application_name='r3_churn_blocker' and w.wait_event_type='Lock'
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
    enterStage('churn-wait', 'observed completion wait');
    await waitForSql(observer, blocked);
    const expected = await changeInventory(context, actor, kind, inventory);
    assert.equal(await observer.query(blocked), 't');
    if (cleanupProbe) {
      enterStage('churn-interruption', 'interruption after replacement while blocked');
      throw interruption;
    }
    await blocker.query('rollback;');
    enterStage('churn-completion', 'exact completion after provider change');
    const settled = await pending;
    if (settled.error) throw settled.error;
    const after = evidence.snapshot(details.userId, grantId);
    assertProviderCompletion(before, after, settled.value, details);
    assert.deepEqual(inventory(), expected);
    enterStage('churn-bootstrap', 'final factor conflict denial');
    const access = await invoke('auth-bootstrap', actor.session.access_token, {});
    assertProviderBootstrap(after, evidence.snapshot(details.userId, grantId), access, {
      ...details,
      removed: true,
    });
    assert.deepEqual(inventory(), expected);
  } catch (error) {
    if (error !== interruption) throw error;
    interrupted = true;
  } finally {
    await settleWork(blocker, observer, pending);
  }
  if (cleanupProbe) assert.equal(interrupted, true);
}

export async function runOnboardingChurnCases(context) {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const {
    users,
    organizationId,
    sourceInstanceId,
    psql,
    signIn,
    promoteToAal2,
    invoke,
    evidence,
    enterStage,
    reportDiagnostic,
    clearScenario,
    cleanupProbe,
  } = context;
  const selected = cleanupProbe ? [8] : churnCases.map((_value, index) => index);
  const adminRoleId = evidence.json("select to_jsonb(id) from public.roles where code='admin';");
  for (const index of selected) {
    const [phase, kind] = churnCases[index];
    const stage = `churn-${phase}-${kind}`;
    reportDiagnostic(stage, 'enter');
    const userId = users[index].id;
    const grantId = randomUUID();
    const key = randomBytes(16).toString('hex');
    enterStage('churn-setup', 'owned grant and verified actor');
    issueGrant(psql, organizationId, userId, grantId, sourceInstanceId);
    const actor = await promoteToAal2(await signIn(users[index]));
    const details = {
      userId,
      organizationId,
      grantId,
      key,
      adminRoleId,
      authenticationMethods: providerAuthenticationMethods(actor.session.access_token, userId),
      assuranceLevel: 'aal2',
      factorState: 'challenge_required',
    };
    const inventory = () =>
      evidence.json(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')
      from (select id,factor_type,status from auth.mfa_factors where user_id='${userId}') t;`);
    evidence.captureParents();
    assert.deepEqual(inventory(), [
      { id: actor.factorId, factor_type: 'totp', status: 'verified' },
    ]);
    if (phase !== 'start') {
      enterStage('churn-start', 'retained factor start control');
      const before = evidence.snapshot(userId, grantId);
      const start = await invoke('organization-admin-onboarding', actor.session.access_token, {
        action: 'start',
        bootstrapGrantId: grantId,
        expectedVersion: 1,
        idempotencyKey: key,
      });
      assertStaleTransition('start', before, evidence.snapshot(userId, grantId), start, details);
    }
    const before = evidence.snapshot(userId, grantId);
    const ownedContext = { ...context, userId };
    if (phase === 'start' || phase === 'complete') {
      const expected = await changeInventory(ownedContext, actor, kind, inventory);
      enterStage('churn-denial', 'exact pre-RPC conflict and audit');
      const result = await invoke('organization-admin-onboarding', actor.session.access_token, {
        action: phase,
        bootstrapGrantId: grantId,
        expectedVersion: 1,
        idempotencyKey: key,
      });
      assertStaleTransition('entry', before, evidence.snapshot(userId, grantId), result, details);
      assert.deepEqual(inventory(), expected);
    } else {
      await waitCase(ownedContext, actor, phase, kind, inventory, before, details);
    }
    evidence.captureParents();
    evidence.assertAuthority();
    if (cleanupProbe) reportDiagnostic('churn-interruption', 'passed');
    else {
      clearScenario(grantId, userId);
      reportDiagnostic(stage, 'passed');
    }
  }
}
