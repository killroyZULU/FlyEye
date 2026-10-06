import assert from 'node:assert/strict';
import {
  postgresSession,
  waitForSql,
  failureDetail,
  H002SqlError,
} from './lib/h002-postgres-session.mjs';
import {
  q,
  scope,
  seed,
  clearDomain,
  domainTables,
  revokeSql,
  snapshotSql,
} from './lib/h002-review-fixture.mjs';
import { cases } from './lib/h002-review-cases.mjs';
import { assertReviewSuccess } from './lib/h002-review-assertions.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('H002 review requires the disposable GitHub Actions database job.');
}
const characterize = process.argv.includes('--characterize');
const cleanupProbe = process.argv.includes('--cleanup-probe');
const names = ['observer', 'blocker', 'worker', 'revoker'].map((name) => `h002_review_${name}`);
const [observer, blocker, worker, revoker] = names.map(postgresSession);
let owned = false;
let phase = 'preflight';
let stage = 'setup';
let injected = false;
function blocked(waiter, holder) {
  return `select exists(select 1 from pg_stat_activity w join pg_stat_activity b
    on b.pid=any(pg_blocking_pids(w.pid)) where w.application_name='h002_review_${waiter}'
    and b.application_name='h002_review_${holder}' and w.wait_event_type='Lock');`;
}
function pending(session, sql) {
  const state = { done: false };
  state.result = session
    .query(sql)
    .then((value) => {
      state.done = true;
      return JSON.parse(value);
    })
    .catch((failure) => {
      state.done = true;
      return { failure };
    });
  return state;
}
async function valueOf(task) {
  const result = await task.result;
  if (result.failure) throw result.failure;
  return result;
}
async function successCount(test) {
  return Number(
    await observer.query(`select count(*) from public.${test.eventTable}
    where actor_user_id=${q('actor')} and outcome='success';`),
  );
}
async function prepare(test) {
  await observer.query(`begin; ${clearDomain()}
    delete from public.aircraft_document_categories where ${scope} and category_kind='custom' and id<>${q('category')};
    update public.aircraft_document_categories set category_label='Synthetic review',category_state='active',version=1,archived_at=null,archived_by=null where id=${q('category')};
    update public.organization_memberships set status='active',version=1 where ${scope};
    update public.membership_roles mr set role_id=r.id from public.roles r where mr.${scope}
      and r.code=case when mr.membership_id=${q('targetMember')} then 'instructor_pilot' else 'admin' end;
    ${test.setup} commit;`);
}
async function race(test, authority) {
  stage = `${test.name}-${authority}`;
  phase = 'prepare';
  await prepare(test);
  if (test.replay) {
    assert.equal((await valueOf(pending(worker, test.sql))).decision, test.success);
  }
  const before = await observer.query(snapshotSql(test));
  const events = await successCount(test);
  phase = 'lock';
  await blocker.query(`begin; ${test.lock}`);
  const work = pending(worker, test.sql);
  phase = 'observe-worker';
  await waitForSql(observer, blocked('worker', 'blocker'));
  if (cleanupProbe) {
    phase = 'inject-observer-failure';
    await observer.query('select 1/0;');
    assert.fail('Observer failure must abort');
  }
  let serialized = false;
  let revocation;
  if (authority !== 'retained') {
    phase = 'revoke';
    if (test.blockerRevokes) {
      const result = JSON.parse(
        await blocker.query(`set local role service_role; ${revokeSql(authority)}`),
      );
      assert.equal(result.decision, authority === 'membership' ? 'revoked' : 'changed');
      await blocker.query('commit;');
    } else {
      revocation = pending(revoker, revokeSql(authority));
      const deadline = Date.now() + 8000;
      while (!revocation.done && Date.now() < deadline) {
        if ((await observer.query(blocked('revoker', 'worker'))) === 't') {
          serialized = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(serialized || revocation.done, 'Revocation ordering must be established');
      if (!serialized) {
        assert.equal(
          (await valueOf(revocation)).decision,
          authority === 'membership' ? 'revoked' : 'changed',
        );
        assert.equal(
          await observer.query(
            `select public.aircraft_registry_actor_is_authorized(${q('actor')},${q('org')},'aircraft.record.manage');`,
          ),
          'f',
        );
      } else {
        assert.equal(
          await observer.query(
            `select status from public.organization_memberships where id=${q('member')};`,
          ),
          'active',
        );
      }
      await blocker.query('rollback;');
    }
  } else await blocker.query('rollback;');
  phase = 'result';
  const result = await valueOf(work);
  if (revocation)
    assert.equal(
      (await valueOf(revocation)).decision,
      authority === 'membership' ? 'revoked' : 'changed',
    );
  const denied = authority !== 'retained' && !serialized && result.decision === test.deny;
  const expected = authority === 'retained' || serialized ? test.success : test.deny;
  if (!characterize) assert.equal(result.decision, expected);
  else
    assert.ok(denied || result.decision === test.success, 'Unexpected characterization decision');
  phase = 'assert-state';
  if (denied) {
    assert.equal(await observer.query(snapshotSql(test)), before);
    assert.equal(await successCount(test), events);
  } else if (test.replay) {
    assert.equal(result.replayed, true);
    assert.equal(await observer.query(snapshotSql(test)), before);
    assert.equal(await successCount(test), events);
  } else if (!test.readOnly) {
    assert.notEqual(await observer.query(snapshotSql(test)), before);
    assert.ok((await successCount(test)) > events);
    await assertReviewSuccess(observer, test);
  }
  const outcome =
    authority === 'retained'
      ? 'authorized-control'
      : serialized
        ? 'serialized-before-revocation'
        : denied
          ? 'denied-after-revocation'
          : 'STALE-AUTHORIZATION-REPRODUCED';
  process.stdout.write(`H002 review: ${stage} ${outcome}.\n`);
}

try {
  assert.equal(await observer.query('select count(*) from public.organizations;'), '0');
  assert.equal(
    await observer.query(
      `select count(*) from auth.users where id in (${q('actor')},${q('admin')},${q('target')});`,
    ),
    '0',
  );
  for (const session of [observer, blocker, worker, revoker])
    assert.equal(await session.query('show transaction_isolation;'), 'read committed');
  owned = true;
  phase = 'seed';
  await observer.query(`begin; ${seed} commit;`);
  await worker.query('set role service_role;');
  await revoker.query('set role service_role;');
  for (const session of [worker, revoker]) {
    assert.equal(await session.query('select current_user;'), 'service_role');
    assert.equal(
      await session.query(`select has_table_privilege(current_user,
      'public.organization_memberships','SELECT');`),
      'f',
    );
    assert.equal(
      await session.query(`select has_function_privilege(current_user,
      'public.change_organization_member_status(uuid,uuid,uuid,text,text,bigint,text,uuid)', 'EXECUTE');`),
      't',
    );
    assert.equal(
      await session.query(`select has_function_privilege(current_user,
      'public.change_organization_member_role(uuid,uuid,uuid,text,text,bigint,text,text,uuid)', 'EXECUTE');`),
      't',
    );
  }
  process.stdout.write(
    'H002 review: service-role RPC privileges verified; direct membership SELECT unavailable.\n',
  );
  for (const test of cases) {
    for (const authority of test.authorities ?? ['membership', 'role', 'retained'])
      await race(test, authority);
  }
} catch (error) {
  if (
    cleanupProbe &&
    phase === 'inject-observer-failure' &&
    error instanceof H002SqlError &&
    error.sqlState === '22012'
  ) {
    injected = true;
    process.stdout.write('H002 review: controlled observer failure observed.\n');
  } else {
    process.stderr.write(
      `H002 review failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  for (const session of [blocker, worker, revoker, observer]) {
    try {
      await session.close();
    } catch (error) {
      process.stderr.write(
        `H002 review failed: phase=close-sessions detail=${failureDetail(error)}.\n`,
      );
      process.exitCode = 1;
    }
  }
  const cleanup = postgresSession('h002_review_cleanup');
  try {
    phase = 'cleanup';
    if (owned) {
      await cleanup.query(`begin; ${clearDomain()}
        delete from public.aircraft_document_categories where ${scope};
        delete from public.organization_member_profiles where ${scope};
        delete from public.membership_roles where ${scope};
        delete from public.organization_memberships where ${scope};
        delete from public.organizations where id=${q('org')};
        delete from auth.users where id in (${q('actor')},${q('admin')},${q('target')}); commit;`);
      const tables = [
        ...domainTables,
        'aircraft_document_categories',
        'organization_member_profiles',
        'membership_roles',
        'organization_memberships',
      ];
      const residue = tables.map(
        (table) => `(select count(*) from public.${table} where ${scope})`,
      );
      residue.push(
        `(select count(*) from public.organizations where id=${q('org')})`,
        `(select count(*) from auth.users where id in (${q('actor')},${q('admin')},${q('target')}))`,
        `(select count(*) from public.authentication_events where actor_user_id in (${q('actor')},${q('admin')},${q('target')}))`,
        `(select count(*) from public.member_invitation_events where actor_user_id in (${q('actor')},${q('admin')},${q('target')}))`,
      );
      assert.equal(await cleanup.query(`select ${residue.join('+')};`), '0');
    }
    assert.equal(
      await cleanup.query(
        `select count(*) from pg_stat_activity where application_name in (${names.map((name) => `'${name}'`).join(',')});`,
      ),
      '0',
    );
    if (owned)
      process.stdout.write(
        'H002 review cleanup passed: fixture rows, users and original sessions absent.\n',
      );
  } catch (error) {
    process.stderr.write(`H002 review failed: phase=${phase} detail=${failureDetail(error)}.\n`);
    process.exitCode = 1;
  } finally {
    try {
      await cleanup.close();
    } catch (error) {
      process.stderr.write(
        `H002 review failed: phase=close-cleanup detail=${failureDetail(error)}.\n`,
      );
      process.exitCode = 1;
    }
  }
  if (cleanupProbe && !injected) process.exitCode = 1;
}
