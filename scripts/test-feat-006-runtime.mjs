import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { createClient } from '@supabase/supabase-js';

import { feat006Diagnostic } from './lib/runtime-diagnostics.mjs';
import { fetchLocalEdge } from './lib/local-edge-request.mjs';
import { stopLocalEdge, waitForMemberMfaWorker } from './lib/local-edge-lifecycle.mjs';

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

// This is an Origin header only; no network request targets this hostname.
// A fresh exact origin prevents the default/previous worker passing readiness.
const origin = `https://${randomUUID()}.localhost`;
const organizationId = randomUUID();
const membershipId = randomUUID();
const email = `feat006a-${randomBytes(6).toString('hex')}@example.test`;
const password = `Synthetic-${randomBytes(18).toString('base64url')}!`;
const limiterSecret = randomBytes(32).toString('hex');
const admin = createClient(apiUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let userId;
let client;
let edgeProcess;
let temporaryDirectory;
let primaryError;
const limiterCorrelationIds = [];
let discardedCorrelationId;
let limiterRowBaseline;
let cleanupLimiterKeyList;
let stage = 'fixture-setup';
let failureDetail = 'unclassified';

function reportDiagnostic(event, detail) {
  if (process.env.FLYEYE_RUNTIME_DIAGNOSTICS === '1') {
    process.stdout.write(`${feat006Diagnostic(stage, event, detail)}\n`);
  }
}

function enterStage(nextStage) {
  stage = nextStage;
  failureDetail = 'unclassified';
  reportDiagnostic('enter');
}

function psql(sql, tuplesOnly = false) {
  const args = [
    'exec',
    '-i',
    'supabase_db_flyeye',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
  ];
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

async function invoke(body, trackCorrelation = true) {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('The synthetic session is unavailable.');
  failureDetail = 'transport-failed';
  const response = await fetchLocalEdge(
    `${apiUrl}/functions/v1/member-mfa`,
    {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${data.session.access_token}`,
        'content-type': 'application/json',
        origin,
      },
      body: JSON.stringify(body),
    },
    (status) => reportDiagnostic('retry', `http-${status}`),
  );
  failureDetail = 'response-decoding-failed';
  const payload = await response.json();
  failureDetail = 'unclassified';
  if (
    trackCorrelation &&
    payload &&
    typeof payload === 'object' &&
    typeof payload.correlationId === 'string'
  ) {
    limiterCorrelationIds.push(payload.correlationId);
  }
  if (!response.ok) {
    failureDetail = [400, 401, 403, 409, 422, 429, 500, 502, 503, 504].includes(response.status)
      ? `http-${response.status}`
      : 'http-other';
    const safeCode =
      payload && typeof payload === 'object' && typeof payload.error?.code === 'string'
        ? payload.error.code
        : 'unknown';
    throw new Error(`Member MFA runtime request failed with ${response.status} (${safeCode}).`);
  }
  return payload;
}

try {
  enterStage('fixture-setup');
  limiterRowBaseline = psql(
    `select (select count(*) from public.member_mfa_rate_limit_state)
      + (select count(*) from public.member_mfa_rate_limit_events);`,
    true,
  );
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Synthetic user creation failed.');
  userId = created.data.user.id;
  psql(`
    insert into public.organizations (id, name, status)
    values ('${organizationId}', 'Synthetic FEAT-006 Runtime School', 'active');
    insert into public.organization_memberships (id, organization_id, user_id, status)
    values ('${membershipId}', '${organizationId}', '${userId}', 'active');
    insert into public.membership_roles (organization_id, membership_id, role_id)
    select '${organizationId}', '${membershipId}', id
    from public.roles where code = 'student_pilot';
  `);

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
      `FEAT006_LIMITER_HMAC_SECRET=${limiterSecret}`,
    ].join('\n'),
    { encoding: 'utf8', mode: 0o600 },
  );
  client = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  enterStage('password-sign-in');
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw new Error('Synthetic sign-in failed.');

  enterStage('edge-startup');
  edgeProcess = spawn(
    process.execPath,
    [cliPath, 'functions', 'serve', '--env-file', environmentPath, '--log-level', 'error'],
    { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' },
  );
  // Avoid an unhandled spawn error; readiness and cleanup report fixed failures.
  edgeProcess.on('error', () => {});
  await waitForMemberMfaWorker(`${apiUrl}/functions/v1/member-mfa`, origin, edgeProcess, {
    apikey: publishableKey,
    authorization: `Bearer ${signedIn.data.session.access_token}`,
  });

  enterStage('readiness-status');
  const identity = await invoke({ action: 'status' });
  assert.match(identity.correlationId, /^[0-9a-f-]{36}$/);
  assert.equal(
    psql(
      `select limiter_key_hash from public.member_mfa_rate_limit_events
      where correlation_id = '${identity.correlationId}'::uuid;`,
      true,
    ),
    createHmac('sha256', limiterSecret).update(`${userId}\u0000status`).digest('hex'),
  );
  // Model a lost response: its correlation ID is deliberately unavailable to cleanup.
  // Retain it only for the post-cleanup regression assertion.
  discardedCorrelationId = (await invoke({ action: 'status' }, false)).correlationId;
  const status = await invoke({ action: 'status' });
  assert.equal(status.factorState, 'enrollment_required');
  assert.equal(status.ready, false);

  enterStage('enrollment-start');
  const started = await invoke({
    action: 'start',
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(started.factorState, 'enrollment_required');
  enterStage('totp-enroll');
  const enrolled = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Synthetic FlyEye authenticator',
  });
  if (enrolled.error || !enrolled.data.totp.secret)
    throw new Error('Synthetic TOTP enrollment failed.');

  enterStage('factor-inventory');
  const providerInventory = await admin.auth.admin.mfa.listFactors({ userId });
  if (providerInventory.error) {
    throw new Error(
      `Synthetic factor inventory failed (${providerInventory.error.code ?? 'unknown'}).`,
    );
  }
  if (!providerInventory.data.factors[0]) {
    throw new Error('Synthetic factor inventory was empty.');
  }

  enterStage('factor-bind');
  const bound = await invoke({
    action: 'bind_factor',
    operationId: started.operationId,
    expectedVersion: started.operationVersion,
    factorId: enrolled.data.id,
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(bound.decision, 'bound');

  enterStage('totp-verify');
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: enrolled.data.id,
    code: currentTotp(enrolled.data.totp.secret),
  });
  if (verified.error) throw new Error('Synthetic TOTP verification failed.');

  enterStage('readiness-complete');
  const completed = await invoke({
    action: 'complete',
    operationId: started.operationId,
    expectedVersion: bound.operationVersion,
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(completed.decision, 'completed');
  enterStage('persistence-assertions');
  assert.equal(completed.membershipId, membershipId);
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
  reportDiagnostic('passed');
} catch (error) {
  reportDiagnostic('failed', error?.code === 'ERR_ASSERTION' ? 'assertion' : failureDetail);
  primaryError = error;
} finally {
  const cleanupErrors = [];
  async function cleanupStep(name, action) {
    enterStage(name);
    try {
      await action();
      reportDiagnostic('passed');
    } catch (error) {
      reportDiagnostic('failed', error?.code === 'ERR_ASSERTION' ? 'assertion' : 'unclassified');
      cleanupErrors.push(error);
    }
  }
  await cleanupStep('cleanup-edge-shutdown', () => stopLocalEdge(edgeProcess));
  await cleanupStep('cleanup-auth-refresh', () => client?.auth.stopAutoRefresh());
  if (userId) {
    await cleanupStep('cleanup-limiter-rows', () => {
      const limiterKeys = new Set(
        ['status', 'start', 'bind_factor', 'complete'].map((action) =>
          createHmac('sha256', limiterSecret).update(`${userId}\u0000${action}`).digest('hex'),
        ),
      );
      if (limiterCorrelationIds.length > 0) {
        const correlationList = limiterCorrelationIds.map((value) => `'${value}'::uuid`).join(',');
        const observedKeys = psql(
          `select distinct limiter_key_hash from public.member_mfa_rate_limit_events
            where correlation_id in (${correlationList});`,
          true,
        );
        for (const key of observedKeys.split(/\r?\n/).filter(Boolean)) {
          assert.match(key, /^[0-9a-f]{64}$/);
          limiterKeys.add(key);
        }
      }
      cleanupLimiterKeyList = [...limiterKeys].map((value) => `'${value}'`).join(',');
      psql(`
        delete from public.member_mfa_rate_limit_state
        where limiter_key_hash in (${cleanupLimiterKeyList});
        delete from public.member_mfa_rate_limit_events
        where limiter_key_hash in (${cleanupLimiterKeyList});
      `);
    });
    await cleanupStep('cleanup-domain-rows', () => {
      psql(`
        delete from public.authentication_events where actor_user_id = '${userId}';
        delete from public.member_mfa_readiness where subject_user_id = '${userId}';
        delete from public.member_mfa_enrollment_operations where subject_user_id = '${userId}';
        delete from public.organization_member_profiles where membership_id = '${membershipId}';
        delete from public.membership_roles where membership_id = '${membershipId}';
        delete from public.organization_memberships where id = '${membershipId}';
        delete from public.organizations where id = '${organizationId}';
      `);
    });
    await cleanupStep('cleanup-auth-user', async () => {
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error) throw deleted.error;
    });
    await cleanupStep('cleanup-identity-assertions', () => {
      assert.equal(psql(`select count(*) from auth.users where id = '${userId}';`, true), '0');
      assert.equal(
        psql(`select count(*) from public.organizations where id = '${organizationId}';`, true),
        '0',
      );
    });
    await cleanupStep('cleanup-key-assertions', () => {
      assert.ok(cleanupLimiterKeyList);
      assert.equal(
        psql(
          `select (select count(*) from public.member_mfa_rate_limit_state
            where limiter_key_hash in (${cleanupLimiterKeyList}))
            + (select count(*) from public.member_mfa_rate_limit_events
            where limiter_key_hash in (${cleanupLimiterKeyList}));`,
          true,
        ),
        '0',
      );
    });
    await cleanupStep('cleanup-discarded-event', () => {
      if (discardedCorrelationId) {
        assert.equal(
          psql(
            `select count(*) from public.member_mfa_rate_limit_events
              where correlation_id = '${discardedCorrelationId}'::uuid;`,
            true,
          ),
          '0',
        );
      }
    });
    await cleanupStep('cleanup-baseline-assertions', () => {
      assert.equal(
        psql(
          `select (select count(*) from public.member_mfa_rate_limit_state)
            + (select count(*) from public.member_mfa_rate_limit_events);`,
          true,
        ),
        limiterRowBaseline,
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
    });
  }
  await cleanupStep('cleanup-temporary-files', () => {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  });
  enterStage('fixture-cleanup');
  reportDiagnostic(cleanupErrors.length > 0 ? 'failed' : 'passed');
  if (cleanupErrors.length > 0)
    primaryError = new AggregateError(
      primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors,
      'FEAT-006A runtime verification or cleanup failed.',
    );
}

if (primaryError) throw primaryError;

process.stdout.write('FEAT-006A local synthetic TOTP runtime verification passed.\n');
