import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
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
  throw new Error('FEAT-007 runtime evidence is restricted to the local synthetic stack.');
}

const runId = randomBytes(6).toString('hex');
const limiterSecret = randomBytes(32).toString('hex');
const password = `Synthetic registry ${randomBytes(18).toString('base64url')}!`;
const admin = { id: randomUUID(), email: `aircraft-admin-${runId}@example.test` };
const student = { id: randomUUID(), email: `aircraft-student-${runId}@example.test` };
const organizationId = randomUUID();
const adminMembershipId = randomUUID();
const studentMembershipId = randomUUID();
const concealedRecordId = randomUUID();
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
  if (result.status !== 0) {
    const diagnostic = result.stderr.trim().split(/\r?\n/).at(-1);
    throw new Error(
      `The synthetic FEAT-007 database fixture failed${diagnostic ? `: ${diagnostic}` : '.'}`,
    );
  }
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

function limiterHash(subjectId) {
  return createHmac('sha256', limiterSecret)
    .update(`${subjectId}\0${organizationId}\0aircraft-registry-v1`)
    .digest('hex');
}

async function signIn(identity, withTotp) {
  const client = browserClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: identity.email,
    password,
  });
  if (signInError) throw new Error('Synthetic aircraft fixture sign-in failed.');
  if (withTotp) {
    const { data: enrollment, error: enrollmentError } = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `FEAT-007 ${runId}`,
    });
    if (enrollmentError) throw new Error('Synthetic aircraft fixture TOTP enrollment failed.');
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
      factorId: enrollment.id,
      code: currentTotp(enrollment.totp.secret),
    });
    if (verifyError) throw new Error('Synthetic aircraft fixture TOTP verification failed.');
  }
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('Synthetic aircraft fixture session is unavailable.');
  return { client, session: data.session };
}

async function invoke(token, body) {
  const response = await fetchLocalEdge(`${apiUrl}/functions/v1/aircraft-registry`, {
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
      const response = await fetch(`${apiUrl}/functions/v1/aircraft-registry`, {
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
  throw new Error('The FEAT-007 Edge worker did not become ready.');
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
        delete from public.aircraft_registry_events
        where organization_id = '${organizationId}'::uuid;
        delete from public.aircraft_registry_idempotency
        where organization_id = '${organizationId}'::uuid;
        delete from public.aircraft_records
        where organization_id = '${organizationId}'::uuid;
        delete from public.aircraft_registry_rate_limit_events
        ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'};
        delete from public.aircraft_registry_rate_limit_state
        ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'};
        delete from public.member_mfa_readiness
        where organization_id = '${organizationId}'::uuid;
        delete from public.authentication_events
        where actor_user_id in ('${admin.id}'::uuid, '${student.id}'::uuid);
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
    for (const identity of [admin, student]) {
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
            (select count(*) from public.organizations
             where id = '${organizationId}'::uuid)
            + (select count(*) from public.aircraft_records
               where organization_id = '${organizationId}'::uuid)
            + (select count(*) from public.aircraft_registry_events
               where organization_id = '${organizationId}'::uuid)
            + (select count(*) from public.aircraft_registry_idempotency
               where organization_id = '${organizationId}'::uuid)
            + (select count(*) from public.aircraft_registry_rate_limit_events
               ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'})
            + (select count(*) from public.aircraft_registry_rate_limit_state
               ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'})
            + (select count(*) from public.member_mfa_readiness
               where organization_id = '${organizationId}'::uuid)
            + (select count(*) from public.authentication_events
               where actor_user_id in ('${admin.id}'::uuid, '${student.id}'::uuid))
            + (select count(*) from public.organization_member_profiles
               where organization_id = '${organizationId}'::uuid)
            + (select count(*) from public.membership_roles
               where organization_id = '${organizationId}'::uuid)
            + (select count(*) from public.organization_memberships
               where organization_id = '${organizationId}'::uuid)
            + (select count(*) from auth.users
               where id in ('${admin.id}'::uuid, '${student.id}'::uuid));
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
    throw new AggregateError(failures, 'Synthetic FEAT-007 cleanup did not complete cleanly.');
  }
}

try {
  for (const identity of [admin, student]) {
    const { error } = await server.auth.admin.createUser({
      id: identity.id,
      email: identity.email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error('Synthetic FEAT-007 Auth fixture creation failed.');
  }

  psql(`
    begin;
    insert into public.organizations (id, name, status)
    values ('${organizationId}', 'Synthetic FEAT-007 Flight School', 'active');
    insert into public.organization_memberships (
      id, organization_id, user_id, status, created_by, updated_by
    ) values
      ('${adminMembershipId}', '${organizationId}', '${admin.id}', 'active', '${admin.id}', '${admin.id}'),
      ('${studentMembershipId}', '${organizationId}', '${student.id}', 'active', '${admin.id}', '${admin.id}');
    insert into public.membership_roles (organization_id, membership_id, role_id, assigned_by)
    select mapping.organization_id, mapping.membership_id, role.id, '${admin.id}'::uuid
    from (values
      ('${organizationId}'::uuid, '${adminMembershipId}'::uuid, 'admin'),
      ('${organizationId}'::uuid, '${studentMembershipId}'::uuid, 'student_pilot')
    ) mapping(organization_id, membership_id, role_code)
    join public.roles role on role.code = mapping.role_code;
    commit;
  `);

  const adminSession = await signIn(admin, true);
  const studentSession = await signIn(student, false);
  limiterKeys.add(limiterHash(admin.id));
  limiterKeys.add(limiterHash(student.id));

  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'flyeye-feat007-'));
  const environmentPath = path.join(temporaryDirectory, 'edge.env');
  writeFileSync(
    environmentPath,
    [
      `ALLOWED_ORIGIN=${origin}`,
      'FLYEYE_RUNTIME_PROFILE=local-synthetic-v1',
      'FEAT007_LIMITER_POLICY_VERSION=aircraft-registry-v1',
      'FEAT007_DATA_CLASSIFICATION=synthetic-only',
      `FEAT007_LIMITER_HMAC_SECRET=${limiterSecret}`,
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

  const empty = await invoke(adminSession.session.access_token, {
    action: 'list',
    includeArchived: false,
    page: 1,
    pageSize: 25,
  });
  assert.equal(empty.response.status, 200, JSON.stringify(empty.payload));
  assert.deepEqual(empty.payload.records, []);

  const createKey = randomBytes(16).toString('hex');
  const createRequest = {
    action: 'create',
    registrationMark: ' rp-c1234 ',
    manufacturer: 'Synthetic Airframes',
    model: 'Trainer One',
    idempotencyKey: createKey,
  };
  const created = await invoke(adminSession.session.access_token, createRequest);
  assert.equal(created.response.status, 200, JSON.stringify(created.payload));
  assert.equal(created.payload.record.registrationMark, 'RP-C1234');
  assert.equal(created.payload.replayed, false);
  const recordId = created.payload.record.id;

  const replayed = await invoke(adminSession.session.access_token, createRequest);
  assert.equal(replayed.response.status, 200, JSON.stringify(replayed.payload));
  assert.equal(replayed.payload.replayed, true);
  assert.equal(replayed.payload.record.id, recordId);

  const duplicate = await invoke(adminSession.session.access_token, {
    ...createRequest,
    registrationMark: 'RP C1234',
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.error.code, 'aircraft_registry.duplicate_registration');

  const concurrentCreates = await Promise.all([
    invoke(adminSession.session.access_token, {
      ...createRequest,
      registrationMark: 'RP-C2000',
      idempotencyKey: randomBytes(16).toString('hex'),
    }),
    invoke(adminSession.session.access_token, {
      ...createRequest,
      registrationMark: 'RP C2000',
      idempotencyKey: randomBytes(16).toString('hex'),
    }),
  ]);
  assert.deepEqual(concurrentCreates.map((item) => item.response.status).sort(), [200, 409]);

  const found = await invoke(adminSession.session.access_token, {
    action: 'list',
    search: 'C1234',
    includeArchived: false,
    page: 1,
    pageSize: 25,
  });
  assert.equal(found.response.status, 200, JSON.stringify(found.payload));
  assert.equal(found.payload.records.length, 1);

  const concealed = await invoke(adminSession.session.access_token, {
    action: 'get',
    recordId: concealedRecordId,
  });
  assert.equal(concealed.response.status, 404);
  assert.equal(concealed.payload.error.code, 'aircraft_registry.not_found');

  const stale = await invoke(adminSession.session.access_token, {
    action: 'update',
    recordId,
    registrationMark: 'RP-C1234',
    manufacturer: 'Synthetic Airframes',
    model: 'Trainer Two',
    expectedVersion: 99,
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.error.code, 'aircraft_registry.version_conflict');

  const updated = await invoke(adminSession.session.access_token, {
    action: 'update',
    recordId,
    registrationMark: 'RP-C1234',
    manufacturer: 'Synthetic Airframes',
    model: 'Trainer Two',
    expectedVersion: 1,
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.payload));
  assert.equal(updated.payload.record.version, 2);

  const archiveRace = await Promise.all([
    invoke(adminSession.session.access_token, {
      action: 'archive',
      recordId,
      expectedVersion: 2,
      reason: 'no_longer_tracked',
      idempotencyKey: randomBytes(16).toString('hex'),
    }),
    invoke(adminSession.session.access_token, {
      action: 'archive',
      recordId,
      expectedVersion: 2,
      reason: 'created_in_error',
      idempotencyKey: randomBytes(16).toString('hex'),
    }),
  ]);
  assert.deepEqual(archiveRace.map((item) => item.response.status).sort(), [200, 409]);
  const archived = archiveRace.find((item) => item.response.status === 200);
  assert.ok(archived);
  assert.equal(archived.response.status, 200, JSON.stringify(archived.payload));
  assert.equal(archived.payload.record.registryState, 'archived');

  const reactivated = await invoke(adminSession.session.access_token, {
    action: 'reactivate',
    recordId,
    expectedVersion: 3,
    reason: 'tracking_resumed',
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(reactivated.response.status, 200, JSON.stringify(reactivated.payload));
  assert.equal(reactivated.payload.record.registryState, 'tracked');

  const denied = await invoke(studentSession.session.access_token, {
    action: 'list',
    includeArchived: false,
    page: 1,
    pageSize: 25,
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.payload.error.code, 'aircraft_registry.unauthorized');

  const { data: directRows, error: directError } = await studentSession.client
    .from('aircraft_records')
    .select('id');
  assert.ok(directError);
  assert.equal(directRows, null);
  assert.equal(
    psql(`
      select count(*) from public.aircraft_registry_events
      where organization_id = '${organizationId}'::uuid
        and event_name in (
          'aircraft_record.created', 'aircraft_record.updated',
          'aircraft_record.archived', 'aircraft_record.reactivated'
        );
    `),
    '5',
  );

  process.stdout.write(
    'Local FEAT-007 Auth, TOTP, Edge registry, normalization, concurrent duplicate prevention, replay, conflict, record concealment, direct-data denial, audit, and cleanup checks passed.\n',
  );
} finally {
  await cleanup();
}
