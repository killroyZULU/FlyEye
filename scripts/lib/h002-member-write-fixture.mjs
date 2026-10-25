import { ids, q, scope, aircraftSeed, documentSeed } from './h002-review-fixture.mjs';
import { reset as baseReset, tables as registryTables } from './h002-registry-implicit-fixture.mjs';

export { seed, cleanup, residue, users, permissions } from './h002-registry-implicit-fixture.mjs';
export { ids, q, scope };
export const name = 'Synthetic updated';
export const contact = '+63 9000000000';
export const variants = ['complete', 'clear', 'unchanged'];
export const cases = [
  ...variants.flatMap((action) =>
    ['domain', 'audit', 'organization', 'actor', 'membership'].map((kind) => ({
      family: 'profile',
      action,
      kind,
    })),
  ),
  ...['open', 'read', 'resolved'].flatMap((action) =>
    ['audit', 'organization', 'actor'].map((kind) => ({ family: 'notification', action, kind })),
  ),
  { family: 'notification', action: 'open', kind: 'domain' },
].map((test) => ({ ...test, name: `${test.family}-${test.action}-${test.kind}` }));
export const authorities = (test) =>
  test.family === 'profile'
    ? ['membership', 'retained', 'student']
    : ['membership', 'role', 'retained'];
export const denied = (authority) => ['membership', 'role'].includes(authority);
export const tables = [
  ...registryTables,
  'stored_files',
  'aircraft_document_idempotency',
  'organization_member_profiles',
  'member_administration_events',
  'organization_memberships',
  'membership_roles',
];
export const snapshot = `select jsonb_build_object(${tables
  .map(
    (table) => `'${table}',
  (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
   from public.${table} t where ${scope})`,
  )
  .join(',')});`;
export const reset = `${baseReset}
  update public.organization_member_profiles set display_name=null,contact_number=null,version=1,
  updated_by=${q('admin')},updated_at=created_at where ${scope};`;
export const signatures = [
  'public.update_my_member_profile(uuid,uuid,text,text,bigint,uuid)',
  'public.open_aircraft_document_notification(uuid,uuid,uuid,uuid,uuid)',
];
export const relation = (test) =>
  test.kind === 'domain'
    ? test.family === 'profile'
      ? 'organization_member_profiles'
      : 'aircraft_document_notifications'
    : test.kind === 'audit'
      ? test.family === 'profile'
        ? 'member_administration_events'
        : 'aircraft_document_events'
      : undefined;
export const holderRevokes = (test) =>
  !relation(test) || (test.family === 'profile' && test.kind === 'audit');
export function setup(test, authority = 'retained') {
  let sql =
    aircraftSeed +
    documentSeed
      .replace('current_date+3', "'2026-10-04'::date")
      .replace('current_date-4', "'2026-09-27'::date");
  if (test.family === 'profile' && test.action !== 'complete')
    sql += `update public.organization_member_profiles set display_name='${name}',contact_number='${contact}'
    where membership_id=${q('member')};`;
  if (test.family === 'notification' && test.action !== 'open')
    sql +=
      test.action === 'read'
        ? `update public.aircraft_document_notifications set notification_state='read',read_at='2026-10-01' where id=${q('notification')};`
        : `update public.aircraft_document_notifications set notification_state='resolved',resolved_at='2026-10-01',resolution_reason='suspended' where id=${q('notification')};`;
  if (authority === 'student')
    sql += `update public.membership_roles set role_id=(select id from public.roles where code='student_pilot') where membership_id=${q('member')};`;
  return sql;
}
export function lock(test) {
  if (relation(test)) return `lock public.${relation(test)} in share mode;`;
  return {
    organization: `select id from public.organizations where id=${q('org')} for update;`,
    actor: `select id from auth.users where id=${q('actor')} for update;`,
    membership: `select id from public.organization_memberships where id=${q('member')} for update;`,
  }[test.kind];
}
export function command(test) {
  return test.family === 'profile'
    ? `select public.update_my_member_profile(${q('actor')},${q('member')},'  ${name}  ',${test.action === 'clear' ? "'  '" : `' ${contact} '`},1,${q('correlation')});`
    : `select public.open_aircraft_document_notification(${q('actor')},${q('org')},${q('member')},${q('notification')},${q('correlation')});`;
}
