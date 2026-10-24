import {
  ids,
  q,
  hash,
  scope,
  aircraftSeed,
  documentSeed,
  fileSeed,
} from './h002-review-fixture.mjs';
import { reset as baseReset, tables as registryTables } from './h002-registry-implicit-fixture.mjs';

export { seed, cleanup, residue, users, permissions } from './h002-registry-implicit-fixture.mjs';
export { ids, q, scope };
export const peerCategory = 'e0320000-0000-4000-8000-000000000091';
export const peerNotification = 'e0320000-0000-4000-8000-000000000092';
export const adminNotification = 'e0320000-0000-4000-8000-000000000093';
export const date = '2026-10-01';
export const reason = 'Synthetic record update';
export const label = 'Synthetic next category';
export const documentActions = ['create', 'renew', 'correct', 'suspend', 'restore'];
export const categoryActions = [
  'create_category',
  'rename_category',
  'archive_category',
  'assign_new',
  'reassign',
  'remove_category',
];
export const variants = [
  ...documentActions.map((action) => ({ family: 'document', action })),
  ...categoryActions.map((action) => ({ family: 'category', action })),
];
const variant = (action) => variants.find((item) => item.action === action);
export const cases = [
  ...['domain', 'audit', 'idempotency'].flatMap((kind) =>
    variants.map((item) => ({ ...item, kind })),
  ),
  ...[
    ['create', 'aircraft_document_versions'],
    ['renew', 'aircraft_documents'],
    ['correct', 'aircraft_documents'],
    ['archive_category', 'aircraft_document_requirements'],
    ['archive_category', 'aircraft_documents'],
    ['reassign', 'aircraft_documents'],
    ['remove_category', 'aircraft_documents'],
  ].map(([action, table]) => ({ ...variant(action), kind: 'secondary', table })),
  ...[...documentActions, 'archive_category', 'reassign', 'remove_category'].map((action) => ({
    ...variant(action),
    kind: 'notification',
  })),
  ...variants.flatMap((item) =>
    [true, false].map((commit) => ({ ...item, kind: 'unique-idempotency', commit })),
  ),
  ...['create_category', 'rename_category'].flatMap((action) =>
    [true, false].map((commit) => ({ ...variant(action), kind: 'unique-label', commit })),
  ),
  ...['create', 'create_category'].flatMap((action) =>
    ['organization', 'actor'].map((parent) => ({
      ...variant(action),
      kind: 'foreign-key',
      parent,
    })),
  ),
  { ...variant('create'), kind: 'foreign-key', parent: 'recipient' },
  ...['restore', 'reassign'].map((action) => ({
    ...variant(action),
    kind: 'unique-notification',
    commit: true,
  })),
].map((test) => ({
  ...test,
  name: [
    test.kind,
    test.action,
    test.table,
    test.parent,
    test.commit === undefined ? undefined : test.commit ? 'commit' : 'rollback',
  ]
    .filter(Boolean)
    .join('-'),
}));

export const tables = [...registryTables, 'stored_files', 'aircraft_document_idempotency'];
export const snapshot = `select jsonb_build_object(${tables
  .map(
    (table) => `'${table}',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.${table} t where ${scope})`,
  )
  .join(',')});`;
export const reset = `${baseReset}
  delete from public.aircraft_document_categories where ${scope} and category_kind='custom' and id<>${q('category')};
  update public.aircraft_document_categories set category_label='Synthetic review',category_state='active',
    version=1,updated_at=created_at,updated_by=${q('admin')},archived_at=null,archived_by=null where id=${q('category')};`;
export const signatures = [
  'public.mutate_aircraft_document(uuid,uuid,text,uuid,uuid,uuid,bigint,text,text,text,date,date,text,uuid,text,text,text,date,uuid)',
  'public.mutate_aircraft_document_category(uuid,uuid,text,uuid,uuid,bigint,text,text,text,date,uuid)',
];
export const actualAction = (test) =>
  ['assign_new', 'reassign'].includes(test.action) ? 'assign_category' : test.action;
export const notifying = (test) =>
  test.kind === 'notification' ||
  test.parent === 'recipient' ||
  test.kind === 'unique-notification';
export const expiration = (test) => (notifying(test) ? '2026-10-06' : '2026-12-31');
export const permission = (test) =>
  test.family === 'document' ? 'aircraft.document.manage' : 'aircraft.document.category.manage';
export const holderRevokes = (test) =>
  test.kind === 'foreign-key' || test.kind === 'unique-notification';
export const committedPeer = (test) => test.kind.startsWith('unique-') && test.commit;
export const success = (test) =>
  ({
    create: 'created',
    renew: 'renewed',
    correct: 'corrected',
    suspend: 'suspended',
    restore: 'restored',
    create_category: 'category_created',
    rename_category: 'category_renamed',
    archive_category: 'category_archived',
    assign_new: 'category_assigned',
    reassign: 'category_assigned',
    remove_category: 'category_removed',
  })[test.action];

export function setup(test) {
  let sql = aircraftSeed + fileSeed;
  if (!(test.family === 'document' && test.action === 'create') && test.action !== 'assign_new')
    sql += documentSeed
      .replace('current_date+3', "'2026-10-04'::date")
      .replace('current_date-4', "'2026-09-27'::date");
  if (test.action === 'assign_new')
    sql += `delete from public.aircraft_document_requirements where ${scope} and category_id=${q('category')};`;
  if (['restore', 'reassign'].includes(test.action)) {
    sql += `update public.aircraft_document_notifications set notification_state='resolved',resolved_at=now(),resolution_reason='suspended' where ${scope};`;
    if (test.kind === 'unique-notification') {
      sql += `insert into public.aircraft_document_notifications(id,organization_id,recipient_membership_id,
        aircraft_document_id,document_version_id,event_kind,due_date,notification_state,resolved_at,resolution_reason)
        values('${peerNotification}',${q('org')},${q('targetMember')},${q('document')},${q('version')},'warning',
        '2026-09-27','resolved',now(),'suspended');`;
    } else {
      sql += `insert into public.aircraft_document_notifications(id,organization_id,recipient_membership_id,
        aircraft_document_id,document_version_id,event_kind,due_date,notification_state,resolved_at,resolution_reason)
        values('${adminNotification}',${q('org')},${q('adminMember')},${q('document')},${q('version')},'warning',
        '2026-09-27','resolved',now(),'suspended');`;
    }
    if (test.action === 'restore')
      sql += `update public.aircraft_documents set document_state='suspended',
      suspension_reason='Synthetic suspension',suspended_at=now(),suspended_by=${q('admin')} where ${scope};`;
    else
      sql += `update public.aircraft_document_requirements set requirement_state='archived',archived_at=now(),archived_by=${q('admin')}
      where ${scope} and category_id=${q('category')};
      update public.aircraft_documents set document_state='archived',archived_at=now(),archived_by=${q('admin')} where ${scope};`;
  }
  if (test.kind === 'unique-idempotency')
    sql += `insert into public.aircraft_document_idempotency
    (organization_id,actor_user_id,idempotency_key_hash,action,target_id,expected_version,request_hash,result)
    values(${q('org')},${q('actor')},${hash('c')},'fixture_peer',null,null,${hash('d')},'{"fixture":"peer"}');`;
  if (test.kind === 'unique-label')
    sql += `insert into public.aircraft_document_categories
    (id,organization_id,category_code,category_label,category_kind,created_by,updated_by)
    values('${peerCategory}',${q('org')},'custom_peer','Synthetic peer','custom',${q('admin')},${q('admin')});`;
  return sql;
}
export function relation(test) {
  if (test.kind === 'secondary') return test.table;
  if (test.kind === 'audit') return 'aircraft_document_events';
  if (test.kind === 'idempotency') return 'aircraft_document_idempotency';
  if (test.kind === 'notification') return 'aircraft_document_notifications';
  if (test.kind !== 'domain') return undefined;
  if (test.family === 'document')
    return ['renew', 'correct'].includes(test.action)
      ? 'aircraft_document_versions'
      : 'aircraft_documents';
  return ['assign_new', 'reassign', 'remove_category'].includes(test.action)
    ? 'aircraft_document_requirements'
    : 'aircraft_document_categories';
}
export function lock(test) {
  if (relation(test)) return `lock public.${relation(test)} in share mode;`;
  if (test.kind === 'foreign-key')
    return {
      organization: `select id from public.organizations where id=${q('org')} for update;`,
      actor: `select id from auth.users where id=${q('actor')} for update;`,
      recipient: `select id from public.organization_memberships where id=${q('member')} for update;`,
    }[test.parent];
  if (test.kind === 'unique-idempotency')
    return `update public.aircraft_document_idempotency set idempotency_key_hash=${hash('a')}
    where ${scope} and idempotency_key_hash=${hash('c')};`;
  if (test.kind === 'unique-label')
    return `update public.aircraft_document_categories set category_label='${label}' where id='${peerCategory}';`;
  return `update public.aircraft_document_notifications set recipient_membership_id=${q('adminMember')} where id='${peerNotification}';`;
}
export function command(test) {
  const args = `${q('actor')},${q('org')},'${actualAction(test)}'`;
  if (test.family === 'category')
    return `select public.mutate_aircraft_document_category(${args},
    ${test.action === 'create_category' ? 'null' : q('category')},
    ${['assign_new', 'reassign', 'remove_category'].includes(test.action) ? q('aircraft') : 'null'},
    ${test.action === 'create_category' ? 'null' : '1'},
    ${['create_category', 'rename_category'].includes(test.action) ? `'${label}'` : 'null'},
    ${hash('a')},${hash('b')},'${date}',${q('correlation')});`;
  const metadata = ['create', 'renew', 'correct'].includes(test.action)
    ? `'Synthetic next document','Synthetic next source','SYN-REF','2026-09-01','${expiration(test)}','Synthetic note',${q('file')}`
    : 'null,null,null,null,null,null,null';
  return `select public.mutate_aircraft_document(${args},${q('aircraft')},${q('category')},
    ${test.action === 'create' ? 'null,null' : `${q('document')},1`},${metadata},
    ${test.action === 'create' ? 'null' : `'${reason}'`},${hash('a')},${hash('b')},'${date}',${q('correlation')});`;
}
