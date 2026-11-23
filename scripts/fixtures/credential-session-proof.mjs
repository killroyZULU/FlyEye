// Explicit, disposable-only verification. The standard runtime matrix does not start this stack.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  inventory,
  differences,
  openReceipt,
  ownedGuard,
  engineBinding,
} from './credential-proof-receipt.mjs';
import { prepareBrowser } from './credential-owner-browser.mjs';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { authenticationEvidenceFromVerifiedToken } from '../../supabase/functions/_shared/authentication-evidence.ts';
import { localNoSendProject } from '../lib/no-send-local-project.mjs';
import { currentTotp, localJson } from '../lib/no-send-runtime-client.mjs';

const uuid = (value) => {
  assert.match(value, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  return value;
};
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', timeout: 15000 }).trim();
const browserCheckpoint = process.argv.includes('--chromium-checkpoint');
const onePng = process.argv.includes('--one-png-proof');
const withdrawal = process.argv.includes('--withdrawal-proof');
const focused = browserCheckpoint || onePng || withdrawal;
if (focused) {
  assert.equal(process.argv.length, 3);
  assert.equal(process.platform, 'linux');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.env.GITHUB_REPOSITORY, 'killroyZULU/FlyEye');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/feat/FEAT-009-s2-chromium-checkpoint');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    process.env.GITHUB_SHA,
  );
}
const receipt = openReceipt();
const mark = (label) => {
  receipt.record.stages.push(label);
  receipt.save();
  if (focused && !/^(?:owner|metadata)-http-/.test(label)) {
    stage = label;
    console.log('Checkpoint: ' + label);
  }
};
let bundle;
let stage = 'inventory';
function passed(name) {
  console.log(`Session proof passed: ${name}.`);
}
let project;
let before;
async function run() {
  stage = 'browser-preflight';
  if (browserCheckpoint || process.argv.includes('--submission'))
    bundle = await prepareBrowser(browserCheckpoint);
  stage = 'inventory';
  const ctx = process.platform === 'win32' ? 'desktop-linux' : 'default';
  assert.equal(docker('context', 'show'), ctx);
  assert.ok(!process.env.DOCKER_HOST);
  const endpoint = docker('context', 'inspect', ctx, '--format', '{{.Endpoints.docker.Host}}');
  assert.equal(
    endpoint,
    process.platform === 'win32'
      ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
      : 'unix:///var/run/docker.sock',
  );
  if (process.platform === 'win32') {
    // Optional recovery evidence. Its availability does not govern normal execution or release.
    try {
      receipt.record.engineBefore = engineBinding();
    } catch {
      /* unavailable */
    }
  }
  before = inventory();
  receipt.record.before = before;
  receipt.save();
  stage = 'isolated-startup';
  const ownership = ownedGuard(receipt, before);
  project = localNoSendProject(ownership);
  project.start(true);
  stage = 'pinned-auth-image';
  assert.equal(
    docker('inspect', '-f', '{{.Image}}', 'supabase_auth_flyeye-nosend-p3d1'),
    docker('image', 'inspect', '-f', '{{.Id}}', 'public.ecr.aws/supabase/gotrue:v2.192.0'),
  );
  const status = project.status();
  const sql = (statement) => project.sql(statement);
  const auth = async (method, route, body, token = status.ANON_KEY) => {
    const result = await localJson(`${status.API_URL}/auth/v1${route}`, {
      method,
      headers: {
        apikey: status.ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(result.status, 200);
    return result.body;
  };
  const sink = async () =>
    assert.equal((await localJson('http://127.0.0.1:58324/api/v1/messages')).body.total, 0);
  await sink();
  passed('pinned isolated Auth with empty non-relaying sink');
  stage = 'baseline-schema';
  assert.equal(
    sql(
      "select to_regclass('public.organizations') is null and not exists(select from auth.users)",
    ),
    't',
  );
  for (const file of readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (file !== '20261107105251_feat_003_staging_no_send.sql') {
      stage = `migration-${file.split('_')[0]}`;
      sql(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    }
  }
  stage = 'password-sign-in';
  const email = `synthetic-${randomUUID()}@example.invalid`;
  const password = `Synthetic-${randomUUID()}!`;
  const account = await auth(
    'POST',
    '/admin/users',
    { email, password, email_confirm: true },
    status.SERVICE_ROLE_KEY,
  );
  const actor = uuid(account.id);
  const school = randomUUID();
  const member = randomUUID();
  sql(`begin;
    insert into public.organizations(id,name) values ('${school}','Synthetic school');
    insert into public.organization_memberships(id,organization_id,user_id) values ('${member}','${school}','${actor}');
    insert into public.membership_roles(organization_id,membership_id,role_id)
      select '${school}','${member}',id from public.roles where code='student_pilot';
    commit;`);
  if (browserCheckpoint) {
    const { checkpoint } = await import('./credential-chromium-checkpoint.mjs');
    await checkpoint({
      auth,
      email,
      password,
      actor,
      school,
      member,
      status,
      sql,
      ownership,
      bundle,
      mark,
    });
    mark('empty-sink');
    await sink();
    receipt.record.submissionWorkers = 'settled';
    receipt.record.test = 'passed';
    return;
  }
  const verify = async (token) => {
    const user = await auth('GET', '/user', undefined, token);
    assert.equal(user.id, actor);
    return authenticationEvidenceFromVerifiedToken(token, user.id);
  };
  const signed = await auth('POST', '/token?grant_type=password', { email, password });
  const initial = await verify(signed.access_token);
  const sid = uuid(initial.sessionId);
  assert.equal(initial.assuranceLevel, 'aal1');
  assert.ok(Number.isSafeInteger(initial.passwordAuthenticatedAt));
  assert.equal(
    sql(`select exists(select from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
    where s.id='${sid}' and s.user_id='${actor}' and a.authentication_method='password'
    and floor(extract(epoch from a.updated_at))=${initial.passwordAuthenticatedAt})`),
    't',
  );
  passed('provider-verified user, password time and live session agree');
  stage = 'owner-school-authorization';
  const workspace = (user, session, org, target) =>
    sql(`select public.credential_workspace('${user}','${session}',false,
    '${org}','my_credentials','${target}',null,null,null,gen_random_uuid())->>'decision'`);
  assert.equal(workspace(actor, sid, school, member), 'credential_workspace');
  for (const args of [
    [actor, sid, school, randomUUID()],
    [actor, sid, randomUUID(), member],
    [randomUUID(), sid, school, member],
    [actor, randomUUID(), school, member],
  ]) {
    assert.equal(workspace(...args), 'not_found');
  }
  passed('owner allowed; wrong membership, school, user and session denied');
  stage = 'totp-enroll-and-step-up';
  const enrolled = await auth(
    'POST',
    '/factors',
    { factor_type: 'totp', friendly_name: 'Synthetic proof' },
    signed.access_token,
  );
  const factor = uuid(enrolled.id);
  const challenge = await auth('POST', `/factors/${factor}/challenge`, {}, signed.access_token);
  const elevated = await auth(
    'POST',
    `/factors/${factor}/verify`,
    {
      challenge_id: uuid(challenge.id),
      code: currentTotp(enrolled.totp.secret),
    },
    signed.access_token,
  );
  const mfa = await verify(elevated.access_token);
  stage = 'step-up-original-session-and-password-origin';
  assert.equal(mfa.sessionId, sid);
  assert.equal(mfa.passwordAuthenticatedAt, initial.passwordAuthenticatedAt);
  assert.equal(mfa.assuranceLevel, 'aal2');
  assert.equal(
    sql(`select public.credential_session_is_current('${actor}','${sid}','${factor}',true)`),
    't',
  );
  passed('TOTP binds the same session, original password window and verified factor');
  if (onePng || withdrawal) {
    stage = withdrawal ? 'withdrawal-setup' : 'png-setup';
    const { proveSubmission } = await import('./credential-submission-proof.mjs');
    const focusedProof = withdrawal
      ? (await import('./credential-withdrawal-proof.mjs')).proveWithdrawal
      : (await import('./credential-one-png-proof.mjs')).proveOnePng;
    await proveSubmission({
      ownership,
      mark,
      status,
      sql,
      school,
      member,
      actor,
      sid,
      aal1: signed.access_token,
      aal2: elevated.access_token,
      focusedProof,
    });
    mark('empty-sink');
    await sink();
    receipt.record.submissionWorkers = 'settled';
    receipt.record.test = 'passed';
    return;
  }
  stage = 'refresh-and-distinct-sign-in';
  const refreshed = await auth('POST', '/token?grant_type=refresh_token', {
    refresh_token: elevated.refresh_token,
  });
  const renewed = await verify(refreshed.access_token);
  assert.equal(renewed.sessionId, sid);
  assert.equal(renewed.passwordAuthenticatedAt, initial.passwordAuthenticatedAt);
  const second = await verify(
    (await auth('POST', '/token?grant_type=password', { email, password })).access_token,
  );
  assert.notEqual(second.sessionId, sid);
  passed('token refresh retains origin; independent password login creates a distinct session');
  if (process.argv.includes('--submission')) {
    stage = 'owner-submission';
    const { proveSubmission } = await import('./credential-submission-proof.mjs');
    await proveSubmission({
      bundle,
      ownership,
      mark,
      status,
      sql,
      school,
      member,
      actor,
      sid,
      aal1: signed.access_token,
      aal2: refreshed.access_token,
      session: { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token },
    });
    receipt.record.submissionWorkers = 'settled';
  }
  stage = 'revocation';
  sql(`update public.organization_memberships set status='suspended' where id='${member}'`);
  assert.equal(workspace(actor, sid, school, member), 'not_found');
  await sink();
  passed('revoked membership denied; sink empty');
  receipt.record.test = 'passed';
}
try {
  await run();
} catch (error) {
  receipt.record.test = 'failed';
  receipt.record.failure = {
    stage,
    kind:
      {
        CHECKPOINT_4XX: 'http-4xx',
        CHECKPOINT_5XX: 'http-5xx',
        CHECKPOINT_STATUS: 'unexpected-status',
      }[error?.code] ??
      (error?.code === 'ERR_ASSERTION'
        ? 'assertion'
        : error?.name === 'TimeoutError'
          ? 'timeout'
          : 'operation'),
  };
  // Provider errors, assertions, HTTP bodies, identifiers and credentials stay private.
  console.error(`Session proof stopped at ${stage} (${receipt.record.failure.kind}).`);
  process.exitCode = 1;
} finally {
  try {
    if (project) {
      project.close();
      receipt.record.teardown = 'passed';
    }
  } catch {
    receipt.record.teardown = 'failed';
    process.exitCode = 1;
  }
  try {
    if (before) {
      const after = inventory();
      receipt.record.after = after;
      if (receipt.record.engineBefore) {
        try {
          receipt.record.engineAfter = engineBinding();
        } catch {
          /* unavailable */
        }
      }
      const diff = differences(before, after);
      receipt.record.delta = diff;
      receipt.record.comparison = Object.values(diff).every((k) =>
        Object.values(k).every((a) => !a.length),
      )
        ? 'match'
        : 'mismatch';
      if (receipt.record.comparison !== 'match') process.exitCode = 1;
    }
  } catch {
    receipt.record.comparison = 'unavailable';
    process.exitCode = 1;
  }
  receipt.save();
  console.log(
    'Test=' +
      receipt.record.test +
      ' teardown=' +
      receipt.record.teardown +
      ' inventory=' +
      receipt.record.comparison,
  );
  if (receipt.record.teardown !== 'failed' && (!before || receipt.record.comparison === 'match'))
    receipt.release();
}
