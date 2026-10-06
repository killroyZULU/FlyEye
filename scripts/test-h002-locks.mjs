import assert from 'node:assert/strict';
import {
  H002SqlError,
  failureDetail,
  postgresSession,
  waitForSql,
} from './lib/h002-postgres-session.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('H002 requires the disposable GitHub Actions database job.');
}

const org = 'e0200000-0000-4000-8000-000000000001';
const actor = 'e0200000-0000-4000-8000-000000000002';
const admin = 'e0200000-0000-4000-8000-000000000003';
const member = 'e0200000-0000-4000-8000-000000000004';
const adminMember = 'e0200000-0000-4000-8000-000000000005';
const correlation = 'e0200000-0000-4000-8000-000000000006';
const record = 'e0200000-0000-4000-8000-000000000007';
const observer = postgresSession('h002_observer');
const blocker = postgresSession('h002_blocker');
const worker = postgresSession('h002_worker');
let owned = false;
let stage = 'setup';
let phase = 'session-setup';
const cleanupProbe = process.argv.includes('--cleanup-probe');
let observerFailureObserved = false;

const observedWait = `select exists (
  select 1 from pg_stat_activity w join pg_stat_activity b
  on b.pid = any(pg_blocking_pids(w.pid))
  where w.application_name='h002_worker' and b.application_name='h002_blocker'
    and w.wait_event_type='Lock');`;

function mutate(action) {
  const fields = ['create', 'update'].includes(action)
    ? "'SYN-H002', 'synh002', 'Synthetic', 'Model', null"
    : `null, null, null, null, '${action === 'archive' ? 'no_longer_tracked' : 'tracking_resumed'}'`;
  return `select public.mutate_aircraft_record('${actor}', '${org}', '${action}',
    ${action === 'create' ? 'null' : `'${record}'`}, ${fields},
    ${action === 'create' ? 'null' : '1'}, repeat('1',64), repeat('a',64), '${correlation}');`;
}

async function snapshot() {
  return observer.query(`select jsonb_build_array(
    (select jsonb_agg(to_jsonb(r) order by id) from public.aircraft_records r where organization_id='${org}'),
    (select jsonb_agg(to_jsonb(e) order by id) from public.aircraft_registry_events e where organization_id='${org}'),
    (select jsonb_agg(to_jsonb(i) order by organization_id, actor_user_id, idempotency_key_hash)
      from public.aircraft_registry_idempotency i where organization_id='${org}'));`);
}

async function prepare(action) {
  await observer.query(`begin;
    delete from public.aircraft_registry_idempotency where organization_id='${org}';
    delete from public.aircraft_registry_events where organization_id='${org}';
    delete from public.aircraft_records where organization_id='${org}';
    delete from public.member_administration_events where organization_id='${org}';
    update public.organization_memberships set status='active' where id='${member}';
    update public.membership_roles set role_id=(select id from public.roles where code='admin')
      where membership_id='${member}';
    commit;`);
  if (action !== 'create') {
    await observer.query(`insert into public.aircraft_records(
      id,organization_id,registration_mark,registration_key,manufacturer,model,created_by,updated_by,
      registry_state,archive_reason,archived_at,archived_by)
      values('${record}','${org}','SYN-BASE','synbase','Synthetic','Model','${admin}','${admin}',
      ${action === 'reactivate' ? `'archived','no_longer_tracked',now(),'${admin}'` : "'tracked',null,null,null"});`);
  }
}

async function revoke(authority) {
  if (authority === 'retained') return;
  if (authority === 'membership') {
    assert.equal(
      await observer.query(`select public.change_organization_member_status(
      '${admin}','${org}','${member}','revoke','membership_ended',
      (select version from public.organization_memberships where id='${member}'),
      repeat('2',64),'${correlation}')->>'decision';`),
      'revoked',
    );
    assert.equal(
      await observer.query(
        `select status from public.organization_memberships where id='${member}';`,
      ),
      'revoked',
    );
  } else {
    assert.equal(
      await observer.query(`select public.change_organization_member_role(
      '${admin}','${org}','${member}','student_pilot','responsibility_changed',
      (select version from public.organization_memberships where id='${member}'),
      repeat('2',64),null,'${correlation}')->>'decision';`),
      'changed',
    );
    assert.equal(
      await observer.query(`select r.code from public.membership_roles mr
      join public.roles r on r.id=mr.role_id where mr.membership_id='${member}';`),
      'student_pilot',
    );
  }
  assert.equal(
    await observer.query(`select public.aircraft_registry_actor_is_authorized(
    '${actor}','${org}','aircraft.record.manage');`),
    'f',
  );
}

async function race(action, kind, authority, replay = false) {
  stage = `${action}-${kind}-${authority}${replay ? '-replay' : ''}`;
  phase = 'prepare';
  await prepare(action);
  phase = 'snapshot';
  if (replay) assert.equal(JSON.parse(await worker.query(mutate(action))).decision, 'created');
  const before = await snapshot();
  const lock =
    kind === 'advisory'
      ? `select pg_advisory_xact_lock(hashtextextended('${org}:${actor}:' || repeat('1',64),0));`
      : `select id from public.aircraft_records where id='${record}' for update;`;
  phase = 'acquire-blocker';
  await blocker.query(`begin; ${lock}`);
  const result = worker
    .query(mutate(action))
    .then((response) => JSON.parse(response))
    .catch((error) => ({ failure: error }));
  // Establish the actual blocked backend and its exact blocker, not an assumed delay.
  phase = 'observe-wait';
  await waitForSql(observer, observedWait);
  phase = 'revoke';
  await revoke(authority);
  phase = 'release-blocker';
  await blocker.query('rollback;');
  phase = 'worker-result';
  const response = await result;
  if (response.failure) throw response.failure;
  phase = 'assert-state';
  if (authority !== 'retained') {
    assert.equal(response.decision, 'unauthorized');
    assert.equal(await snapshot(), before);
  } else {
    assert.equal(
      response.decision,
      { create: 'created', update: 'updated', archive: 'archived', reactivate: 'reactivated' }[
        action
      ],
    );
    assert.equal(response.replayed, replay);
    if (replay) assert.equal(await snapshot(), before);
    assert.equal(
      await observer.query(
        `select version from public.aircraft_records where organization_id='${org}';`,
      ),
      action === 'create' ? '1' : '2',
    );
    assert.equal(
      await observer.query(`select count(*) from public.aircraft_registry_events
      where organization_id='${org}' and actor_user_id='${actor}' and outcome='success';`),
      '1',
    );
    assert.equal(
      await observer.query(
        `select count(*) from public.aircraft_registry_idempotency where organization_id='${org}';`,
      ),
      '1',
    );
  }
  process.stdout.write(`H002 regression passed: ${stage}.\n`);
}

try {
  for (const session of [observer, blocker, worker]) {
    await session.query(
      "set statement_timeout='15s'; set idle_in_transaction_session_timeout='15s';",
    );
    assert.equal(await session.query('show transaction_isolation;'), 'read committed');
  }
  assert.equal(await observer.query('select count(*) from public.organizations;'), '0');
  assert.equal(
    await observer.query(`select count(*) from auth.users where id in ('${actor}','${admin}');`),
    '0',
  );
  // Preflight proves these exact IDs are absent. Cleanup also covers lost commit acknowledgement.
  owned = true;
  phase = 'seed';
  await observer.query(`begin;
    insert into auth.users(id,email) values('${actor}','h002-actor@example.test'),('${admin}','h002-admin@example.test');
    insert into public.organizations(id,name,status) values('${org}','Synthetic H002 School','active');
    insert into public.organization_memberships(id,organization_id,user_id,status,created_by,updated_by)
    values('${member}','${org}','${actor}','active','${admin}','${admin}'),
      ('${adminMember}','${org}','${admin}','active','${admin}','${admin}');
    insert into public.membership_roles(organization_id,membership_id,role_id,assigned_by)
    select '${org}',m.id,r.id,'${admin}' from public.organization_memberships m
    cross join public.roles r where m.organization_id='${org}' and r.code='admin';
    commit;`);
  await worker.query('set role service_role;');
  if (cleanupProbe) {
    stage = 'controlled-observer-failure';
    phase = 'seed-domain';
    assert.equal(JSON.parse(await worker.query(mutate('create'))).decision, 'created');
    await blocker.query(`begin; select pg_advisory_xact_lock(
      hashtextextended('${org}:${actor}:' || repeat('1',64),0));`);
    // Keep a real worker blocked when the observer fails; cleanup must release/drain it.
    worker.query(mutate('create')).catch(() => {});
    await waitForSql(observer, observedWait);
    phase = 'inject-observer-failure';
    await observer.query('select 1 / 0;');
    assert.fail('The controlled SQL error must close the observer');
  } else
    for (const authority of ['membership', 'role', 'retained']) {
      await race('create', 'advisory', authority);
      await race('create', 'advisory', authority, true);
      for (const action of ['update', 'archive', 'reactivate']) {
        for (const lock of ['advisory', 'row']) await race(action, lock, authority);
      }
    }
} catch (error) {
  if (
    cleanupProbe &&
    phase === 'inject-observer-failure' &&
    error instanceof H002SqlError &&
    error.sqlState === '22012'
  ) {
    observerFailureObserved = true;
    process.stdout.write('H002 controlled observer failure observed: sqlstate-22012.\n');
  } else {
    process.stderr.write(
      `H002 failed: case=${stage} phase=${phase} detail=${failureDetail(error)}.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  // Closing the lock holder first releases any wait even after an assertion fails.
  for (const session of [blocker, worker, observer]) {
    try {
      await session.close();
    } catch (error) {
      process.stderr.write(`H002 failed: phase=close-sessions detail=${failureDetail(error)}.\n`);
      process.exitCode = 1;
    }
  }
  const cleanup = postgresSession('h002_cleanup');
  try {
    phase = 'cleanup-rows';
    if (owned)
      await cleanup.query(`begin;
      delete from public.aircraft_registry_idempotency where organization_id='${org}';
      delete from public.aircraft_registry_events where organization_id='${org}';
      delete from public.aircraft_records where organization_id='${org}';
      delete from public.member_administration_events where organization_id='${org}';
      delete from public.aircraft_document_categories where organization_id='${org}';
      delete from public.organization_member_profiles where organization_id='${org}';
      delete from public.membership_roles where organization_id='${org}';
      delete from public.organization_memberships where organization_id='${org}';
      delete from public.organizations where id='${org}';
      delete from auth.users where id in ('${actor}','${admin}'); commit;`);
    phase = 'cleanup-assertions';
    if (owned)
      assert.equal(
        await cleanup.query(`select
      (select count(*) from public.aircraft_registry_idempotency where organization_id='${org}') +
      (select count(*) from public.aircraft_registry_events where organization_id='${org}') +
      (select count(*) from public.aircraft_records where organization_id='${org}') +
      (select count(*) from public.member_administration_events where organization_id='${org}') +
      (select count(*) from public.aircraft_document_categories where organization_id='${org}') +
      (select count(*) from public.organization_member_profiles where organization_id='${org}') +
      (select count(*) from public.membership_roles where organization_id='${org}') +
      (select count(*) from public.organization_memberships where organization_id='${org}') +
      (select count(*) from public.organizations where id='${org}') +
      (select count(*) from auth.users where id in ('${actor}','${admin}')) +
      (select count(*) from pg_stat_activity where application_name in ('h002_blocker','h002_worker','h002_observer'));`),
        '0',
      );
    if (owned)
      process.stdout.write(
        'H002 cleanup passed: all fixture rows, users and original sessions absent.\n',
      );
  } catch (error) {
    process.stderr.write(`H002 failed: phase=${phase} detail=${failureDetail(error)}.\n`);
    process.exitCode = 1;
  } finally {
    try {
      await cleanup.close();
    } catch (error) {
      process.stderr.write(`H002 failed: phase=close-cleanup detail=${failureDetail(error)}.\n`);
      process.exitCode = 1;
    }
  }
  if (cleanupProbe && !observerFailureObserved) process.exitCode = 1;
  if (cleanupProbe && observerFailureObserved && !process.exitCode) {
    process.stdout.write('H002 controlled observer-failure cleanup regression passed.\n');
  }
}
