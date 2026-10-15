import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { postgresSession, waitForSql } from './h002-postgres-session.mjs';
import {
  quote,
  hash,
  seedInvitation,
  snapshot,
  assertDenied,
  assertAccepted,
  foreignSnapshot,
} from './invitation-recipient-state.mjs';

const zero = '00000000-0000-0000-0000-000000000000';
const settled = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
async function result(task) {
  const outcome = await task;
  if (outcome.error) throw new Error('Recipient provider request failed.');
  return outcome.value;
}

async function releaseAndVerify(blocker, observer, tasks, pids, psql) {
  const failures = [];
  const attempt = async (operation) => {
    try {
      await operation();
    } catch {
      failures.push(true);
    }
  };
  await attempt(() => blocker.close());
  await Promise.allSettled(tasks);
  for (const task of tasks)
    await attempt(async () => {
      const value = await result(task);
      if ('error' in value) assert.equal(value.error, null);
      else assert.equal(value.response.status, 200);
    });
  const known = pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  if (known.length)
    await attempt(() =>
      waitForSql(
        observer,
        `select not exists(select 1 from pg_stat_activity
    where pid in (${known.join(',')}) and (state<>'idle' or xact_start is not null));`,
      ),
    );
  await attempt(async () =>
    assert.equal(
      await observer.query(
        "select count(*) from pg_stat_activity where application_name='r4_provider_blocker';",
      ),
      '0',
    ),
  );
  await attempt(() => observer.close());
  await attempt(() =>
    assert.equal(
      psql(
        "select count(*) from pg_stat_activity where application_name in ('r4_provider_blocker','r4_provider_observer');",
      ),
      '0',
    ),
  );
  if (failures.length) throw new Error('Recipient request settlement or session cleanup failed.');
}

async function identity(client, token, actor, email) {
  const { data, error } = await client.auth.getUser(token);
  assert.equal(error, null);
  assert.equal(data.user.id, actor.id);
  assert.equal(data.user.email, email);
  assert.ok(data.user.email_confirmed_at);
  return data.user;
}

async function createActor(server, browserClient, actor, password) {
  const created = await server.auth.admin.createUser({
    id: actor.id,
    email: actor.email,
    password,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  const client = browserClient();
  const signed = await client.auth.signInWithPassword({ email: actor.email, password });
  assert.equal(signed.error, null);
  assert.ok(signed.data.session);
  const token = signed.data.session.access_token;
  await identity(client, token, actor, actor.email);
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const passwordTime = claims.amr.find((entry) => entry.method === 'password')?.timestamp;
  assert.ok(Number.isSafeInteger(passwordTime));
  return { client, token, passwordTime };
}

async function staleSnapshot(context, actor, session, invitation) {
  const { server, psql, invoke, correlations, register, diagnostics } = context;
  diagnostics.enter('recipient-snapshot');
  const captured = await identity(session.client, session.token, actor, actor.email);
  const changed = await server.auth.admin.updateUserById(actor.id, {
    email: actor.changedEmail,
    email_confirm: true,
  });
  assert.equal(changed.error, null);
  await identity(session.client, session.token, actor, actor.changedEmail);
  for (const action of ['prepare', 'accept']) {
    const correlation = randomUUID();
    correlations.add(correlation);
    const before = snapshot(psql, actor, invitation);
    const { data, error } = await server.rpc(
      action === 'prepare' ? 'prepare_member_invitation_acceptance' : 'accept_member_invitation',
      {
        p_actor_user_id: actor.id,
        p_confirmed_email: captured.email,
        p_invitation_id: invitation,
        p_expected_version: 1,
        p_correlation_id: correlation,
        ...(action === 'accept'
          ? {
              p_password_authenticated_at: session.passwordTime,
              p_idempotency_key_hash: hash(randomUUID()),
            }
          : {}),
      },
    );
    assert.equal(error, null);
    assert.deepEqual(data, { decision: 'not_available', correlationId: correlation });
    assertDenied(before, snapshot(psql, actor, invitation), actor, correlation);
    const beforeEdge = snapshot(psql, actor, invitation);
    register(actor.id, action, zero);
    const response = await invoke(session.token, {
      action,
      invitationId: invitation,
      expectedVersion: 1,
      ...(action === 'accept' ? { idempotencyKey: randomUUID() } : {}),
    });
    assert.equal(response.response.status, 404);
    assert.equal(response.payload.error.code, 'member_invitation.not_available');
    assertDenied(
      beforeEdge,
      snapshot(psql, actor, invitation),
      actor,
      response.payload.correlationId,
    );
  }
  diagnostics.pass();
}

async function commandWins(context, actor, session, invitation) {
  const { server, psql, invoke, register, organization, diagnostics, probe } = context;
  diagnostics.enter('recipient-provider-wait');
  const blocker = postgresSession('r4_provider_blocker');
  const observer = postgresSession('r4_provider_observer');
  const key = randomUUID();
  const before = snapshot(psql, actor, invitation);
  let acceptance;
  let update;
  let interrupted = false;
  let workerPid;
  let providerPid;
  const tasks = [];
  try {
    await blocker.query(`set idle_in_transaction_session_timeout='45s'; begin;
      select 1 from public.organizations where id=${quote(organization)} for update;`);
    register(actor.id, 'accept', invitation);
    acceptance = settled(
      invoke(session.token, {
        action: 'accept',
        invitationId: invitation,
        expectedVersion: 1,
        idempotencyKey: key,
      }),
    );
    tasks.push(acceptance);
    const workerQuery = `select w.pid from pg_stat_activity w join pg_stat_activity b
      on b.pid=any(pg_blocking_pids(w.pid)) where b.application_name='r4_provider_blocker'
      and w.wait_event_type='Lock' and position('accept_member_invitation' in w.query)>0`;
    await waitForSql(observer, `select exists(${workerQuery});`);
    workerPid = Number(await observer.query(`${workerQuery};`));
    assert.ok(Number.isSafeInteger(workerPid) && workerPid > 0);
    update = settled(
      server.auth.admin.updateUserById(actor.id, {
        email: actor.changedEmail,
        email_confirm: true,
      }),
    );
    tasks.push(update);
    const providerQuery = `select pid from pg_stat_activity where usename='supabase_auth_admin'
      and ${workerPid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock'`;
    await waitForSql(observer, `select exists(${providerQuery});`);
    providerPid = Number(await observer.query(`${providerQuery};`));
    assert.ok(Number.isSafeInteger(providerPid) && providerPid > 0);
    if (probe) {
      diagnostics.enter('recipient-interruption');
      interrupted = true;
      throw new Error('Controlled recipient interruption.');
    }
  } catch (error) {
    if (!interrupted) throw error;
  } finally {
    // Release only our blocker; never stop provider/PostgREST processes or abandon requests.
    await releaseAndVerify(blocker, observer, tasks, [workerPid, providerPid], psql);
  }
  const accepted = await result(acceptance);
  const changed = await result(update);
  assert.equal(changed.error, null);
  await identity(session.client, session.token, actor, actor.changedEmail);
  const after = snapshot(psql, actor, invitation);
  assertAccepted(before, after, actor, accepted.payload, key);
  if (!probe) {
    register(actor.id, 'accept', zero);
    const replay = await invoke(session.token, {
      action: 'accept',
      invitationId: invitation,
      expectedVersion: 1,
      idempotencyKey: key,
    });
    assert.equal(replay.response.status, 200);
    assert.deepEqual(replay.payload, {
      ...accepted.payload,
      replayed: true,
      correlationId: replay.payload.correlationId,
    });
    assert.deepEqual(snapshot(psql, actor, invitation), after);
  }
  assert.equal(interrupted, probe);
  diagnostics.pass();
}

export async function runInvitationRecipients(context) {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const {
    actors,
    server,
    browserClient,
    password,
    psql,
    organization,
    admin,
    diagnostics,
    invoke,
    register,
  } = context;
  diagnostics.enter('recipient-setup');
  const sessions = [];
  for (const actor of actors)
    sessions.push(await createActor(server, browserClient, actor, password));
  const invitations = actors.map((actor) => seedInvitation(psql, organization, admin, actor.email));
  const recovery = seedInvitation(psql, organization, admin, actors[0].changedEmail);
  const foreign = foreignSnapshot(psql, actors, [...invitations, recovery]);
  if (!context.probe) await staleSnapshot(context, actors[0], sessions[0], invitations[0]);
  await commandWins(context, actors[1], sessions[1], invitations[1]);
  if (!context.probe) {
    diagnostics.enter('recipient-recovery');
    const before = snapshot(psql, actors[0], recovery);
    assert.equal(before.members.length, 0);
    const key = randomUUID();
    register(actors[0].id, 'prepare', recovery);
    const prepared = await invoke(sessions[0].token, {
      action: 'prepare',
      invitationId: recovery,
      expectedVersion: 1,
    });
    assert.equal(prepared.response.status, 200);
    assert.equal(prepared.payload.credentialMode, 'existing');
    assert.deepEqual(snapshot(psql, actors[0], recovery), before);
    register(actors[0].id, 'accept', recovery);
    const accepted = await invoke(sessions[0].token, {
      action: 'accept',
      invitationId: recovery,
      expectedVersion: 1,
      idempotencyKey: key,
    });
    assert.equal(accepted.response.status, 200);
    assertAccepted(before, snapshot(psql, actors[0], recovery), actors[0], accepted.payload, key);
    diagnostics.pass();
  }
  assert.equal(foreignSnapshot(psql, actors, [...invitations, recovery]), foreign);
}
