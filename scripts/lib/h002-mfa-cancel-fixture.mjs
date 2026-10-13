export const ids = Object.fromEntries(
  [
    'org',
    'actor',
    'other',
    'member',
    'otherMember',
    'operation',
    'missing',
    'session',
    'first',
    'second',
    'setup',
  ].map((name, index) => [name, `e1800000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]),
);
export const q = (name) => `'${ids[name]}'`;
export const scope = `organization_id=${q('org')}`;
const subjects = `${q('actor')},${q('other')}`;
export const signatures = [
  'public.cancel_member_mfa_enrollment(uuid,uuid,bigint,text,text,text,uuid)',
  'public.bind_member_mfa_factor(uuid,uuid,bigint,text,text,uuid)',
  'public.complete_member_mfa_enrollment(uuid,uuid,bigint,text,text[],uuid,bigint,text,text,uuid)',
];
export const tables = [
  'authentication_events',
  'member_mfa_readiness',
  'member_mfa_enrollment_operations',
  'organization_member_profiles',
  'membership_roles',
  'organization_memberships',
  'aircraft_document_categories',
];
const predicate = (table) =>
  `${scope}${table === 'authentication_events' ? ` or actor_subject_id in (${subjects})` : ''}`;
export const seed = `insert into auth.users(id,email) values
  (${q('actor')},'h002-mfa-cancel@example.test'),(${q('other')},'h002-mfa-other@example.test');
  insert into public.organizations(id,name,status) values(${q('org')},'Synthetic MFA cancellation','active');
  insert into public.organization_memberships(id,organization_id,user_id,status)
    values(${q('member')},${q('org')},${q('actor')},'active'),
      (${q('otherMember')},${q('org')},${q('other')},'active');
  insert into public.membership_roles(organization_id,membership_id,role_id)
    select ${q('org')},m.id,r.id from public.organization_memberships m
    join public.roles r on r.code=case when m.id=${q('member')} then 'student_pilot' else 'admin' end
    where m.${scope};`;
export const reset = `delete from public.authentication_events where ${predicate('authentication_events')};
  delete from public.member_mfa_readiness where ${scope};
  delete from public.member_mfa_enrollment_operations where ${scope};
  update public.organization_memberships set status='active' where id=${q('member')};
  insert into public.member_mfa_enrollment_operations(id,organization_id,membership_id,subject_user_id,status,start_idempotency_key_hash)
    values(${q('operation')},${q('org')},${q('member')},${q('actor')},'started',repeat('a',64));`;
const rows = (
  table,
) => `(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
  from public.${table} t where ${predicate(table)})`;
export const snapshot = `select jsonb_build_object(
  'operation',(select to_jsonb(t) from public.member_mfa_enrollment_operations t where id=${q('operation')}),
  'readiness',${rows('member_mfa_readiness')},'events',${rows('authentication_events')},
  'members',${rows('organization_memberships')},'roles',${rows('membership_roles')},
  'profiles',${rows('organization_member_profiles')},'categories',${rows('aircraft_document_categories')},
  'organization',(select to_jsonb(t) from public.organizations t where id=${q('org')}),
  'factors',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from auth.mfa_factors t where user_id in (${subjects})),
  'sessions',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from auth.sessions t where user_id in (${subjects})));`;
export const permissions = `select jsonb_build_array(
  (select jsonb_agg(to_jsonb(t) order by id) from public.roles t),
  (select jsonb_agg(to_jsonb(t) order by id) from public.permissions t),
  (select jsonb_agg(to_jsonb(t) order by role_id,permission_id) from public.role_permissions t));`;
export const cleanupSql = `${tables.map((table) => `delete from public.${table} where ${predicate(table)};`).join('\n')}
  delete from public.organizations where id=${q('org')};
  delete from auth.users where id in (${subjects});`;
export const residueSql = `select ${[
  ...tables.map((table) => `(select count(*) from public.${table} where ${predicate(table)})`),
  `(select count(*) from public.organizations where id=${q('org')})`,
  `(select count(*) from auth.users where id in (${subjects}))`,
  ...['sessions', 'mfa_factors', 'identities'].map(
    (table) => `(select count(*) from auth.${table} where user_id in (${subjects}))`,
  ),
].join('+')};`;
export function command(
  action,
  {
    correlation = 'first',
    actor = 'actor',
    operation = 'operation',
    version,
    key,
    factor = 'null',
  } = {},
) {
  const common = `${q(actor)},${q(operation)},${version ?? (action === 'complete' ? 2 : 1)}`;
  if (action === 'cancel')
    return `select public.cancel_member_mfa_enrollment(${common},${factor},'not_required',repeat('${key ?? 'd'}',64),${q(correlation)});`;
  if (action === 'bind')
    return `select public.bind_member_mfa_factor(${common},repeat('f',64),repeat('b',64),${q(correlation)});`;
  return `select public.complete_member_mfa_enrollment(${q(actor)},${q('session')},floor(extract(epoch from transaction_timestamp()))::bigint,
    'aal2',array['password','totp'],${q(operation)},${version ?? 2},repeat('f',64),repeat('c',64),${q(correlation)});`;
}
