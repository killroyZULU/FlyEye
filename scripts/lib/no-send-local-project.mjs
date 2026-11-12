import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedNoSendCliEnvironment } from './no-send-cli-artifact.mjs';

const id = 'flyeye-nosend-p3d1';
const network = `${id}-isolated`;
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const cli = path.join(repositoryRoot, 'node_modules/supabase/dist/supabase.js');
const migration = '20261107105251_feat_003_staging_no_send.sql';
const digest = (text) => createHash('sha256').update(text).digest('hex');

function verifyLocalMailBoundary() {
  // Fixed labels, counts and booleans only; never emit inspect values or errors.
  const report = (check, summary = {}) =>
    process.stdout.write(`${JSON.stringify({ noSendSafeguard: { check, ...summary } })}\n`);
  report('container-inspection');
  const inspect = (service) =>
    JSON.parse(command('docker', ['inspect', `supabase_${service}_${id}`]))[0];
  const containers = ['db', 'auth', 'kong', 'inbucket', 'rest'].map(inspect);
  report('network-inspection');
  const networkState = JSON.parse(command('docker', ['network', 'inspect', network]))[0];
  report('exact-network-membership', { count: Object.keys(networkState.Containers).length });
  assert.deepEqual(
    Object.keys(networkState.Containers).sort(),
    containers.map((container) => container.Id).sort(),
  );
  for (const container of containers) {
    const service = ['db', 'auth', 'kong', 'inbucket', 'rest'][containers.indexOf(container)];
    report('single-network-attachment', {
      service,
      count: Object.keys(container.NetworkSettings.Networks).length,
    });
    assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [network]);
    const bindings = Object.values(container.NetworkSettings.Ports ?? {}).flatMap(
      (ports) => ports ?? [],
    );
    report('loopback-bindings', {
      service,
      count: bindings.length,
      ipv4Loopback: bindings.filter((binding) => binding.HostIp === '127.0.0.1').length,
      ipv4Wildcard: bindings.filter((binding) => binding.HostIp === '0.0.0.0').length,
      ipv6Wildcard: bindings.filter((binding) => binding.HostIp === '::').length,
      other: bindings.filter((binding) => !['127.0.0.1', '0.0.0.0', '::'].includes(binding.HostIp))
        .length,
    });
    assert.ok(bindings.every((binding) => binding.HostIp === '127.0.0.1'));
  }
  const [database, auth, gateway, mail] = containers;
  const bound = (container, port, hostPort) =>
    container.NetworkSettings.Ports[port]?.some(
      (binding) => binding.HostIp === '127.0.0.1' && binding.HostPort === hostPort,
    );
  report('required-db-binding', { matches: Boolean(bound(database, '5432/tcp', '58322')) });
  assert.ok(bound(database, '5432/tcp', '58322'));
  report('required-api-binding', { matches: Boolean(bound(gateway, '8000/tcp', '58321')) });
  assert.ok(bound(gateway, '8000/tcp', '58321'));
  report('required-mail-binding', { matches: Boolean(bound(mail, '8025/tcp', '58324')) });
  assert.ok(bound(mail, '8025/tcp', '58324'));
  process.stdout.write('No-send compatibility: owned network and loopback bindings passed.\n');
  const environment = (container) =>
    Object.fromEntries(
      container.Config.Env.map((entry) => {
        const separator = entry.indexOf('=');
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
    );
  const authEnvironment = environment(auth);
  report('smtp-owned-host');
  assert.equal(authEnvironment.GOTRUE_SMTP_HOST, `supabase_inbucket_${id}`);
  report('smtp-local-port');
  assert.equal(authEnvironment.GOTRUE_SMTP_PORT, '1025');
  report('smtp-no-credentials');
  assert.ok(!authEnvironment.GOTRUE_SMTP_USER && !authEnvironment.GOTRUE_SMTP_PASS);
  const mailEnvironment = environment(mail);
  report('mail-no-relay-environment');
  assert.ok(Object.keys(mailEnvironment).every((key) => !/RELAY|FORWARD|CONFIG/i.test(key)));
  const mailArguments = [...(mail.Config.Entrypoint ?? []), ...(mail.Config.Cmd ?? [])];
  report('mail-no-relay-arguments');
  assert.ok(mailArguments.every((value) => !/relay|forward|config/i.test(value)));
  report('mail-no-mounts');
  assert.equal(mail.Mounts.length, 0);
  // Only booleans/assertions leave this inspection; local keys remain in memory.
}

function command(executable, args, input, environment = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    input,
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1', ...environment },
  });
  if (result.status !== 0 || result.error || result.signal) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const categories = [
      ['configuration', /invalid config|unknown key|unrecognized key|failed to parse/i],
      ['migration', /error.*migration|failed.*migration|SQLSTATE/i],
      ['image', /failed to pull|pull access denied|manifest unknown/i],
      ['health', /unhealthy|health check|healthcheck/i],
      ['network', /network.*not found|network.*error|connection refused/i],
      ['port', /port is already allocated|address already in use/i],
      ['timeout', /timed out|timeout/i],
    ];
    const category = categories.find(([, pattern]) => pattern.test(output))?.[0] ?? 'unknown';
    throw new Error(`No-send disposable command failed: ${category}.`);
  }
  return result.stdout;
}

export function noSendLocalConfiguration(hook) {
  return `project_id = "${id}"
[api]
enabled = true
port = 58321
[db]
port = 58322
shadow_port = 58320
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
port = 58323
[local_smtp]
enabled = true
port = 58324
smtp_port = 58325
pop3_port = 58326
[analytics]
enabled = false
port = 58327
[auth]
site_url = "http://127.0.0.1:58329"
enable_signup = false
minimum_password_length = 15
[auth.rate_limit]
email_sent = 30
[auth.email]
enable_signup = true
enable_confirmations = true
double_confirm_changes = true
secure_password_change = false
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
[auth.hook.send_email]
enabled = ${hook}
uri = "pg-functions://postgres/staging_private/reject_email"
[auth.email.notification.password_changed]
enabled = false
[auth.email.notification.email_changed]
enabled = false
[auth.email.notification.phone_changed]
enabled = false
[auth.email.notification.identity_linked]
enabled = false
[auth.email.notification.identity_unlinked]
enabled = false
[auth.email.notification.mfa_factor_enrolled]
enabled = false
[auth.email.notification.mfa_factor_unenrolled]
enabled = false
`;
}

export function localNoSendProject() {
  if (realpathSync(process.cwd()) !== realpathSync(repositoryRoot)) {
    throw new Error('Disposable no-send working directory rejected.');
  }
  const cliEnvironment = verifiedNoSendCliEnvironment();
  const cliCommand = (args) => command(process.execPath, [cli, ...args], undefined, cliEnvironment);
  const original = digest(readFileSync('supabase/config.toml'));
  const existing = command('docker', ['ps', '-a', '--format', '{{.Names}}']);
  const volumes = command('docker', ['volume', 'ls', '--format', '{{.Name}}']);
  const networks = command('docker', ['network', 'ls', '--format', '{{.Name}}']);
  assert.ok(![existing, volumes, networks].some((text) => text.includes(id)));
  const root = mkdtempSync(path.join(tmpdir(), 'flyeye-nosend-'));
  mkdirSync(path.join(root, 'supabase/migrations'), { recursive: true });
  copyFileSync(
    `supabase/migrations/${migration}`,
    path.join(root, 'supabase/migrations', migration),
  );
  let ownsNetwork = false;
  let started = false;
  function start(hook) {
    writeFileSync(path.join(root, 'supabase/config.toml'), noSendLocalConfiguration(hook));
    if (!ownsNetwork) {
      // Internal networks did not publish the DB host port on the verified engine.
      // Email containment instead uses the owned, non-relaying local SMTP sink.
      command('docker', [
        'network',
        'create',
        '--driver',
        'bridge',
        '--opt',
        'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
        network,
      ]);
      ownsNetwork = true;
    }
    started = true; // partial startup must also be cleaned up
    cliCommand([
      'start',
      '--workdir',
      root,
      '--network-id',
      network,
      '--exclude',
      'studio,meta,realtime,storage-api,imgproxy,edge-runtime,analytics,vector',
    ]);
    verifyLocalMailBoundary();
    process.stdout.write(
      'No-send compatibility: loopback bindings and local SMTP containment passed.\n',
    );
  }
  return {
    start,
    enableHook() {
      cliCommand(['stop', '--project-id', id, '--workdir', root]);
      start(true);
    },
    status(observe = () => {}) {
      observe('status-command', 'entered');
      const output = cliCommand(['status', '--workdir', root, '-o', 'json']);
      observe('status-command', 'passed');
      observe('status-json', 'entered');
      const status = JSON.parse(output);
      observe('status-json', 'passed');
      observe('status-origin', 'entered');
      assert.equal(new URL(status.API_URL).hostname, '127.0.0.1');
      assert.equal(new URL(status.API_URL).port, '58321');
      observe('status-origin', 'passed');
      return status;
    },
    sql(sql) {
      return command(
        'docker',
        [
          'exec',
          '-i',
          `supabase_db_${id}`,
          'psql',
          '-X',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-At',
          '-v',
          'ON_ERROR_STOP=1',
        ],
        sql,
      ).trim();
    },
    logsContain(values) {
      const result = spawnSync('docker', ['logs', `supabase_auth_${id}`], {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      if (result.status !== 0 || result.error || result.signal)
        throw new Error('Auth log inspection unavailable.');
      const logs = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      return values.some((value) => value && logs.includes(value));
    },
    close() {
      if (started) cliCommand(['stop', '--no-backup', '--project-id', id, '--workdir', root]);
      if (ownsNetwork) command('docker', ['network', 'rm', network]);
      assert.ok(!command('docker', ['ps', '-a', '--format', '{{.Names}}']).includes(id));
      assert.ok(!command('docker', ['volume', 'ls', '--format', '{{.Name}}']).includes(id));
      assert.equal(digest(readFileSync('supabase/config.toml')), original);
      assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
      rmSync(root, { recursive: true, force: true });
    },
  };
}
