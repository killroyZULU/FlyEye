// Fixed synthetic identifiers are accepted only after an empty-school preflight.
export const ids = Object.fromEntries(
  [
    'org',
    'actor',
    'admin',
    'member',
    'adminMember',
    'target',
    'targetMember',
    'aircraft',
    'category',
    'document',
    'version',
    'file',
    'notification',
    'invitation',
    'operation',
    'correlation',
  ].map((name, index) => [name, `e0300000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]),
);
export const q = (name) => `'${ids[name]}'`;
export const hash = (char) => `repeat('${char}',64)`;
export const scope = `organization_id=${q('org')}`;
export const domainTables = [
  'aircraft_document_idempotency',
  'aircraft_document_events',
  'aircraft_document_notifications',
  'aircraft_document_versions',
  'aircraft_documents',
  'stored_files',
  'aircraft_document_requirements',
  'aircraft_records',
  'member_invitation_events',
  'organization_invitations',
  'authentication_events',
  'member_mfa_readiness',
  'member_mfa_enrollment_operations',
  'member_administration_events',
];
export function clearDomain() {
  return domainTables
    .map(
      (table) =>
        `delete from public.${table} where ${scope}${
          table === 'authentication_events' || table === 'member_invitation_events'
            ? ` or actor_user_id in (${q('actor')},${q('admin')},${q('target')})`
            : ''
        };`,
    )
    .join('\n');
}
export const seed = `
  insert into auth.users(id,email) values
    (${q('actor')},'h002-review-actor@example.test'),
    (${q('admin')},'h002-review-admin@example.test'),
    (${q('target')},'h002-review-target@example.test');
  insert into public.organizations(id,name,status) values(${q('org')},'Synthetic H002 review','active');
  insert into public.organization_memberships(id,organization_id,user_id,status,created_by,updated_by)
  values (${q('member')},${q('org')},${q('actor')},'active',${q('admin')},${q('admin')}),
    (${q('adminMember')},${q('org')},${q('admin')},'active',${q('admin')},${q('admin')}),
    (${q('targetMember')},${q('org')},${q('target')},'active',${q('admin')},${q('admin')});
  insert into public.membership_roles(organization_id,membership_id,role_id,assigned_by)
  select ${q('org')},m.id,r.id,${q('admin')} from public.organization_memberships m
  join public.roles r on r.code=case when m.id=${q('targetMember')} then 'instructor_pilot' else 'admin' end
  where m.${scope};
  insert into public.aircraft_document_categories(id,organization_id,category_code,category_label,category_kind,created_by,updated_by)
  values(${q('category')},${q('org')},'custom_h002','Synthetic review','custom',${q('admin')},${q('admin')});`;

export const aircraftSeed = `insert into public.aircraft_records(
  id,organization_id,registration_mark,registration_key,manufacturer,model,created_by,updated_by)
  values(${q('aircraft')},${q('org')},'SYN-H003','synh003','Synthetic','Model',${q('admin')},${q('admin')});
  insert into public.aircraft_document_requirements(organization_id,aircraft_record_id,category_id,created_by,updated_by)
  values(${q('org')},${q('aircraft')},${q('category')},${q('admin')},${q('admin')});`;
export const fileSeed = `insert into public.stored_files(
  id,organization_id,aircraft_record_id,object_key,display_name,generated_name,media_type,size_bytes,sha256_hash,scan_state,uploader_user_id)
  values(${q('file')},${q('org')},${q('aircraft')},'${ids.org}/${ids.aircraft}/${ids.file}/${ids.file}.pdf',
  'Synthetic.pdf','${ids.file}.pdf','application/pdf',10,${hash('a')},'clean',${q('actor')});`;
export const documentSeed = `insert into public.aircraft_documents(
  id,organization_id,aircraft_record_id,category_id,current_version_id,created_by,updated_by)
  values(${q('document')},${q('org')},${q('aircraft')},${q('category')},${q('version')},${q('admin')},${q('admin')});
  insert into public.aircraft_document_versions(id,organization_id,aircraft_document_id,version_number,version_kind,
    category_code,category_label,document_title,document_source,expiration_date,created_by)
  values(${q('version')},${q('org')},${q('document')},1,'create','custom_h002','Synthetic review',
    'Synthetic document','Synthetic source',current_date+3,${q('admin')});
  insert into public.aircraft_document_notifications(id,organization_id,recipient_membership_id,
    aircraft_document_id,document_version_id,event_kind,due_date)
  values(${q('notification')},${q('org')},${q('member')},${q('document')},${q('version')},'warning',current_date-4);`;
export const invitationSeed = `insert into public.organization_invitations(
  id,organization_id,email_original,email_canonical,role_id,status,invited_by,issuance_idempotency_key_hash,correlation_id)
  values(${q('invitation')},${q('org')},'h002-invite@example.test','h002-invite@example.test',
    (select id from public.roles where code='student_pilot'),'pending',${q('actor')},${hash('b')},${q('correlation')});`;
export const operationSeed = `insert into public.member_mfa_enrollment_operations(
  id,organization_id,membership_id,subject_user_id,status,start_idempotency_key_hash)
  values(${q('operation')},${q('org')},${q('member')},${q('actor')},'started',${hash('b')});`;

export function revokeSql(authority) {
  const args = `${q('admin')},${q('org')},${q('member')}`;
  // prepare() owns and resets this synthetic membership to version 1.
  // service_role can execute the protected command, not select its backing table.
  const version = 1;
  return authority === 'membership'
    ? `select public.change_organization_member_status(${args},'revoke','membership_ended',${version},${hash('e')},${q('correlation')});`
    : `select public.change_organization_member_role(${args},'student_pilot','responsibility_changed',${version},${hash('e')},null,${q('correlation')});`;
}

export function snapshotSql(test) {
  const tables = test.tables.map(
    (table) => `(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
    from public.${table} t where ${scope}${
      table === 'organization_memberships' || table === 'membership_roles'
        ? ` and ${table === 'organization_memberships' ? 'id' : 'membership_id'}=${q('targetMember')}`
        : ''
    })`,
  );
  return `select jsonb_build_array(${tables.join(',')});`;
}
