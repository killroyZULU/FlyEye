import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';

import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const origin = 'http://127.0.0.1:5173';
const cliPath = path.resolve('node_modules', 'supabase', 'dist', 'supabase.js');
const cliBinaryPath = resolveSupabaseBinary();
const configPath = path.resolve('supabase', 'config.toml');
const commandTimeoutMs = 30_000;
const requestTimeoutMs = 30_000;
const readinessProbeTimeoutMs = 2_000;
const shutdownTimeoutMs = 5_000;
const diagnosticsEnabled = process.env.FLYEYE_RUNTIME_DIAGNOSTICS === '1';
const linkedMarkers = [
  path.resolve('supabase', '.temp', 'project-ref'),
  path.resolve('supabase', '.temp', 'pooler-url'),
  path.resolve('.supabase', 'project-ref'),
];

let stage = 'same-stack attestation';
let edgeProcess;
let temporaryDirectory;
let cleanupRequired = false;
let cleanupComplete = false;

function resolveSupabaseBinary() {
  const require = createRequire(realpathSync(cliPath));
  const platformCandidates = {
    darwin: { arm64: ['darwin-arm64'], x64: ['darwin-x64'] },
    linux: {
      arm64: ['linux-arm64', 'linux-arm64-musl'],
      x64: ['linux-x64', 'linux-x64-musl'],
    },
    win32: { arm64: ['windows-arm64'], x64: ['windows-x64'] },
  };
  const candidates = platformCandidates[process.platform]?.[process.arch] ?? [];
  const executableName = process.platform === 'win32' ? 'supabase.exe' : 'supabase';

  for (const suffix of candidates) {
    try {
      const packageDirectory = path.dirname(
        require.resolve(`@supabase/cli-${suffix}/package.json`),
      );
      return path.join(packageDirectory, 'bin', executableName);
    } catch {
      // Try the next pinned platform package.
    }
  }

  throw new Error('Pinned local Supabase binary is unavailable for this platform.');
}

function reportDiagnostic(diagnosticStage, event) {
  assert.match(diagnosticStage, /^[a-z0-9-]+$/);
  assert.match(event, /^(?:enter|passed)$/);
  if (diagnosticsEnabled) {
    process.stdout.write(`FEAT-003 runtime diagnostic: stage=${diagnosticStage} event=${event}.\n`);
  }
}

function enterStage(diagnosticStage, description) {
  stage = description;
  reportDiagnostic(diagnosticStage, 'enter');
}

function boundedFetch(input, init = {}, timeoutMs = requestTimeoutMs) {
  return fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

  return new Promise((resolve) => {
    const finish = (exited) => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function waitForProcessGroupExit(processId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-processId, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function stopChild(child, diagnosticStage, description) {
  if (!child) return;
  enterStage(diagnosticStage, description);

  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') {
      const termination = spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        timeout: commandTimeoutMs,
        windowsHide: true,
      });
      if (![0, 128].includes(termination.status ?? -1)) {
        throw new Error('Synthetic child process tree shutdown failed.');
      }
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }

    const childExited = await waitForChildExit(child, shutdownTimeoutMs);
    const processTreeExited =
      process.platform === 'win32'
        ? childExited
        : childExited && (await waitForProcessGroupExit(child.pid, shutdownTimeoutMs));

    if (!processTreeExited) {
      if (process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error;
        }
      }
      const forcedChildExit = await waitForChildExit(child, shutdownTimeoutMs);
      const forcedTreeExit =
        process.platform === 'win32'
          ? forcedChildExit
          : forcedChildExit && (await waitForProcessGroupExit(child.pid, shutdownTimeoutMs));
      if (!forcedTreeExit) {
        throw new Error('Synthetic child process tree shutdown remained uncertain.');
      }
    }
  }

  child.stdout?.destroy();
  child.stderr?.destroy();
  reportDiagnostic(diagnosticStage, 'passed');
}

function assertLoopbackUrl(value, label) {
  const url = new URL(value);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${label} is not loopback.`);
  }
  return url;
}

if (process.argv.includes('--verify-non-loopback-guard')) {
  assert.throws(() => assertLoopbackUrl('https://remote.example.test', 'synthetic guard'));
  process.stdout.write('FEAT-003 non-loopback pre-mutation guard passed.\n');
  process.exit(0);
}

function safeCommandFailure(label) {
  return new Error(`${label} failed; credential-bearing process output was suppressed.`);
}

function localStatus() {
  const result = spawnSync(process.execPath, [cliPath, 'status', '-o', 'json'], {
    encoding: 'utf8',
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  if (result.status !== 0) throw safeCommandFailure('Local Supabase status');
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('Local Supabase status returned an invalid contract.');
  }
}

function inspectDatabaseContainer(expectedContainer) {
  const result = spawnSync('docker', ['inspect', expectedContainer], {
    encoding: 'utf8',
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  if (result.status !== 0) throw safeCommandFailure('Local database container inspection');
  try {
    const inspected = JSON.parse(result.stdout);
    assert.equal(inspected.length, 1);
    return inspected[0];
  } catch {
    throw new Error('Local database container inspection returned an invalid contract.');
  }
}

function psql(sql, variables = {}, tuplesOnly = false) {
  const args = ['exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres'];
  if (tuplesOnly) args.push('-At');
  for (const [name, value] of Object.entries(variables)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Unsafe psql variable name.');
    args.push('-v', `${name}=${value}`);
  }
  const result = spawnSync('docker', args, {
    input: `\\set ON_ERROR_STOP on\n${sql}`,
    encoding: 'utf8',
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  if (result.status !== 0) throw safeCommandFailure('Parameterized local PostgreSQL command');
  return result.stdout.trim();
}

function psqlMustFail(sql, variables = {}) {
  const args = ['exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres'];
  for (const [name, value] of Object.entries(variables)) {
    args.push('-v', `${name}=${value}`);
  }
  const result = spawnSync('docker', args, {
    input: `\\set ON_ERROR_STOP on\n${sql}`,
    encoding: 'utf8',
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  assert.notEqual(result.status, 0, 'The injected database failure unexpectedly succeeded.');
}

function base32Bytes(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replaceAll('=', '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Synthetic TOTP secret did not satisfy the provider contract.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function currentTotp(secret) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', base32Bytes(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function limiterHash(subjectId, action) {
  return createHmac('sha256', limiterSecret).update(`${subjectId}\0${action}`).digest('hex');
}

function browserClient() {
  return createClient(apiUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: boundedFetch },
  });
}

async function signIn(user) {
  const client = browserClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (error || !data.session) {
    throw new Error('Synthetic password sign-in failed.');
  }
  return { client, session: data.session };
}

async function promoteToAal2(signedIn) {
  const { data: enrollment, error: enrollmentError } = await signedIn.client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `FlyEye synthetic ${runId}`,
  });
  if (enrollmentError) throw new Error('Synthetic TOTP enrollment failed.');
  const { error: verifyError } = await signedIn.client.auth.mfa.challengeAndVerify({
    factorId: enrollment.id,
    code: currentTotp(enrollment.totp.secret),
  });
  if (verifyError) throw new Error('Synthetic TOTP verification failed.');
  const { data: assurance, error: assuranceError } =
    await signedIn.client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || assurance.currentLevel !== 'aal2') {
    throw new Error('Synthetic session did not reach AAL2.');
  }
  const { data } = await signedIn.client.auth.getSession();
  if (!data.session) throw new Error('Synthetic AAL2 session was unavailable.');
  return { ...signedIn, session: data.session, factorId: enrollment.id };
}

async function invokeFunction(pathname, token, body) {
  const response = await boundedFetch(`${apiUrl}/functions/v1/${pathname}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin,
    },
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Local Edge Function returned a non-JSON contract.');
  }
  return {
    status: response.status,
    payload,
    retryAfter: response.headers.get('retry-after'),
  };
}

async function invokeWithTransientRecovery(pathname, token, body) {
  let result;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = await invokeFunction(pathname, token, body);
    if (![500, 502, 503].includes(result.status)) return result;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return result;
}

function onboarding(token, body) {
  return invokeWithTransientRecovery('organization-admin-onboarding', token, body);
}

function bootstrap(token, organizationId) {
  return invokeWithTransientRecovery(
    'auth-bootstrap',
    token,
    organizationId ? { organizationId } : {},
  );
}

async function waitForEdgeRuntime() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (edgeProcess.exitCode !== null) {
      throw new Error('Local Edge Runtime stopped before readiness.');
    }
    try {
      const response = await boundedFetch(
        `${apiUrl}/functions/v1/organization-admin-onboarding`,
        { method: 'OPTIONS', headers: { origin } },
        readinessProbeTimeoutMs,
      );
      if (response.status === 204) return;
    } catch {
      // Bounded readiness retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Local Edge Runtime did not become ready.');
}

async function restartLocalAuth() {
  const authContainer = `supabase_auth_${projectId}`;
  const restart = spawnSync('docker', ['restart', authContainer], {
    encoding: 'utf8',
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  if (restart.status !== 0) throw safeCommandFailure('Local Auth scenario reset');

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await boundedFetch(`${apiUrl}/auth/v1/health`, {}, readinessProbeTimeoutMs);
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        return;
      }
    } catch {
      // Bounded local Auth readiness retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Local Auth did not recover after the scenario reset.');
}

async function createUsers() {
  for (const user of Object.values(users)) {
    const { error } = await adminClient.auth.admin.createUser({
      id: user.id,
      email: user.email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error('Synthetic local Auth user creation failed.');
  }
}

function seedFixture() {
  const variables = {
    organization_a: organizations.a,
    organization_b: organizations.b,
    organization_race: organizations.race,
    organization_ui: organizations.ui,
    first_admin: users.firstAdmin.id,
    attacker: users.attacker.id,
    existing_admin: users.existingAdmin.id,
    race_admin_one: users.raceAdminOne.id,
    race_admin_two: users.raceAdminTwo.id,
    ui_admin: users.uiAdmin.id,
    first_grant: grants.first,
    race_grant_one: grants.raceOne,
    race_grant_two: grants.raceTwo,
    ui_grant: grants.ui,
    first_membership: randomUUID(),
    existing_membership: randomUUID(),
    source_instance: sourceInstanceId,
    issuance_one: randomUUID(),
    issuance_two: randomUUID(),
    issuance_three: randomUUID(),
    issuance_four: randomUUID(),
  };

  psql(
    `
      begin;

      insert into public.organizations (id, name)
      values
        (:'organization_a'::uuid, 'FEAT-003 Synthetic School A'),
        (:'organization_b'::uuid, 'FEAT-003 Synthetic School B'),
        (:'organization_race'::uuid, 'FEAT-003 Synthetic Race School'),
        (:'organization_ui'::uuid, 'FEAT-003 Synthetic Browser School');

      insert into public.organization_memberships (
        id, organization_id, user_id, status, created_by, updated_by
      )
      values
        (
          :'first_membership'::uuid,
          :'organization_b'::uuid,
          :'first_admin'::uuid,
          'active',
          :'first_admin'::uuid,
          :'first_admin'::uuid
        ),
        (
          :'existing_membership'::uuid,
          :'organization_b'::uuid,
          :'existing_admin'::uuid,
          'active',
          :'existing_admin'::uuid,
          :'existing_admin'::uuid
        );

      insert into public.membership_roles (
        organization_id, membership_id, role_id, assigned_by
      )
      select
        mapping.organization_id,
        mapping.membership_id,
        role.id,
        mapping.assigned_by
      from (
        values
          (
            :'organization_b'::uuid,
            :'first_membership'::uuid,
            'student_pilot'::text,
            :'first_admin'::uuid
          ),
          (
            :'organization_b'::uuid,
            :'existing_membership'::uuid,
            'admin'::text,
            :'existing_admin'::uuid
          )
      ) mapping(organization_id, membership_id, role_code, assigned_by)
      join public.roles role on role.code = mapping.role_code;

      insert into public.organization_admin_bootstrap_grants (
        id,
        organization_id,
        eligible_user_id,
        issued_at,
        expires_at,
        authorization_source_kind,
        authorization_source_code,
        authorization_source_instance_id,
        issuance_correlation_id
      )
      values
        (
          :'first_grant'::uuid,
          :'organization_a'::uuid,
          :'first_admin'::uuid,
          transaction_timestamp(),
          transaction_timestamp() + interval '30 minutes',
          'local_fixture',
          'feat-003-local-cli-fixture',
          :'source_instance'::uuid,
          :'issuance_one'::uuid
        ),
        (
          :'race_grant_one'::uuid,
          :'organization_race'::uuid,
          :'race_admin_one'::uuid,
          transaction_timestamp(),
          transaction_timestamp() + interval '30 minutes',
          'local_fixture',
          'feat-003-local-cli-fixture',
          :'source_instance'::uuid,
          :'issuance_two'::uuid
        ),
        (
          :'race_grant_two'::uuid,
          :'organization_race'::uuid,
          :'race_admin_two'::uuid,
          transaction_timestamp(),
          transaction_timestamp() + interval '30 minutes',
          'local_fixture',
          'feat-003-local-cli-fixture',
          :'source_instance'::uuid,
          :'issuance_three'::uuid
        ),
        (
          :'ui_grant'::uuid,
          :'organization_ui'::uuid,
          :'ui_admin'::uuid,
          transaction_timestamp(),
          transaction_timestamp() + interval '30 minutes',
          'local_fixture',
          'feat-003-local-cli-fixture',
          :'source_instance'::uuid,
          :'issuance_four'::uuid
        );

      insert into public.authentication_events (
        organization_id,
        organization_ids,
        actor_kind,
        event_name,
        outcome,
        correlation_id,
        reason_code,
        source_code,
        source_instance_id,
        target_kind,
        target_id,
        metadata
      )
      select
        grant_row.organization_id,
        array[grant_row.organization_id],
        'local_fixture',
        'admin_bootstrap.grant_issued',
        'success',
        grant_row.issuance_correlation_id,
        'local_fixture_grant_issued',
        'feat-003-local-cli-fixture',
        :'source_instance'::uuid,
        'organization_admin_bootstrap_grant',
        grant_row.id,
        jsonb_build_object('grantVersion', grant_row.version)
      from public.organization_admin_bootstrap_grants grant_row
      where grant_row.id in (
        :'first_grant'::uuid,
        :'race_grant_one'::uuid,
        :'race_grant_two'::uuid,
        :'ui_grant'::uuid
      );

      commit;
    `,
    variables,
  );

  const postconditions = psql(
    `
      select
        (
          select count(*)
          from public.organization_admin_bootstrap_grants
          where id in (
            :'first_grant'::uuid,
            :'race_grant_one'::uuid,
            :'race_grant_two'::uuid,
            :'ui_grant'::uuid
          )
            and status = 'pending'
            and expires_at = issued_at + interval '30 minutes'
        )
        || ':'
        ||
        (
          select count(*)
          from public.authentication_events
          where source_instance_id = :'source_instance'::uuid
            and event_name = 'admin_bootstrap.grant_issued'
        );
    `,
    variables,
    true,
  );
  assert.equal(postconditions, '4:4');
}

function verifyInjectedIssuanceFailures() {
  for (const failureKind of ['grant', 'audit']) {
    const organizationId = randomUUID();
    const grantId = randomUUID();
    const correlationId = randomUUID();
    const variables = {
      organization_id: organizationId,
      grant_id: grantId,
      user_id: users.noAccess.id,
      source_instance: sourceInstanceId,
      correlation_id: correlationId,
    };
    const failingStatement =
      failureKind === 'grant'
        ? `
          insert into public.organization_admin_bootstrap_grants (
            id, organization_id, eligible_user_id, issued_at, expires_at,
            authorization_source_kind, authorization_source_code,
            authorization_source_instance_id,
            issuance_correlation_id
          )
          values (
            :'grant_id'::uuid, :'organization_id'::uuid, :'user_id'::uuid,
            transaction_timestamp(), transaction_timestamp() + interval '30 minutes',
            'local_fixture', 'invalid-source', :'source_instance'::uuid,
            :'correlation_id'::uuid
          );
        `
        : `
          insert into public.organization_admin_bootstrap_grants (
            id, organization_id, eligible_user_id, issued_at, expires_at,
            authorization_source_kind, authorization_source_code,
            authorization_source_instance_id, issuance_correlation_id
          )
          values (
            :'grant_id'::uuid, :'organization_id'::uuid, :'user_id'::uuid,
            transaction_timestamp(), transaction_timestamp() + interval '30 minutes',
            'local_fixture', 'feat-003-local-cli-fixture',
            :'source_instance'::uuid, :'correlation_id'::uuid
          );

          insert into public.authentication_events (
            organization_id, organization_ids, actor_kind, event_name, outcome,
            correlation_id, reason_code, source_code, source_instance_id,
            target_kind, target_id, metadata
          )
          values (
            :'organization_id'::uuid, array[:'organization_id'::uuid], 'local_fixture',
            'admin_bootstrap.grant_issued', 'denied', :'correlation_id'::uuid,
            'local_fixture_grant_issued', 'feat-003-local-cli-fixture',
            :'source_instance'::uuid, 'organization_admin_bootstrap_grant',
            :'grant_id'::uuid, '{}'::jsonb
          );
        `;

    psqlMustFail(
      `
        begin;
        insert into public.organizations (id, name)
        values (:'organization_id'::uuid, 'FEAT-003 Injected Failure School');
        ${failingStatement}
        commit;
      `,
      variables,
    );

    const remaining = psql(
      `
        select
          (
            select count(*) from public.organizations
            where id = :'organization_id'::uuid
          )
          +
          (
            select count(*) from public.organization_admin_bootstrap_grants
            where id = :'grant_id'::uuid
          )
          +
          (
            select count(*) from public.authentication_events
            where correlation_id = :'correlation_id'::uuid
          );
      `,
      variables,
      true,
    );
    assert.equal(remaining, '0');
  }
}

async function createVerifiedRaceActor(user) {
  return promoteToAal2(await signIn(user));
}

async function runBrowserOnboarding() {
  enterStage('browser-frontend-startup', 'browser frontend startup');
  const viteProcess = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173'],
    {
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        VITE_SUPABASE_URL: apiUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const suppressedViteOutput = [];
  viteProcess.stdout.on('data', (chunk) => {
    if (suppressedViteOutput.length < 16) suppressedViteOutput.push(chunk.byteLength);
  });
  viteProcess.stderr.on('data', (chunk) => {
    if (suppressedViteOutput.length < 16) suppressedViteOutput.push(chunk.byteLength);
  });

  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (viteProcess.exitCode !== null) {
        throw new Error('Local frontend stopped before readiness.');
      }
      try {
        const response = await boundedFetch(origin);
        if (response.ok) break;
      } catch {
        // Bounded local frontend readiness retry.
      }
      if (attempt === 59) throw new Error('Local frontend did not become ready.');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    enterStage('browser-launch', 'browser launch');
    const browser = await chromium.launch({
      channel: process.platform === 'win32' ? 'msedge' : undefined,
      headless: true,
    });
    try {
      const page = await browser.newPage({ viewport: { width: 393, height: 851 } });
      const consoleMessages = [];
      const authNetworkStatuses = [];
      page.on('console', (message) => {
        consoleMessages.push(message.text());
      });
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (LOOPBACK_HOSTS.has(url.hostname) && url.pathname.startsWith('/auth/v1/')) {
          authNetworkStatuses.push(
            `${response.request().method()} ${url.pathname} ${response.status()}`,
          );
        }
      });

      enterStage('browser-sign-in', 'browser administrator sign-in');
      await page.goto(origin);
      await page.getByLabel('Email address').fill(users.uiAdmin.email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in securely' }).click();

      stage = 'browser onboarding heading lookup';
      const heading = page.getByRole('heading', { name: 'Set up your authenticator' });
      enterStage('browser-onboarding-ready', 'browser onboarding heading wait');
      try {
        await heading.waitFor({ timeout: 10_000 });
      } catch {
        const [headingTexts, alertTexts] = await Promise.allSettled([
          page.locator('h2').allTextContents(),
          page.getByRole('alert').allTextContents(),
        ]);
        const summarizeVisibleText = (result) =>
          result.status === 'fulfilled'
            ? result.value
                .map((value) => value.trim())
                .filter(Boolean)
                .join('|')
                .slice(0, 240) || 'none'
            : 'unavailable';
        const visibleHeadings = summarizeVisibleText(headingTexts);
        const visibleAlerts = summarizeVisibleText(alertTexts);
        stage =
          `browser onboarding heading wait headings(${visibleHeadings}) ` +
          `alerts(${visibleAlerts}) ` +
          `auth-statuses(${authNetworkStatuses.slice(-12).join('|') || 'none'})`;
        throw new Error('Browser onboarding did not reach the expected safe heading.');
      }
      stage = 'browser onboarding heading focus';
      const headingHandle = await heading.elementHandle();
      assert.ok(headingHandle);
      await page.waitForFunction(
        (element) => element === globalThis.document.activeElement,
        headingHandle,
        { timeout: 2_000 },
      );
      await headingHandle.dispose();
      const codeInput = page.getByLabel('Verification code');
      stage = 'browser onboarding verification input mode';
      assert.equal(await codeInput.getAttribute('inputmode'), 'numeric');
      stage = 'browser onboarding verification autocomplete';
      assert.equal(await codeInput.getAttribute('autocomplete'), 'one-time-code');
      stage = 'browser onboarding verification length';
      assert.equal(await codeInput.getAttribute('maxlength'), '6');

      stage = 'browser accessible enrollment credential';
      await page.getByRole('button', { name: 'Show manual setup key' }).click();
      const secretElement = page.locator('.manual-secret');
      const secret = (await secretElement.textContent())?.trim();
      assert.ok(secret);
      await codeInput.fill(currentTotp(secret));
      enterStage('browser-totp-completion', 'browser TOTP completion');
      await page.getByRole('button', { name: 'Verify and create administrator' }).click();
      await page.getByRole('heading', { name: 'Administration workspace' }).waitFor();

      stage = 'browser secret removal and responsive checks';
      assert.equal(await page.locator('.manual-secret').count(), 0);
      assert.equal(await page.getByAltText('Authenticator setup QR code').count(), 0);
      assert.equal(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.document.documentElement.clientWidth,
        ),
        true,
      );
      assert.equal(
        consoleMessages.some(
          (message) =>
            message.includes(secret) ||
            message.includes('otpauth://') ||
            message.includes('service_role'),
        ),
        false,
      );
      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    await stopChild(viteProcess, 'browser-frontend-shutdown', 'browser frontend shutdown');
  }
}

async function cleanup() {
  const userIds = Object.values(users).map((user) => user.id);
  const userVariables = Object.fromEntries(userIds.map((id, index) => [`user_${index}`, id]));
  const userValues = userIds.map((_id, index) => `:'user_${index}'::uuid`);
  const baselineStateVariables = Object.fromEntries(
    baselineLimiterState.map((entry, index) => [`baseline_state_${index}`, entry]),
  );
  const baselineEventVariables = Object.fromEntries(
    baselineLimiterEvents.map((id, index) => [`baseline_event_${index}`, id]),
  );
  const stateCleanupPredicate = baselineLimiterState.length
    ? `limiter_key_hash || ':' || action not in (${baselineLimiterState
        .map((_entry, index) => `:'baseline_state_${index}'`)
        .join(', ')})`
    : 'true';
  const eventCleanupPredicate = baselineLimiterEvents.length
    ? `id not in (${baselineLimiterEvents
        .map((_id, index) => `:'baseline_event_${index}'::uuid`)
        .join(', ')})`
    : 'true';

  psql(
    `
      begin;
      delete from public.admin_onboarding_rate_limit_events
      where ${eventCleanupPredicate};
      delete from public.admin_onboarding_rate_limit_state
      where ${stateCleanupPredicate};
      delete from public.authentication_events
      where source_instance_id = :'source_instance'::uuid
         or actor_subject_id in (${userValues.join(', ')});
      delete from public.membership_roles
      where organization_id in (
        :'organization_a'::uuid,
        :'organization_b'::uuid,
        :'organization_race'::uuid,
        :'organization_ui'::uuid
      );
      delete from public.organization_admin_bootstrap_grants
      where authorization_source_instance_id = :'source_instance'::uuid;
      delete from public.organization_memberships
      where organization_id in (
        :'organization_a'::uuid,
        :'organization_b'::uuid,
        :'organization_race'::uuid,
        :'organization_ui'::uuid
      );
      delete from public.organizations
      where id in (
        :'organization_a'::uuid,
        :'organization_b'::uuid,
        :'organization_race'::uuid,
        :'organization_ui'::uuid
      );
      commit;
    `,
    {
      ...baselineStateVariables,
      ...baselineEventVariables,
      ...userVariables,
      source_instance: sourceInstanceId,
      organization_a: organizations.a,
      organization_b: organizations.b,
      organization_race: organizations.race,
      organization_ui: organizations.ui,
    },
  );

  assert.equal(
    psql(
      `
        select limiter_key_hash || ':' || action
        from public.admin_onboarding_rate_limit_state
        order by limiter_key_hash, action;
      `,
      {},
      true,
    ),
    baselineLimiterState.join('\n'),
  );
  assert.equal(
    psql(
      `
        select id::text
        from public.admin_onboarding_rate_limit_events
        order by id;
      `,
      {},
      true,
    ),
    baselineLimiterEvents.join('\n'),
  );

  for (const user of Object.values(users)) {
    const { error } = await adminClient.auth.admin.deleteUser(user.id);
    if (error && error.status !== 404) {
      throw new Error('Synthetic local Auth cleanup failed.');
    }
  }
}

for (const marker of linkedMarkers) {
  if (existsSync(marker)) throw new Error('A linked or ambiguous Supabase marker is present.');
}

const config = readFileSync(configPath, 'utf8');
const projectId = /^project_id\s*=\s*"([a-z0-9_-]+)"\s*$/m.exec(config)?.[1];
if (!projectId) throw new Error('Local Supabase project identity is unavailable.');

const local = localStatus();
const apiUrl = local.API_URL;
const databaseUrl = local.DB_URL;
const publishableKey = local.PUBLISHABLE_KEY ?? local.ANON_KEY;
const serviceRoleKey = local.SERVICE_ROLE_KEY;
if (![apiUrl, databaseUrl, publishableKey, serviceRoleKey].every((value) => value)) {
  throw new Error('Local Supabase administrative contract is incomplete.');
}

const api = assertLoopbackUrl(apiUrl, 'Local API');
const database = assertLoopbackUrl(databaseUrl, 'Local database');
const databaseContainer = `supabase_db_${projectId}`;
const inspected = inspectDatabaseContainer(databaseContainer);
assert.equal(inspected.Name, `/${databaseContainer}`);
assert.equal(inspected.Config.Labels?.['com.supabase.cli.project'], projectId);
const boundDatabasePort = inspected.HostConfig.PortBindings?.['5432/tcp']?.[0]?.HostPort;
assert.equal(String(boundDatabasePort), database.port);
assert.ok(api.port);

const baselineLimiterState = psql(
  `
    select limiter_key_hash || ':' || action
    from public.admin_onboarding_rate_limit_state
    order by limiter_key_hash, action;
  `,
  {},
  true,
)
  .split(/\r?\n/)
  .filter(Boolean);
const baselineLimiterEvents = psql(
  `
    select id::text
    from public.admin_onboarding_rate_limit_events
    order by id;
  `,
  {},
  true,
)
  .split(/\r?\n/)
  .filter(Boolean);

const nonLoopbackGuard = spawnSync(
  process.execPath,
  [process.argv[1], '--verify-non-loopback-guard'],
  { encoding: 'utf8', timeout: commandTimeoutMs, windowsHide: true },
);
assert.equal(nonLoopbackGuard.status, 0);

const runId = randomBytes(6).toString('hex');
const password = `Synthetic-${randomBytes(18).toString('base64url')}!`;
const sourceInstanceId = randomUUID();
const limiterSecret = randomBytes(48).toString('base64url');
const organizations = {
  a: randomUUID(),
  b: randomUUID(),
  race: randomUUID(),
  ui: randomUUID(),
};
const grants = {
  first: randomUUID(),
  raceOne: randomUUID(),
  raceTwo: randomUUID(),
  ui: randomUUID(),
};
const users = Object.fromEntries(
  [
    'firstAdmin',
    'attacker',
    'existingAdmin',
    'raceAdminOne',
    'raceAdminTwo',
    'uiAdmin',
    'noAccess',
  ].map((name) => [
    name,
    {
      id: randomUUID(),
      email: `${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-${runId}@example.test`,
    },
  ]),
);

const adminClient = createClient(apiUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: boundedFetch },
});

try {
  enterStage('auth-reset-initial', 'local Auth initial scenario reset');
  await restartLocalAuth();

  enterStage('identity-creation', 'synthetic identity creation');
  cleanupRequired = true;
  await createUsers();

  enterStage('fixture-failure-injection', 'fixture failure injection');
  verifyInjectedIssuanceFailures();

  enterStage('fixture-issuance', 'atomic fixture issuance');
  seedFixture();

  enterStage('edge-runtime-startup', 'ephemeral Edge secret startup');
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'flyeye-feat003-'));
  const environmentPath = path.join(temporaryDirectory, 'edge.env');
  writeFileSync(
    environmentPath,
    `FEAT003_LIMITER_HMAC_SECRET=${limiterSecret}\nALLOWED_ORIGIN=${origin}\nFLYEYE_RUNTIME_PROFILE=local-synthetic-v1\nFEAT003_LIMITER_POLICY_VERSION=subject-action-v1\nFEAT003_DATA_CLASSIFICATION=synthetic-only\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  edgeProcess = spawn(
    cliBinaryPath,
    ['functions', 'serve', '--env-file', environmentPath, '--log-level', 'error'],
    {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const suppressedOutput = [];
  edgeProcess.stdout.on('data', (chunk) => {
    if (suppressedOutput.length < 32) suppressedOutput.push(chunk.byteLength);
  });
  edgeProcess.stderr.on('data', (chunk) => {
    if (suppressedOutput.length < 32) suppressedOutput.push(chunk.byteLength);
  });
  await waitForEdgeRuntime();

  enterStage('first-admin-status', 'first-admin status and tenant isolation');
  const firstAdminAal1 = await signIn(users.firstAdmin);
  const firstStatus = await onboarding(firstAdminAal1.session.access_token, {
    action: 'status',
  });
  if (firstStatus.status !== 200) {
    const safeCode =
      typeof firstStatus.payload?.error?.code === 'string'
        ? firstStatus.payload.error.code
        : 'unknown';
    stage = `first-admin status HTTP ${firstStatus.status} ${safeCode}`;
    throw new Error('First-admin status returned a safe failure contract.');
  }
  stage = 'first-admin status payload';
  assert.equal(firstStatus.payload.grants.length, 1);
  assert.equal(firstStatus.payload.grants[0].bootstrapGrantId, grants.first);
  assert.equal(firstStatus.payload.grants[0].organizationId, organizations.a);

  stage = 'first-admin pre-completion membership';
  const initialContext = await bootstrap(firstAdminAal1.session.access_token);
  const initialMemberships = Array.isArray(initialContext.payload?.memberships)
    ? initialContext.payload.memberships
    : [];
  if (
    initialContext.status !== 200 ||
    initialMemberships.length !== 1 ||
    initialMemberships[0]?.organizationId !== organizations.b ||
    initialMemberships[0]?.role !== 'student_pilot'
  ) {
    const safeCode =
      typeof initialContext.payload?.error?.code === 'string'
        ? initialContext.payload.error.code
        : 'none';
    const safeRoles = initialMemberships
      .map((membership) => (typeof membership?.role === 'string' ? membership.role : 'invalid'))
      .join(',');
    stage =
      `first-admin pre-completion membership HTTP ${initialContext.status} ` +
      `code(${safeCode}) count(${initialMemberships.length}) roles(${safeRoles || 'none'})`;
    throw new Error('Initial access context returned an unexpected safe contract.');
  }

  stage = 'attacker empty status';
  const attacker = await signIn(users.attacker);
  const attackerStatus = await onboarding(attacker.session.access_token, {
    action: 'status',
  });
  assert.equal(attackerStatus.status, 200);
  assert.deepEqual(attackerStatus.payload.grants, []);
  stage = 'attacker direct grant identifier';
  const crossTenantStart = await onboarding(attacker.session.access_token, {
    action: 'start',
    bootstrapGrantId: grants.first,
    expectedVersion: 1,
    idempotencyKey: randomBytes(16).toString('hex'),
  });
  assert.equal(crossTenantStart.status, 404);

  stage = 'browser-role direct table denial';
  const directTable = await boundedFetch(
    `${apiUrl}/rest/v1/organization_admin_bootstrap_grants?select=id`,
    {
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${attacker.session.access_token}`,
      },
    },
  );
  assert.notEqual(directTable.status, 200);
  stage = 'browser-role direct RPC denial';
  const directRpc = await boundedFetch(
    `${apiUrl}/rest/v1/rpc/complete_first_organization_admin_bootstrap`,
    {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${attacker.session.access_token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    },
  );
  assert.notEqual(directRpc.status, 200);

  enterStage('first-admin-start', 'first-admin start');
  const firstStartKey = randomBytes(16).toString('hex');
  const firstStart = await onboarding(firstAdminAal1.session.access_token, {
    action: 'start',
    bootstrapGrantId: grants.first,
    expectedVersion: 1,
    idempotencyKey: firstStartKey,
  });
  if (firstStart.status !== 200) {
    const safeCode =
      typeof firstStart.payload?.error?.code === 'string'
        ? firstStart.payload.error.code
        : 'unknown';
    stage = `first-admin start HTTP ${firstStart.status} ${safeCode}`;
    throw new Error('First-admin start returned a safe failure contract.');
  }
  assert.equal(firstStart.payload.factorState, 'enrollment_required');

  enterStage('first-admin-totp', 'first-admin TOTP enrollment');
  const firstAdminAal2 = await promoteToAal2(firstAdminAal1);
  enterStage('first-admin-completion', 'first-admin completion');
  const firstCompleteKey = randomBytes(16).toString('hex');
  const firstComplete = await onboarding(firstAdminAal2.session.access_token, {
    action: 'complete',
    bootstrapGrantId: grants.first,
    expectedVersion: 1,
    idempotencyKey: firstCompleteKey,
  });
  if (firstComplete.status !== 200) {
    const safeCode =
      typeof firstComplete.payload?.error?.code === 'string'
        ? firstComplete.payload.error.code
        : 'unknown';
    stage = `first-admin completion HTTP ${firstComplete.status} ${safeCode}`;
    throw new Error('First-admin completion returned a safe failure contract.');
  }
  assert.equal(firstComplete.payload.decision, 'completed');
  enterStage('first-admin-bootstrap', 'first-admin final bootstrap');
  const finalContext = await bootstrap(firstAdminAal2.session.access_token, organizations.a);
  assert.equal(finalContext.status, 200);
  assert.equal(finalContext.payload.decision, 'granted');
  assert.equal(finalContext.payload.memberships[0].role, 'admin');

  enterStage('browser-onboarding', 'real browser onboarding and accessibility');
  await runBrowserOnboarding();

  enterStage('completion-race', 'organization-serialized completion race');
  const [raceOne, raceTwo] = await Promise.all([
    createVerifiedRaceActor(users.raceAdminOne),
    createVerifiedRaceActor(users.raceAdminTwo),
  ]);
  for (const [actor, grant] of [
    [raceOne, grants.raceOne],
    [raceTwo, grants.raceTwo],
  ]) {
    const startResult = await onboarding(actor.session.access_token, {
      action: 'start',
      bootstrapGrantId: grant,
      expectedVersion: 1,
      idempotencyKey: randomBytes(16).toString('hex'),
    });
    assert.equal(startResult.status, 200);
  }
  const raceKeys = [randomBytes(16).toString('hex'), randomBytes(16).toString('hex')];
  const raceResults = await Promise.all([
    onboarding(raceOne.session.access_token, {
      action: 'complete',
      bootstrapGrantId: grants.raceOne,
      expectedVersion: 1,
      idempotencyKey: raceKeys[0],
    }),
    onboarding(raceTwo.session.access_token, {
      action: 'complete',
      bootstrapGrantId: grants.raceTwo,
      expectedVersion: 1,
      idempotencyKey: raceKeys[1],
    }),
  ]);
  assert.deepEqual(raceResults.map((result) => result.status).sort(), [200, 409]);
  const raceMembershipCount = psql(
    `
      select count(*)
      from public.organization_memberships membership
      join public.membership_roles membership_role
        on membership_role.organization_id = membership.organization_id
       and membership_role.membership_id = membership.id
      join public.roles role on role.id = membership_role.role_id
      where membership.organization_id = :'organization_id'::uuid
        and membership.status = 'active'
        and role.code = 'admin';
    `,
    { organization_id: organizations.race },
    true,
  );
  assert.equal(raceMembershipCount, '1');

  enterStage('auth-reset-limiter', 'local Auth scenario reset before limiter evidence');
  await restartLocalAuth();
  enterStage('limiter-burst', 'protected action paths and status limiter burst');
  const noAccess = await signIn(users.noAccess);
  const limiterRequests = {
    status: () => onboarding(noAccess.session.access_token, { action: 'status' }),
    start: () =>
      onboarding(noAccess.session.access_token, {
        action: 'start',
        bootstrapGrantId: randomUUID(),
        expectedVersion: 1,
        idempotencyKey: randomBytes(16).toString('hex'),
      }),
    complete: () =>
      onboarding(noAccess.session.access_token, {
        action: 'complete',
        bootstrapGrantId: randomUUID(),
        expectedVersion: 1,
        idempotencyKey: randomBytes(16).toString('hex'),
      }),
    cancel: () =>
      onboarding(noAccess.session.access_token, {
        action: 'cancel',
        bootstrapGrantId: randomUUID(),
        idempotencyKey: randomBytes(16).toString('hex'),
      }),
  };
  for (let index = 0; index < 4; index += 1) {
    const allowed = await limiterRequests.status();
    assert.notEqual(allowed.status, 429);
  }
  const limited = await limiterRequests.status();
  assert.equal(limited.status, 429);
  assert.match(limited.retryAfter ?? '', /^\d+$/);
  assert.equal((await limiterRequests.start()).status, 404);
  assert.equal((await limiterRequests.complete()).status, 403);
  assert.equal((await limiterRequests.cancel()).status, 404);

  enterStage('limiter-recovery', '60-second limiter recovery');
  for (let elapsed = 0; elapsed < 60; elapsed += 15) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  const recoveredStatus = await limiterRequests.status();
  assert.notEqual(recoveredStatus.status, 429);

  enterStage('completion-replay', 'completion replay after limiter recovery');
  const firstReplay = await onboarding(firstAdminAal2.session.access_token, {
    action: 'complete',
    bootstrapGrantId: grants.first,
    expectedVersion: 1,
    idempotencyKey: firstCompleteKey,
  });
  assert.equal(firstReplay.status, 200);
  assert.equal(firstReplay.payload.decision, 'already_completed');

  const winningRaceIndex = raceResults.findIndex((result) => result.status === 200);
  const winningRaceActor = [raceOne, raceTwo][winningRaceIndex];
  const winningRaceGrant = [grants.raceOne, grants.raceTwo][winningRaceIndex];
  const winningRaceReplay = await onboarding(winningRaceActor.session.access_token, {
    action: 'complete',
    bootstrapGrantId: winningRaceGrant,
    expectedVersion: 1,
    idempotencyKey: raceKeys[winningRaceIndex],
  });
  assert.equal(winningRaceReplay.status, 200);
  assert.equal(winningRaceReplay.payload.decision, 'already_completed');

  enterStage('privacy-evidence', 'privacy-minimized audit and limiter evidence');
  const prohibitedPersistedFields = psql(
    `
      select count(*)
      from public.authentication_events
      where (
        source_instance_id = :'source_instance'::uuid
        or actor_subject_id in (
          :'first_admin'::uuid,
          :'attacker'::uuid,
          :'race_one'::uuid,
          :'race_two'::uuid,
          :'ui_admin'::uuid,
          :'no_access'::uuid
        )
      )
        and (
          metadata ? 'password'
          or metadata ? 'totpCode'
          or metadata ? 'totpSecret'
          or metadata ? 'qrCode'
          or metadata ? 'provisioningUri'
          or metadata ? 'email'
          or metadata ? 'token'
          or metadata ? 'ip'
          or metadata ? 'headers'
        );
    `,
    {
      source_instance: sourceInstanceId,
      first_admin: users.firstAdmin.id,
      attacker: users.attacker.id,
      race_one: users.raceAdminOne.id,
      race_two: users.raceAdminTwo.id,
      ui_admin: users.uiAdmin.id,
      no_access: users.noAccess.id,
    },
    true,
  );
  assert.equal(prohibitedPersistedFields, '0');
  const networkSourceCount = psql(
    `
      select count(*)
      from public.admin_onboarding_rate_limit_events
      where limiter_key_hash in (
        :'status_key',
        :'start_key',
        :'complete_key',
        :'cancel_key'
      )
        and network_source_used;
    `,
    {
      status_key: limiterHash(users.noAccess.id, 'status'),
      start_key: limiterHash(users.noAccess.id, 'start'),
      complete_key: limiterHash(users.noAccess.id, 'complete'),
      cancel_key: limiterHash(users.noAccess.id, 'cancel'),
    },
    true,
  );
  assert.equal(networkSourceCount, '0');

  enterStage('fixture-cleanup', 'bounded cleanup');
  await cleanup();
  cleanupComplete = true;
  cleanupRequired = false;
  reportDiagnostic('fixture-cleanup', 'passed');
  reportDiagnostic('fixture-assertions', 'passed');

  process.stdout.write(
    'FEAT-003 sanitized local fixture, Auth/TOTP/Edge, tenant, atomicity, race, replay, limiter, recovery, privacy, and cleanup evidence passed.\n',
  );
} catch {
  process.stderr.write(`FEAT-003 runtime evidence failed at sanitized stage: ${stage}.\n`);
  process.exitCode = 1;
} finally {
  try {
    await stopChild(edgeProcess, 'edge-runtime-shutdown', 'ephemeral Edge runtime shutdown');
  } catch {
    process.stderr.write('FEAT-003 Edge runtime shutdown uncertainty: evidence run is invalid.\n');
    process.exitCode = 1;
  }
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  if (cleanupRequired && !cleanupComplete) {
    try {
      await cleanup();
      cleanupComplete = true;
      cleanupRequired = false;
    } catch {
      process.stderr.write('FEAT-003 cleanup uncertainty: local evidence run is invalid.\n');
      process.exitCode = 1;
    }
  }
}
