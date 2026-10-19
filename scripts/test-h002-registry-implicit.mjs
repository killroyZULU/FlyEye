import assert from 'node:assert/strict';
import {
  postgresSession,
  waitForSql,
  failureDetail,
  H002SqlError,
} from './lib/h002-postgres-session.mjs';
import { revokeSql } from './lib/h002-review-fixture.mjs';
import {
  q,
  scope,
  seed,
  users,
  peerId,
  cases,
  reset,
  cleanup,
  residue,
  permissions,
  snapshot,
  setup,
  relation,
  lock,
  command,
} from './lib/h002-registry-implicit-fixture.mjs';
import { assertRegistry } from './lib/h002-registry-implicit-assertions.mjs';
import { quiesce, sessionsAbsent } from './lib/h002-registry-implicit-cleanup.mjs';

if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Registry implicit waits require the disposable GitHub Actions database.');
}
const probe = process.argv.includes('--cleanup-probe');
const observer = postgresSession('h002_registry_implicit_observer');
const names = ['blocker', 'worker', 'revoker'].map((name) => `h002_registry_implicit_${name}`);
let owned = false;
let originalPermissions;
let stage = 'setup';
let phase = 'preflight';
let injected = false;
let passed = 0;
const snap = (session = observer) => session.query(snapshot).then(JSON.parse);
function pending(session, sql) {
  const state = { done: false };
  state.result = session
    .query(sql)
    .then(
      (value) => ({ value: JSON.parse(value) }),
      (error) => ({ error }),
    )
    .then((result) => {
      state.done = true;
      return result;
    });
  return state;
}
async function valueOf(task) {
  const result = await task.result;
  if (result.error) throw result.error;
  return result.value;
}
const blocked = (waiter, holder) => `select exists(select 1 from pg_stat_activity w
  join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid))
  where w.application_name='h002_registry_implicit_${waiter}'
  and b.application_name='h002_registry_implicit_${holder}' and w.wait_event_type='Lock');`;
async function closeCase(sessions, tasks) {
  await quiesce(
    sessions,
    tasks,
    (sql) => observer.query(sql),
    `select count(*) from pg_stat_activity where application_name in (${names.map((name) => `'${name}'`).join(',')});`,
  );
  await observer.query(`begin; ${reset} commit;`);
  assert.equal(
    await observer.query(`select
    (select count(*) from public.aircraft_records where ${scope})+
    (select count(*) from public.aircraft_registry_events where ${scope})+
    (select count(*) from public.aircraft_registry_idempotency where ${scope});`),
    '0',
  );
  assert.equal(await observer.query(permissions), originalPermissions);
}
async function runCase(test, authority) {
  stage = `${test.name}-${authority}`;
  phase = 'prepare';
  await observer.query(`begin; ${reset} ${setup(test)} commit;`);
  const before = await snap();
  const [blocker, worker, revoker] = names.map(postgresSession);
  const tasks = [];
  let serialized = false;
  let result;
  let peerState;
  try {
    for (const session of [worker, revoker]) await session.query('set role service_role;');
    phase = 'block';
    await blocker.query(`begin; ${lock(test)}`);
    if (test.kind === 'unique') peerState = await snap(blocker);
    const work = pending(worker, command(test));
    tasks.push(work);
    phase = 'observe-worker';
    await waitForSql(observer, blocked('worker', 'blocker'));
    if (relation(test))
      assert.equal(
        await observer.query(`select exists(select 1 from pg_locks l
      join pg_stat_activity a on a.pid=l.pid where a.application_name='h002_registry_implicit_worker'
      and l.relation='public.${relation(test)}'::regclass and l.mode='RowExclusiveLock' and not l.granted);`),
        't',
      );
    if (probe) {
      phase = 'inject-observer-failure';
      const failing = postgresSession('h002_registry_implicit_probe');
      try {
        await failing.query('select 1/0;');
      } finally {
        await failing.close();
      }
      assert.fail('Expected controlled observer failure');
    }
    let revocation;
    if (authority !== 'retained') {
      phase = 'revoke';
      if (test.kind === 'foreign-key') {
        const revoked = JSON.parse(
          await blocker.query(`set local role service_role; ${revokeSql(authority)}`),
        );
        assert.equal(revoked.decision, authority === 'membership' ? 'revoked' : 'changed');
        await blocker.query('commit;');
      } else {
        revocation = pending(revoker, revokeSql(authority));
        tasks.push(revocation);
        const deadline = Date.now() + 8000;
        while (!revocation.done && Date.now() < deadline) {
          if ((await observer.query(blocked('revoker', 'worker'))) === 't') {
            serialized = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.ok(serialized || revocation.done, 'Revocation ordering must be observed');
        if (!serialized)
          assert.equal(
            (await valueOf(revocation)).decision,
            authority === 'membership' ? 'revoked' : 'changed',
          );
        assert.equal(
          await observer.query(
            `select public.aircraft_registry_actor_is_authorized(${q('actor')},${q('org')},'aircraft.record.manage');`,
          ),
          serialized ? 't' : 'f',
        );
        await blocker.query(test.kind === 'unique' && test.commit ? 'commit;' : 'rollback;');
      }
    } else await blocker.query(test.kind === 'unique' && test.commit ? 'commit;' : 'rollback;');
    phase = 'result';
    result = await valueOf(work);
    if (revocation)
      assert.equal(
        (await valueOf(revocation)).decision,
        authority === 'membership' ? 'revoked' : 'changed',
      );
    phase = 'assert-state';
    const after = await snap();
    const denied = authority !== 'retained' && !serialized;
    assertRegistry(test, result, before, after, peerState, denied);
    if (authority === 'retained' && result.replayed === false) {
      phase = 'assert-replay';
      const replay = JSON.parse(await worker.query(command(test)));
      assert.deepEqual(replay, { ...result, replayed: true });
      assert.deepEqual(await snap(), after);
    }
    passed++;
    process.stdout.write(
      `H002 registry implicit: ${stage} ${denied ? 'denied-after-revocation' : serialized ? 'serialized-before-revocation' : 'authorized-control'}.\n`,
    );
  } catch (error) {
    if (
      probe &&
      phase === 'inject-observer-failure' &&
      error instanceof H002SqlError &&
      error.sqlState === '22012'
    ) {
      injected = true;
      process.stdout.write('H002 registry implicit: controlled observer failure observed.\n');
    } else if (error?.code === 'ERR_ASSERTION') {
      const decision = [
        'created',
        'updated',
        'archived',
        'reactivated',
        'unauthorized',
        'duplicate_registration',
      ].includes(result?.decision)
        ? result.decision
        : 'other';
      process.stderr.write(
        `H002 registry implicit failed: case=${stage} phase=${phase} detail=assertion decision=${decision} ordering=${serialized ? 'serialized' : 'not-serialized'}.\n`,
      );
      process.exitCode = 1;
    } else throw error;
  } finally {
    phase = 'case-cleanup';
    await closeCase([blocker, worker, revoker], tasks);
  }
}

try {
  assert.equal(await observer.query('select count(*) from public.organizations;'), '0');
  assert.equal(
    await observer.query(`select count(*) from auth.users where id in (${users});`),
    '0',
  );
  assert.equal(
    await observer.query(
      `select count(*) from public.aircraft_records where id in (${q('aircraft')},${peerId});`,
    ),
    '0',
  );
  assert.equal(await observer.query('show transaction_isolation;'), 'read committed');
  originalPermissions = await observer.query(permissions);
  const signature =
    'public.mutate_aircraft_record(uuid,uuid,text,uuid,text,text,text,text,text,bigint,text,text,uuid)';
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(
      await observer.query(`select has_function_privilege('${role}','${signature}','EXECUTE');`),
      role === 'service_role' ? 't' : 'f',
    );
    assert.equal(
      await observer.query(
        `select has_table_privilege('${role}','public.organization_memberships','SELECT');`,
      ),
      'f',
    );
  }
  owned = true;
  await observer.query(`begin; ${seed} commit;`);
  for (const test of probe ? [cases[0]] : cases) {
    for (const authority of probe ? ['retained'] : ['membership', 'role', 'retained'])
      await runCase(test, authority);
  }
  phase = 'matrix-summary';
  if (probe) assert.equal(injected, true);
  else assert.equal(passed, 63);
} catch (error) {
  process.stderr.write(
    `H002 registry implicit failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
  );
  process.exitCode = 1;
} finally {
  await observer.close().catch(() => {
    process.exitCode = 1;
  });
  const cleaner = postgresSession('h002_registry_implicit_cleanup');
  let cleaned = false;
  try {
    phase = 'final-session-absence';
    // No destructive cleanup while a worker might still commit fixture changes.
    assert.equal(await cleaner.query(sessionsAbsent), '0');
    phase = 'final-row-cleanup';
    if (owned) {
      await cleaner.query(`begin; ${cleanup} commit;`);
      assert.equal(await cleaner.query(residue), '0');
      assert.equal(await cleaner.query(permissions), originalPermissions);
    }
    cleaned = owned;
  } catch (error) {
    process.stderr.write(
      `H002 registry implicit failed: phase=${phase} detail=${failureDetail(error)} cleanup-unverified.\n`,
    );
    process.exitCode = 1;
  } finally {
    await cleaner.close().catch(() => {
      cleaned = false;
      process.exitCode = 1;
    });
  }
  if (cleaned)
    process.stdout.write(
      'H002 registry implicit cleanup passed: fixture rows, users and sessions absent; permissions unchanged.\n',
    );
}
