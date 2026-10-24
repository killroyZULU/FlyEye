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
  ids,
  scope,
  seed,
  users,
  cases,
  reset,
  permissions,
  snapshot,
  setup,
  relation,
  lock,
  command,
  permission,
  signatures,
  holderRevokes,
  committedPeer,
} from './lib/h002-document-implicit-fixture.mjs';
import { assertDocument, assertReplay } from './lib/h002-document-implicit-assertions.mjs';
import { quiesce } from './lib/h002-registry-implicit-cleanup.mjs';
import { finishCleanup } from './lib/h002-document-implicit-cleanup.mjs';

if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Document implicit waits require the disposable GitHub Actions database.');
}
const probe = process.argv.includes('--cleanup-probe');
const observer = postgresSession('h002_document_implicit_observer');
const names = ['blocker', 'worker', 'revoker'].map((name) => `h002_document_implicit_${name}`);
let owned = false;
let safe = true;
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
  where w.application_name='h002_document_implicit_${waiter}'
  and b.application_name='h002_document_implicit_${holder}' and w.wait_event_type='Lock');`;
async function closeCase(sessions, tasks) {
  safe = false;
  await quiesce(
    sessions,
    tasks,
    (sql) => observer.query(sql),
    `select count(*) from pg_stat_activity where application_name in (${names.map((name) => `'${name}'`).join(',')});`,
  );
  await observer.query(`begin; ${reset} commit;`);
  assert.equal(
    await observer.query(`select
    (select count(*) from public.stored_files where ${scope})+
    (select count(*) from public.aircraft_document_events where ${scope})+
    (select count(*) from public.aircraft_documents where ${scope});`),
    '0',
  );
  assert.equal(await observer.query(permissions), originalPermissions);
  safe = true;
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
    if (test.kind.startsWith('unique-')) peerState = await snap(blocker);
    const work = pending(worker, command(test));
    tasks.push(work);
    phase = 'observe-worker';
    await waitForSql(observer, blocked('worker', 'blocker'));
    if (relation(test))
      assert.equal(
        await observer.query(`select exists(select 1 from pg_locks l
      join pg_stat_activity a on a.pid=l.pid where a.application_name='h002_document_implicit_worker'
      and l.relation='public.${relation(test)}'::regclass and l.mode='RowExclusiveLock' and not l.granted);`),
        't',
      );
    if (probe) {
      phase = 'inject-observer-failure';
      const failing = postgresSession('h002_document_implicit_probe');
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
      if (holderRevokes(test)) {
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
            `select public.aircraft_document_actor_is_authorized(${q('actor')},${q('org')},'${permission(test)}');`,
          ),
          serialized ? 't' : 'f',
        );
        await blocker.query(
          test.kind.startsWith('unique-') && test.commit ? 'commit;' : 'rollback;',
        );
      }
    } else
      await blocker.query(test.kind.startsWith('unique-') && test.commit ? 'commit;' : 'rollback;');
    phase = 'result';
    result = await valueOf(work);
    if (revocation)
      assert.equal(
        (await valueOf(revocation)).decision,
        authority === 'membership' ? 'revoked' : 'changed',
      );
    phase = 'assert-state';
    const after = await snap();
    assert.equal(serialized, false, 'This manifest requires revocation to commit before release');
    const denied = authority !== 'retained' && !serialized;
    if (authority !== 'retained')
      assert.equal(
        await observer.query(
          `select public.aircraft_document_actor_is_authorized(${q('actor')},${q('org')},'${permission(test)}');`,
        ),
        'f',
      );
    if (authority !== 'retained') {
      assert.deepEqual(
        JSON.parse(
          await observer.query(`select jsonb_build_object(
        'status',m.status,'version',m.version,'role',r.code,
        'events',(select count(*) from public.member_administration_events where ${scope}))
        from public.organization_memberships m join public.membership_roles mr on mr.membership_id=m.id
        join public.roles r on r.id=mr.role_id where m.id=${q('member')};`),
        ),
        {
          status: authority === 'membership' ? 'revoked' : 'active',
          version: 2,
          role: authority === 'membership' ? 'admin' : 'student_pilot',
          events: 1,
        },
      );
    }
    assertDocument(test, result, before, after, peerState, denied);
    if (authority === 'retained') {
      phase = 'assert-replay';
      const retry = JSON.parse(await worker.query(command(test)));
      const retried = await snap();
      if (!committedPeer(test)) assertReplay(result, retry, after, retried);
      else if (test.kind === 'unique-notification') {
        assertDocument({ ...test, kind: 'retry' }, retry, after, retried, undefined, false);
        const replay = JSON.parse(await worker.query(command(test)));
        assertReplay(retry, replay, retried, await snap());
      } else {
        assert.deepEqual(retry, {
          decision: test.kind === 'unique-idempotency' ? 'idempotency_conflict' : 'state_conflict',
          correlationId: ids.correlation,
        });
        assert.deepEqual(retried, after);
      }
    }
    passed++;
    process.stdout.write(
      `H002 document implicit: ${stage} ${denied ? 'denied-after-revocation' : serialized ? 'serialized-before-revocation' : 'authorized-control'}.\n`,
    );
  } catch (error) {
    if (
      probe &&
      phase === 'inject-observer-failure' &&
      error instanceof H002SqlError &&
      error.sqlState === '22012'
    ) {
      injected = true;
      process.stdout.write('H002 document implicit: controlled observer failure observed.\n');
    } else if (error?.code === 'ERR_ASSERTION') {
      const decision = [
        'created',
        'renewed',
        'corrected',
        'suspended',
        'restored',
        'category_created',
        'category_renamed',
        'category_archived',
        'category_assigned',
        'category_removed',
        'unauthorized',
        'state_conflict',
      ].includes(result?.decision)
        ? result.decision
        : 'other';
      process.stderr.write(
        `H002 document implicit failed: case=${stage} phase=${phase} detail=assertion decision=${decision} ordering=${serialized ? 'serialized' : 'not-serialized'} evidence=${['rollback', 'response-after-verified-rollback'].includes(error.evidence) ? error.evidence : 'other'}.\n`,
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
    await observer.query(`select count(*) from public.aircraft_records where id=${q('aircraft')};`),
    '0',
  );
  assert.equal(await observer.query('show transaction_isolation;'), 'read committed');
  originalPermissions = await observer.query(permissions);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const signature of signatures)
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
  else assert.equal(passed, 243);
} catch (error) {
  process.stderr.write(
    `H002 document implicit failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
  );
  process.exitCode = 1;
} finally {
  await observer.close().catch(() => {
    safe = false;
    process.exitCode = 1;
  });
  const cleaner = postgresSession('h002_document_implicit_cleanup');
  let cleaned = false;
  try {
    phase = 'final-owned-cleanup';
    cleaned = await finishCleanup(cleaner, { owned, safe, originalPermissions });
  } catch (error) {
    process.stderr.write(
      `H002 document implicit failed: phase=${phase} detail=${failureDetail(error)} cleanup-unverified.\n`,
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
      'H002 document implicit cleanup passed: fixture rows, users and sessions absent; permissions unchanged.\n',
    );
}
