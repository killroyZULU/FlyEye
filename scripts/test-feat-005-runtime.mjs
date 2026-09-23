import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';

import { fetchLocalEdge } from './lib/local-edge-request.mjs';

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
const origin = 'http://127.0.0.1:5173';
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(apiUrl).hostname)) {
  throw new Error('FEAT-005 runtime evidence is restricted to the local synthetic stack.');
}

const runId = randomBytes(6).toString('hex');
const limiterSecret = randomBytes(32).toString('hex');
const password = `Synthetic member ${randomBytes(18).toString('base64url')}!`;
const adminA = { id: randomUUID(), email: `member-admin-a-${runId}@example.test` };
const adminTwo = { id: randomUUID(), email: `member-admin-two-${runId}@example.test` };
const member = { id: randomUUID(), email: `member-student-${runId}@example.test` };
const organizationA = randomUUID();
const organizationB = randomUUID();
const adminMembership = randomUUID();
const adminTwoMembership = randomUUID();
const memberMembershipA = randomUUID();
const limiterKeys = new Set();
let edgeProcess;
let temporaryDirectory;
let adminRoleNeedsRestoration = false;

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
  if (result.status !== 0) throw new Error('The synthetic FEAT-005 database fixture failed.');
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
  const group =
    action === 'list' || action === 'detail'
      ? 'directory'
      : action === 'get_profile' || action === 'update_profile'
        ? 'profile'
        : 'status';
  return createHmac('sha256', limiterSecret)
    .update(`${subjectId}\0${group}\0${scopeId}`)
    .digest('hex');
}

function trackLimit(subjectId, action, scopeId) {
  limiterKeys.add(limiterHash(subjectId, action, scopeId));
}

async function signInAal2(identity) {
  const client = browserClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: identity.email,
    password,
  });
  if (signInError) throw new Error('Synthetic admin sign-in failed.');
  const { data: enrollment, error: enrollmentError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `FEAT-005 ${runId}`,
  });
  if (enrollmentError) throw new Error('Synthetic admin TOTP enrollment failed.');
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: enrollment.id,
    code: currentTotp(enrollment.totp.secret),
  });
  if (verifyError) throw new Error('Synthetic admin TOTP verification failed.');
  const { data } = await client.auth.getSession();
  assert.ok(data.session);
  return { client, session: data.session };
}

async function invoke(token, body) {
  const response = await fetchLocalEdge(`${apiUrl}/functions/v1/member-administration`, {
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
  return { response, payload };
}

async function waitForEdge() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/functions/v1/member-administration`, {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${serviceRoleKey}`,
          'content-type': 'application/json',
          origin,
        },
        body: '{}',
        signal: AbortSignal.timeout(1_000),
      });
      if ([400, 401, 403, 405, 422].includes(response.status)) return;
    } catch {
      // The bounded local worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The FEAT-005 Edge worker did not become ready.');
}

async function stopEdge() {
  if (!edgeProcess || edgeProcess.exitCode !== null) return;
  const stopped = new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };
    edgeProcess.once('exit', finish);
    edgeProcess.once('error', finish);
  });
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(edgeProcess.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    edgeProcess.kill('SIGTERM');
  }
  await stopped;
}

async function cleanup() {
  const failures = [];
  const limiterValues = [...limiterKeys].map((value) => `'${value}'`).join(',');
  try {
    try {
      await stopEdge();
    } catch (error) {
      failures.push(error);
    }
    if (adminRoleNeedsRestoration) {
      try {
        psql("update public.roles set is_active = true where code = 'admin';");
        adminRoleNeedsRestoration = false;
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      psql(`
        begin;
        delete from public.member_administration_events
        where organization_id = '${organizationA}'::uuid
           or actor_user_id in ('${adminA.id}'::uuid, '${adminTwo.id}'::uuid, '${member.id}'::uuid);
        delete from public.member_administration_rate_limit_events
        ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'};
        delete from public.member_administration_rate_limit_state
        ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'};
        delete from public.authentication_events
        where actor_user_id in ('${adminA.id}'::uuid, '${adminTwo.id}'::uuid, '${member.id}'::uuid);
        delete from public.organization_member_profiles
        where organization_id = '${organizationA}'::uuid;
        delete from public.membership_roles
        where organization_id = '${organizationA}'::uuid;
        delete from public.organization_memberships
        where organization_id = '${organizationA}'::uuid;
        delete from public.aircraft_document_categories
        where organization_id = '${organizationA}'::uuid;
        delete from public.organizations
        where id = '${organizationA}'::uuid;
        commit;
      `);
    } catch (error) {
      failures.push(error);
    }
    for (const identity of [adminA, adminTwo, member]) {
      try {
        const { error } = await server.auth.admin.deleteUser(identity.id);
        if (error && error.status !== 404) {
          throw new Error(`Synthetic FEAT-005 Auth cleanup failed for ${identity.id}.`);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      const residue = psql(`
        select
          (select count(*) from public.organizations where id = '${organizationA}'::uuid)
          + (select count(*) from public.organization_memberships where id in (
              '${adminMembership}'::uuid, '${adminTwoMembership}'::uuid,
              '${memberMembershipA}'::uuid
            ))
          + (select count(*) from public.organization_member_profiles where membership_id in (
              '${adminMembership}'::uuid, '${adminTwoMembership}'::uuid,
              '${memberMembershipA}'::uuid
            ))
          + (select count(*) from public.member_administration_events
             where organization_id = '${organizationA}'::uuid
                or actor_user_id in ('${adminA.id}'::uuid, '${adminTwo.id}'::uuid, '${member.id}'::uuid))
          + (select count(*) from public.member_administration_rate_limit_events
             ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'})
          + (select count(*) from public.member_administration_rate_limit_state
             ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'})
          + (select count(*) from auth.users
             where id in ('${adminA.id}'::uuid, '${adminTwo.id}'::uuid, '${member.id}'::uuid));
      `);
      assert.equal(residue, '0');
    } catch (error) {
      failures.push(error);
    }
  } finally {
    if (temporaryDirectory) {
      try {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Synthetic FEAT-005 cleanup did not complete cleanly.');
  }
}

try {
  for (const identity of [adminA, adminTwo, member]) {
    const { error } = await server.auth.admin.createUser({
      id: identity.id,
      email: identity.email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error('Synthetic FEAT-005 Auth fixture creation failed.');
  }

  psql(`
    begin;
    insert into public.organizations (id, name, status) values
      ('${organizationA}', 'Synthetic FEAT-005 Flight School', 'active');
    insert into public.organization_memberships (
      id, organization_id, user_id, status, created_by, updated_by
    ) values
      ('${adminMembership}', '${organizationA}', '${adminA.id}', 'active', '${adminA.id}', '${adminA.id}'),
      ('${adminTwoMembership}', '${organizationA}', '${adminTwo.id}', 'active', '${adminA.id}', '${adminA.id}'),
      ('${memberMembershipA}', '${organizationA}', '${member.id}', 'active', '${adminA.id}', '${adminA.id}');
    insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
    select mapping.organization_id, mapping.membership_id, role.id, mapping.assigned_by
    from (values
      ('${organizationA}'::uuid, '${adminMembership}'::uuid, 'admin', '${adminA.id}'::uuid),
      ('${organizationA}'::uuid, '${adminTwoMembership}'::uuid, 'admin', '${adminA.id}'::uuid),
      ('${organizationA}'::uuid, '${memberMembershipA}'::uuid, 'student_pilot', '${adminA.id}'::uuid)
    ) mapping(organization_id, membership_id, role_code, assigned_by)
    join public.roles role on role.code = mapping.role_code;
    commit;
  `);

  const adminSession = await signInAal2(adminA);
  const adminTwoSession = await signInAal2(adminTwo);
  const memberClient = browserClient();
  const { data: memberSignIn, error: memberSignInError } =
    await memberClient.auth.signInWithPassword({ email: member.email, password });
  if (memberSignInError || !memberSignIn.session)
    throw new Error('Synthetic member sign-in failed.');

  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'flyeye-feat005-'));
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
      `FEAT004_LIMITER_HMAC_SECRET=${randomBytes(32).toString('hex')}`,
      `FEAT004_INVITATION_REDIRECT_URL=${origin}/auth/invitation`,
      'FEAT005_LIMITER_POLICY_VERSION=member-administration-subject-scope-v1',
      'FEAT005_DATA_CLASSIFICATION=synthetic-only',
      `FEAT005_LIMITER_HMAC_SECRET=${limiterSecret}`,
      'FEAT006_LIMITER_POLICY_VERSION=member-mfa-subject-action-v1',
      'FEAT006_DATA_CLASSIFICATION=synthetic-only',
      `FEAT006_LIMITER_HMAC_SECRET=${randomBytes(32).toString('hex')}`,
      '',
    ].join('\n'),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  edgeProcess = spawn(
    process.execPath,
    [cliPath, 'functions', 'serve', '--env-file', environmentPath, '--log-level', 'error'],
    { cwd: process.cwd(), windowsHide: true, stdio: 'ignore' },
  );
  await waitForEdge();

  const adminAal1Client = browserClient();
  const { data: adminAal1, error: adminAal1Error } = await adminAal1Client.auth.signInWithPassword({
    email: adminA.email,
    password,
  });
  if (adminAal1Error || !adminAal1.session)
    throw new Error('Synthetic privileged AAL1 sign-in failed.');
  trackLimit(adminA.id, 'get_profile', adminMembership);
  const privilegedProfileAtAal1 = await invoke(adminAal1.session.access_token, {
    action: 'get_profile',
    membershipId: adminMembership,
  });
  assert.equal(privilegedProfileAtAal1.response.status, 403);

  psql("update public.roles set is_active = false where code = 'admin';");
  adminRoleNeedsRestoration = true;
  try {
    trackLimit(adminA.id, 'get_profile', adminMembership);
    const inactivePrivilegedProfile = await invoke(adminAal1.session.access_token, {
      action: 'get_profile',
      membershipId: adminMembership,
    });
    assert.equal(inactivePrivilegedProfile.response.status, 404);
  } finally {
    psql("update public.roles set is_active = true where code = 'admin';");
    adminRoleNeedsRestoration = false;
  }

  trackLimit(member.id, 'get_profile', memberMembershipA);
  const initialProfile = await invoke(memberSignIn.session.access_token, {
    action: 'get_profile',
    membershipId: memberMembershipA,
  });
  assert.equal(initialProfile.response.status, 200);
  assert.equal(initialProfile.payload.profile.complete, false);

  trackLimit(member.id, 'update_profile', memberMembershipA);
  const updatedProfile = await invoke(memberSignIn.session.access_token, {
    action: 'update_profile',
    membershipId: memberMembershipA,
    displayName: 'Synthetic Runtime Student',
    contactNumber: '+63 2 555 0100',
    expectedVersion: initialProfile.payload.profile.version,
  });
  assert.equal(updatedProfile.response.status, 200);
  assert.equal(updatedProfile.payload.profile.complete, true);
  assert.equal(
    psql(`
      select count(*) || ':' || bool_and(tokens < 3)::text
      from public.member_administration_rate_limit_state
      where limiter_key_hash = '${limiterHash(member.id, 'get_profile', memberMembershipA)}'
        and action_group = 'profile';
    `),
    '1:true',
  );

  trackLimit(member.id, 'get_profile', member.id);
  const crossProfile = await invoke(memberSignIn.session.access_token, {
    action: 'get_profile',
    membershipId: adminMembership,
  });
  assert.equal(crossProfile.response.status, 404);

  trackLimit(adminA.id, 'list', organizationA);
  const listed = await invoke(adminSession.session.access_token, {
    action: 'list',
    organizationId: organizationA,
    search: 'runtime student',
  });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.members.length, 1);
  assert.equal(listed.payload.members[0].membershipId, memberMembershipA);

  trackLimit(adminA.id, 'detail', organizationA);
  const detail = await invoke(adminSession.session.access_token, {
    action: 'detail',
    organizationId: organizationA,
    membershipId: memberMembershipA,
  });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.member.contactNumber, '+63 2 555 0100');
  assert.equal(
    psql(`
      select count(*) || ':' || bool_and(tokens < 9)::text
      from public.member_administration_rate_limit_state
      where limiter_key_hash = '${limiterHash(adminA.id, 'list', organizationA)}'
        and action_group = 'directory';
    `),
    '1:true',
  );

  trackLimit(adminA.id, 'list', adminA.id);
  const forgedSchool = await invoke(adminSession.session.access_token, {
    action: 'list',
    organizationId: organizationB,
  });
  assert.equal(forgedSchool.response.status, 404);

  trackLimit(member.id, 'list', member.id);
  const aal1Directory = await invoke(memberSignIn.session.access_token, {
    action: 'list',
    organizationId: organizationA,
  });
  assert.equal(aal1Directory.response.status, 403);

  const { error: directProfileReadError } = await memberClient
    .from('organization_member_profiles')
    .select('*');
  assert.ok(directProfileReadError);

  trackLimit(adminA.id, 'suspend', organizationA);
  const suspension = await invoke(adminSession.session.access_token, {
    action: 'suspend',
    organizationId: organizationA,
    membershipId: memberMembershipA,
    reasonCode: 'temporary_access_hold',
    expectedVersion: 1,
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(suspension.response.status, 200);
  assert.equal(suspension.payload.status, 'suspended');

  trackLimit(member.id, 'get_profile', member.id);
  const suspendedAccess = await invoke(memberSignIn.session.access_token, {
    action: 'get_profile',
    membershipId: memberMembershipA,
  });
  assert.equal(suspendedAccess.response.status, 404);

  trackLimit(adminTwo.id, 'reactivate', organizationA);
  const reactivation = await invoke(adminTwoSession.session.access_token, {
    action: 'reactivate',
    organizationId: organizationA,
    membershipId: memberMembershipA,
    reasonCode: 'hold_resolved',
    expectedVersion: suspension.payload.version,
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(reactivation.response.status, 200);
  assert.equal(reactivation.payload.status, 'active');

  trackLimit(adminA.id, 'revoke', organizationA);
  const revokeKey = randomBytes(16).toString('hex');
  const revocation = await invoke(adminSession.session.access_token, {
    action: 'revoke',
    organizationId: organizationA,
    membershipId: memberMembershipA,
    reasonCode: 'membership_ended',
    expectedVersion: reactivation.payload.version,
    idempotencyKey: revokeKey,
  });
  assert.equal(revocation.response.status, 200);
  assert.equal(revocation.payload.status, 'revoked');
  assert.equal(
    psql(`
      select count(*) || ':' || bool_and(tokens < 1)::text
      from public.member_administration_rate_limit_state
      where limiter_key_hash = '${limiterHash(adminA.id, 'suspend', organizationA)}'
        and action_group = 'status';
    `),
    '1:true',
  );
  await new Promise((resolve) => setTimeout(resolve, 11_000));
  const replay = await invoke(adminSession.session.access_token, {
    action: 'revoke',
    organizationId: organizationA,
    membershipId: memberMembershipA,
    reasonCode: 'membership_ended',
    expectedVersion: reactivation.payload.version,
    idempotencyKey: revokeKey,
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.replayed, true);

  await new Promise((resolve) => setTimeout(resolve, 11_000));

  trackLimit(adminA.id, 'suspend', organizationA);
  trackLimit(adminTwo.id, 'suspend', organizationA);
  const concurrent = await Promise.all([
    invoke(adminSession.session.access_token, {
      action: 'suspend',
      organizationId: organizationA,
      membershipId: adminTwoMembership,
      reasonCode: 'administrative_review',
      expectedVersion: 1,
      idempotencyKey: randomBytes(16).toString('hex'),
    }),
    invoke(adminTwoSession.session.access_token, {
      action: 'suspend',
      organizationId: organizationA,
      membershipId: adminMembership,
      reasonCode: 'administrative_review',
      expectedVersion: 1,
      idempotencyKey: randomBytes(16).toString('hex'),
    }),
  ]);
  assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [200, 404]);
  assert.equal(
    psql(`
      select count(*) from public.organization_memberships membership
      join public.membership_roles membership_role
        on membership_role.organization_id = membership.organization_id
       and membership_role.membership_id = membership.id
      join public.roles role on role.id = membership_role.role_id and role.code = 'admin'
      where membership.organization_id = '${organizationA}'::uuid
        and membership.status = 'active';
    `),
    '1',
  );

  assert.equal(
    psql(`
      select count(*) from public.member_administration_events
      where organization_id = '${organizationA}'::uuid
        and metadata::text !~* 'example\\.test|Synthetic Runtime Student|555 0100';
    `),
    psql(
      `select count(*) from public.member_administration_events where organization_id = '${organizationA}'::uuid;`,
    ),
  );

  process.stdout.write(
    'Local FEAT-005 Auth, TOTP, Edge, profile, school-boundary, status, concurrency, audit, and cleanup checks passed.\n',
  );
} finally {
  await cleanup();
}
