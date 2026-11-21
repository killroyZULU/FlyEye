import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { localNoSendProject } from './lib/no-send-local-project.mjs';
import { createNoSendHttpClient } from './lib/no-send-http-client.mjs';
import {
  currentTotp,
  incorrectTotp,
  validateNoSendRequest,
} from './lib/no-send-runtime-client.mjs';

import { createNoSendRegressionDiagnostic } from './lib/no-send-regression-diagnostic.mjs';

const regressionDiagnostic = createNoSendRegressionDiagnostic();
const enrollmentOnly = process.argv.includes('--enrollment-observation-only');
let project;
let client;
let stage = 'startup-control';
let lastStatus = null;
let lastMailCount = null;
const sensitive = new Set();
const retain = (value) => {
  if (typeof value === 'string' && value.length > 8) sensitive.add(value);
  return value;
};
const report = (result) =>
  process.stdout.write(`${JSON.stringify({ noSendBehavior: { stage, ...result } })}\n`);
const email = () => `synthetic-${randomUUID()}@example.invalid`;
const password = () => retain(`Synthetic-${randomUUID()}!`);
let status;

async function api(method, route, body, bearer) {
  validateNoSendRequest(status.API_URL, method, route, body);
  regressionDiagnostic.request();
  const result = await client.request(
    `${status.API_URL}/auth/v1${route}`,
    {
      method,
      headers: {
        apikey: status.ANON_KEY,
        Authorization: `Bearer ${bearer ?? status.ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    regressionDiagnostic.transport,
  );
  regressionDiagnostic.response(result);
  lastStatus = result.status;
  retain(result.body?.access_token);
  retain(result.body?.refresh_token);
  return result;
}
async function mailCount() {
  regressionDiagnostic.mark('sink-request');
  regressionDiagnostic.request();
  const result = await client.request('http://127.0.0.1:58324/api/v1/messages');
  regressionDiagnostic.response(result);
  regressionDiagnostic.mark('sink-status');
  assert.equal(result.status, 200);
  regressionDiagnostic.mark('sink-count-shape');
  assert.ok(Number.isInteger(result.body.total) && result.body.total >= 0);
  lastMailCount = result.body.total;
  return result.body.total;
}
async function expectMail(count) {
  // Bounded sink observation only; never repeat an Auth operation.
  for (let observation = 0; observation < 5; observation++) {
    const actual = await mailCount();
    regressionDiagnostic.mark('sink-no-extra-mail');
    assert.ok(actual <= count, 'Unexpected local delivery.');
    if (count === 1 && actual === count) return;
    if (observation < 4) await delay(250);
  }
  regressionDiagnostic.mark('sink-final-count');
  assert.equal(lastMailCount, count);
}
async function user(confirmed = true) {
  regressionDiagnostic.mark('fixture-request');
  const fixture = { email: email(), password: password() };
  const result = await api(
    'POST',
    '/admin/users',
    {
      ...fixture,
      email_confirm: confirmed,
      user_metadata: { privacy_canary: retain(`private-${randomUUID()}`) },
    },
    status.SERVICE_ROLE_KEY,
  );
  regressionDiagnostic.mark('fixture-status');
  assert.equal(result.status, 200);
  regressionDiagnostic.mark('fixture-id');
  assert.match(result.body.id, /^[a-f0-9-]{36}$/);
  regressionDiagnostic.mark('fixture-email');
  assert.equal(result.body.email, fixture.email);
  regressionDiagnostic.mark('fixture-confirmed');
  assert.equal(Boolean(result.body.email_confirmed_at), confirmed);
  return { ...fixture, id: result.body.id };
}
async function login(fixture) {
  regressionDiagnostic.mark('login-request');
  const result = await api('POST', '/token?grant_type=password', {
    email: fixture.email,
    password: fixture.password,
  });
  regressionDiagnostic.mark('login-status');
  assert.equal(result.status, 200);
  regressionDiagnostic.mark('login-user');
  assert.equal(result.body.user.id, fixture.id);
  regressionDiagnostic.mark('login-aal');
  assert.equal(
    JSON.parse(Buffer.from(result.body.access_token.split('.')[1], 'base64url')).aal,
    'aal1',
  );
  return result.body.access_token;
}
async function blocked(name, method, route, body, bearer, expected = 403) {
  stage = name;
  const result = await api(method, route, body, bearer);
  await expectMail(0);
  assert.equal(result.status, expected);
  if (expected === 403)
    assert.equal(
      result.body.msg ?? result.body.message,
      'Email delivery is disabled in synthetic staging.',
    );
  report({ passed: true, status: result.status, mailCount: lastMailCount });
}
function loadStatus() {
  status = project.status();
  for (const name of ['ANON_KEY', 'SERVICE_ROLE_KEY']) {
    assert.ok(typeof status[name] === 'string' && status[name].length > 20);
    retain(status[name]);
  }
}
function checkLogPrivacy() {
  assert.equal(project.logsContain([...sensitive]), false);
}

try {
  enrollmentObservation: {
    project = localNoSendProject();
    project.start(false);
    loadStatus();
    client = createNoSendHttpClient();
    await expectMail(0);
    stage = 'sink-positive-control';
    const control = await user();
    const sent = await api('POST', '/recover', { email: control.email });
    assert.equal(sent.status, 200);
    await expectMail(1);
    checkLogPrivacy();
    report({ passed: true, status: sent.status, mailCount: lastMailCount });

    stage = 'startup-hook';
    await client.close();
    client = undefined;
    // Deliberate configuration transition, not a failed-start retry. Same owned DB;
    // the non-persistent sink is replaced, so the positive-control mail is gone.
    project.enableHook();
    loadStatus();
    client = createNoSendHttpClient();
    await expectMail(0);
    const settings = await api('GET', '/settings');
    assert.equal(settings.status, 200);
    assert.equal(settings.body.disable_signup, true);
    assert.equal(settings.body.external.email, true);
    assert.ok(
      Object.entries(settings.body.external).every(([key, enabled]) => key === 'email' || !enabled),
    );
    report({ passed: true, mailCount: lastMailCount });

    stage = 'signup-disabled';
    const signup = await api('POST', '/signup', { email: email(), password: password() });
    await expectMail(0);
    assert.equal(signup.status, 422);
    assert.equal(signup.body.error_code, 'signup_disabled');
    report({ passed: true, status: signup.status, mailCount: lastMailCount });
    for (const [name, route, extra] of [
      ['recovery', '/recover', {}],
      ['email-otp', '/otp', { create_user: false }],
      ['legacy-magic-link', '/magiclink', { create_user: false }],
    ]) {
      stage = `${name}-fixture`;
      const fixture = await user();
      await blocked(name, 'POST', route, { email: fixture.email, ...extra });
    }
    stage = 'signup-resend-fixture';
    const unconfirmed = await user(false);
    await blocked('signup-resend', 'POST', '/resend', { type: 'signup', email: unconfirmed.email });
    await blocked(
      'admin-invitation',
      'POST',
      '/invite',
      { email: email() },
      status.SERVICE_ROLE_KEY,
    );
    stage = 'email-change-fixture';
    const changing = await user();
    const token = await login(changing);
    await blocked('email-change', 'PUT', '/user', { email: email() }, token);
    const unchanged = await api('GET', '/user', undefined, token);
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.email, changing.email);
    stage = 'email-change-resend-fixture';
    const pending = await user();
    const pendingEmail = email();
    assert.equal(
      project
        .sql(
          `update auth.users set email_change='${pendingEmail}', email_change_sent_at=null where id='${pending.id}' returning id;`,
        )
        .split('\n')[0],
      pending.id,
    );
    await blocked('email-change-resend', 'POST', '/resend', {
      type: 'email_change',
      email: pending.email,
    });
    await blocked('email-reauthentication', 'GET', '/reauthenticate', undefined, token);

    stage = 'password-totp-regression';
    regressionDiagnostic.start();
    const regression = await user();
    const session = await login(regression);
    regressionDiagnostic.mark('wrong-password-request');
    const denied = await api('POST', '/token?grant_type=password', {
      email: regression.email,
      password: password(),
    });
    regressionDiagnostic.mark('wrong-password-status');
    assert.equal(denied.status, 400);
    regressionDiagnostic.mark('wrong-password-code');
    assert.equal(denied.body.error_code, 'invalid_credentials');
    regressionDiagnostic.mark('enroll-request');
    const enrolled = await api(
      'POST',
      '/factors',
      { factor_type: 'totp', friendly_name: 'synthetic-no-send' },
      session,
    );
    regressionDiagnostic.mark('enroll-status');
    assert.equal(enrolled.status, 200);
    regressionDiagnostic.mark('enroll-id');
    assert.match(enrolled.body.id, /^[a-f0-9-]{36}$/);
    regressionDiagnostic.mark('enroll-secret');
    const secret = retain(enrolled.body.totp.secret);
    if (enrollmentOnly) {
      stage = 'totp-enrollment-observation';
      report({ passed: true, ...regressionDiagnostic.snapshot() });
      break enrollmentObservation;
    }
    const challenge = () => api('POST', `/factors/${enrolled.body.id}/challenge`, {}, session);
    regressionDiagnostic.mark('bad-challenge-request');
    const badChallenge = await challenge();
    regressionDiagnostic.mark('bad-challenge-status');
    assert.equal(badChallenge.status, 200);
    regressionDiagnostic.mark('bad-verify-request');
    const invalid = await api(
      'POST',
      `/factors/${enrolled.body.id}/verify`,
      { challenge_id: badChallenge.body.id, code: incorrectTotp(secret) },
      session,
    );
    regressionDiagnostic.mark('bad-verify-status');
    assert.equal(invalid.status, 422);
    regressionDiagnostic.mark('bad-verify-code');
    assert.equal(invalid.body.error_code, 'mfa_verification_failed');
    regressionDiagnostic.mark('good-challenge-request');
    const validChallenge = await challenge();
    regressionDiagnostic.mark('good-challenge-status');
    assert.equal(validChallenge.status, 200);
    regressionDiagnostic.mark('good-verify-request');
    const verified = await api(
      'POST',
      `/factors/${enrolled.body.id}/verify`,
      { challenge_id: validChallenge.body.id, code: currentTotp(secret) },
      session,
    );
    regressionDiagnostic.mark('good-verify-status');
    assert.equal(verified.status, 200);
    regressionDiagnostic.mark('good-verify-aal');
    assert.equal(
      JSON.parse(Buffer.from(verified.body.access_token.split('.')[1], 'base64url')).aal,
      'aal2',
    );
    await expectMail(0);
    report({
      passed: true,
      passwordAal1: true,
      wrongPasswordDenied: true,
      invalidTotpDenied: true,
      totpAal2: true,
      mailCount: lastMailCount,
    });
    regressionDiagnostic.stop();

    stage = 'hook-failure-setup';
    const originalHook = project.sql(
      "select pg_get_functiondef('staging_private.reject_email(jsonb)'::regprocedure);",
    );
    const functionBody = (body, language = 'sql') =>
      `create or replace function staging_private.reject_email(event jsonb) returns jsonb language ${language} security invoker set search_path=pg_catalog as $fixture$ ${body} $fixture$;`;
    const faults = [
      [
        'hook-exception',
        functionBody("begin raise exception 'synthetic hook failure'; end", 'plpgsql'),
        originalHook,
      ],
      [
        'hook-missing',
        'alter function staging_private.reject_email(jsonb) rename to withheld_email;',
        'alter function staging_private.withheld_email(jsonb) rename to reject_email;',
      ],
      [
        'hook-permission-denied',
        'revoke execute on function staging_private.reject_email(jsonb) from supabase_auth_admin;',
        'grant execute on function staging_private.reject_email(jsonb) to supabase_auth_admin;',
      ],
      [
        'hook-malformed-output',
        functionBody(`select '"invalid-hook-shape"'::jsonb;`),
        originalHook,
      ],
      [
        'hook-timeout',
        functionBody("begin perform pg_sleep(3); return '{}'::jsonb; end", 'plpgsql'),
        originalHook,
      ],
    ];
    for (const [name, inject, restore] of faults) {
      stage = `${name}-fixture`;
      const fixture = await user();
      try {
        project.sql(inject);
        await blocked(name, 'POST', '/recover', { email: fixture.email }, undefined, 500);
      } finally {
        project.sql(restore);
      }
      assert.equal(
        project.sql("select staging_private.reject_email('{}'::jsonb)->'error'->>'http_code';"),
        '403',
      );
    }
    stage = 'restored-hook-fixture';
    const restored = await user();
    await blocked('restored-hook', 'POST', '/recover', { email: restored.email });
    stage = 'privacy-and-final-sink';
    checkLogPrivacy();
    await expectMail(0);
    report({ passed: true, authLogSecretScan: true, mailCount: lastMailCount });
  }
} catch (error) {
  const match =
    /^No-send disposable command failed: (configuration|migration|image|health|network|port|timeout|unknown)\.$/.exec(
      error?.message ?? '',
    );
  report({
    passed: false,
    ...regressionDiagnostic.snapshot(),
    category: match?.[1] ?? (error?.code === 'ERR_ASSERTION' ? 'assertion' : 'unknown'),
    lastHttpStatus: lastStatus,
    lastMailCount,
  });
  process.exitCode = 1;
} finally {
  if (client) {
    stage = 'client-cleanup';
    try {
      await client.close();
      report({ passed: true });
    } catch {
      report({ passed: false, category: 'cleanup-uncertain' });
      process.exitCode = 1;
    }
  }
  if (project) {
    stage = 'final-log-privacy';
    try {
      checkLogPrivacy();
      report({ passed: true });
    } catch {
      report({ passed: false, category: 'privacy-unverified' });
      process.exitCode = 1;
    }
    stage = 'cleanup';
    try {
      project.close();
      report({ passed: true });
    } catch {
      report({ passed: false, category: 'cleanup-uncertain' });
      process.exitCode = 1;
    }
  }
}
