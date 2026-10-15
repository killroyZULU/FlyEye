import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { issueGrant } from './onboarding-provider-cases.mjs';
import { postgresSession, waitForSql } from './h002-postgres-session.mjs';
import {
  assertProviderCompletion,
  assertProviderBootstrap,
  providerAuthenticationMethods,
} from './onboarding-provider-evidence.mjs';
import {
  assertCurrentFactorDenial,
  currentFactorState,
  replaceCurrentFactor,
  sessionIdentity,
  verifyCurrentFactor,
} from './onboarding-current-factor-evidence.mjs';
import { bindingActor } from './onboarding-current-factor-locks.mjs';

export const currentFactorCases = [
  'complete',
  'start',
  'refresh',
  'rechallenge',
  'aal1-start',
  'aal1-before-start',
  'replay',
  'org',
  'grant',
  'binding',
];
const interrupted = Symbol('current factor interruption');

async function settleCompletion(blocker, observer, pending) {
  const closed = await Promise.allSettled([blocker.close(), observer.close()]);
  const settled = pending ? await pending : undefined;
  assert.ok(closed.every((result) => result.status === 'fulfilled'));
  if (settled?.error) throw settled.error;
}

async function freshControl(context, user, replacement, details, completed) {
  // COMPLETE refills every 20 seconds; this is scheduling, never a failed-request retry.
  await new Promise((resolve) => setTimeout(resolve, 20_100));
  const actor = await verifyCurrentFactor(context, await context.signIn(user), replacement.factor);
  const state = currentFactorState(context.evidence, user.id);
  const id = sessionIdentity(actor.session.access_token, user.id);
  assert.deepEqual(
    state.bindings.find((row) => row.session_id === id),
    {
      session_id: id,
      actor_user_id: user.id,
      factor_id: replacement.factor.id,
    },
  );
  const before = context.evidence.snapshot(user.id, details.grantId);
  const result = await context.invoke('organization-admin-onboarding', actor.session.access_token, {
    action: 'complete',
    bootstrapGrantId: details.grantId,
    expectedVersion: 1,
    idempotencyKey: details.key,
  });
  const after = context.evidence.snapshot(user.id, details.grantId);
  if (completed) {
    assert.equal(result.status, 200);
    assert.equal(result.payload.decision, 'already_completed');
    assert.deepEqual(after, before);
  } else
    assertProviderCompletion(before, after, result, {
      ...details,
      authenticationMethods: providerAuthenticationMethods(actor.session.access_token, user.id),
    });
  const access = await context.invoke('auth-bootstrap', actor.session.access_token, {});
  assertProviderBootstrap(after, context.evidence.snapshot(user.id, details.grantId), access, {
    ...details,
    removed: false,
  });
  return actor;
}

async function completionWait(context, user, actor, details, name) {
  const blocker = postgresSession('r3_current_blocker');
  const observer = postgresSession('r3_current_observer');
  let pending;
  let replacement;
  let didInterrupt = false;
  try {
    const table = name === 'org' ? 'organizations' : 'organization_admin_bootstrap_grants';
    const row = name === 'org' ? details.organizationId : details.grantId;
    await blocker.query(`begin; select 1 from public.${table} where id='${row}' for update;`);
    const before = context.evidence.snapshot(user.id, details.grantId);
    pending = context
      .invoke('organization-admin-onboarding', actor.session.access_token, {
        action: 'complete',
        bootstrapGrantId: details.grantId,
        expectedVersion: 1,
        idempotencyKey: details.key,
      })
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    const blocked = `select exists(select 1 from pg_stat_activity w join pg_stat_activity b
      on b.pid=any(pg_blocking_pids(w.pid)) where b.application_name='r3_current_blocker'
      and w.wait_event_type='Lock' and w.query like '%complete_first_organization_admin_bootstrap%');`;
    await waitForSql(observer, blocked);
    replacement = await replaceCurrentFactor(context, user, actor);
    assert.equal(await observer.query(blocked), 't');
    if (context.cleanupProbe) throw interrupted;
    await blocker.query('rollback;');
    const settled = await pending;
    if (settled.error) throw settled.error;
    const after = context.evidence.snapshot(user.id, details.grantId);
    assertProviderCompletion(before, after, settled.value, details);
    const access = await context.invoke('auth-bootstrap', actor.session.access_token, {});
    assertProviderBootstrap(after, context.evidence.snapshot(user.id, details.grantId), access, {
      ...details,
      removed: true,
    });
  } catch (error) {
    if (error !== interrupted) throw error;
    didInterrupt = true;
  } finally {
    await settleCompletion(blocker, observer, pending);
  }
  if (context.cleanupProbe) assert.equal(didInterrupt, true);
  return replacement;
}

export async function runCurrentFactorCases(context) {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const selected = context.cleanupProbe ? [8] : currentFactorCases.map((_name, index) => index);
  const adminRoleId = context.evidence.json(
    "select to_jsonb(id) from public.roles where code='admin';",
  );
  for (const index of selected) {
    const name = currentFactorCases[index];
    const user = context.users[index];
    const grantId = randomUUID();
    const key = randomBytes(16).toString('hex');
    const stage = `current-${name}`;
    context.enterStage('current-setup', 'current factor case setup');
    const original =
      name === 'binding'
        ? await bindingActor(context, user)
        : await context.promoteToAal2(await context.signIn(user));
    issueGrant(context.psql, context.organizationId, user.id, grantId, context.sourceInstanceId);
    let actor = name.startsWith('aal1-')
      ? { ...(await context.signIn(user)), factorId: original.factorId }
      : original;
    const sessionId = sessionIdentity(actor.session.access_token, user.id);
    context.evidence.captureParents();
    assert.deepEqual(
      currentFactorState(context.evidence, user.id).bindings.find(
        (row) => row.session_id === sessionId,
      ),
      {
        session_id: sessionId,
        actor_user_id: user.id,
        factor_id: original.factorId,
      },
    );
    const details = {
      userId: user.id,
      organizationId: context.organizationId,
      grantId,
      key,
      adminRoleId,
      authenticationMethods: providerAuthenticationMethods(original.session.access_token, user.id),
    };
    let completed = false;
    let replacement;
    context.enterStage(stage, stage);
    try {
      if (!['start', 'aal1-before-start'].includes(name)) {
        const start = await context.invoke(
          'organization-admin-onboarding',
          actor.session.access_token,
          {
            action: 'start',
            bootstrapGrantId: grantId,
            expectedVersion: 1,
            idempotencyKey: key,
          },
        );
        assert.equal(start.status, 200);
        assert.equal(start.payload.factorState, 'challenge_required');
      }
      if (name === 'org' || name === 'grant') {
        replacement = await completionWait(context, user, actor, details, name);
        completed = true;
      } else {
        if (name === 'replay') {
          const before = context.evidence.snapshot(user.id, grantId);
          const result = await context.invoke(
            'organization-admin-onboarding',
            actor.session.access_token,
            {
              action: 'complete',
              bootstrapGrantId: grantId,
              expectedVersion: 1,
              idempotencyKey: key,
            },
          );
          assertProviderCompletion(
            before,
            context.evidence.snapshot(user.id, grantId),
            result,
            details,
          );
          completed = true;
        }
        replacement = await replaceCurrentFactor(context, user, actor, name.startsWith('aal1-'));
        if (name.startsWith('aal1-')) actor = replacement.actor;
        if (name === 'refresh') {
          const refreshed = await actor.client.auth.refreshSession();
          assert.equal(Boolean(refreshed.error), false);
          actor = { ...actor, session: refreshed.data.session };
        }
        if (name === 'rechallenge')
          actor = await verifyCurrentFactor(context, actor, replacement.factor);
        assert.equal(sessionIdentity(actor.session.access_token, user.id), sessionId);
        if (name === 'replay') await new Promise((resolve) => setTimeout(resolve, 20_100));
        const before = context.evidence.snapshot(user.id, grantId);
        const state = currentFactorState(context.evidence, user.id);
        const result = await context.invoke(
          'organization-admin-onboarding',
          actor.session.access_token,
          {
            action: ['start', 'aal1-before-start'].includes(name) ? 'start' : 'complete',
            bootstrapGrantId: grantId,
            expectedVersion: 1,
            idempotencyKey: key,
          },
        );
        assertCurrentFactorDenial(
          before,
          context.evidence.snapshot(user.id, grantId),
          result,
          details,
        );
        assert.deepEqual(currentFactorState(context.evidence, user.id), state);
        if (completed) {
          const beforeAccess = context.evidence.snapshot(user.id, grantId);
          const access = await context.invoke('auth-bootstrap', actor.session.access_token, {});
          assertProviderBootstrap(
            beforeAccess,
            context.evidence.snapshot(user.id, grantId),
            access,
            { ...details, removed: true },
          );
        }
      }
      if (!context.cleanupProbe) {
        const fresh = await freshControl(context, user, replacement, details, completed);
        if (name === 'binding') {
          const beforeUnenroll = currentFactorState(context.evidence, user.id);
          const unenrolled = await fresh.client.auth.mfa.unenroll({
            factorId: replacement.factor.id,
          });
          assert.equal(Boolean(unenrolled.error), false);
          const afterUnenroll = currentFactorState(context.evidence, user.id);
          assert.deepEqual(afterUnenroll.factors, []);
          assert.deepEqual(afterUnenroll.bindings, beforeUnenroll.bindings);
          for (const prior of beforeUnenroll.sessions) {
            const current = afterUnenroll.sessions.find((row) => row.id === prior.id);
            assert.deepEqual(
              current,
              prior.factor_id === replacement.factor.id
                ? { ...prior, factor_id: null, aal: 'aal1' }
                : prior,
            );
          }
          assert.equal(afterUnenroll.sessions.length, beforeUnenroll.sessions.length);
        }
      }
      context.evidence.assertAuthority();
    } finally {
      context.evidence.captureParents();
      if (!context.cleanupProbe) context.clearScenario(grantId, user.id);
    }
    context.reportDiagnostic(context.cleanupProbe ? 'current-interruption' : stage, 'passed');
  }
}
