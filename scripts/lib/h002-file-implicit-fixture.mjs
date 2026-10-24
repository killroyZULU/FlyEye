import { ids, q, hash, scope, aircraftSeed, fileSeed } from './h002-review-fixture.mjs';
import { tables as registryTables } from './h002-registry-implicit-fixture.mjs';

// Reuse the reviewed single-school ownership/reset lifecycle, not registry cases.
export {
  seed,
  reset,
  cleanup,
  residue,
  users,
  permissions,
} from './h002-registry-implicit-fixture.mjs';
export { ids, q, scope };
export const peerId = 'e0300000-0000-4000-8000-000000000091';
export const objectKey = `${ids.org}/${ids.aircraft}/${ids.file}/${ids.file}.pdf`;
export const outcomes = ['clean', 'rejected', 'scan_failed', 'size-mismatch', 'hash-mismatch'];
export const tables = [...registryTables, 'stored_files'];
export const cases = [
  ...['domain', 'audit'].flatMap((kind) => [
    { kind, action: 'stage' },
    ...outcomes.map((outcome) => ({ kind, action: 'complete', outcome })),
  ]),
  { kind: 'audit', action: 'download' },
  ...['id', 'object-key'].flatMap((key) =>
    [true, false].map((commit) => ({ kind: 'unique', action: 'stage', key, commit })),
  ),
  ...['organization', 'aircraft', 'uploader'].map((parent) => ({
    kind: 'foreign-key',
    action: 'stage',
    parent,
  })),
].map((test) => ({
  ...test,
  name: [
    test.kind,
    test.action,
    test.outcome,
    test.key,
    test.kind === 'unique' ? (test.commit ? 'commit' : 'rollback') : test.parent,
  ]
    .filter(Boolean)
    .join('-'),
}));

export const signatures = [
  'public.stage_aircraft_document_file(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text,uuid)',
  'public.complete_aircraft_document_file(uuid,uuid,uuid,text,bigint,text,uuid)',
  'public.confirm_aircraft_document_download_issued(uuid,uuid,uuid,uuid)',
];
export const snapshot = `select jsonb_build_object(${tables
  .map(
    (table) => `'${table}',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.${table} t where ${scope})`,
  )
  .join(',')});`;

export function setup(test) {
  let sql = aircraftSeed;
  if (test.action === 'complete') sql += fileSeed.replace("'clean'", "'staged'");
  if (test.action === 'download')
    sql += `${fileSeed}
    insert into public.aircraft_documents(id,organization_id,aircraft_record_id,category_id,
      current_version_id,created_by,updated_by)
    values(${q('document')},${q('org')},${q('aircraft')},${q('category')},${q('version')},${q('admin')},${q('admin')});
    insert into public.aircraft_document_versions(id,organization_id,aircraft_document_id,version_number,
      version_kind,category_code,category_label,document_title,document_source,expiration_date,stored_file_id,created_by)
    values(${q('version')},${q('org')},${q('document')},1,'create','custom_h002','Synthetic review',
      'Synthetic document','Synthetic source',current_date+3,${q('file')},${q('admin')});`;
  if (test.kind === 'unique') sql += fileSeed.replaceAll(ids.file, peerId);
  return sql;
}
export const relation = (test) =>
  ({ domain: 'stored_files', audit: 'aircraft_document_events' })[test.kind];
export function lock(test) {
  if (relation(test)) return `lock public.${relation(test)} in share mode;`;
  if (test.kind === 'foreign-key')
    return {
      organization: `select id from public.organizations where id=${q('org')} for update;`,
      aircraft: `select id from public.aircraft_records where id=${q('aircraft')} for update;`,
      uploader: `select id from auth.users where id=${q('actor')} for update;`,
    }[test.parent];
  return `update public.stored_files set ${test.key === 'id' ? `id=${q('file')}` : `object_key='${objectKey}'`}
    where id='${peerId}';`;
}
export const finalState = (test) =>
  test.outcome?.endsWith('mismatch') ? 'rejected' : test.outcome;
export const permission = (test) =>
  test.action === 'download' ? 'aircraft.document.attachment.read' : 'aircraft.document.manage';
export function command(test) {
  const args = `${q('actor')},${q('org')}`;
  if (test.action === 'stage')
    return `select public.stage_aircraft_document_file(${args},${q('aircraft')},${q('file')},
    '${objectKey}','Synthetic.pdf','${ids.file}.pdf','application/pdf',10,${hash('a')},${q('correlation')});`;
  if (test.action === 'complete')
    return `select public.complete_aircraft_document_file(${args},${q('file')},
    '${test.outcome.endsWith('mismatch') ? 'clean' : test.outcome}',${test.outcome === 'size-mismatch' ? 11 : 10},
    ${hash(test.outcome === 'hash-mismatch' ? 'b' : 'a')},${q('correlation')});`;
  return `select public.confirm_aircraft_document_download_issued(${args},${q('file')},${q('correlation')});`;
}
