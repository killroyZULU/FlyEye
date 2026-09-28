import assert from 'node:assert/strict';

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownedMail(mailpitUrl, emails, request) {
  const ids = [];
  let offset = 0;
  for (let page = 0; page < 10; page += 1) {
    const response = await request(`${mailpitUrl}/api/v1/messages?start=${offset}&limit=100`, {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(Array.isArray(payload.messages));
    if (payload.messages.length === 0) return ids;
    for (const message of payload.messages) {
      assert.ok(Array.isArray(message.To));
      assert.ok(message.To.every((entry) => typeof entry.Address === 'string'));
      if (message.To.some((entry) => emails.includes(entry.Address.toLowerCase()))) {
        assert.equal(typeof message.ID, 'string');
        assert.ok(message.ID.length > 0);
        ids.push(message.ID);
      }
    }
    offset += payload.messages.length;
  }
  throw new Error('Synthetic invitation mailbox inventory exceeded its bound.');
}

export async function cleanInvitationMail(mailpitUrl, emails, request = fetch) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(mailpitUrl).hostname)) {
    throw new Error('Invitation mail cleanup requires a loopback URL.');
  }
  const ids = await ownedMail(mailpitUrl, emails, request);
  // Mailpit deletes the whole mailbox for an empty/omitted IDs list.
  if (ids.length > 0) {
    const response = await request(`${mailpitUrl}/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ IDs: ids }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
  }
  assert.equal((await ownedMail(mailpitUrl, emails, request)).length, 0);
}

export async function cleanupInvitationRuntime({
  diagnostics,
  psql,
  deleteUser,
  stopEdge,
  removeTemporaryFiles,
  cleanMail,
  organizationId,
  identities,
  recipientEmail,
  recipientId,
  limiterKeys,
  correlations,
}) {
  const failures = [];
  const attempt = async (stage, operation) => {
    try {
      await diagnostics.run(stage, operation);
    } catch (error) {
      failures.push(error);
    }
  };
  const emails = [...identities.map((identity) => identity.email), recipientEmail];
  const ids = new Set(identities.map((identity) => identity.id));
  if (recipientId) ids.add(recipientId);
  const emailValues = emails.map(quote).join(',');
  const limitValues = [...limiterKeys].map(quote).join(',');
  const correlationValues = [...correlations].map(quote).join(',');
  const limiterScope = limitValues ? `limiter_key_hash in (${limitValues})` : 'false';
  const correlationScope = correlationValues ? `correlation_id in (${correlationValues})` : 'false';

  await attempt('cleanup-edge-shutdown', stopEdge);
  await attempt('cleanup-identity-discovery', async () => {
    // Find a provider-created recipient even if the callback was never received.
    const discovered = JSON.parse(
      psql(`
      select coalesce(json_agg(id), '[]'::json) from auth.users
      where lower(email) in (${emailValues});
    `),
    );
    assert.ok(Array.isArray(discovered));
    assert.ok(discovered.every((id) => typeof id === 'string' && uuid.test(id)));
    for (const id of discovered) ids.add(id);
  });
  const idValues = [...ids].map(quote).join(',');
  const eventScope = `organization_id = ${quote(organizationId)}::uuid
    or actor_user_id in (${idValues}) or ${correlationScope}`;
  await attempt('cleanup-domain-rows', async () => {
    psql(`
      begin;
      delete from public.member_invitation_events where ${eventScope};
      delete from public.member_invitation_rate_limit_events where ${limiterScope} or ${correlationScope};
      delete from public.member_invitation_rate_limit_state where ${limiterScope};
      delete from public.authentication_events where actor_user_id in (${idValues});
      delete from public.organization_invitations where organization_id = ${quote(organizationId)}::uuid;
      delete from public.organization_member_profiles where organization_id = ${quote(organizationId)}::uuid;
      delete from public.membership_roles where organization_id = ${quote(organizationId)}::uuid;
      delete from public.organization_memberships where organization_id = ${quote(organizationId)}::uuid;
      delete from public.aircraft_document_categories where organization_id = ${quote(organizationId)}::uuid;
      delete from public.organizations where id = ${quote(organizationId)}::uuid;
      commit;
    `);
  });
  for (const id of ids) {
    await attempt('cleanup-auth-users', async () => {
      const { error } = await deleteUser(id);
      if (error && error.status !== 404)
        throw new Error('Synthetic invitation Auth cleanup failed.');
    });
  }
  await attempt('cleanup-assertions', async () => {
    const residue = psql(`
      select
        (select count(*) from public.organizations where id = ${quote(organizationId)}::uuid)
        + (select count(*) from public.organization_invitations where organization_id = ${quote(organizationId)}::uuid)
        + (select count(*) from public.organization_memberships where organization_id = ${quote(organizationId)}::uuid)
        + (select count(*) from public.membership_roles where organization_id = ${quote(organizationId)}::uuid)
        + (select count(*) from public.organization_member_profiles where organization_id = ${quote(organizationId)}::uuid)
        + (select count(*) from public.aircraft_document_categories where organization_id = ${quote(organizationId)}::uuid)
        + (select count(*) from public.member_invitation_events where ${eventScope})
        + (select count(*) from public.member_invitation_rate_limit_events where ${limiterScope} or ${correlationScope})
        + (select count(*) from public.member_invitation_rate_limit_state where ${limiterScope})
        + (select count(*) from public.authentication_events where actor_user_id in (${idValues}))
        + (select count(*) from auth.users where id in (${idValues}) or lower(email) in (${emailValues}));
    `);
    assert.equal(residue, '0');
  });
  await attempt('cleanup-mail', () => cleanMail(emails));
  await attempt('cleanup-temporary-files', removeTemporaryFiles);
  if (failures.length > 0) throw new Error('Synthetic invitation fixture cleanup failed.');
}
