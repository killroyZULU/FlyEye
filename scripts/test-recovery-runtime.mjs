import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { createClient } from '@supabase/supabase-js';

const cliPath = path.resolve('node_modules', 'supabase', 'dist', 'supabase.js');
const statusResult = spawnSync(process.execPath, [cliPath, 'status', '-o', 'json'], {
  encoding: 'utf8',
});
if (statusResult.status !== 0) {
  throw new Error(statusResult.stderr || 'The local Supabase stack is not running.');
}

const local = JSON.parse(statusResult.stdout);
const apiUrl = local.API_URL;
const publishableKey = local.PUBLISHABLE_KEY ?? local.ANON_KEY;
const serviceRoleKey = local.SERVICE_ROLE_KEY;
const mailpitUrl = local.MAILPIT_URL ?? local.INBUCKET_URL;
if (
  ![new URL(apiUrl).hostname, new URL(mailpitUrl).hostname].every((host) =>
    ['127.0.0.1', 'localhost'].includes(host),
  )
) {
  throw new Error('FEAT-002 runtime evidence is restricted to the local synthetic stack.');
}

const origin = 'http://127.0.0.1:5173';
const runId = randomBytes(6).toString('hex');
const user = {
  id: randomUUID(),
  email: `recovery-${runId}@example.test`,
};
const aliasUsers = [
  { type: 'recovery', accepted: true },
  { type: 'email', accepted: true },
  { type: 'magiclink', accepted: true },
  { type: 'signup', accepted: false },
  { type: 'invite', accepted: false },
  { type: 'email_change', accepted: false },
].map((entry) => ({
  ...entry,
  id: randomUUID(),
  email: `recovery-${entry.type}-${runId}@example.test`,
}));
const organizationId = randomUUID();
const membershipId = randomUUID();
const originalPassword = `Original synthetic ${randomBytes(18).toString('base64url')}`;
const recoveredPassword = `${'synthetic password with spaces '.repeat(2)}ok`;
const startedAt = new Date().toISOString();

const adminClient = createClient(apiUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function psql(sql, tuplesOnly = false) {
  const args = ['exec', '-i', 'supabase_db_flyeye', 'psql', '-U', 'postgres', '-d', 'postgres'];
  if (tuplesOnly) args.push('-At');
  const result = spawnSync('docker', args, { input: sql, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'psql failed.');
  return result.stdout.trim();
}

function browserClient() {
  return createClient(apiUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function signIn(password) {
  const client = browserClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (error || !data.session) throw error ?? new Error('Synthetic sign-in returned no session.');
  return { client, session: data.session };
}

async function invokeBootstrap(accessToken) {
  return fetch(`${apiUrl}/functions/v1/auth-bootstrap`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      origin,
    },
    body: '{}',
  });
}

function jwtAuthenticationMethods(accessToken) {
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
  return Array.isArray(payload.amr) ? payload.amr.map((reference) => reference.method) : [];
}

function mailAddressMatches(message, email) {
  const recipients = message.To ?? message.to ?? [];
  return recipients.some(
    (recipient) => (recipient.Address ?? recipient.address ?? '').toLowerCase() === email,
  );
}

async function waitForMail(subject) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const listResponse = await fetch(`${mailpitUrl}/api/v1/messages`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    const summary = (list.messages ?? []).find(
      (message) =>
        mailAddressMatches(message, user.email) && (message.Subject ?? message.subject) === subject,
    );
    if (summary) {
      const id = summary.ID ?? summary.Id ?? summary.id;
      assert.ok(id);
      const messageResponse = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
      assert.equal(messageResponse.status, 200);
      return messageResponse.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Synthetic Mailpit message was not received for subject: ${subject}`);
}

function recoveryLink(message) {
  const content = `${message.HTML ?? message.html ?? ''}\n${message.Text ?? message.text ?? ''}`
    .replaceAll('&amp;', '&')
    .replaceAll('&#61;', '=');
  const urls = content.match(/https?:\/\/[^"'<> \r\n]+/g) ?? [];
  for (const candidate of urls) {
    const url = new URL(candidate);
    if (url.origin === origin && url.pathname === '/auth/recovery') {
      const tokenHash = url.searchParams.get('token_hash');
      if (tokenHash) return { tokenHash, url };
    }
  }
  throw new Error('The synthetic recovery message did not contain the exact recovery callback.');
}

async function assertOtpBootstrapDenied(accessToken) {
  assert.deepEqual(jwtAuthenticationMethods(accessToken), ['otp']);
  const response = await invokeBootstrap(accessToken);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error?.code, 'auth.authentication_method_not_allowed');
}

function assertOtpDenialAudit(userId) {
  const evidence = psql(
    `select count(*) || ':' ||
            bool_and(event_name = 'authentication.access_denied')::text || ':' ||
            bool_and(outcome = 'denied')::text || ':' ||
            bool_and(reason_code = 'authentication_method_not_allowed')::text || ':' ||
            bool_and(organization_id is null)::text || ':' ||
            bool_and(cardinality(organization_ids) = 0)::text
     from public.authentication_events
     where actor_subject_id = '${userId}'::uuid
       and reason_code = 'authentication_method_not_allowed';`,
    true,
  );
  assert.equal(evidence, '1:true:true:true:true:true');
}

async function verifyProviderAlias(aliasUser) {
  const { data: generated, error: generationError } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email: aliasUser.email,
  });
  if (generationError) throw generationError;
  const tokenHash = generated.properties?.hashed_token;
  assert.ok(tokenHash);

  const client = browserClient();
  const { data, error } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: aliasUser.type,
  });
  if (!aliasUser.accepted) {
    assert.ok(error);
    assert.equal(data.session, null);
    return;
  }
  if (error || !data.session) throw error ?? new Error('Alias verification returned no session.');
  await assertOtpBootstrapDenied(data.session.access_token);
  assertOtpDenialAudit(aliasUser.id);
  await client.auth.signOut({ scope: 'local' });
}

async function directPathStatuses(accessToken) {
  const auth = await fetch(`${apiUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}` },
  });
  const bootstrap = await invokeBootstrap(accessToken);
  const table = await fetch(`${apiUrl}/rest/v1/organizations?select=id`, {
    headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}` },
  });
  const rpc = await fetch(`${apiUrl}/rest/v1/rpc/resolve_auth_access_context`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_actor_user_id: user.id,
      p_assurance_level: 'aal2',
      p_selected_organization_id: organizationId,
    }),
  });
  return [auth.status, bootstrap.status, table.status, rpc.status];
}

async function cleanup() {
  psql(`
    delete from public.authentication_events
    where actor_subject_id in (
      '${user.id}'::uuid,
      ${aliasUsers.map((aliasUser) => `'${aliasUser.id}'::uuid`).join(',\n      ')}
    );
    delete from public.membership_roles
    where membership_id = '${membershipId}'::uuid;
    delete from public.organization_member_profiles
    where membership_id = '${membershipId}'::uuid;
    delete from public.organization_memberships
    where id = '${membershipId}'::uuid;
    delete from public.aircraft_document_categories
    where organization_id = '${organizationId}'::uuid;
    delete from public.organizations
    where id = '${organizationId}'::uuid;
  `);
  await adminClient.auth.admin.deleteUser(user.id);
  for (const aliasUser of aliasUsers) {
    await adminClient.auth.admin.deleteUser(aliasUser.id);
  }
}

try {
  const { error: createError } = await adminClient.auth.admin.createUser({
    id: user.id,
    email: user.email,
    password: originalPassword,
    email_confirm: true,
  });
  if (createError) throw createError;
  for (const aliasUser of aliasUsers) {
    const { error } = await adminClient.auth.admin.createUser({
      id: aliasUser.id,
      email: aliasUser.email,
      password: originalPassword,
      email_confirm: true,
    });
    if (error) throw error;
  }

  psql(`
    insert into public.organizations (id, name)
    values ('${organizationId}'::uuid, 'FEAT-002 Synthetic Flight School ${runId}');

    insert into public.organization_memberships (id, organization_id, user_id, status)
    values (
      '${membershipId}'::uuid,
      '${organizationId}'::uuid,
      '${user.id}'::uuid,
      'active'
    );

    insert into public.membership_roles (organization_id, membership_id, role_id)
    select '${organizationId}'::uuid, '${membershipId}'::uuid, roles.id
    from public.roles roles
    where roles.code = 'student_pilot';
  `);

  const oldClientA = await signIn(originalPassword);
  const oldClientB = await signIn(originalPassword);
  assert.ok(jwtAuthenticationMethods(oldClientA.session.access_token).includes('password'));
  assert.equal((await invokeBootstrap(oldClientA.session.access_token)).status, 200);

  for (const aliasUser of aliasUsers) {
    await verifyProviderAlias(aliasUser);
  }

  const recoveryClient = browserClient();
  const { error: requestError } = await recoveryClient.auth.resetPasswordForEmail(user.email, {
    redirectTo: `${origin}/auth/recovery`,
  });
  if (requestError) throw requestError;
  const { error: cooldownError } = await recoveryClient.auth.resetPasswordForEmail(user.email, {
    redirectTo: `${origin}/auth/recovery`,
  });
  assert.equal(cooldownError?.status, 429);

  const usersBeforeUnknownRequest = psql('select count(*) from auth.users;', true);
  const unknownClient = browserClient();
  await unknownClient.auth.resetPasswordForEmail(`unknown-${runId}@example.test`, {
    redirectTo: `${origin}/auth/recovery`,
  });
  assert.equal(psql('select count(*) from auth.users;', true), usersBeforeUnknownRequest);

  const recoveryMessage = await waitForMail('Reset your FlyEye password');
  const { tokenHash, url } = recoveryLink(recoveryMessage);
  const recoveryMailContent = `${recoveryMessage.HTML ?? recoveryMessage.html ?? ''} ${recoveryMessage.Text ?? recoveryMessage.text ?? ''}`;
  assert.equal(recoveryMailContent.includes(`Synthetic Flight School ${runId}`), false);
  assert.equal(recoveryMailContent.includes('student_pilot'), false);
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, '/auth/recovery');
  assert.deepEqual([...url.searchParams.keys()], ['token_hash']);

  const { data: recoveryData, error: verifyError } = await recoveryClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'recovery',
  });
  if (verifyError || !recoveryData.session) {
    throw verifyError ?? new Error('Recovery verification returned no session.');
  }
  const replayClient = browserClient();
  const { error: replayError } = await replayClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'recovery',
  });
  assert.ok(replayError);
  await assertOtpBootstrapDenied(recoveryData.session.access_token);

  const directBeforePassword = await directPathStatuses(recoveryData.session.access_token);
  assert.equal(directBeforePassword[0], 200);
  assert.equal(directBeforePassword[1], 403);
  assert.notEqual(directBeforePassword[2], 200);
  assert.notEqual(directBeforePassword[3], 200);

  const protectedDenial = psql(
    `select count(*) || ':' ||
            bool_and(organization_id is null)::text || ':' ||
            bool_and(cardinality(organization_ids) = 0)::text
     from public.authentication_events
     where actor_subject_id = '${user.id}'::uuid
       and reason_code = 'authentication_method_not_allowed';`,
    true,
  );
  assert.equal(protectedDenial, '2:true:true');

  const { error: samePasswordError } = await recoveryClient.auth.updateUser({
    password: originalPassword,
  });
  assert.equal(samePasswordError?.code, 'same_password');
  const { error: weakPasswordError } = await recoveryClient.auth.updateUser({
    password: 'too short',
  });
  assert.equal(weakPasswordError?.code, 'weak_password');

  const { error: updateError } = await recoveryClient.auth.updateUser({
    password: recoveredPassword,
  });
  if (updateError) throw updateError;
  const passwordChangedMessage = await waitForMail('Your FlyEye password was changed');
  const passwordChangedContent = `${passwordChangedMessage.HTML ?? passwordChangedMessage.html ?? ''} ${passwordChangedMessage.Text ?? passwordChangedMessage.text ?? ''}`;
  assert.equal(passwordChangedContent.includes(recoveredPassword), false);
  assert.equal(passwordChangedContent.includes('token_hash'), false);
  assert.equal(passwordChangedContent.includes(`Synthetic Flight School ${runId}`), false);

  const { error: logoutError } = await recoveryClient.auth.signOut({ scope: 'global' });
  if (logoutError) throw logoutError;

  for (const oldSession of [oldClientA.session, oldClientB.session]) {
    const refreshResponse = await fetch(`${apiUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: oldSession.refresh_token }),
    });
    assert.notEqual(refreshResponse.status, 200);
  }

  for (const oldSession of [oldClientA.session, oldClientB.session]) {
    const statuses = await directPathStatuses(oldSession.access_token);
    assert.ok(statuses.every((status) => status !== 200));
  }

  const oldPasswordClient = browserClient();
  const { error: oldPasswordError } = await oldPasswordClient.auth.signInWithPassword({
    email: user.email,
    password: originalPassword,
  });
  assert.ok(oldPasswordError);

  const fresh = await signIn(recoveredPassword);
  assert.ok(jwtAuthenticationMethods(fresh.session.access_token).includes('password'));
  assert.equal((await invokeBootstrap(fresh.session.access_token)).status, 200);

  const auditActions = new Set(
    psql(
      `select distinct payload ->> 'action'
       from auth.audit_log_entries
       where created_at >= '${startedAt}'::timestamptz
         and payload ->> 'actor_id' = '${user.id}'
       order by 1;`,
      true,
    )
      .split(/\r?\n/)
      .filter(Boolean),
  );
  for (const action of [
    'user_recovery_requested',
    'login',
    'user_updated_password',
    'user_modified',
    'logout',
  ]) {
    assert.ok(auditActions.has(action), `Missing minimized Auth audit action: ${action}`);
  }
  assert.equal(auditActions.has('token_revoked'), false);

  process.stdout.write(
    'Pinned local FEAT-002 recovery, Mailpit, per-alias OTP-AMR denial audit, password update, global logout, both old refresh tokens and two-client old access paths, and fresh-password bootstrap checks passed.\n',
  );
} finally {
  await cleanup();
}
