import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';

const cliPath = path.resolve('node_modules', 'supabase', 'dist', 'supabase.js');
const status = spawnSync(process.execPath, [cliPath, 'status', '-o', 'json'], {
  encoding: 'utf8',
  windowsHide: true,
});
if (status.status !== 0) throw new Error('The local Supabase stack is not running.');
const local = JSON.parse(status.stdout);
const apiUrl = local.API_URL;
const publishableKey = local.PUBLISHABLE_KEY ?? local.ANON_KEY;
const serviceRoleKey = local.SERVICE_ROLE_KEY;
const mailpitUrl = local.MAILPIT_URL ?? local.INBUCKET_URL;
const origin = 'http://127.0.0.1:5173';
for (const value of [apiUrl, mailpitUrl]) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(value).hostname)) {
    throw new Error('FEAT-004 runtime evidence is restricted to the local synthetic stack.');
  }
}

const runId = randomBytes(6).toString('hex');
const limiterSecret = randomBytes(32).toString('hex');
const admin = { id: randomUUID(), email: `invite-admin-${runId}@example.test` };
const recipientEmail = `invite-recipient-${runId}@example.test`;
const existing = { id: randomUUID(), email: `invite-existing-${runId}@example.test` };
const organizationA = randomUUID();
const organizationB = randomUUID();
const adminMembership = randomUUID();
const password = `Synthetic invitation ${randomBytes(18).toString('base64url')}!`;
const recipientPassword = `Synthetic recipient ${randomBytes(18).toString('base64url')}!`;
const correlations = new Set();
const limiterKeys = new Set();
let recipientId;
let invitationId;
let edgeProcess;
let temporaryDirectory;

const server = createClient(apiUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function psql(sql) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_flyeye',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: sql, encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) throw new Error('The synthetic database fixture failed.');
  return result.stdout.trim();
}

function browserClient() {
  return createClient(apiUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

function base32Bytes(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replaceAll('=', '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Synthetic TOTP secret is invalid.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function currentTotp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', base32Bytes(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function limiterHash(subjectId, action, scopeId) {
  return createHmac('sha256', limiterSecret)
    .update(`${subjectId}\0${action}\0${scopeId}`)
    .digest('hex');
}

async function invoke(token, body) {
  const response = await fetch(`${apiUrl}/functions/v1/member-invitations`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (typeof payload?.correlationId === 'string') correlations.add(payload.correlationId);
  return { response, payload };
}

async function waitForEdge() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/functions/v1/member-invitations`, {
        method: 'OPTIONS',
        headers: { origin },
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status === 204) return;
    } catch {
      // The bounded local worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The FEAT-004 Edge worker did not become ready.');
}

async function waitForInvitationMail(recipient) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const listResponse = await fetch(`${mailpitUrl}/api/v1/messages`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    const summary = (list.messages ?? []).find((message) => {
      const recipients = message.To ?? message.to ?? [];
      return recipients.some(
        (entry) => (entry.Address ?? entry.address ?? '').toLowerCase() === recipient,
      );
    });
    if (summary) {
      const id = summary.ID ?? summary.Id ?? summary.id;
      const messageResponse = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
      assert.equal(messageResponse.status, 200);
      return messageResponse.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The local invitation email was not captured.');
}

function confirmationUrl(message) {
  const content = `${message.HTML ?? message.html ?? ''}\n${message.Text ?? message.text ?? ''}`
    .replaceAll('&amp;', '&')
    .replaceAll('&#61;', '=');
  const urls = content.match(/https?:\/\/[^"'<> \r\n]+/g) ?? [];
  const candidate = urls.find((value) => new URL(value).pathname === '/auth/v1/verify');
  if (!candidate)
    throw new Error('The local invite template omitted the provider verification link.');
  return candidate;
}

async function stopEdge() {
  if (!edgeProcess || edgeProcess.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(edgeProcess.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    edgeProcess.kill('SIGTERM');
  }
}

async function cleanup() {
  await stopEdge();
  const correlationValues = [...correlations].map((value) => `'${value}'::uuid`).join(',');
  const limiterValues = [...limiterKeys].map((value) => `'${value}'`).join(',');
  psql(`
    begin;
    delete from public.member_invitation_events
    where organization_id in ('${organizationA}'::uuid, '${organizationB}'::uuid);
    delete from public.organization_invitations
    where organization_id in ('${organizationA}'::uuid, '${organizationB}'::uuid);
    delete from public.membership_roles
    where organization_id in ('${organizationA}'::uuid, '${organizationB}'::uuid);
    delete from public.organization_memberships
    where organization_id in ('${organizationA}'::uuid, '${organizationB}'::uuid);
    delete from public.organizations where id in ('${organizationA}'::uuid, '${organizationB}'::uuid);
    ${correlationValues ? `delete from public.member_invitation_rate_limit_events where correlation_id in (${correlationValues});` : ''}
    ${limiterValues ? `delete from public.member_invitation_rate_limit_state where limiter_key_hash in (${limiterValues});` : ''}
    commit;
  `);
  const { data: syntheticUsers } = await server.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const user of syntheticUsers?.users ?? []) {
    if (
      user.id === recipientId ||
      /^invite-(?:recipient|existing)-[0-9a-f]{12}@example\.test$/.test(user.email ?? '')
    ) {
      await server.auth.admin.deleteUser(user.id);
    }
  }
  await server.auth.admin.deleteUser(admin.id);
  try {
    await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
  } catch {
    // Public database and Auth cleanup remain authoritative for fixture residue.
  }
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}

try {
  const { error: adminError } = await server.auth.admin.createUser({
    id: admin.id,
    email: admin.email,
    password,
    email_confirm: true,
  });
  if (adminError) throw adminError;
  const { error: existingError } = await server.auth.admin.createUser({
    id: existing.id,
    email: existing.email,
    password: recipientPassword,
    email_confirm: true,
  });
  if (existingError) throw existingError;
  psql(`
    begin;
    insert into public.organizations (id, name, status)
    values
      ('${organizationA}', 'Synthetic Runtime School A ${runId}', 'active'),
      ('${organizationB}', 'Synthetic Runtime School B ${runId}', 'active');
    insert into public.organization_memberships (
      id, organization_id, user_id, status, created_by, updated_by
    ) values (
      '${adminMembership}', '${organizationA}', '${admin.id}', 'active', '${admin.id}', '${admin.id}'
    );
    insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
    select '${organizationA}', '${adminMembership}', id, '${admin.id}'
    from public.roles where code = 'admin';
    commit;
  `);

  const adminClient = browserClient();
  const { data: signIn, error: signInError } = await adminClient.auth.signInWithPassword({
    email: admin.email,
    password,
  });
  if (signInError || !signIn.session) throw new Error('Synthetic admin sign-in failed.');
  const { data: enrollment, error: enrollmentError } = await adminClient.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `FlyEye FEAT-004 ${runId}`,
  });
  if (enrollmentError) throw new Error('Synthetic admin TOTP enrollment failed.');
  const { error: verificationError } = await adminClient.auth.mfa.challengeAndVerify({
    factorId: enrollment.id,
    code: currentTotp(enrollment.totp.secret),
  });
  if (verificationError) throw new Error('Synthetic admin TOTP verification failed.');
  const { data: aal2Data } = await adminClient.auth.getSession();
  assert.ok(aal2Data.session);

  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'flyeye-feat004-'));
  const environmentPath = path.join(temporaryDirectory, 'edge.env');
  writeFileSync(
    environmentPath,
    [
      `ALLOWED_ORIGIN=${origin}`,
      'FLYEYE_RUNTIME_PROFILE=local-synthetic-v1',
      'FEAT003_LIMITER_POLICY_VERSION=subject-action-v1',
      'FEAT003_DATA_CLASSIFICATION=synthetic-only',
      `FEAT003_LIMITER_HMAC_SECRET=${randomBytes(32).toString('hex')}`,
      'FEAT004_LIMITER_POLICY_VERSION=invitation-subject-scope-v1',
      'FEAT004_DATA_CLASSIFICATION=synthetic-only',
      `FEAT004_LIMITER_HMAC_SECRET=${limiterSecret}`,
      `FEAT004_INVITATION_REDIRECT_URL=${origin}/auth/invitation`,
      '',
    ].join('\n'),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  edgeProcess = spawn(
    process.execPath,
    [cliPath, 'functions', 'serve', '--env-file', environmentPath, '--log-level', 'error'],
    {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  await waitForEdge();

  limiterKeys.add(limiterHash(admin.id, 'list', organizationA));
  const initialList = await invoke(aal2Data.session.access_token, {
    action: 'list',
    organizationId: organizationA,
  });
  assert.equal(initialList.response.status, 200);
  assert.equal(initialList.payload.roles.length, 3);
  assert.equal(initialList.payload.invitations.length, 0);

  limiterKeys.add(limiterHash(admin.id, 'create', organizationA));
  const created = await invoke(aal2Data.session.access_token, {
    action: 'create',
    organizationId: organizationA,
    email: recipientEmail,
    roleCode: 'student_pilot',
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.payload.decision, 'pending');
  invitationId = created.payload.invitationId;

  const listed = await invoke(aal2Data.session.access_token, {
    action: 'list',
    organizationId: organizationA,
  });
  assert.equal(listed.response.status, 200);
  const invitation = listed.payload.invitations.find((item) => item.invitationId === invitationId);
  assert.equal(invitation.status, 'pending');
  assert.equal(invitation.email, recipientEmail);

  const message = await waitForInvitationMail(recipientEmail);
  const verification = await fetch(confirmationUrl(message), {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok([302, 303].includes(verification.status));
  const location = verification.headers.get('location');
  assert.ok(location);
  const callback = new URL(location);
  assert.equal(callback.origin, origin);
  assert.equal(callback.pathname, '/auth/invitation');
  assert.equal(callback.searchParams.get('invitation'), invitationId);
  const fragment = new URLSearchParams(callback.hash.slice(1));
  const recipientClient = browserClient();
  const { data: invitedSession, error: sessionError } = await recipientClient.auth.setSession({
    access_token: fragment.get('access_token'),
    refresh_token: fragment.get('refresh_token'),
  });
  if (sessionError || !invitedSession.user)
    throw new Error('Synthetic invite verification failed.');
  recipientId = invitedSession.user.id;
  limiterKeys.add(limiterHash(recipientId, 'prepare', invitationId));
  const preparedNewIdentity = await invoke(invitedSession.session.access_token, {
    action: 'prepare',
    invitationId,
    expectedVersion: invitation.version,
  });
  assert.equal(preparedNewIdentity.response.status, 200);
  assert.equal(preparedNewIdentity.payload.credentialMode, 'new');
  const { error: passwordError } = await recipientClient.auth.updateUser({
    password: recipientPassword,
  });
  if (passwordError) throw new Error('Synthetic invite credential setup failed.');
  const { data: recipientSignIn, error: recipientSignInError } =
    await recipientClient.auth.signInWithPassword({
      email: recipientEmail,
      password: recipientPassword,
    });
  if (recipientSignInError || !recipientSignIn.session)
    throw new Error('Synthetic recipient password sign-in failed.');

  limiterKeys.add(limiterHash(recipientId, 'accept', invitationId));
  const acceptanceAttempts = await Promise.all(
    Array.from({ length: 2 }, () =>
      invoke(recipientSignIn.session.access_token, {
        action: 'accept',
        invitationId,
        expectedVersion: invitation.version,
        idempotencyKey: randomBytes(16).toString('hex'),
      }),
    ),
  );
  assert.deepEqual(acceptanceAttempts.map((attempt) => attempt.response.status).sort(), [200, 404]);
  assert.equal(
    acceptanceAttempts.filter((attempt) => attempt.payload.decision === 'accepted').length,
    1,
  );
  const membershipEvidence = psql(`
    select count(*) from public.organization_memberships membership
    join public.membership_roles membership_role
      on membership_role.organization_id = membership.organization_id
     and membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id
    where membership.organization_id = '${organizationA}'::uuid
      and membership.user_id = '${recipientId}'::uuid
      and membership.status = 'active' and role.code = 'student_pilot';
  `);
  assert.equal(membershipEvidence.trim(), '1');

  const existingCreated = await invoke(aal2Data.session.access_token, {
    action: 'create',
    organizationId: organizationA,
    email: existing.email,
    roleCode: 'instructor_pilot',
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(existingCreated.response.status, 200);
  assert.equal(existingCreated.payload.decision, 'pending');
  const existingInvitationId = existingCreated.payload.invitationId;
  limiterKeys.add(limiterHash(admin.id, 'create', organizationA));
  const existingMessage = await waitForInvitationMail(existing.email);
  const existingLink = new URL(confirmationUrl(existingMessage));
  const existingRedirect = new URL(existingLink.searchParams.get('redirect_to'));
  assert.equal(existingRedirect.searchParams.get('invitation'), existingInvitationId);

  const existingClient = browserClient();
  const existingVerification = await fetch(confirmationUrl(existingMessage), {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok([302, 303].includes(existingVerification.status));
  const existingLocation = existingVerification.headers.get('location');
  assert.ok(existingLocation);
  const existingFragment = new URLSearchParams(new URL(existingLocation).hash.slice(1));
  const { data: existingMagicSession, error: existingMagicSessionError } =
    await existingClient.auth.setSession({
      access_token: existingFragment.get('access_token'),
      refresh_token: existingFragment.get('refresh_token'),
    });
  if (existingMagicSessionError || !existingMagicSession.session) {
    throw new Error('Synthetic existing-recipient verification failed.');
  }
  limiterKeys.add(limiterHash(existing.id, 'prepare', existingInvitationId));
  const preparedExistingIdentity = await invoke(existingMagicSession.session.access_token, {
    action: 'prepare',
    invitationId: existingInvitationId,
    expectedVersion: existingCreated.payload.version,
  });
  assert.equal(preparedExistingIdentity.response.status, 200);
  assert.equal(preparedExistingIdentity.payload.credentialMode, 'existing');
  const { data: existingSignIn, error: existingSignInError } =
    await existingClient.auth.signInWithPassword({
      email: existing.email,
      password: recipientPassword,
    });
  if (existingSignInError || !existingSignIn.session) {
    throw new Error('Synthetic existing recipient sign-in failed.');
  }
  limiterKeys.add(limiterHash(existing.id, 'accept', existingInvitationId));
  const existingAccepted = await invoke(existingSignIn.session.access_token, {
    action: 'accept',
    invitationId: existingInvitationId,
    expectedVersion: existingCreated.payload.version,
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(existingAccepted.response.status, 200);
  assert.equal(existingAccepted.payload.decision, 'accepted');
  assert.equal(
    psql(`
      select count(*) from public.organization_memberships membership
      join public.membership_roles membership_role
        on membership_role.organization_id = membership.organization_id
       and membership_role.membership_id = membership.id
      join public.roles role on role.id = membership_role.role_id
      where membership.organization_id = '${organizationA}'::uuid
        and membership.user_id = '${existing.id}'::uuid
        and membership.status = 'active' and role.code = 'instructor_pilot';
    `),
    '1',
  );

  limiterKeys.add(limiterHash(admin.id, 'list', '00000000-0000-0000-0000-000000000000'));
  const crossTenant = await invoke(aal2Data.session.access_token, {
    action: 'list',
    organizationId: organizationB,
  });
  assert.equal(crossTenant.response.status, 404);
  const { error: directReadError } = await recipientClient
    .from('organization_invitations')
    .select('*');
  assert.ok(directReadError);

  process.stdout.write(
    'Local FEAT-004 new/existing Auth, TOTP, Edge, Mailpit, explicit acceptance, tenant isolation, and cleanup checks passed.\n',
  );
} finally {
  await cleanup();
}
