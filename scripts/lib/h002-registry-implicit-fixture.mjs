import {
  ids,
  q,
  hash,
  scope,
  seed,
  aircraftSeed,
  documentSeed,
  clearDomain,
  domainTables,
} from './h002-review-fixture.mjs';

export { ids, q, scope, seed };
export const peerId = "'e0300000-0000-4000-8000-000000000090'";
export const actions = ['create', 'update', 'archive', 'reactivate'];
export const tables = [
  'aircraft_records',
  'aircraft_registry_events',
  'aircraft_registry_idempotency',
  'aircraft_documents',
  'aircraft_document_versions',
  'aircraft_document_requirements',
  'aircraft_document_categories',
  'aircraft_document_notifications',
  'aircraft_document_events',
];
export const cases = [
  ...['domain', 'audit', 'idempotency'].flatMap((kind) =>
    actions.map((action) => ({ kind, action })),
  ),
  ...['create', 'update', 'reactivate'].flatMap((action) =>
    [true, false].map((commit) => ({ kind: 'unique', action, commit })),
  ),
  { kind: 'foreign-key', action: 'create' },
  ...['archive', 'reactivate'].map((action) => ({ kind: 'trigger', action })),
].map((test) => ({
  ...test,
  name: `${test.kind}-${test.action}${test.kind === 'unique' ? (test.commit ? '-commit' : '-rollback') : ''}`,
}));

export const clear = `delete from public.aircraft_registry_idempotency where ${scope};
  delete from public.aircraft_registry_events where ${scope}; ${clearDomain()}`;
export const reset = `${clear}
  update public.organization_memberships set status='active',version=1 where ${scope};
  update public.membership_roles mr set role_id=r.id from public.roles r where mr.${scope}
    and r.code=case when mr.membership_id=${q('targetMember')} then 'instructor_pilot' else 'admin' end;`;
export const users = `${q('actor')},${q('admin')},${q('target')}`;
export const permissions = `select jsonb_build_array(
  (select jsonb_agg(to_jsonb(t) order by id) from public.roles t),
  (select jsonb_agg(to_jsonb(t) order by id) from public.permissions t),
  (select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.role_permissions t));`;
export const cleanup = `${clear}
  delete from public.aircraft_document_categories where ${scope};
  delete from public.organization_member_profiles where ${scope};
  delete from public.membership_roles where ${scope};
  delete from public.organization_memberships where ${scope};
  delete from public.organizations where id=${q('org')};
  delete from auth.users where id in (${users});`;
const ownedTables = [
  ...new Set([
    ...domainTables,
    ...tables,
    'organization_member_profiles',
    'membership_roles',
    'organization_memberships',
  ]),
];
export const residue = `select ${ownedTables.map((table) => `(select count(*) from public.${table} where ${scope})`).join('+')}
  +(select count(*) from public.organizations where id=${q('org')})
  +(select count(*) from auth.users where id in (${users}))
  +(select count(*) from public.authentication_events where actor_user_id in (${users}))
  +(select count(*) from public.member_invitation_events where actor_user_id in (${users}));`;
export const snapshot = `select jsonb_build_object(${tables
  .map(
    (table) => `'${table}',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t where ${scope})`,
  )
  .join(',')});`;

export function setup(test) {
  let sql = test.action === 'create' ? '' : aircraftSeed;
  if (test.kind === 'trigger') sql += documentSeed;
  if (test.action === 'reactivate')
    sql += `
    update public.aircraft_records set registry_state='archived',archive_reason='no_longer_tracked',
      archived_at=now(),archived_by=${q('admin')} where id=${q('aircraft')};`;
  if (test.kind === 'unique')
    sql += `
    insert into public.aircraft_records(id,organization_id,registration_mark,registration_key,manufacturer,model,created_by,updated_by)
    values(${peerId},${q('org')},'SYN-PEER','synpeer','Synthetic','Model',${q('admin')},${q('admin')});`;
  return sql;
}
export const relation = (test) =>
  ({
    domain: 'aircraft_records',
    audit: 'aircraft_registry_events',
    idempotency: 'aircraft_registry_idempotency',
  })[test.kind];
export function lock(test) {
  if (relation(test)) return `lock public.${relation(test)} in share mode;`;
  if (test.kind === 'foreign-key')
    return `select id from public.organizations where id=${q('org')} for update;`;
  if (test.kind === 'trigger')
    return `select id from public.aircraft_document_notifications where id=${q('notification')} for update;`;
  return `update public.aircraft_records set registration_mark='${test.action === 'reactivate' ? 'SYN-H003' : 'SYN-NEW'}',
    registration_key='${test.action === 'reactivate' ? 'synh003' : 'synnew'}' where id=${peerId};`;
}
export function command(test) {
  const identity = ['create', 'update'].includes(test.action)
    ? "'SYN-NEW','synnew','Synthetic changed','Model changed'"
    : 'null,null,null,null';
  const reason =
    test.action === 'archive'
      ? "'no_longer_tracked'"
      : test.action === 'reactivate'
        ? "'tracking_resumed'"
        : 'null';
  return `select public.mutate_aircraft_record(${q('actor')},${q('org')},'${test.action}',
    ${test.action === 'create' ? 'null' : q('aircraft')},${identity},${reason},
    ${test.action === 'create' ? 'null' : '1'},${hash('a')},${hash('b')},${q('correlation')});`;
}
export const success = (test) =>
  ({ create: 'created', update: 'updated', archive: 'archived', reactivate: 'reactivated' })[
    test.action
  ];
