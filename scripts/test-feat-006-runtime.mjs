import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { createClient } from '@supabase/supabase-js';

const cliPath = path.resolve('node_modules', 'supabase', 'dist', 'supabase.js');
const localStatus = spawnSync(process.execPath, [cliPath, 'status', '-o', 'json'], {
  encoding: 'utf8',
});
if (localStatus.status !== 0) throw new Error('The local Supabase stack is not running.');
const local = JSON.parse(localStatus.stdout);
const apiUrl = local.API_URL;
const publishableKey = local.PUBLISHABLE_KEY ?? local.ANON_KEY;
const serviceRoleKey = local.SERVICE_ROLE_KEY;
if (!['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname)) {
  throw new Error('FEAT-006 runtime verification is restricted to local Supabase.');
}

const origin = 'http://127.0.0.1:5173';
const organizationId = randomUUID();
const membershipId = randomUUID();
const email = `feat006a-${randomBytes(6).toString('hex')}@example.test`;
const password = `Synthetic-${randomBytes(18).toString('base64url')}!`;
const admin = createClient(apiUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let userId;
let client;
let edgeProcess;
let edgeExitPromise;
let edgeExitObserved = false;
let temporaryDirectory;
let primaryError;
const limiterCorrelationIds = [];
const runtimeDiagnosticsEnabled = process.env.FLYEYE_RUNTIME_DIAGNOSTICS === '1';
const runtimeFailureCodes = new Set([
  'member_mfa.audit_unavailable',
  'member_mfa.authentication_required',
  'member_mfa.factor_conflict',
  'member_mfa.limiter_unavailable',
  'member_mfa.not_available',
  'member_mfa.provider_unavailable',
  'member_mfa.rate_limited',
  'member_mfa.recent_authentication_required',
  'member_mfa.service_unavailable',
  'member_mfa.state_conflict',
]);

class MemberMfaRuntimeRequestError extends Error {
  constructor(status, safeCode) {
    super(`Member MFA runtime request failed with ${status} (${safeCode}).`);
    this.safeCode = safeCode;
  }
}

class MemberMfaRuntimePhaseError extends Error {
  constructor(detail) {
    super('The member MFA runtime invocation failed.');
    this.detail = detail;
  }
}

function runtimeDiagnostic(stage, event) {
  if (runtimeDiagnosticsEnabled) {
    process.stdout.write(`FEAT-006 runtime diagnostic: stage=${stage} event=${event}.\n`);
  }
}

async function runtimeFailureDiagnostic(stage, error) {
  if (!runtimeDiagnosticsEnabled) return;
  if (
    edgeProcess &&
    !edgeExitObserved &&
    edgeProcess.exitCode === null &&
    edgeProcess.signalCode === null
  ) {
    await Promise.race([edgeExitPromise, new Promise((resolve) => setTimeout(resolve, 250))]);
  }
  const detail =
    edgeProcess &&
    (edgeExitObserved || edgeProcess.exitCode !== null || edgeProcess.signalCode !== null)
      ? 'edge-runtime-exited'
      : error instanceof MemberMfaRuntimeRequestError && runtimeFailureCodes.has(error.safeCode)
        ? error.safeCode.replaceAll(/[._]/g, '-')
        : error instanceof MemberMfaRuntimePhaseError
          ? error.detail
          : 'unclassified';
  process.stdout.write(
    `FEAT-006 runtime diagnostic: stage=${stage} event=failed detail=${detail}.\n`,
  );
}

function psql(sql, tuplesOnly = false) {
  const args = ['exec', '-i', 'supabase_db_flyeye', 'psql', '-U', 'postgres', '-d', 'postgres'];
  if (tuplesOnly) args.push('-At');
  const result = spawnSync('docker', args, { input: sql, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Local synthetic database command failed.');
  return result.stdout.trim();
}

function base32Bytes(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replaceAll('=', '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('The local TOTP fixture is invalid.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function currentTotp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Bytes(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function waitForEdge() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/functions/v1/member-mfa`, {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${serviceRoleKey}`,
          'content-type': 'application/json',
          origin,
        },
        body: '{}',
      });
      if ([400, 401, 403, 405, 422].includes(response.status)) return;
    } catch {
      // The local worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The local member-MFA Edge Function did not become ready.');
}

async function invoke(body) {
  let data;
  try {
    ({ data } = await client.auth.getSession());
  } catch {
    throw new MemberMfaRuntimePhaseError('auth-session-read-failed');
  }
  if (!data.session) throw new MemberMfaRuntimePhaseError('auth-session-unavailable');
  let response;
  try {
    response = await fetch(`${apiUrl}/functions/v1/member-mfa`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${data.session.access_token}`,
        'content-type': 'application/json',
        origin,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new MemberMfaRuntimePhaseError('transport-failed');
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new MemberMfaRuntimePhaseError('response-decoding-failed');
  }
  if (payload && typeof payload === 'object' && typeof payload.correlationId === 'string') {
    limiterCorrelationIds.push(payload.correlationId);
  }
  if (!response.ok) {
    const safeCode =
      payload && typeof payload === 'object' && typeof payload.error?.code === 'string'
        ? payload.error.code
        : 'unknown';
    throw new MemberMfaRuntimeRequestError(response.status, safeCode);
  }
  return payload;
}

try {
  runtimeDiagnostic('identity-creation', 'enter');
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Synthetic user creation failed.');
  userId = created.data.user.id;
  runtimeDiagnostic('identity-creation', 'passed');

  runtimeDiagnostic('database-fixture', 'enter');
  psql(`
    insert into public.organizations (id, name, status)
    values ('${organizationId}', 'Synthetic FEAT-006 Runtime School', 'active');
    insert into public.organization_memberships (id, organization_id, user_id, status)
    values ('${membershipId}', '${organizationId}', '${userId}', 'active');
    insert into public.membership_roles (organization_id, membership_id, role_id)
    select '${organizationId}', '${membershipId}', id
    from public.roles where code = 'student_pilot';
  `);
  runtimeDiagnostic('database-fixture', 'passed');

  runtimeDiagnostic('edge-runtime-startup', 'enter');
  temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'flyeye-feat006a-'));
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
      `FEAT005_LIMITER_HMAC_SECRET=${randomBytes(32).toString('hex')}`,
      'FEAT006_LIMITER_POLICY_VERSION=member-mfa-subject-action-v1',
      'FEAT006_DATA_CLASSIFICATION=synthetic-only',
      `FEAT006_LIMITER_HMAC_SECRET=${randomBytes(32).toString('hex')}`,
    ].join('\n'),
    { encoding: 'utf8', mode: 0o600 },
  );
  edgeProcess = spawn(
    process.execPath,
    [cliPath, 'functions', 'serve', '--env-file', environmentPath, '--log-level', 'error'],
    { stdio: 'ignore', windowsHide: true },
  );
  edgeExitPromise = new Promise((resolve) => {
    edgeProcess.once('exit', () => {
      edgeExitObserved = true;
      resolve();
    });
  });
  await waitForEdge();
  runtimeDiagnostic('edge-runtime-startup', 'passed');

  runtimeDiagnostic('sign-in', 'enter');
  client = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw new Error('Synthetic sign-in failed.');
  runtimeDiagnostic('sign-in', 'passed');

  runtimeDiagnostic('readiness-status', 'enter');
  const status = await invoke({ action: 'status' });
  assert.equal(status.factorState, 'enrollment_required');
  assert.equal(status.ready, false);
  runtimeDiagnostic('readiness-status', 'passed');

  runtimeDiagnostic('enrollment-start', 'enter');
  const started = await invoke({
    action: 'start',
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(started.factorState, 'enrollment_required');
  runtimeDiagnostic('enrollment-start', 'passed');

  runtimeDiagnostic('provider-enrollment', 'enter');
  const enrolled = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Synthetic FlyEye authenticator',
  });
  if (enrolled.error || !enrolled.data.totp.secret)
    throw new Error('Synthetic TOTP enrollment failed.');

  const providerInventory = await admin.auth.admin.mfa.listFactors({ userId });
  if (providerInventory.error) {
    throw new Error(
      `Synthetic factor inventory failed (${providerInventory.error.code ?? 'unknown'}).`,
    );
  }
  if (!providerInventory.data.factors[0]) {
    throw new Error('Synthetic factor inventory was empty.');
  }
  runtimeDiagnostic('provider-enrollment', 'passed');

  runtimeDiagnostic('factor-binding', 'enter');
  const bound = await invoke({
    action: 'bind_factor',
    operationId: started.operationId,
    expectedVersion: started.operationVersion,
    factorId: enrolled.data.id,
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(bound.decision, 'bound');
  runtimeDiagnostic('factor-binding', 'passed');

  runtimeDiagnostic('totp-verification', 'enter');
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: enrolled.data.id,
    code: currentTotp(enrolled.data.totp.secret),
  });
  if (verified.error) throw new Error('Synthetic TOTP verification failed.');
  runtimeDiagnostic('totp-verification', 'passed');

  runtimeDiagnostic('completion', 'enter');
  let completed;
  try {
    completed = await invoke({
      action: 'complete',
      operationId: started.operationId,
      expectedVersion: bound.operationVersion,
      idempotencyKey: randomBytes(16).toString('hex'),
    });
  } catch (error) {
    await runtimeFailureDiagnostic('completion', error);
    throw error;
  }
  assert.equal(completed.decision, 'completed');
  assert.equal(completed.membershipId, membershipId);
  runtimeDiagnostic('completion', 'passed');

  runtimeDiagnostic('evidence', 'enter');
  assert.equal(
    psql(
      `select count(*) from public.member_mfa_readiness where membership_id = '${membershipId}';`,
      true,
    ),
    '1',
  );
  assert.equal(
    psql(
      `select count(*) from public.authentication_events where actor_user_id = '${userId}' and event_name = 'member_mfa.enrollment_completed';`,
      true,
    ),
    '1',
  );
  assert.equal(
    psql(
      `select role.code from public.membership_roles membership_role join public.roles role on role.id = membership_role.role_id where membership_role.membership_id = '${membershipId}';`,
      true,
    ),
    'student_pilot',
  );
  runtimeDiagnostic('evidence', 'passed');
} catch (error) {
  primaryError = error;
} finally {
  if (edgeProcess) edgeProcess.kill();
  runtimeDiagnostic('fixture-data-cleanup', 'enter');
  const cleanupErrors = [];
  if (userId) {
    try {
      if (limiterCorrelationIds.length > 0) {
        const correlationList = limiterCorrelationIds.map((value) => `'${value}'::uuid`).join(',');
        psql(`
          delete from public.member_mfa_rate_limit_state state_row
          using public.member_mfa_rate_limit_events event_row
          where state_row.limiter_key_hash = event_row.limiter_key_hash
            and state_row.action = event_row.action
            and event_row.correlation_id in (${correlationList});
          delete from public.member_mfa_rate_limit_events
          where correlation_id in (${correlationList});
        `);
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      psql(`
        delete from public.authentication_events where actor_user_id = '${userId}';
        delete from public.member_mfa_readiness where subject_user_id = '${userId}';
        delete from public.member_mfa_enrollment_operations where subject_user_id = '${userId}';
        delete from public.organization_member_profiles where membership_id = '${membershipId}';
        delete from public.membership_roles where membership_id = '${membershipId}';
        delete from public.organization_memberships where id = '${membershipId}';
        delete from public.aircraft_document_categories where organization_id = '${organizationId}';
        delete from public.organizations where id = '${organizationId}';
      `);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error) cleanupErrors.push(deleted.error);
      const lookup = await admin.auth.admin.getUserById(userId);
      if (!lookup.error || lookup.data.user) {
        cleanupErrors.push(new Error('Synthetic Auth user cleanup failed.'));
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      assert.equal(
        psql(`select count(*) from public.organizations where id = '${organizationId}';`, true),
        '0',
      );
      if (limiterCorrelationIds.length > 0) {
        const correlationList = limiterCorrelationIds.map((value) => `'${value}'::uuid`).join(',');
        assert.equal(
          psql(
            `select count(*) from public.member_mfa_rate_limit_events where correlation_id in (${correlationList});`,
            true,
          ),
          '0',
        );
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0)
    primaryError = new AggregateError(
      primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors,
      'FEAT-006A runtime verification or cleanup failed.',
    );
  if (cleanupErrors.length === 0) runtimeDiagnostic('fixture-data-cleanup', 'passed');
}

if (primaryError) throw primaryError;

runtimeDiagnostic('fixture-assertions', 'passed');
process.stdout.write('FEAT-006A local synthetic TOTP runtime verification passed.\n');
