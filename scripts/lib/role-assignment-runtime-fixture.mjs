import assert from 'node:assert/strict';

const quote = (value) => `'${value.replaceAll("'", "''")}'`;

export async function cleanupRoleAssignmentRuntime({
  diagnostics,
  psql,
  deleteUser,
  stopEdge,
  removeTemporaryFiles,
  organizationId,
  identities,
  limiterKeys,
}) {
  let failed = false;
  const attempt = async (stage, operation) => {
    try {
      await diagnostics.run(stage, operation);
    } catch {
      failed = true;
    }
  };
  const ids = identities.map(({ id }) => quote(id)).join(',');
  const emails = identities.map(({ email }) => quote(email)).join(',');
  const limiterValues = [...limiterKeys].map(quote).join(',');
  const limiterScope = limiterValues ? `limiter_key_hash in (${limiterValues})` : 'false';
  const organizationScope = `organization_id = ${quote(organizationId)}::uuid`;
  const actorScope = `actor_user_id in (${ids})`;
  const eventScope = `${organizationScope} or ${actorScope}`;
  const scopedTables = [
    ['public.member_administration_events', eventScope],
    ['public.member_administration_rate_limit_events', limiterScope],
    ['public.member_administration_rate_limit_state', limiterScope],
    ['public.member_mfa_readiness', organizationScope],
    ['public.authentication_events', actorScope],
    ['public.organization_member_profiles', organizationScope],
    ['public.membership_roles', organizationScope],
    ['public.organization_memberships', organizationScope],
    ['public.aircraft_document_categories', organizationScope],
    ['public.organizations', `id = ${quote(organizationId)}::uuid`],
  ];

  await attempt('cleanup-edge-shutdown', stopEdge);
  await attempt('cleanup-domain-rows', async () => {
    psql(
      `begin;\n${scopedTables.map(([table, scope]) => `delete from ${table} where ${scope};`).join('\n')}\ncommit;`,
    );
  });
  for (const { id } of identities) {
    await attempt('cleanup-auth-users', async () => {
      const { error } = await deleteUser(id);
      if (error && error.status !== 404) throw new Error('Synthetic role Auth cleanup failed.');
    });
  }
  await attempt('cleanup-assertions', async () => {
    const residue = psql(
      `select ${[...scopedTables, ['auth.users', `id in (${ids}) or lower(email) in (${emails})`]]
        .map(([table, scope]) => `(select count(*) from ${table} where ${scope})`)
        .join(' + ')};`,
    );
    assert.equal(residue, '0');
  });
  await attempt('cleanup-temporary-files', removeTemporaryFiles);
  if (failed) throw new Error('Synthetic role fixture cleanup failed.');
}

export async function runRoleAssignmentFixture({ diagnostics, run, cleanup, onSuccess }) {
  let scenarioFailed = false;
  let cleanupFailed = false;
  try {
    await run();
    diagnostics.pass();
  } catch (error) {
    diagnostics.fail(error);
    scenarioFailed = true;
  }
  try {
    await diagnostics.run('fixture-cleanup', cleanup);
  } catch {
    cleanupFailed = true;
  }
  if (scenarioFailed || cleanupFailed) {
    // Keep raw assertion/provider errors out of direct execution as well as CI.
    throw new Error(
      scenarioFailed && cleanupFailed
        ? 'FEAT-006B scenario and cleanup failed.'
        : scenarioFailed
          ? 'FEAT-006B scenario failed; cleanup passed.'
          : 'FEAT-006B cleanup failed.',
    );
  }
  onSuccess();
}
