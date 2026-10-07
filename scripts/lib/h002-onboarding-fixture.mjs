export const ids = Object.fromEntries(
  ['org', 'actor', 'grant', 'session', 'factor', 'correlation', 'issuance'].map((name, index) => [
    name,
    `e0700000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  ]),
);
export const q = (name) => `'${ids[name]}'`;
export const scope = `organization_id=${q('org')}`;
export const tables = [
  'organization_admin_bootstrap_grants',
  'authentication_events',
  'organization_member_profiles',
  'membership_roles',
  'organization_memberships',
  'aircraft_document_categories',
];
export const clear = tables
  .map(
    (table) =>
      `delete from public.${table} where ${scope}${
        table === 'authentication_events' ? ` or actor_subject_id=${q('actor')}` : ''
      };`,
  )
  .join('\n');
export const seed = `insert into auth.users(id,email,email_confirmed_at)
  values(${q('actor')},'h002-onboarding@example.test',now());
  insert into public.organizations(id,name,status) values(${q('org')},'Synthetic onboarding','active');`;
export const reset = `${clear}
  update public.organizations set status='active' where id=${q('org')};
  insert into public.organization_admin_bootstrap_grants(id,organization_id,eligible_user_id,
    authorization_source_kind,authorization_source_code,authorization_source_instance_id,issuance_correlation_id)
    values(${q('grant')},${q('org')},${q('actor')},'local_fixture','feat-003-local-cli-fixture',${q('issuance')},${q('issuance')});`;
export const signature =
  'public.complete_first_organization_admin_bootstrap(uuid,uuid,uuid,bigint,text,text[],uuid,integer,uuid,bigint,text,uuid)';
export function complete(password, key = 'a') {
  return `select public.complete_first_organization_admin_bootstrap(${q('actor')},${q('actor')},
    ${q('session')},${password},'aal2',array['password','totp'],${q('factor')},1,${q('grant')},1,
    repeat('${key}',64),${q('correlation')});`;
}
export const locks = {
  org: `select 1 from public.organizations where id=${q('org')} for update;`,
  grant: `select 1 from public.organization_admin_bootstrap_grants where id=${q('grant')} for update;`,
};
export const snapshot = `select jsonb_build_object(
  'profiles',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.organization_member_profiles p where ${scope}),
  'grant',(select to_jsonb(g) from public.organization_admin_bootstrap_grants g where id=${q('grant')}),
  'members',(select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) from public.organization_memberships m where ${scope}),
  'roles',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.membership_roles r where ${scope}),
  'events',(select coalesce(jsonb_agg(to_jsonb(e) order by event_name,id),'[]'::jsonb)
    from public.authentication_events e where ${scope} or actor_subject_id=${q('actor')}));`;
export const unchangedRoles = `select jsonb_build_array(
  (select jsonb_agg(to_jsonb(r) order by id) from public.roles r),
  (select jsonb_agg(to_jsonb(rp) order by role_id,permission_id) from public.role_permissions rp));`;
export const cleanupSql = `${clear} delete from public.organizations where id=${q('org')};
  delete from auth.users where id=${q('actor')};`;
export const residueSql = `select ${[
  ...tables.map(
    (table) =>
      `(select count(*) from public.${table} where ${scope}${table === 'authentication_events' ? ` or actor_subject_id=${q('actor')}` : ''})`,
  ),
  `(select count(*) from public.organizations where id=${q('org')})`,
  `(select count(*) from auth.users where id=${q('actor')})`,
  `(select count(*) from auth.sessions where user_id=${q('actor')})`,
  `(select count(*) from auth.mfa_factors where user_id=${q('actor')})`,
].join('+')};`;
