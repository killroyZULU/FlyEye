// Disposable-CI-only synthetic ownership; never mutate seeded production roles.
export const ids = Object.fromEntries(
  ['org', 'recipient', 'admin', 'adminMember', 'invitation', 'role', 'correlation'].map(
    (name, index) => [name, `e0600000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`],
  ),
);
export const q = (name) => `'${ids[name]}'`;
export const scope = `organization_id=${q('org')}`;
export const users = `${q('recipient')},${q('admin')}`;
export const hash = (value) => `repeat('${value}',64)`;
export const tables = [
  'member_invitation_events',
  'organization_invitations',
  'organization_member_profiles',
  'membership_roles',
  'organization_memberships',
  'aircraft_document_categories',
  'authentication_events',
];
export const seed = `
  insert into auth.users(id,email,email_confirmed_at) values
    (${q('recipient')},'h002-accept-recipient@example.test',now()),
    (${q('admin')},'h002-accept-admin@example.test',now());
  insert into public.organizations(id,name,status) values(${q('org')},'Synthetic acceptance','active');
  insert into public.organization_memberships(id,organization_id,user_id,status,created_by,updated_by)
    values(${q('adminMember')},${q('org')},${q('admin')},'active',${q('admin')},${q('admin')});
  insert into public.membership_roles(organization_id,membership_id,role_id,assigned_by)
    select ${q('org')},${q('adminMember')},id,${q('admin')} from public.roles where code='admin';
  insert into public.roles(id,code,display_name,is_active,is_invitation_assignable)
    values(${q('role')},'h002_acceptance_synthetic','Synthetic acceptance role',true,true);
  insert into public.role_permissions(role_id,permission_id)
    select ${q('role')},rp.permission_id from public.role_permissions rp
    join public.roles r on r.id=rp.role_id where r.code='student_pilot';`;
export const reset = `
  delete from public.member_invitation_events where ${scope} or actor_user_id in (${users});
  delete from public.organization_invitations where ${scope};
  delete from public.organization_member_profiles where ${scope} and membership_id<>${q('adminMember')};
  delete from public.membership_roles where ${scope} and membership_id<>${q('adminMember')};
  delete from public.organization_memberships where ${scope} and id<>${q('adminMember')};
  update public.organizations set status='active' where id=${q('org')};
  update public.roles set is_active=true,is_invitation_assignable=true where id=${q('role')};
  insert into public.organization_invitations(id,organization_id,email_original,email_canonical,
    role_id,status,invited_by,issuance_idempotency_key_hash,correlation_id)
    values(${q('invitation')},${q('org')},'h002-accept-recipient@example.test',
    'h002-accept-recipient@example.test',${q('role')},'pending',${q('admin')},${hash('a')},${q('correlation')});`;
export function accept({
  key = 'b',
  email = 'h002-accept-recipient@example.test',
  version = 1,
  age = 0,
} = {}) {
  return `select public.accept_member_invitation(${q('recipient')},'${email}',
    floor(extract(epoch from now()))::bigint-${age},${q('invitation')},${version},${hash(key)},${q('correlation')});`;
}
export const revoke = `select public.revoke_member_invitation(${q('admin')},${q('org')},
  ${q('invitation')},1,${hash('c')},${q('correlation')});`;
export const locks = {
  org: `select 1 from public.organizations where id=${q('org')} for update;`,
  invitation: `select 1 from public.organization_invitations where id=${q('invitation')} for update;`,
  role: `select 1 from public.roles where id=${q('role')} for no key update;`,
};
export const unchangedRoles = `select jsonb_build_array(
  (select jsonb_agg(to_jsonb(r) order by id) from public.roles r where id<>${q('role')}),
  (select jsonb_agg(to_jsonb(rp) order by role_id,permission_id) from public.role_permissions rp where role_id<>${q('role')}));`;
export const snapshot = `select jsonb_build_object(
  'roleState',(select jsonb_build_object('is_active',is_active,'is_invitation_assignable',is_invitation_assignable)
    from public.roles where id=${q('role')}),
  'organizationStatus',(select status from public.organizations where id=${q('org')}),
  'invitation',(select to_jsonb(i) from public.organization_invitations i where id=${q('invitation')}),
  'members',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]'::jsonb)
    from public.organization_memberships m where ${scope} and user_id=${q('recipient')}),
  'roles',(select coalesce(jsonb_agg(to_jsonb(mr) order by membership_id),'[]'::jsonb)
    from public.membership_roles mr where ${scope} and membership_id<>${q('adminMember')}),
  'events',(select coalesce(jsonb_agg(to_jsonb(e) order by event_name,id),'[]'::jsonb)
    from public.member_invitation_events e where ${scope} or actor_user_id in (${users})));`;
export const cleanupSql =
  tables
    .map(
      (table) =>
        `delete from public.${table} where ${scope}${
          table.endsWith('_events') ? ` or actor_user_id in (${users})` : ''
        };`,
    )
    .join('\n') +
  `
  delete from public.organizations where id=${q('org')};
  delete from public.role_permissions where role_id=${q('role')};
  delete from public.roles where id=${q('role')};
  delete from auth.users where id in (${users});`;
export const residueSql = `select ${[
  ...tables.map(
    (table) =>
      `(select count(*) from public.${table} where ${scope}${table.endsWith('_events') ? ` or actor_user_id in (${users})` : ''})`,
  ),
  `(select count(*) from public.organizations where id=${q('org')})`,
  `(select count(*) from public.roles where id=${q('role')})`,
  `(select count(*) from public.role_permissions where role_id=${q('role')})`,
  `(select count(*) from auth.users where id in (${users}))`,
  `(select count(*) from auth.sessions where user_id in (${users}))`,
].join('+')};`;
