import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { createClient } from '@supabase/supabase-js';

import { reconcileAircraftDocumentStorage } from './lib/aircraft-document-reconciliation.mjs';
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
  throw new Error('FEAT-007B runtime evidence is restricted to the local synthetic stack.');
}

const runId = randomBytes(6).toString('hex');
const limiterSecret = randomBytes(32).toString('hex');
const password = `Synthetic documents ${randomBytes(18).toString('base64url')}!`;
const admin = { id: randomUUID(), email: `document-admin-${runId}@example.test` };
const student = { id: randomUUID(), email: `document-student-${runId}@example.test` };
const organizationId = randomUUID();
const adminMembershipId = randomUUID();
const studentMembershipId = randomUUID();
const aircraftId = randomUUID();
const limiterKeys = new Set();
let edgeProcess;
let temporaryDirectory;
const uploadedObjectKeys = new Set();
const runtimeDiagnosticsEnabled = process.env.FLYEYE_RUNTIME_DIAGNOSTICS === '1';
let currentRuntimeStage;

const server = createClient(apiUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function enterRuntimeStage(stage) {
  if (currentRuntimeStage && runtimeDiagnosticsEnabled) {
    process.stdout.write(
      `FEAT-007B runtime diagnostic: stage=${currentRuntimeStage} event=passed.\n`,
    );
  }
  currentRuntimeStage = stage;
  if (runtimeDiagnosticsEnabled) {
    process.stdout.write(`FEAT-007B runtime diagnostic: stage=${stage} event=enter.\n`);
  }
}

function failRuntimeStage(error) {
  if (!runtimeDiagnosticsEnabled || !currentRuntimeStage) return;
  const assertedHttpStatus =
    error?.name === 'AssertionError' &&
    Number.isInteger(error.actual) &&
    error.actual >= 400 &&
    error.actual <= 599
      ? error.actual
      : undefined;
  const detail =
    assertedHttpStatus !== undefined
      ? [400, 401, 403, 404, 409, 429, 500, 502, 503, 504].includes(assertedHttpStatus)
        ? `http-${assertedHttpStatus}`
        : 'http-other'
      : error?.name === 'AssertionError'
        ? 'assertion'
        : error?.name === 'TimeoutError'
          ? 'timeout'
          : 'unclassified';
  process.stdout.write(
    `FEAT-007B runtime diagnostic: stage=${currentRuntimeStage} event=failed detail=${detail}.\n`,
  );
}

function completeRuntimeStages() {
  if (currentRuntimeStage && runtimeDiagnosticsEnabled) {
    process.stdout.write(
      `FEAT-007B runtime diagnostic: stage=${currentRuntimeStage} event=passed.\n`,
    );
  }
  currentRuntimeStage = undefined;
}

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
      `The synthetic FEAT-007B database fixture failed${diagnostic ? `: ${diagnostic}` : '.'}`,
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

function philippineDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function limiterHash(subjectId) {
  return createHmac('sha256', limiterSecret)
    .update(`${subjectId}\0${organizationId}\0aircraft-documents-v1`)
    .digest('hex');
}

async function signIn(identity, withTotp) {
  const client = browserClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: identity.email,
    password,
  });
  if (signInError) throw new Error('Synthetic aircraft document fixture sign-in failed.');
  if (withTotp) {
    const { data: enrollment, error: enrollmentError } = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `FEAT-007B ${runId}`,
    });
    if (enrollmentError) {
      throw new Error('Synthetic aircraft document fixture TOTP enrollment failed.');
    }
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
      factorId: enrollment.id,
      code: currentTotp(enrollment.totp.secret),
    });
    if (verifyError)
      throw new Error('Synthetic aircraft document fixture TOTP verification failed.');
  }
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('Synthetic aircraft document fixture session is unavailable.');
  return { client, session: data.session };
}

async function invoke(token, body) {
  const response = await fetchLocalEdge(`${apiUrl}/functions/v1/aircraft-documents`, {
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
    if (edgeProcess?.exitCode !== null) {
      throw new Error('The FEAT-007B Edge worker exited during startup.');
    }
    try {
      const response = await fetch(`${apiUrl}/functions/v1/aircraft-documents`, {
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
  throw new Error('The FEAT-007B Edge worker did not become ready.');
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
    if (uploadedObjectKeys.size > 0) {
      try {
        const { error } = await server.storage
          .from('aircraft-documents')
          .remove([...uploadedObjectKeys]);
        if (error) throw error;
      } catch (error) {
        failures.push(error);
      }
    }
    const limiterValues = [...limiterKeys].map((value) => `'${value}'`).join(',');
    try {
      psql(`
        begin;
        delete from public.aircraft_document_events where organization_id = '${organizationId}'::uuid;
        delete from public.aircraft_document_idempotency where organization_id = '${organizationId}'::uuid;
        delete from public.aircraft_document_notifications where organization_id = '${organizationId}'::uuid;
        set local session_replication_role = replica;
        delete from public.aircraft_document_versions where organization_id = '${organizationId}'::uuid;
        set local session_replication_role = origin;
        delete from public.aircraft_documents where organization_id = '${organizationId}'::uuid;
        delete from public.stored_files where organization_id = '${organizationId}'::uuid;
        delete from public.aircraft_document_requirements where organization_id = '${organizationId}'::uuid;
        delete from public.aircraft_document_categories where organization_id = '${organizationId}'::uuid;
        delete from public.aircraft_document_rate_limit_events
        ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'};
        delete from public.aircraft_document_rate_limit_state
        ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'};
        delete from public.aircraft_records where organization_id = '${organizationId}'::uuid;
        delete from public.member_mfa_readiness where organization_id = '${organizationId}'::uuid;
        delete from public.authentication_events
        where actor_user_id in ('${admin.id}'::uuid, '${student.id}'::uuid);
        delete from public.organization_member_profiles where organization_id = '${organizationId}'::uuid;
        delete from public.membership_roles where organization_id = '${organizationId}'::uuid;
        delete from public.organization_memberships where organization_id = '${organizationId}'::uuid;
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
            (select count(*) from public.organizations where id = '${organizationId}'::uuid)
            + (select count(*) from public.aircraft_documents where organization_id = '${organizationId}'::uuid)
            + (select count(*) from public.aircraft_document_events where organization_id = '${organizationId}'::uuid)
            + (select count(*) from public.aircraft_document_idempotency where organization_id = '${organizationId}'::uuid)
            + (select count(*) from public.aircraft_document_rate_limit_events
               ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'})
            + (select count(*) from public.aircraft_document_rate_limit_state
               ${limiterValues ? `where limiter_key_hash in (${limiterValues})` : 'where false'})
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
    throw new AggregateError(failures, 'Synthetic FEAT-007B cleanup did not complete cleanly.');
  }
}

try {
  enterRuntimeStage('identity-creation');
  for (const identity of [admin, student]) {
    const { error } = await server.auth.admin.createUser({
      id: identity.id,
      email: identity.email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error('Synthetic FEAT-007B Auth fixture creation failed.');
  }

  enterRuntimeStage('database-fixture');
  psql(`
    begin;
    insert into public.organizations (id, name, status)
    values ('${organizationId}', 'Synthetic FEAT-007B Flight School', 'active');
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
    insert into public.aircraft_records (
      id, organization_id, registration_mark, registration_key, manufacturer, model,
      created_by, updated_by
    ) values (
      '${aircraftId}', '${organizationId}', 'RP-C7B1', 'rpc7b1',
      'Synthetic Airframes', 'Document Trainer', '${admin.id}', '${admin.id}'
    );
    commit;
  `);

  const categoryId = psql(`
    select id from public.aircraft_document_categories
    where organization_id = '${organizationId}'::uuid
      and category_code = 'registration_certificate';
  `);
  assert.match(categoryId, /^[0-9a-f-]{36}$/);

  enterRuntimeStage('authentication');
  const adminSession = await signIn(admin, true);
  const studentSession = await signIn(student, false);
  limiterKeys.add(limiterHash(admin.id));
  limiterKeys.add(limiterHash(student.id));

  enterRuntimeStage('edge-runtime-startup');
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'flyeye-feat007b-'));
  const environmentPath = path.join(temporaryDirectory, 'edge.env');
  writeFileSync(
    environmentPath,
    [
      `ALLOWED_ORIGIN=${origin}`,
      'FLYEYE_RUNTIME_PROFILE=local-synthetic-v1',
      'FEAT007B_LIMITER_POLICY_VERSION=aircraft-documents-v1',
      'FEAT007B_DATA_CLASSIFICATION=synthetic-only',
      'FEAT007B_SCANNER_MODE=deterministic-local-v1',
      `FEAT007B_LIMITER_HMAC_SECRET=${limiterSecret}`,
      `FEAT007B_PUBLIC_SUPABASE_URL=${apiUrl}`,
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

  enterRuntimeStage('role-boundary');
  const studentStatus = await invoke(studentSession.session.access_token, {
    action: 'status_list',
    aircraftId,
  });
  assert.equal(studentStatus.response.status, 200, JSON.stringify(studentStatus.payload));
  assert.equal(studentStatus.payload.items.length, 6);
  assert.ok(studentStatus.payload.items.every((item) => item.status === 'missing'));

  const concealed = await invoke(studentSession.session.access_token, {
    action: 'detail',
    documentId: randomUUID(),
  });
  assert.equal(concealed.response.status, 403);
  assert.equal(concealed.payload.error.code, 'aircraft_documents.unauthorized');

  enterRuntimeStage('file-lifecycle');
  const fileBytes = new Uint8Array(24);
  fileBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(fileBytes.buffer).setUint32(16, 10);
  new DataView(fileBytes.buffer).setUint32(20, 10);
  const fileKey = randomBytes(32).toString('hex');
  const fileStage = await invoke(adminSession.session.access_token, {
    action: 'file_initiate',
    aircraftId,
    displayName: 'synthetic-registration.png',
    mediaType: 'image/png',
    sizeBytes: fileBytes.byteLength,
    sha256Hash: createHash('sha256').update(fileBytes).digest('hex'),
    idempotencyKey: fileKey,
  });
  assert.equal(fileStage.response.status, 200, JSON.stringify(fileStage.payload));
  const uploadedObjectKey = fileStage.payload.uploadPath;
  uploadedObjectKeys.add(uploadedObjectKey);
  const { error: uploadError } = await adminSession.client.storage
    .from('aircraft-documents')
    .uploadToSignedUrl(fileStage.payload.uploadPath, fileStage.payload.uploadToken, fileBytes, {
      contentType: 'image/png',
    });
  if (uploadError) throw new Error('Synthetic aircraft document upload failed.');
  const fileComplete = await invoke(adminSession.session.access_token, {
    action: 'file_complete',
    fileId: fileStage.payload.fileId,
    idempotencyKey: fileKey,
  });
  assert.equal(fileComplete.response.status, 200, JSON.stringify(fileComplete.payload));
  assert.equal(fileComplete.payload.scanState, 'clean');
  const resumedUpload = await invoke(adminSession.session.access_token, {
    action: 'file_initiate',
    aircraftId,
    displayName: 'synthetic-registration.png',
    mediaType: 'image/png',
    sizeBytes: fileBytes.byteLength,
    sha256Hash: createHash('sha256').update(fileBytes).digest('hex'),
    idempotencyKey: fileKey,
  });
  assert.equal(resumedUpload.response.status, 200, JSON.stringify(resumedUpload.payload));
  assert.equal(resumedUpload.payload.decision, 'completed');
  assert.equal(resumedUpload.payload.fileId, fileStage.payload.fileId);
  assert.equal(resumedUpload.payload.uploadToken, undefined);

  enterRuntimeStage('metadata-create');
  const createKey = randomBytes(32).toString('hex');
  const createRequest = {
    action: 'create',
    aircraftId,
    categoryId,
    documentTitle: 'Registration Certificate',
    documentSource: 'Synthetic Authority',
    referenceNumber: 'SYN-007B',
    issueDate: philippineDate(-30),
    expirationDate: philippineDate(5),
    notes: 'Synthetic runtime evidence only',
    storedFileId: fileStage.payload.fileId,
    idempotencyKey: createKey,
  };
  const created = await invoke(adminSession.session.access_token, createRequest);
  assert.equal(created.response.status, 200, JSON.stringify(created.payload));
  assert.equal(created.payload.decision, 'created');
  // A committed attempt whose proxy response is lost is returned by the bounded retry as a replay.
  assert.equal(typeof created.payload.replayed, 'boolean');
  const documentId = created.payload.documentId;

  enterRuntimeStage('metadata-replay');
  const replayed = await invoke(adminSession.session.access_token, createRequest);
  assert.equal(replayed.response.status, 200, JSON.stringify(replayed.payload));
  assert.equal(replayed.payload.replayed, true);
  assert.equal(replayed.payload.documentId, documentId);

  enterRuntimeStage('status-after-create');
  const statusAfterCreate = await invoke(studentSession.session.access_token, {
    action: 'status_list',
    aircraftId,
  });
  assert.equal(statusAfterCreate.response.status, 200, JSON.stringify(statusAfterCreate.payload));
  assert.equal(
    statusAfterCreate.payload.items.find((item) => item.categoryId === categoryId)?.status,
    'expiring_soon',
  );

  enterRuntimeStage('detail-after-create');
  const detail = await invoke(adminSession.session.access_token, {
    action: 'detail',
    documentId,
  });
  assert.equal(detail.response.status, 200, JSON.stringify(detail.payload));
  assert.equal(detail.payload.document.currentVersion.versionNumber, 1);
  assert.equal(detail.payload.document.currentVersion.attachment.scanState, 'clean');

  enterRuntimeStage('concealed-detail-audit');
  const guessedDetail = await invoke(adminSession.session.access_token, {
    action: 'detail',
    documentId: randomUUID(),
  });
  assert.equal(guessedDetail.response.status, 404);
  assert.equal(guessedDetail.payload.error.code, 'aircraft_documents.not_found');
  assert.equal(
    psql(`
      select count(*) from public.aircraft_document_events
      where organization_id = '${organizationId}'::uuid
        and event_name = 'aircraft_document.security_denied'
        and outcome = 'denied'
        and reason_code = 'not_found'
        and metadata->>'action' = 'detail';
    `),
    '1',
  );

  enterRuntimeStage('attachment-download');
  const download = await invoke(adminSession.session.access_token, {
    action: 'attachment_download',
    fileId: fileStage.payload.fileId,
  });
  assert.equal(download.response.status, 200, JSON.stringify(download.payload));
  const downloaded = await fetch(download.payload.signedUrl, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), fileBytes);
  enterRuntimeStage('reconciliation-ready');
  const ready = await reconcileAircraftDocumentStorage(server, organizationId, randomUUID());
  assert.equal(ready.decision, 'ready', JSON.stringify(ready));

  enterRuntimeStage('reconciliation-orphan-row');
  const abandonedFileId = randomUUID();
  const abandonedObjectKey = `${organizationId}/${aircraftId}/${abandonedFileId}/${abandonedFileId}.png`;
  uploadedObjectKeys.add(abandonedObjectKey);
  const { error: abandonedUploadError } = await server.storage
    .from('aircraft-documents')
    .upload(abandonedObjectKey, fileBytes, { contentType: 'image/png', upsert: false });
  if (abandonedUploadError) throw abandonedUploadError;
  psql(`
    insert into public.stored_files (
      id, organization_id, aircraft_record_id, object_key, display_name, generated_name,
      media_type, size_bytes, sha256_hash, scan_state, uploader_user_id
    ) values (
      '${abandonedFileId}', '${organizationId}', '${aircraftId}', '${abandonedObjectKey}',
      'abandoned-clean-upload.png', '${abandonedFileId}.png', 'image/png',
      ${fileBytes.byteLength}, '${createHash('sha256').update(fileBytes).digest('hex')}',
      'clean', '${admin.id}'
    );
  `);
  const abandoned = await reconcileAircraftDocumentStorage(server, organizationId, randomUUID());
  assert.equal(abandoned.decision, 'reconciliation_failed');
  assert.ok(
    abandoned.failures.some(
      (failure) => failure.reason === 'orphan_object' && failure.fileId === abandonedFileId,
    ),
  );
  const { error: abandonedRemovalError } = await server.storage
    .from('aircraft-documents')
    .remove([abandonedObjectKey]);
  if (abandonedRemovalError) throw abandonedRemovalError;
  uploadedObjectKeys.delete(abandonedObjectKey);
  psql(
    `delete from public.stored_files where organization_id = '${organizationId}'::uuid and id = '${abandonedFileId}'::uuid;`,
  );

  enterRuntimeStage('reconciliation-hash-mismatch');
  const mismatched = await server.rpc('reconcile_aircraft_document_storage', {
    p_organization_id: organizationId,
    p_observed_hashes: { [uploadedObjectKey]: '0'.repeat(64) },
    p_correlation_id: randomUUID(),
  });
  if (mismatched.error) throw mismatched.error;
  assert.equal(mismatched.data.decision, 'reconciliation_failed');
  assert.ok(mismatched.data.failures.some((failure) => failure.reason === 'hash_mismatch'));

  enterRuntimeStage('reconciliation-missing-object');
  const { error: missingRemovalError } = await server.storage
    .from('aircraft-documents')
    .remove([uploadedObjectKey]);
  if (missingRemovalError) throw missingRemovalError;
  const missing = await reconcileAircraftDocumentStorage(server, organizationId, randomUUID());
  assert.equal(missing.decision, 'reconciliation_failed');
  assert.ok(missing.failures.some((failure) => failure.reason === 'missing_object'));
  const { error: restoreError } = await server.storage
    .from('aircraft-documents')
    .upload(uploadedObjectKey, fileBytes, { contentType: 'image/png', upsert: false });
  if (restoreError) throw restoreError;

  enterRuntimeStage('reconciliation-orphan-object');
  const orphanId = randomUUID();
  const orphanObjectKey = `${organizationId}/${aircraftId}/${orphanId}/${orphanId}.png`;
  uploadedObjectKeys.add(orphanObjectKey);
  const { error: orphanUploadError } = await server.storage
    .from('aircraft-documents')
    .upload(orphanObjectKey, fileBytes, { contentType: 'image/png', upsert: false });
  if (orphanUploadError) throw orphanUploadError;
  const orphaned = await reconcileAircraftDocumentStorage(server, organizationId, randomUUID());
  assert.equal(orphaned.decision, 'reconciliation_failed');
  assert.ok(orphaned.failures.some((failure) => failure.reason === 'orphan_object'));
  const { error: orphanRemovalError } = await server.storage
    .from('aircraft-documents')
    .remove([orphanObjectKey]);
  if (orphanRemovalError) throw orphanRemovalError;
  uploadedObjectKeys.delete(orphanObjectKey);

  enterRuntimeStage('reconciliation-wrong-scope');
  const wrongScopeFileId = randomUUID();
  const wrongScopeOrganizationId = randomUUID();
  psql(`
    insert into public.stored_files (
      id, organization_id, aircraft_record_id, object_key, display_name, generated_name,
      media_type, size_bytes, sha256_hash, scan_state, uploader_user_id
    ) values (
      '${wrongScopeFileId}', '${organizationId}', '${aircraftId}',
      '${wrongScopeOrganizationId}/${aircraftId}/${wrongScopeFileId}/${wrongScopeFileId}.png',
      'wrong-scope.png', '${wrongScopeFileId}.png', 'image/png', ${fileBytes.byteLength},
      '${createHash('sha256').update(fileBytes).digest('hex')}', 'staged', '${admin.id}'
    );
  `);
  const wrongScope = await reconcileAircraftDocumentStorage(server, organizationId, randomUUID());
  assert.equal(wrongScope.decision, 'reconciliation_failed');
  assert.ok(wrongScope.failures.some((failure) => failure.reason === 'wrong_scope'));
  psql(`delete from public.stored_files where id = '${wrongScopeFileId}'::uuid;`);

  enterRuntimeStage('reconciliation-unclean-object');
  psql(`
    update public.stored_files set scan_state = 'staged', updated_at = now()
    where id = '${fileStage.payload.fileId}'::uuid;
  `);
  const unclean = await reconcileAircraftDocumentStorage(server, organizationId, randomUUID());
  assert.equal(unclean.decision, 'reconciliation_failed');
  assert.ok(unclean.failures.some((failure) => failure.reason === 'unclean_object'));
  psql(`
    update public.stored_files set scan_state = 'clean', updated_at = now()
    where id = '${fileStage.payload.fileId}'::uuid;
  `);
  // The local Kong/Edge bridge can briefly recycle its upstream after serving Storage bytes.
  await new Promise((resolve) => setTimeout(resolve, 500));

  enterRuntimeStage('renewal-conflict');
  const stale = await invoke(adminSession.session.access_token, {
    ...createRequest,
    action: 'renew',
    documentId,
    expectedVersion: 99,
    expirationDate: philippineDate(365),
    storedFileId: null,
    reason: 'Annual synthetic replacement recorded',
    idempotencyKey: randomBytes(32).toString('hex'),
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.error.code, 'aircraft_documents.version_conflict');

  enterRuntimeStage('renewal-success');
  const renewed = await invoke(adminSession.session.access_token, {
    ...createRequest,
    action: 'renew',
    documentId,
    expectedVersion: 1,
    expirationDate: philippineDate(365),
    storedFileId: null,
    reason: 'Annual synthetic replacement recorded',
    idempotencyKey: randomBytes(32).toString('hex'),
  });
  assert.equal(renewed.response.status, 200, JSON.stringify(renewed.payload));
  assert.equal(renewed.payload.decision, 'renewed');
  assert.equal(renewed.payload.currentVersionNumber, 2);

  enterRuntimeStage('history-read');
  const history = await invoke(adminSession.session.access_token, {
    action: 'history',
    documentId,
    page: 1,
    pageSize: 25,
  });
  assert.equal(history.response.status, 200, JSON.stringify(history.payload));
  assert.equal(history.payload.items.length, 2);

  enterRuntimeStage('notification-read');
  const notifications = await invoke(adminSession.session.access_token, {
    action: 'notifications_list',
    page: 1,
    pageSize: 25,
    includeResolved: true,
  });
  assert.equal(notifications.response.status, 200, JSON.stringify(notifications.payload));
  assert.equal(notifications.payload.items.length, 1);
  assert.equal(notifications.payload.items[0].state, 'resolved');

  enterRuntimeStage('archived-download');
  psql(`
    update public.aircraft_records
    set registry_state = 'archived', archive_reason = 'no_longer_tracked',
        archived_at = now(), archived_by = '${admin.id}'::uuid,
        version = version + 1, updated_at = now(), updated_by = '${admin.id}'::uuid
    where organization_id = '${organizationId}'::uuid and id = '${aircraftId}'::uuid;
  `);
  const archivedDownload = await invoke(adminSession.session.access_token, {
    action: 'attachment_download',
    fileId: fileStage.payload.fileId,
  });
  assert.equal(archivedDownload.response.status, 404);
  assert.equal(archivedDownload.payload.error.code, 'aircraft_documents.not_found');

  enterRuntimeStage('direct-data-audit');
  const { data: directRows, error: directError } = await studentSession.client
    .from('aircraft_documents')
    .select('id');
  assert.ok(directError);
  assert.equal(directRows, null);
  assert.equal(
    psql(`
      select count(*) from public.aircraft_document_events
      where organization_id = '${organizationId}'::uuid
        and event_name in ('aircraft_document.created', 'aircraft_document.renewed');
    `),
    '2',
  );

  completeRuntimeStages();
  process.stdout.write(
    'Local FEAT-007B Auth, TOTP, status-only access, protected metadata, versioning, replay, conflict, warning lifecycle, Storage reconciliation, direct-data denial, audit, and cleanup checks passed.\n',
  );
} catch (error) {
  failRuntimeStage(error);
  throw error;
} finally {
  await cleanup();
}
