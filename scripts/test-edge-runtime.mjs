import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';

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
const apiHost = new URL(apiUrl).hostname;
if (!['127.0.0.1', 'localhost'].includes(apiHost)) {
  throw new Error('The Edge integration test is restricted to the local Supabase stack.');
}

const origin = 'http://127.0.0.1:5173';
const runId = randomBytes(6).toString('hex');
const password = `Synthetic-${randomBytes(16).toString('base64url')}!`;
const organizationA = randomUUID();
const organizationB = randomUUID();
const users = {
  student: { id: randomUUID(), email: `student-${runId}@example.test` },
  instructor: { id: randomUUID(), email: `instructor-${runId}@example.test` },
  mixed: { id: randomUUID(), email: `mixed-${runId}@example.test` },
  suspended: { id: randomUUID(), email: `suspended-${runId}@example.test` },
  revoked: { id: randomUUID(), email: `revoked-${runId}@example.test` },
};

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

const baselineLimiterState = psql(
  `
    select limiter_key_hash || ':' || action
    from public.admin_onboarding_rate_limit_state
    order by limiter_key_hash, action;
  `,
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
  true,
)
  .split(/\r?\n/)
  .filter(Boolean);
assert.ok(
  baselineLimiterState.every((entry) =>
    /^[0-9a-f]{64}:(status|start|complete|cancel)$/.test(entry),
  ),
);
assert.ok(
  baselineLimiterEvents.every((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
  ),
);

function base32Bytes(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replaceAll('=', '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('The local TOTP secret is invalid.');
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
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Bytes(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function signIn(user) {
  const client = createClient(apiUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password });
  if (error || !data.session)
    throw error ?? new Error('Synthetic sign-in did not return a session.');
  return { client, token: data.session.access_token };
}

async function invoke(token, body = '{}', additional = {}) {
  return fetch(`${apiUrl}/functions/v1/auth-bootstrap`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin,
      ...(additional.headers ?? {}),
    },
    body: additional.body ?? body,
    duplex: additional.duplex,
  });
}

async function context(token, body = {}) {
  const response = await invoke(token, JSON.stringify(body));
  assert.equal(response.status, 200);
  return response.json();
}

async function promoteToAal2(client) {
  const { data: enrollment, error: enrollmentError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `FlyEye integration ${runId}`,
  });
  if (enrollmentError) throw enrollmentError;
  const { error } = await client.auth.mfa.challengeAndVerify({
    factorId: enrollment.id,
    code: currentTotp(enrollment.totp.secret),
  });
  if (error) throw error;
  const { data: assurance, error: assuranceError } =
    await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw assuranceError;
  assert.equal(assurance.currentLevel, 'aal2');
  const { data: sessionData } = await client.auth.getSession();
  assert.ok(sessionData.session?.access_token);
  return { token: sessionData.session.access_token, secret: enrollment.totp.secret };
}

async function runFrontendIntegration(instructorTotpSecret) {
  const vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173'],
    {
      env: {
        ...process.env,
        VITE_SUPABASE_URL: apiUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch('http://127.0.0.1:5173');
        if (response.ok) break;
      } catch {
        // Bounded startup retry.
      }
      if (attempt === 59) throw new Error('The local frontend integration server did not start.');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const browser = await chromium.launch({
      channel: process.platform === 'win32' ? 'msedge' : undefined,
      headless: true,
    });
    try {
      const studentPage = await browser.newPage();
      await studentPage.goto('http://127.0.0.1:5173');
      await studentPage.getByLabel('Email address').fill(users.student.email);
      await studentPage.getByLabel('Password', { exact: true }).fill(password);
      await studentPage.getByRole('button', { name: 'Sign in securely' }).click();
      await studentPage.getByRole('heading', { name: 'Student workspace' }).waitFor();
      await studentPage.waitForLoadState('networkidle');
      await studentPage.close();

      const instructorPage = await browser.newPage();
      await instructorPage.goto('http://127.0.0.1:5173');
      await instructorPage.getByLabel('Email address').fill(users.instructor.email);
      await instructorPage.getByLabel('Password', { exact: true }).fill(password);
      await instructorPage.getByRole('button', { name: 'Sign in securely' }).click();
      await instructorPage.getByRole('heading', { name: 'Verify your identity' }).waitFor();
      await instructorPage.getByLabel('Verification code').fill(currentTotp(instructorTotpSecret));
      await instructorPage.getByRole('button', { name: 'Verify and continue' }).click();
      await instructorPage.getByRole('heading', { name: 'Instructor workspace' }).waitFor();
      await instructorPage.waitForLoadState('networkidle');
      await instructorPage.close();
    } finally {
      await browser.close();
    }
  } finally {
    vite.kill();
  }
}

async function createSyntheticUsers() {
  for (const user of Object.values(users)) {
    const { error } = await adminClient.auth.admin.createUser({
      id: user.id,
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: { role: 'admin', organization_id: organizationB },
    });
    if (error) throw error;
  }
}

function seedAccess() {
  psql(`
    insert into public.organizations (id, name) values
      ('${organizationA}', 'Runtime Flight School ${runId}');

    with memberships(id, organization_id, user_id, status, role_code) as (
      values
        ('${randomUUID()}'::uuid, '${organizationA}'::uuid, '${users.student.id}'::uuid, 'active', 'student_pilot'),
        ('${randomUUID()}'::uuid, '${organizationA}'::uuid, '${users.instructor.id}'::uuid, 'active', 'instructor_pilot'),
        ('${randomUUID()}'::uuid, '${organizationA}'::uuid, '${users.mixed.id}'::uuid, 'active', 'admin'),
        ('${randomUUID()}'::uuid, '${organizationA}'::uuid, '${users.suspended.id}'::uuid, 'suspended', 'student_pilot'),
        ('${randomUUID()}'::uuid, '${organizationA}'::uuid, '${users.revoked.id}'::uuid, 'revoked', 'student_pilot')
    ), inserted as (
      insert into public.organization_memberships (id, organization_id, user_id, status)
      select id, organization_id, user_id, status from memberships
      returning id, organization_id
    )
    insert into public.membership_roles (organization_id, membership_id, role_id)
    select memberships.organization_id, memberships.id, roles.id
    from memberships
    join inserted using (id, organization_id)
    join public.roles roles on roles.code = memberships.role_code;
  `);
}

function assertSingleAudit(contextResponse, expected) {
  const row = psql(
    `select count(*) || ':' || min(event_name) || ':' || min(outcome) || ':' || min(reason_code)
     from public.authentication_events where correlation_id = '${contextResponse.correlationId}';`,
    true,
  );
  assert.equal(row, `1:${expected.eventName}:${expected.outcome}:${expected.reason}`);
}

async function cleanup() {
  const stateCleanupPredicate = baselineLimiterState.length
    ? `limiter_key_hash || ':' || action not in (${baselineLimiterState
        .map((entry) => `'${entry}'`)
        .join(', ')})`
    : 'true';
  const eventCleanupPredicate = baselineLimiterEvents.length
    ? `id not in (${baselineLimiterEvents.map((id) => `'${id}'::uuid`).join(', ')})`
    : 'true';

  psql(`
    begin;
    delete from public.admin_onboarding_rate_limit_events where ${eventCleanupPredicate};
    delete from public.admin_onboarding_rate_limit_state where ${stateCleanupPredicate};
    delete from public.authentication_events
    where actor_subject_id in (${Object.values(users)
      .map((user) => `'${user.id}'::uuid`)
      .join(', ')});
    delete from public.organization_member_profiles
    where organization_id = '${organizationA}';
    delete from public.membership_roles where organization_id = '${organizationA}';
    delete from public.organization_memberships where organization_id = '${organizationA}';
    delete from public.organizations where id = '${organizationA}';
    commit;
  `);
  assert.equal(
    psql(
      `
        select limiter_key_hash || ':' || action
        from public.admin_onboarding_rate_limit_state
        order by limiter_key_hash, action;
      `,
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
      true,
    ),
    baselineLimiterEvents.join('\n'),
  );
  for (const user of Object.values(users)) {
    await adminClient.auth.admin.deleteUser(user.id);
  }
}

try {
  await createSyntheticUsers();
  seedAccess();

  const preflight = await fetch(`${apiUrl}/functions/v1/auth-bootstrap`, {
    method: 'OPTIONS',
    headers: { origin },
  });
  assert.equal(preflight.status, 204);

  const anonymous = await fetch(`${apiUrl}/functions/v1/auth-bootstrap`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'content-type': 'application/json', origin },
    body: '{}',
  });
  assert.equal(anonymous.status, 401);
  const publicSignup = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `blocked-${runId}@example.test`, password }),
  });
  assert.notEqual(publicSignup.status, 200);
  const invalidJwt = await invoke('invalid.jwt.token');
  assert.equal(invalidJwt.status, 401);

  const student = await signIn(users.student);
  const studentContext = await context(student.token);
  assert.equal(studentContext.decision, 'granted');
  assert.equal(studentContext.memberships[0].role, 'student_pilot');
  assertSingleAudit(studentContext, {
    eventName: 'authentication.access_context_loaded',
    outcome: 'success',
    reason: 'access_context_granted',
  });
  const schoolSelection = await invoke(
    student.token,
    JSON.stringify({ organizationId: organizationB }),
  );
  assert.equal(schoolSelection.status, 422);

  const directList = await fetch(`${apiUrl}/rest/v1/organizations?select=id`, {
    headers: { apikey: publishableKey, authorization: `Bearer ${student.token}` },
  });
  assert.notEqual(directList.status, 200);
  const directRpc = await fetch(`${apiUrl}/rest/v1/rpc/resolve_auth_access_context`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${student.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      p_actor_user_id: users.student.id,
      p_assurance_level: 'aal2',
      p_selected_organization_id: organizationB,
    }),
  });
  assert.notEqual(directRpc.status, 200);

  const instructor = await signIn(users.instructor);
  const instructorAal1 = await context(instructor.token);
  assert.equal(instructorAal1.decision, 'mfa_required');
  assert.equal(instructorAal1.memberships[0].accessStatus, 'mfa_required');
  assertSingleAudit(instructorAal1, {
    eventName: 'authentication.access_denied',
    outcome: 'denied',
    reason: 'mfa_required',
  });
  const { data: factorsBefore } = await instructor.client.auth.mfa.listFactors();
  assert.equal(
    factorsBefore.totp.some((factor) => factor.status === 'verified'),
    false,
  );
  const instructorAal2Session = await promoteToAal2(instructor.client);
  const instructorAal2 = await context(instructorAal2Session.token);
  assert.equal(instructorAal2.decision, 'granted');

  const mixed = await signIn(users.mixed);
  const adminAal1 = await context(mixed.token);
  assert.equal(adminAal1.memberships.length, 1);
  assert.equal(adminAal1.decision, 'mfa_required');
  const mixedAal2Session = await promoteToAal2(mixed.client);
  const adminAal2 = await context(mixedAal2Session.token);
  assert.equal(adminAal2.decision, 'granted');
  assert.equal(adminAal2.memberships[0].role, 'admin');

  for (const user of [users.suspended, users.revoked]) {
    const session = await signIn(user);
    const denied = await context(session.token);
    assert.equal(denied.decision, 'denied');
    assert.equal(denied.memberships.length, 0);
  }

  const oversized = JSON.stringify({ padding: 'x'.repeat(3000) });
  assert.equal((await invoke(student.token, oversized)).status, 413);
  const chunkedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(oversized));
      controller.close();
    },
  });
  assert.equal(
    (
      await invoke(student.token, undefined, {
        body: chunkedBody,
        duplex: 'half',
      })
    ).status,
    413,
  );

  await runFrontendIntegration(instructorAal2Session.secret);

  process.stdout.write(
    'Actual local frontend, Auth, TOTP, Edge Runtime, AAL, school-boundary, RPC, body-limit, and audit integration checks passed.\n',
  );
} finally {
  await cleanup();
}
