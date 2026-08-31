import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const scriptsDirectory = path.resolve('scripts');
const cliPath = path.resolve('node_modules', 'supabase', 'dist', 'supabase.js');
const runtimePattern = /^test-[a-z0-9-]+-runtime\.mjs$/;
const priority = new Map([
  ['test-edge-runtime.mjs', 0],
  ['test-recovery-runtime.mjs', 1],
]);
const defaultFixtureTimeoutMs = 15 * 60 * 1000;
const fixtureTimeoutMs = new Map([['test-feat-003-runtime.mjs', 25 * 60 * 1000]]);
const diagnosticLinePattern =
  /^(FEAT-003|FEAT-006) runtime diagnostic: stage=([a-z0-9-]+) event=(enter|passed)\.$/;
const diagnosticFailureLinePattern =
  /^FEAT-006 runtime diagnostic: stage=([a-z0-9-]+) event=failed detail=([a-z0-9-]+)\.$/;
const fixtureDiagnosticRules = new Map([
  [
    'test-feat-003-runtime.mjs',
    {
      prefix: 'FEAT-003',
      stages: new Set([
        'auth-reset-initial',
        'identity-creation',
        'fixture-failure-injection',
        'fixture-issuance',
        'edge-runtime-startup',
        'first-admin-status',
        'first-admin-start',
        'first-admin-totp',
        'first-admin-completion',
        'first-admin-bootstrap',
        'first-replay-recovery',
        'first-completion-replay',
        'browser-onboarding',
        'browser-frontend-startup',
        'browser-launch',
        'browser-sign-in',
        'browser-onboarding-ready',
        'browser-totp-completion',
        'browser-frontend-shutdown',
        'completion-race',
        'auth-reset-limiter',
        'limiter-burst',
        'limiter-recovery',
        'race-completion-replay',
        'privacy-evidence',
        'fixture-cleanup',
        'fixture-assertions',
        'edge-runtime-shutdown',
      ]),
    },
  ],
  [
    'test-feat-006-runtime.mjs',
    {
      prefix: 'FEAT-006',
      stages: new Set([
        'identity-creation',
        'database-fixture',
        'edge-runtime-startup',
        'sign-in',
        'readiness-status',
        'enrollment-start',
        'provider-enrollment',
        'factor-binding',
        'totp-verification',
        'completion',
        'evidence',
        'fixture-data-cleanup',
        'fixture-assertions',
      ]),
      failureDetails: new Set([
        'auth-session-read-failed',
        'auth-session-unavailable',
        'edge-runtime-exited',
        'member-mfa-audit-unavailable',
        'member-mfa-authentication-required',
        'member-mfa-factor-conflict',
        'member-mfa-limiter-unavailable',
        'member-mfa-not-available',
        'member-mfa-provider-unavailable',
        'member-mfa-rate-limited',
        'member-mfa-recent-authentication-required',
        'member-mfa-service-unavailable',
        'member-mfa-state-conflict',
        'response-decoding-failed',
        'transport-failed',
        'unclassified',
      ]),
    },
  ],
]);

function isApprovedDiagnosticLine(line, rule) {
  const match = diagnosticLinePattern.exec(line);
  if (match) return match[1] === rule.prefix && rule.stages.has(match[2]);
  const failureMatch = diagnosticFailureLinePattern.exec(line);
  return (
    rule.prefix === 'FEAT-006' &&
    failureMatch?.[1] === 'completion' &&
    rule.failureDetails.has(failureMatch[2])
  );
}

const fixtures = readdirSync(scriptsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && runtimePattern.test(entry.name))
  .map((entry) => entry.name)
  .sort((left, right) => {
    const leftPriority = priority.get(left) ?? 100;
    const rightPriority = priority.get(right) ?? 100;
    return leftPriority - rightPriority || left.localeCompare(right);
  });

function recoveryTemplateIsReady() {
  const result = spawnSync(
    'docker',
    [
      'exec',
      'supabase_auth_flyeye',
      'sh',
      '-c',
      'wget -q -O /dev/null "$GOTRUE_MAILER_TEMPLATES_RECOVERY"',
    ],
    {
      stdio: 'ignore',
      timeout: 5_000,
      windowsHide: true,
    },
  );
  return result.status === 0;
}

async function waitForRecoveryTemplate(attempts) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (recoveryTemplateIsReady()) return true;
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

async function restartLocalRuntime() {
  const stop = spawnSync(process.execPath, [cliPath, 'stop'], {
    stdio: 'ignore',
    timeout: 2 * 60 * 1_000,
    windowsHide: true,
  });
  if (stop.status !== 0) {
    throw new Error(
      'Runtime readiness failed: local Supabase lifecycle recovery could not stop cleanly.',
    );
  }

  const start = spawnSync(process.execPath, [cliPath, 'start'], {
    stdio: 'ignore',
    timeout: 3 * 60 * 1_000,
    windowsHide: true,
  });
  if (start.status !== 0 || !(await waitForRecoveryTemplate(80))) {
    throw new Error(
      'Runtime readiness failed: the local Auth template route remained unavailable.',
    );
  }

  process.stdout.write('Runtime readiness recovered: local Auth template route.\n');
}

async function ensureTemplateRuntimeReady() {
  if (await waitForRecoveryTemplate(20)) return;
  await restartLocalRuntime();
}

if (fixtures.length === 0) {
  process.stderr.write('Runtime matrix failed: no approved runtime fixtures were discovered.\n');
  process.exit(1);
}

if (process.argv.includes('--list')) {
  for (const fixture of fixtures) process.stdout.write(`${fixture}\n`);
  process.exit(0);
}

for (const fixture of fixtures) {
  if (
    fixture === 'test-edge-runtime.mjs' ||
    fixture === 'test-feat-003-runtime.mjs' ||
    fixture === 'test-feat-005-runtime.mjs' ||
    fixture === 'test-feat-006-runtime.mjs'
  ) {
    try {
      await restartLocalRuntime();
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Runtime readiness failed.'}\n`,
      );
      process.exit(1);
    }
  }
  if (fixture === 'test-recovery-runtime.mjs' || fixture === 'test-feat-004-runtime.mjs') {
    try {
      await ensureTemplateRuntimeReady();
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Runtime readiness failed.'}\n`,
      );
      process.exit(1);
    }
  }

  const diagnosticRule = fixtureDiagnosticRules.get(fixture);
  const hasSanitizedDiagnostics = diagnosticRule !== undefined;
  const result = spawnSync(process.execPath, [path.join(scriptsDirectory, fixture)], {
    encoding: hasSanitizedDiagnostics ? 'utf8' : undefined,
    env: hasSanitizedDiagnostics
      ? { ...process.env, FLYEYE_RUNTIME_DIAGNOSTICS: '1' }
      : process.env,
    stdio: hasSanitizedDiagnostics ? ['ignore', 'pipe', 'ignore'] : 'ignore',
    timeout: fixtureTimeoutMs.get(fixture) ?? defaultFixtureTimeoutMs,
    windowsHide: true,
  });

  if (diagnosticRule && typeof result.stdout === 'string') {
    for (const line of result.stdout.split(/\r?\n/)) {
      if (isApprovedDiagnosticLine(line, diagnosticRule)) process.stdout.write(`${line}\n`);
    }
  }

  if (result.status !== 0) {
    const outcome =
      result.error?.code === 'ETIMEDOUT' ? 'timeout' : `exit ${result.status ?? 'unknown'}`;
    process.stderr.write(`Runtime matrix failed: ${fixture} (${outcome}).\n`);
    process.stderr.write(
      'Child output was suppressed. Treat data and process cleanup as uncertain; sanitized diagnostics identify only the last confirmed stage.\n',
    );
    process.exit(result.status ?? 1);
  }

  process.stdout.write(`Runtime matrix passed: ${fixture}.\n`);
  if (fixture !== fixtures.at(-1)) {
    // Local Edge workers can keep answering preflight briefly after their process exits.
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

process.stdout.write(`Runtime matrix passed: ${fixtures.length} fixture(s).\n`);
