import {
  q,
  hash,
  scope,
  aircraftSeed,
  fileSeed,
  documentSeed,
  invitationSeed,
  operationSeed,
} from './h002-review-fixture.mjs';

const docTables = [
  'aircraft_document_categories',
  'aircraft_document_requirements',
  'aircraft_documents',
  'aircraft_document_versions',
  'stored_files',
  'aircraft_document_notifications',
  'aircraft_document_events',
  'aircraft_document_idempotency',
];
const invitationTables = ['organization_invitations'];
const mfaTables = ['member_mfa_enrollment_operations', 'member_mfa_readiness'];
const row = (table, id) =>
  `select 1 from public.${table} where ${id ? `id=${q(id)}` : scope} for update;`;
const advisory = `select pg_advisory_xact_lock(hashtextextended(${q('org')} || ':' || ${q('actor')} || ':' || ${hash('1')},0));`;
const contextLock = row('organizations', 'org') + row('organization_memberships', 'member');
const doc = (
  action,
  file = false,
) => `select public.mutate_aircraft_document(${q('actor')},${q('org')},'${action}',
  ${q('aircraft')},${q('category')},${action === 'create' ? 'null,null' : `${q('document')},1`},
  ${['create', 'renew', 'correct'].includes(action) ? `'Synthetic updated','Synthetic source',null,null,current_date+3,null,${file ? q('file') : 'null'}` : 'null,null,null,null,null,null,null'},
  ${action === 'create' ? 'null' : "'Synthetic review reason'"},${hash('1')},${hash('a')},current_date,${q('correlation')});`;
const category = (
  action,
) => `select public.mutate_aircraft_document_category(${q('actor')},${q('org')},'${action}',
  ${action === 'create_category' ? 'null' : q('category')},${['assign_category', 'remove_category'].includes(action) ? q('aircraft') : 'null'},
  ${action === 'create_category' ? 'null' : '1'},${['create_category', 'rename_category'].includes(action) ? "'Synthetic changed'" : 'null'},
  ${hash('1')},${hash('a')},current_date,${q('correlation')});`;
const cases = [];
function add(name, sql, lock, setup, success, options = {}) {
  cases.push({
    name,
    sql,
    lock,
    setup,
    success,
    tables: docTables,
    eventTable: 'aircraft_document_events',
    deny: 'unauthorized',
    ...options,
  });
}

for (const action of ['create', 'renew', 'correct', 'suspend', 'restore']) {
  const setup =
    aircraftSeed +
    (action === 'create' ? '' : documentSeed) +
    (action === 'restore'
      ? `update public.aircraft_documents set document_state='suspended',suspension_reason='Synthetic reason',suspended_at=now(),suspended_by=${q('admin')} where ${scope};`
      : '');
  for (const [kind, lock] of [
    ['advisory', advisory],
    ['aircraft', row('aircraft_records', 'aircraft')],
    ['category', row('aircraft_document_categories', 'category')],
    ...(action === 'create'
      ? []
      : [
          ['document', row('aircraft_documents', 'document')],
          ['version', row('aircraft_document_versions', 'version')],
        ]),
  ]) {
    add(
      `document-${action}-${kind}`,
      doc(action),
      lock,
      setup,
      {
        create: 'created',
        renew: 'renewed',
        correct: 'corrected',
        suspend: 'suspended',
        restore: 'restored',
      }[action],
    );
  }
}
add(
  'document-create-file',
  doc('create', true),
  row('stored_files', 'file'),
  aircraftSeed + fileSeed,
  'created',
);
for (const action of ['renew', 'correct', 'suspend', 'restore']) {
  const setup =
    aircraftSeed +
    documentSeed +
    (action === 'restore'
      ? `update public.aircraft_documents set document_state='suspended',suspension_reason='Synthetic reason',suspended_at=now(),suspended_by=${q('admin')} where ${scope};`
      : '');
  add(
    `document-${action}-notification`,
    doc(action),
    row('aircraft_document_notifications', 'notification'),
    setup,
    { renew: 'renewed', correct: 'corrected', suspend: 'suspended', restore: 'restored' }[action],
  );
}
for (const action of [
  'create_category',
  'rename_category',
  'archive_category',
  'assign_category',
  'remove_category',
]) {
  const setup =
    aircraftSeed +
    (['archive_category', 'remove_category'].includes(action) ? documentSeed : '') +
    (action === 'assign_category'
      ? `update public.aircraft_document_requirements set requirement_state='archived',archived_at=now(),archived_by=${q('admin')} where ${scope};`
      : '');
  for (const [kind, lock] of [
    ['advisory', advisory],
    ...(action === 'create_category'
      ? []
      : [['category', row('aircraft_document_categories', 'category')]]),
    ...(['assign_category', 'remove_category'].includes(action)
      ? [
          ['aircraft', row('aircraft_records', 'aircraft')],
          ['requirement', row('aircraft_document_requirements')],
        ]
      : []),
    ...(['archive_category', 'remove_category'].includes(action)
      ? [['notification', row('aircraft_document_notifications', 'notification')]]
      : []),
  ]) {
    add(
      `${action}-${kind}`,
      category(action),
      lock,
      setup,
      {
        create_category: 'category_created',
        rename_category: 'category_renamed',
        archive_category: 'category_archived',
        assign_category: 'category_assigned',
        remove_category: 'category_removed',
      }[action],
    );
  }
}
add(
  'file-complete',
  `select public.complete_aircraft_document_file(${q('actor')},${q('org')},${q('file')},'clean',10,${hash('a')},${q('correlation')});`,
  row('stored_files', 'file'),
  aircraftSeed + fileSeed + `update public.stored_files set scan_state='staged' where ${scope};`,
  'completed',
);
add(
  'notification-open',
  `select public.open_aircraft_document_notification(${q('actor')},${q('org')},${q('member')},${q('notification')},${q('correlation')});`,
  row('aircraft_document_notifications', 'notification'),
  aircraftSeed + documentSeed,
  'opened',
);
add(
  'profile-update',
  `select public.update_my_member_profile(${q('actor')},${q('member')},'Synthetic updated',null,
  1,${q('correlation')});`,
  `select 1 from public.organization_member_profiles where membership_id=${q('member')} for update;`,
  `update public.organization_member_profiles set display_name=null,contact_number=null,version=1 where membership_id=${q('member')};`,
  'updated',
  {
    tables: ['organization_member_profiles'],
    eventTable: 'member_administration_events',
    deny: 'not_found',
    authorities: ['membership', 'retained'],
  },
);

for (const action of ['status', 'role']) {
  const sql =
    action === 'status'
      ? `select public.change_organization_member_status(${q('actor')},${q('org')},${q('targetMember')},'revoke','membership_ended',1,${hash('1')},${q('correlation')});`
      : `select public.change_organization_member_role(${q('actor')},${q('org')},${q('targetMember')},'student_pilot','responsibility_changed',1,${hash('1')},null,${q('correlation')});`;
  for (const kind of ['administrator', 'target'])
    add(
      `member-${action}-${kind}`,
      sql,
      row('organization_memberships', kind === 'administrator' ? 'member' : 'targetMember'),
      '',
      action === 'status' ? 'revoked' : 'changed',
      {
        tables: ['organization_memberships', 'membership_roles'],
        eventTable: 'member_administration_events',
        deny: 'not_found',
        blockerRevokes: kind === 'administrator',
      },
    );
}
const invitations = [
  [
    'list',
    `select public.list_member_invitations(${q('actor')},${q('org')},${q('correlation')});`,
    'listed',
  ],
  [
    'begin',
    `select public.begin_member_invitation(${q('actor')},${q('org')},'new-synthetic@example.test','student_pilot',${hash('1')},${q('correlation')});`,
    'issuing',
  ],
  [
    'resend',
    `select public.begin_resend_member_invitation(${q('actor')},${q('org')},${q('invitation')},1,${hash('1')},${q('correlation')});`,
    'issuing',
  ],
  [
    'revoke',
    `select public.revoke_member_invitation(${q('actor')},${q('org')},${q('invitation')},1,${hash('1')},${q('correlation')});`,
    'revoked',
  ],
  [
    'finalize',
    `select public.finalize_member_invitation_delivery(${q('actor')},${q('invitation')},${q('operation')},'accepted','new_identity_invite',${q('correlation')});`,
    'pending',
  ],
];
for (const [action, sql, success] of invitations) {
  const setup =
    invitationSeed +
    (action === 'finalize'
      ? `update public.organization_invitations set status='issuing' where ${scope};`
      : '');
  for (const kind of [
    'organization',
    ...(['resend', 'revoke', 'finalize'].includes(action) ? ['invitation'] : []),
  ])
    add(
      `invitation-${action}-${kind}`,
      sql,
      row(
        kind === 'organization' ? 'organizations' : 'organization_invitations',
        kind === 'organization' ? 'org' : 'invitation',
      ),
      setup,
      success,
      {
        tables: invitationTables,
        eventTable: 'member_invitation_events',
        deny: 'not_available',
        blockerRevokes: kind === 'organization',
        readOnly: action === 'list',
      },
    );
}
for (const action of ['start', 'bind', 'complete']) {
  const sql =
    action === 'start'
      ? `select public.start_member_mfa_enrollment(${q('actor')},null,${hash('1')},${q('correlation')});`
      : action === 'bind'
        ? `select public.bind_member_mfa_factor(${q('actor')},${q('operation')},1,${hash('a')},${hash('1')},${q('correlation')});`
        : `select public.complete_member_mfa_enrollment(${q('actor')},${q('correlation')},floor(extract(epoch from now()))::bigint,'aal2',array['password','totp'],${q('operation')},1,${hash('a')},${hash('1')},${q('correlation')});`;
  for (const kind of ['context', ...(action === 'start' ? [] : ['operation'])])
    add(
      `mfa-${action}-${kind}`,
      sql,
      kind === 'context' ? contextLock : row('member_mfa_enrollment_operations', 'operation'),
      action === 'start'
        ? ''
        : operationSeed +
            (action === 'complete'
              ? `update public.member_mfa_enrollment_operations set status='bound',factor_reference_hash=${hash('a')} where ${scope};`
              : ''),
      { start: 'ready', bind: 'bound', complete: 'completed' }[action],
      {
        tables: mfaTables,
        eventTable: 'authentication_events',
        deny: action === 'start' ? 'not_available' : 'conflict',
        blockerRevokes: kind === 'context',
        authorities: ['membership', 'retained'],
      },
    );
}
export { cases };
