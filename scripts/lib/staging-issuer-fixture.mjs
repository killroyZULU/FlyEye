import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { postgresSession, waitForSql } from './h002-postgres-session.mjs';

const transaction = readFileSync(
  new URL('../sql/feat-003-staging-grant.sql', import.meta.url),
  'utf8',
);
const check = (condition) =>
  `do $check$ begin if not (${condition}) then raise exception 'Issuer assertion failed'; end if; end; $check$;`;

function settings(ids) {
  return Object.entries(ids)
    .map(([key, value]) => `set local flyeye.issuer_${key} = '${value}';`)
    .join('\n');
}
function setup(ids) {
  return `insert into public.organizations(id,name) values('${ids.organization_id}','Synthetic Issuer School');
    insert into auth.users(id,email,email_confirmed_at) values('${ids.user_id}','issuer-${ids.user_id}@example.test',now());`;
}
function denied(sql, state = 'P0001') {
  return `do $case$ declare rejected boolean := false; begin
    begin execute $statement$${sql}$statement$; exception when sqlstate '${state}' then rejected := true; end;
    if not rejected then raise exception 'Expected issuer rejection'; end if;
  end; $case$;`;
}
function absent(ids) {
  return `(select count(*) from public.organization_admin_bootstrap_grants where organization_id='${ids.organization_id}')=0
    and (select count(*) from public.authentication_events where source_instance_id='${ids.source_id}')=0`;
}

function rollbackCases(psql, ids) {
  const otherOrg = randomUUID();
  const admin = randomUUID();
  const failures = [];
  for (const table of ['organization_admin_bootstrap_grants', 'authentication_events']) {
    failures.push(`create function pg_temp.fail_issuer() returns trigger language plpgsql as $fail$
      begin raise exception using errcode='23514',message='Synthetic failure'; end; $fail$;
      create trigger staging_issuer_failure before insert on public.${table}
      for each row execute function pg_temp.fail_issuer();
      ${denied(transaction, '23514')} ${check(absent(ids))}
      drop trigger staging_issuer_failure on public.${table}; drop function pg_temp.fail_issuer();`);
    failures.push(`create function pg_temp.suppress_issuer() returns trigger language plpgsql as $fail$
      begin return null; end; $fail$;
      create trigger staging_issuer_failure before insert on public.${table}
      for each row execute function pg_temp.suppress_issuer();
      ${denied(transaction)} ${check(absent(ids))}
      drop trigger staging_issuer_failure on public.${table}; drop function pg_temp.suppress_issuer();`);
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    failures.push(
      `set local role ${role}; ${denied(transaction, '42501')} reset role; ${check(absent(ids))}`,
    );
  }
  psql(`begin; ${setup(ids)} ${settings(ids)}
    ${failures.join('\n')}
    update public.organizations set status='suspended' where id='${ids.organization_id}';
    ${denied(transaction)} ${check(absent(ids))}
    update public.organizations set status='active' where id='${ids.organization_id}';
    update auth.users set email_confirmed_at=null where id='${ids.user_id}';
    ${denied(transaction)} ${check(absent(ids))}
    update auth.users set email_confirmed_at=now() where id='${ids.user_id}';
    update auth.users set banned_until=now()+interval '1 hour' where id='${ids.user_id}';
    ${denied(transaction)} ${check(absent(ids))}
    update auth.users set banned_until=null,deleted_at=now() where id='${ids.user_id}';
    ${denied(transaction)} ${check(absent(ids))}
    update auth.users set deleted_at=null where id='${ids.user_id}';
    set local flyeye.issuer_organization_id='${randomUUID()}';
    ${denied(transaction)} ${check(absent(ids))} ${settings(ids)}
    insert into public.organization_memberships(organization_id,user_id) values('${ids.organization_id}','${ids.user_id}');
    ${denied(transaction)} ${check(absent(ids))}
    delete from public.organization_member_profiles where organization_id='${ids.organization_id}';
    delete from public.organization_memberships where organization_id='${ids.organization_id}';
    insert into auth.users(id,email,email_confirmed_at) values('${admin}','admin-${admin}@example.test',now());
    insert into public.organization_memberships(organization_id,user_id) values('${ids.organization_id}','${admin}');
    insert into public.membership_roles(organization_id,membership_id,role_id)
      select m.organization_id,m.id,r.id from public.organization_memberships m cross join public.roles r
      where m.user_id='${admin}' and r.code='admin';
    ${denied(transaction)} ${check(absent(ids))}
    delete from public.membership_roles where organization_id='${ids.organization_id}';
    delete from public.organization_member_profiles where organization_id='${ids.organization_id}';
    delete from public.organization_memberships where organization_id='${ids.organization_id}';
    delete from auth.users where id='${admin}';
    set constraints organizations_single_school_deployment_key deferred;
    insert into public.organizations(id,name) values('${otherOrg}','Synthetic Other School');
    insert into public.organization_memberships(organization_id,user_id) values('${otherOrg}','${ids.user_id}');
    ${denied(transaction)} ${check(absent(ids))}
    delete from public.organization_member_profiles where organization_id='${otherOrg}';
    delete from public.organization_memberships where organization_id='${otherOrg}';
    delete from public.aircraft_document_categories where organization_id='${otherOrg}';
    delete from public.organizations where id='${otherOrg}';
    set constraints organizations_single_school_deployment_key immediate;
    ${transaction}
    ${denied(transaction)}
    set local flyeye.issuer_grant_id='${randomUUID()}';
    set local flyeye.issuer_correlation_id='${randomUUID()}';
    ${denied(transaction)}
    ${check(`(select count(*) from public.organization_admin_bootstrap_grants where organization_id='${ids.organization_id}'
      and authorization_source_kind='staging_fixture' and authorization_source_code='feat-003-staging-synthetic-cli'
      and authorized_by_subject_id is null and status='pending' and expires_at=issued_at+interval '30 minutes')=1`)}
    ${check(`(select count(*) from public.authentication_events where source_instance_id='${ids.source_id}'
      and actor_kind='staging_fixture' and actor_user_id is null and actor_subject_id is null
      and correlation_id='${ids.correlation_id}' and target_id='${ids.grant_id}')=1`)}
    ${check(`(select count(*) from public.organization_memberships where organization_id='${ids.organization_id}')=0`)}
    rollback;`);
  assert.equal(psql(`select ${absent(ids)};`, {}, true), 't');
  assert.equal(
    psql(
      `select not exists(select 1 from public.aircraft_document_categories
    where organization_id in ('${ids.organization_id}','${otherOrg}'));`,
      {},
      true,
    ),
    't',
  );
}

async function raceCase(psql, ids) {
  const name = `issuer_${randomUUID().replaceAll('-', '')}`;
  const first = postgresSession(`${name}_first`);
  const second = postgresSession(`${name}_second`);
  const observer = postgresSession(`${name}_observer`);
  let pending;
  try {
    psql(`begin; ${setup(ids)} commit;`);
    await first.query(`begin; ${settings(ids)} ${transaction}`);
    pending = second
      .query(
        `begin; ${settings({ ...ids, grant_id: randomUUID(), correlation_id: randomUUID() })} ${denied(transaction)} commit;`,
      )
      .then(
        () => 'expected-denial',
        () => 'unexpected-error',
      );
    await waitForSql(
      observer,
      `select exists(select 1 from pg_stat_activity where application_name='${name}_second' and wait_event_type='Lock');`,
    );
    await first.query('commit;');
    assert.equal(await pending, 'expected-denial');
    assert.equal(
      psql(
        `select (select count(*) from public.organization_admin_bootstrap_grants where organization_id='${ids.organization_id}')::text
      || ':' || (select count(*) from public.authentication_events where source_instance_id='${ids.source_id}')::text;`,
        {},
        true,
      ),
      '1:1',
    );
  } finally {
    const closed = await Promise.allSettled([first.close(), second.close(), observer.close()]);
    if (pending) await pending;
    assert.ok(
      closed.every((result) => result.status === 'fulfilled'),
      'Issuer session cleanup uncertain',
    );
    psql(`begin;
      delete from public.authentication_events where source_instance_id='${ids.source_id}' and organization_id='${ids.organization_id}';
      delete from public.organization_admin_bootstrap_grants where authorization_source_instance_id='${ids.source_id}' and organization_id='${ids.organization_id}';
      delete from public.aircraft_document_categories where organization_id='${ids.organization_id}';
      delete from public.organizations where id='${ids.organization_id}';
      delete from auth.users where id='${ids.user_id}'; commit;`);
    assert.equal(
      psql(
        `select ${absent(ids)} and not exists(select 1 from public.organizations where id='${ids.organization_id}')
      and not exists(select 1 from public.aircraft_document_categories where organization_id='${ids.organization_id}')
      and not exists(select 1 from auth.users where id='${ids.user_id}');`,
        {},
        true,
      ),
      't',
    );
  }
}

// Called only by the existing attested, disposable FEAT-003 runtime fixture.
export async function verifyStagingIssuer(psql) {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(psql('select count(*) from public.organizations;', {}, true), '0');
  const ids = Object.fromEntries(
    ['organization_id', 'user_id', 'grant_id', 'source_id', 'correlation_id'].map((key) => [
      key,
      randomUUID(),
    ]),
  );
  rollbackCases(psql, ids);
  await raceCase(psql, ids);
}
