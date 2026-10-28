import { ids, q, scope } from './h002-review-fixture.mjs';
import { reset as baseReset, tables, snapshot } from './h002-member-write-fixture.mjs';

export { ids, q, scope, tables, snapshot };
export { seed, users, cleanup, residue, permissions } from './h002-registry-implicit-fixture.mjs';
export const cases = ['list', 'detail', 'profile'].flatMap((family) =>
  ['audit', 'organization', 'actor', ...(family === 'list' ? [] : ['membership'])].map((kind) => ({
    family,
    kind,
    name: `${family}-${kind}`,
  })),
);
export const authorities = (test) =>
  test.family === 'profile'
    ? ['membership', 'retained', 'student']
    : ['membership', 'role', 'retained'];
export const denied = (authority) => ['membership', 'role'].includes(authority);
export const reset = baseReset;
export const signatures = [
  'public.list_organization_members(uuid,uuid,uuid,text,text,timestamptz,uuid,integer)',
  'public.get_organization_member(uuid,uuid,uuid,uuid)',
  'public.get_my_member_profile(uuid,uuid,uuid)',
];
export const setup = (_test, authority) =>
  authority === 'student'
    ? `update public.membership_roles set role_id=(select id from public.roles where code='student_pilot') where membership_id=${q('member')};`
    : '';
export const relation = (test) =>
  test.kind === 'audit' ? 'member_administration_events' : undefined;
export function lock(test) {
  return {
    audit: 'lock public.member_administration_events in share mode;',
    organization: `select id from public.organizations where id=${q('org')} for update;`,
    actor: `select id from auth.users where id=${q('actor')} for update;`,
    membership: `select id from public.organization_memberships where id=${q(test.family === 'detail' ? 'targetMember' : 'member')} for update;`,
  }[test.kind];
}
export function command(test) {
  return {
    list: `select public.list_organization_members(${q('actor')},${q('org')},${q('correlation')});`,
    detail: `select public.get_organization_member(${q('actor')},${q('org')},${q('targetMember')},${q('correlation')});`,
    profile: `select public.get_my_member_profile(${q('actor')},${q('member')},${q('correlation')});`,
  }[test.family];
}
export const context = `select jsonb_build_object(
  'roles',(select jsonb_agg(to_jsonb(r) order by display_name,code) from public.roles r),
  'statusOptions',public.member_status_reason_options('suspend') || public.member_status_reason_options('revoke'),
  'roleReasons',public.member_role_reason_options());`;
