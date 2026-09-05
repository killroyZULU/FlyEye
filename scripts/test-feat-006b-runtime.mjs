import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

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
  throw new Error('FEAT-006B runtime evidence is restricted to the local synthetic stack.');
}

const runId = randomBytes(6).toString('hex');
const limiterSecret = randomBytes(32).toString('hex');
const password = `Synthetic role ${randomBytes(18).toString('base64url')}!`;
const actor = { id: randomUUID(), email: `role-admin-${runId}@example.test` };
const secondAdmin = { id: randomUUID(), email: `role-admin-two-${runId}@example.test` };
const target = { id: randomUUID(), email: `role-target-${runId}@example.test` };
const organizationId = randomUUID();
const forgedOrganizationId = randomUUID();
const actorMembershipId = randomUUID();
const secondAdminMembershipId = randomUUID();
const targetMembershipId = randomUUID();
const limiterKeys = new Set();
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
  if (result.status !== 0) throw new Error('The synthetic FEAT-006B database fixture failed.');
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

function limiterHash(subjectId, scopeId) {
  return createHmac('sha256', limiterSecret)
    .update(`${subjectId}\0status\0${scopeId}`)
    .digest('hex');
}

async function enrollAndVerify(identity, friendlyName) {
  const client = browserClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: identity.email,
    password,
  });
  if (signInError) throw new Error('Synthetic role fixture sign-in failed.');
  const { data: enrollment, error: enrollmentError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  });
  if (enrollmentError) throw new Error('Synthetic role fixture TOTP enrollment failed.');
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: enrollment.id,
    code: currentTotp(enrollment.totp.secret),
  });
  if (verifyError) throw new Error('Synthetic role fixture TOTP verification failed.');
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('Synthetic role fixture AAL2 session is unavailable.');
  return { client, session: data.session, factorId: enrollment.id };
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
  return { response, payload: await response.json() };
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
  throw new Error('The FEAT-006B Edge worker did not become ready.');
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
  try {
    try {
      await stopEdge();
    } catch (error) {
      failures.push(error);
    }
    const limiterValues = [...limiterKeys].map((value) => `'${value}'`).join(',');
    try {
      psql(`
        begin;
        delete from public.member_administration_events
        where organization_id = '${organizationId}'::uuid
           or actor_user_id in (
             '${actor.id}'::uuid, '${secondAdmin.id}'::uuid, '${target.id}'::uuid
           );
        delete from public.member_administration_rate_limit_events
        ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'};
        delete from public.member_administration_rate_limit_state
        ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'};
        delete from public.member_mfa_readiness
        where organization_id = '${organizationId}'::uuid;
        delete from public.authentication_events
        where actor_user_id in (
          '${actor.id}'::uuid, '${secondAdmin.id}'::uuid, '${target.id}'::uuid
        );
        delete from public.organization_member_profiles
        where organization_id = '${organizationId}'::uuid;
        delete from public.membership_roles
        where organization_id = '${organizationId}'::uuid;
        delete from public.organization_memberships
        where organization_id = '${organizationId}'::uuid;
        delete from public.aircraft_document_categories
        where organization_id = '${organizationId}'::uuid;
        delete from public.organizations where id = '${organizationId}'::uuid;
        commit;
      `);
    } catch (error) {
      failures.push(error);
    }
    for (const identity of [actor, secondAdmin, target]) {
      try {
        const { error } = await server.auth.admin.deleteUser(identity.id);
        if (error && error.status !== 404) throw error;
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      assert.equal(
        psql(`
          select
            (select count(*) from public.organizations where id = '${organizationId}'::uuid)
            + (select count(*) from public.organization_memberships
               where id in (
                 '${actorMembershipId}'::uuid, '${secondAdminMembershipId}'::uuid,
                 '${targetMembershipId}'::uuid
               ))
            + (select count(*) from public.member_administration_events
               where organization_id = '${organizationId}'::uuid)
            + (select count(*) from auth.users
               where id in (
                 '${actor.id}'::uuid, '${secondAdmin.id}'::uuid, '${target.id}'::uuid
               ));
        `),
        '0',
      );
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
    throw new AggregateError(failures, 'Synthetic FEAT-006B cleanup did not complete cleanly.');
  }
}

try {
  for (const identity of [actor, secondAdmin, target]) {
    const { error } = await server.auth.admin.createUser({
      id: identity.id,
      email: identity.email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error('Synthetic FEAT-006B Auth fixture creation failed.');
  }

  psql(`
    begin;
    insert into public.organizations (id, name, status)
    values ('${organizationId}', 'Synthetic FEAT-006B Flight School', 'active');
    insert into public.organization_memberships (
      id, organization_id, user_id, status, created_by, updated_by
    ) values
      ('${actorMembershipId}', '${organizationId}', '${actor.id}', 'active', '${actor.id}', '${actor.id}'),
      ('${secondAdminMembershipId}', '${organizationId}', '${secondAdmin.id}', 'active', '${actor.id}', '${actor.id}'),
      ('${targetMembershipId}', '${organizationId}', '${target.id}', 'active', '${actor.id}', '${actor.id}');
    insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
    select mapping.organization_id, mapping.membership_id, role.id, '${actor.id}'::uuid
    from (values
      ('${organizationId}'::uuid, '${actorMembershipId}'::uuid, 'admin'),
      ('${organizationId}'::uuid, '${secondAdminMembershipId}'::uuid, 'admin'),
      ('${organizationId}'::uuid, '${targetMembershipId}'::uuid, 'student_pilot')
    ) mapping(organization_id, membership_id, role_code)
    join public.roles role on role.code = mapping.role_code;
    commit;
  `);

  const actorSession = await enrollAndVerify(actor, `FEAT-006B actor ${runId}`);
  const secondAdminSession = await enrollAndVerify(secondAdmin, `FEAT-006B second admin ${runId}`);
  const targetSession = await enrollAndVerify(target, `FEAT-006B target ${runId}`);

  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'flyeye-feat006b-'));
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

  limiterKeys.add(limiterHash(actor.id, actor.id));
  const forged = await invoke(actorSession.session.access_token, {
    action: 'assign_role',
    organizationId: forgedOrganizationId,
    membershipId: targetMembershipId,
    roleCode: 'instructor_pilot',
    reasonCode: 'responsibility_changed',
    expectedVersion: 1,
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(forged.response.status, 404);

  await new Promise((resolve) => setTimeout(resolve, 11_000));
  limiterKeys.add(limiterHash(actor.id, organizationId));
  const factorReferenceHash = createHash('sha256').update(targetSession.factorId).digest('hex');
  psql(`
    insert into public.member_mfa_readiness (
      organization_id, membership_id, subject_user_id, factor_reference_hash, verified_at
    ) values (
      '${organizationId}', '${targetMembershipId}', '${target.id}',
      '${factorReferenceHash}', now()
    );
  `);

  const idempotencyKey = randomBytes(16).toString('hex');
  const changed = await invoke(actorSession.session.access_token, {
    action: 'assign_role',
    organizationId,
    membershipId: targetMembershipId,
    roleCode: 'instructor_pilot',
    reasonCode: 'responsibility_changed',
    expectedVersion: 1,
    idempotencyKey,
  });
  assert.equal(changed.response.status, 200, JSON.stringify(changed.payload));
  assert.equal(changed.payload.roleCode, 'instructor_pilot');
  assert.equal(changed.payload.replayed, false);
  assert.equal(
    psql(`
      select role.code from public.membership_roles membership_role
      join public.roles role on role.id = membership_role.role_id
      where membership_role.membership_id = '${targetMembershipId}'::uuid;
    `),
    'instructor_pilot',
  );
  assert.equal(
    psql(`
      select count(*) from public.member_administration_events
      where target_membership_id = '${targetMembershipId}'::uuid
        and event_name = 'member_role.changed'
        and metadata->>'mfaReadinessVerified' = 'true';
    `),
    '1',
  );

  await new Promise((resolve) => setTimeout(resolve, 11_000));
  const replayed = await invoke(actorSession.session.access_token, {
    action: 'assign_role',
    organizationId,
    membershipId: targetMembershipId,
    roleCode: 'instructor_pilot',
    reasonCode: 'responsibility_changed',
    expectedVersion: 1,
    idempotencyKey,
  });
  assert.equal(replayed.response.status, 200);
  assert.equal(replayed.payload.replayed, true);
  assert.equal(
    psql(`
      select count(*) from public.member_administration_events
      where target_membership_id = '${targetMembershipId}'::uuid
        and event_name = 'member_role.changed';
    `),
    '1',
  );

  await new Promise((resolve) => setTimeout(resolve, 11_000));
  limiterKeys.add(limiterHash(secondAdmin.id, organizationId));
  const concurrentLastAdminChanges = await Promise.all([
    invoke(secondAdminSession.session.access_token, {
      action: 'assign_role',
      organizationId,
      membershipId: actorMembershipId,
      roleCode: 'student_pilot',
      reasonCode: 'responsibility_changed',
      expectedVersion: 1,
      idempotencyKey: randomBytes(16).toString('hex'),
    }),
    invoke(actorSession.session.access_token, {
      action: 'suspend',
      organizationId,
      membershipId: secondAdminMembershipId,
      reasonCode: 'administrative_review',
      expectedVersion: 1,
      idempotencyKey: randomBytes(16).toString('hex'),
    }),
  ]);
  assert.deepEqual(
    concurrentLastAdminChanges.map((item) => item.response.status).sort(),
    [200, 404],
  );
  assert.equal(
    psql(`
      select count(*) from public.organization_memberships membership
      join public.membership_roles membership_role
        on membership_role.organization_id = membership.organization_id
       and membership_role.membership_id = membership.id
      join public.roles role on role.id = membership_role.role_id and role.code = 'admin'
      where membership.organization_id = '${organizationId}'::uuid
        and membership.status = 'active';
    `),
    '1',
  );

  process.stdout.write(
    'Local FEAT-006B Auth, target TOTP readiness, Edge assignment, school-boundary, idempotency, last-admin concurrency, audit, and cleanup checks passed.\n',
  );
} finally {
  await cleanup();
}
