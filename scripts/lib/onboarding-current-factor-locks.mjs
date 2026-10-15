import assert from 'node:assert/strict';
import { postgresSession, waitForSql } from './h002-postgres-session.mjs';
import { currentFactorState, sessionIdentity } from './onboarding-current-factor-evidence.mjs';

const settled = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
const unwrap = (result) => {
  if (result.error) throw result.error;
  return result.value;
};
const blockedBy = (query) => `with recursive blocked(pid) as (
  select pid from pg_stat_activity where application_name='r3_binding_blocker'
  union select a.pid from pg_stat_activity a join blocked b on b.pid=any(pg_blocking_pids(a.pid))
) select exists(select 1 from pg_stat_activity w join blocked b using(pid)
  where w.application_name<>'r3_binding_blocker' and w.wait_event_type='Lock' and ${query});`;

async function contend(context, user, sessionId, factorId, concurrent, observedQuery, expected) {
  const blocker = postgresSession('r3_binding_blocker');
  const observer = postgresSession('r3_binding_observer');
  let validation;
  let mutation;
  try {
    await blocker.query(`begin; select 1 from public.admin_session_factor_bindings
      where session_id='${sessionId}' and actor_user_id='${user.id}' for update;`);
    validation = settled(
      context.admin.rpc('validate_admin_session_factor', {
        p_actor_user_id: user.id,
        p_session_id: sessionId,
        p_factor_id: factorId,
        p_require_aal2: false,
      }),
    );
    await waitForSql(observer, blockedBy("w.query like '%validate_admin_session_factor%'"));
    mutation = settled(concurrent());
    await waitForSql(observer, blockedBy(observedQuery));
    await blocker.query('rollback;');
    const checked = unwrap(await validation);
    assert.equal(Boolean(checked.error), false);
    assert.equal(checked.data, expected);
    return unwrap(await mutation);
  } finally {
    const closed = await Promise.allSettled([blocker.close(), observer.close()]);
    const pending = await Promise.all([validation, mutation].filter(Boolean));
    assert.ok(closed.every((result) => result.status === 'fulfilled'));
    for (const result of pending) unwrap(result);
  }
}

export async function bindingActor(context, user) {
  const actor = await context.signIn(user);
  const sessionId = sessionIdentity(actor.session.access_token, user.id);
  const enrolled = await actor.client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Synthetic binding contention',
  });
  assert.equal(Boolean(enrolled.error), false);
  context.evidence.captureParents();
  assert.equal(currentFactorState(context.evidence, user.id).bindings[0].factor_id, null);
  const spare = await context.signIn(user);
  const spareId = sessionIdentity(spare.session.access_token, user.id);
  assert.notEqual(spareId, sessionId);
  context.evidence.captureParents();
  const spareState = currentFactorState(context.evidence, user.id);
  assert.equal(spareState.sessions.find((row) => row.id === spareId)?.aal, 'aal1');
  assert.deepEqual(
    spareState.bindings.find((row) => row.session_id === spareId),
    {
      session_id: spareId,
      actor_user_id: user.id,
      factor_id: null,
    },
  );
  const verification = await contend(
    context,
    user,
    sessionId,
    enrolled.data.id,
    () =>
      actor.client.auth.mfa.challengeAndVerify({
        factorId: enrolled.data.id,
        code: context.currentTotp(enrolled.data.totp.secret),
      }),
    "w.query like '%sessions%'",
    false,
  );
  assert.equal(Boolean(verification.error), false);
  const session = await actor.client.auth.getSession();
  assert.equal(Boolean(session.error), false);
  assert.equal(sessionIdentity(session.data.session.access_token, user.id), sessionId);
  const before = currentFactorState(context.evidence, user.id);
  assert.equal(
    before.sessions.some((row) => row.id === spareId),
    false,
  );
  assert.equal(
    before.bindings.some((row) => row.session_id === spareId),
    false,
  );
  assert.equal(before.bindings[0].factor_id, enrolled.data.id);
  assert.equal(before.sessions[0].factor_id, enrolled.data.id);
  // Rollback-only deletion races test the FK cascade/lock order before grant issuance.
  for (const table of ['sessions', 'users']) {
    const deletion = postgresSession('r3_binding_delete');
    try {
      await contend(
        context,
        user,
        sessionId,
        enrolled.data.id,
        () =>
          deletion.query(
            `begin; set local statement_timeout='10s'; delete from auth.${table}
         where id='${table === 'sessions' ? sessionId : user.id}'; rollback;`,
          ),
        "w.application_name='r3_binding_delete'",
        true,
      );
    } finally {
      await deletion.close();
    }
    assert.deepEqual(currentFactorState(context.evidence, user.id), before);
  }
  context.evidence.captureParents();
  return { ...actor, session: session.data.session, factorId: enrolled.data.id };
}
