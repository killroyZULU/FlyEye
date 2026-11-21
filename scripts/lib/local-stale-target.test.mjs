// @vitest-environment node
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  localStaleRequest,
  localStaleContainer,
  localStaleNetworkArgs,
  localStaleProfile,
  verifyLocalStaleTarget,
  verifyLocalStaleEndpoints,
  isLocalStaleTarget,
} from './local-stale-target.mjs';
import { localStaleTemplates } from './local-stale-template-mounts.mjs';
import { reportBootstrapFailure } from './onboarding-bootstrap-diagnostics.mjs';
import { observeOnboardingLogin } from './onboarding-login-diagnostics.mjs';

const approvedAt = '2026-11-13T00:00:00.000Z';
const createdAt = '2026-11-13T00:00:01.000Z';
const now = Date.parse('2026-11-13T00:01:00.000Z');
const privateCanary = 'synthetic-private-inspection-material';
const services = ['db', 'auth', 'kong', 'inbucket', 'rest'];
function fixture() {
  const projectId = localStaleProfile.projectId;
  const root = path.join(realpathSync(tmpdir()), `flyeye-stale-${randomBytes(16).toString('hex')}`);
  mkdirSync(root, { mode: 0o700 });
  onTestFinished(() => {
    expect(path.dirname(realpathSync(root))).toBe(realpathSync(tmpdir()));
    expect(path.basename(root)).toMatch(/^flyeye-stale-[a-f0-9]{32}$/);
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(path.join(root, 'supabase/templates'), { recursive: true, mode: 0o700 });
  for (const { file } of localStaleTemplates)
    writeFileSync(
      path.join(root, 'supabase/templates', file),
      readFileSync(new URL('../../supabase/templates/' + file, import.meta.url)),
      { mode: 0o600 },
    );
  const config = `project_id = "${projectId}"\n`;
  const receiptPath = path.join(root, 'local-stale-target.json');
  const ids = Object.fromEntries(services.map((service, i) => [service, String(i + 1).repeat(64)]));
  const volume = `supabase_db_${projectId}`;
  const networkId = 'a'.repeat(64);
  const networkName = localStaleProfile.network;
  const receipt = {
    version: 1,
    purpose: 'one-local-stale-factors-observation',
    root,
    projectId,
    approvedAt,
    expiresAt: '2026-11-13T00:30:00.000Z',
    daemonId: 'local-daemon',
    configSha256: createHash('sha256').update(config).digest('hex'),
    containers: ids,
    networkId,
    ports: { api: 58321, database: 58322, mail: 58324 },
    volumes: [volume],
  };
  const containers = services.map((service) => ({
    Id: ids[service],
    Name: `/supabase_${service}_${projectId}`,
    Created: createdAt,
    State: { Running: true },
    HostConfig: { Privileged: false },
    Config: {
      Labels: { 'com.supabase.cli.project': projectId },
      Image: 'axllent/mailpit:v1.22.3',
      Env:
        service === 'auth'
          ? [
              `GOTRUE_SMTP_HOST=supabase_inbucket_${projectId}`,
              'GOTRUE_SMTP_PORT=1025',
              `PRIVATE_KEY=${privateCanary}`,
            ]
          : [],
      Entrypoint: [],
      Cmd: [],
    },
    NetworkSettings: {
      Networks: { [networkName]: { NetworkID: networkId } },
      Ports: Object.fromEntries(
        (
          {
            db: [['5432/tcp', 58322]],
            kong: [['8000/tcp', 58321]],
            inbucket: [['8025/tcp', 58324]],
          }[service] ?? []
        ).map(([port, value]) => [port, [{ HostIp: '127.0.0.1', HostPort: String(value) }]]),
      ),
    },
    Mounts:
      service === 'db'
        ? [{ Type: 'volume', Name: volume }]
        : service === 'kong'
          ? localStaleTemplates.map(({ file }) => ({
              Type: 'bind',
              Source: path.join(root, 'supabase/templates', file),
              Destination: '/home/kong/templates/email/' + file,
              RW: true,
              Mode: 'rw',
              Propagation: 'rprivate',
            }))
          : [],
  }));
  const state = {
    context: [{ Endpoints: { docker: { Host: 'unix:///var/run/docker.sock' } } }],
    daemon: receipt.daemonId,
    inventory: Object.values(ids).join('\n'),
    network: [
      {
        Id: networkId,
        Name: networkName,
        Created: createdAt,
        Driver: 'bridge',
        Labels: { 'flyeye.fixture.owner': path.basename(root) },
        Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' },
        Containers: Object.fromEntries(Object.values(ids).map((id) => [id, {}])),
      },
    ],
    containers,
    volumes: [{ Name: volume, Driver: 'local', CreatedAt: createdAt, Options: null }],
    volumeUsers: ids.db,
    attachmentContainers: null,
    empty: 'BEGIN\n0\nCOMMIT',
  };
  const execute = vi.fn((program, args, options) => {
    expect(program).toBe('docker');
    expect(options.timeout).toBe(30000);
    expect(options.maxBuffer).toBe(2 * 1024 * 1024);
    let value;
    if (args[0] === 'context') value = state.context;
    else if (args[0] === 'info') value = state.daemon;
    else if (args[0] === 'ps')
      value =
        args[2] === '--format'
          ? (state.attachmentContainers ?? state.containers).map((c) => c.Id).join('\n')
          : args[3].startsWith('label=')
            ? state.inventory
            : state.volumeUsers;
    else if (args[0] === 'network') value = state.network;
    else if (args[0] === 'inspect')
      value =
        args[1] === '--type'
          ? (state.attachmentContainers ?? state.containers)
              .map(({ Id, Mounts }) => JSON.stringify({ Id, Mounts }))
              .join('\n')
          : state.containers;
    else if (args[0] === 'volume') value = state.volumes;
    else if (args[0] === 'exec') {
      expect(args[2]).toBe(ids.db);
      expect(options.input).toContain('begin read only;');
      expect(options.input).not.toMatch(/delete|update|insert|truncate|drop/i);
      value = state.empty;
    } else throw new Error(privateCanary);
    return { status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) };
  });
  const options = {
    readLease: () => JSON.stringify({ root, projectId, approvedAt }),
    receiptPath,
    root,
    scriptRoot: root,
    config,
    projectId,
    now,
    environment: {},
    execute,
  };
  const run = () => {
    writeFileSync(receiptPath, JSON.stringify(receipt));
    return verifyLocalStaleTarget(options);
  };
  return { root, projectId, receipt, state, options, execute, run };
}

describe('explicit local stale-factors selection', () => {
  const target = path.resolve('synthetic-receipt.json');
  const local = { FLYEYE_RUNTIME_DIAGNOSTICS: '1' };
  it('retains existing CI selection and requires explicit local approval input', () => {
    expect(
      localStaleRequest(['--stale-factors'], true, { CI: 'true', GITHUB_ACTIONS: 'true' }),
    ).toBeUndefined();
    expect(localStaleRequest([], false, {})).toBeUndefined();
    expect(() => localStaleRequest(['--stale-factors'], true, local)).toThrow(
      'require disposable GitHub Actions',
    );
    expect(
      localStaleRequest(['--stale-factors', '--local-stale-target', target], true, local),
    ).toBe(target);
    expect(local).toEqual({ FLYEYE_RUNTIME_DIAGNOSTICS: '1' });
  });
  it.each([
    ['--stale-cleanup-probe', '--local-stale-target', target],
    ['--factor-churn', '--local-stale-target', target],
    ['--stale-factors', '--local-stale-target'],
    ['--stale-factors', '--local-stale-target', 'relative.json'],
    ['--stale-factors', '--local-stale-target', target, '--stale-cleanup-probe'],
    ['--local-stale-target', target],
  ])('rejects other modes, ambiguous or missing arguments: %j', (...args) => {
    expect(() => localStaleRequest(args, true, local)).toThrow('rejected');
  });
  it.each([{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }, { FLYEYE_RUNTIME_DIAGNOSTICS: '0' }])(
    'rejects mixed CI/local or disabled diagnostics %j',
    (override) => {
      expect(() =>
        localStaleRequest(['--stale-factors', '--local-stale-target', target], true, {
          ...local,
          ...override,
        }),
      ).toThrow('rejected');
    },
  );
});

describe('disposable target attestation', () => {
  it('binds fresh exclusive resources and endpoints without exposing inspection content', () => {
    const f = fixture();
    const capability = f.run();
    expect(capability).toEqual({});
    expect(isLocalStaleTarget(capability, f.projectId)).toBe(true);
    expect(isLocalStaleTarget({}, f.projectId)).toBe(false);
    expect(isLocalStaleTarget(undefined, undefined)).toBe(false);
    expect(localStaleContainer(capability, f.projectId, 'db')).toBe(f.receipt.containers.db);
    expect(localStaleContainer(capability, f.projectId, 'auth')).toBe(f.receipt.containers.auth);
    expect(localStaleNetworkArgs(capability, f.projectId)).toEqual([
      '--network-id',
      localStaleProfile.network,
    ]);
    expect(() => localStaleContainer({}, f.projectId, 'db')).toThrow('rejected');
    expect(() => localStaleContainer(capability, f.projectId, 'kong')).toThrow('rejected');
    expect(() =>
      verifyLocalStaleEndpoints(capability, f.projectId, {
        API_URL: 'http://127.0.0.1:58321',
        DB_URL: `postgresql://postgres:${privateCanary}@127.0.0.1:58322/postgres`,
      }),
    ).not.toThrow();
    expect(JSON.stringify(capability)).not.toContain(privateCanary);
    expect(existsSync(path.join(f.root, 'local-stale-target.consumed'))).toBe(true);
    const count = f.execute.mock.calls.length;
    expect(() => f.run()).toThrow('rejected');
    expect(f.execute).toHaveBeenCalledTimes(count);
  });
  it.each([
    'missing',
    'oversize',
    'malformed',
    'unexpected-field',
    'expired',
    'future',
    'too-long',
    'wrong-root',
    'wrong-script',
    'shared-project',
    'wrong-config',
    'wrong-container-id',
    'wrong-network-id',
    'invalid-port',
    'shared-volume',
    'docker-host',
    'docker-context',
    'missing-lease',
    'foreign-lease',
    'unique-project',
    'different-profile-ports',
  ])('rejects %s before child processes or credential access', (scenario) => {
    const f = fixture();
    if (scenario === 'unexpected-field') f.receipt.secret = privateCanary;
    if (scenario === 'expired') f.options.now += 3600000;
    if (scenario === 'future') f.options.now -= 3600000;
    if (scenario === 'too-long') f.receipt.expiresAt = '2026-11-14T00:00:00.000Z';
    if (scenario === 'wrong-root') f.receipt.root = path.dirname(f.root);
    if (scenario === 'wrong-script') f.options.scriptRoot = path.dirname(f.root);
    if (scenario === 'shared-project') f.options.projectId = 'flyeye';
    if (scenario === 'wrong-config') f.options.config += 'changed';
    if (scenario === 'wrong-container-id') f.receipt.containers.db = privateCanary;
    if (scenario === 'wrong-network-id') f.receipt.networkId = privateCanary;
    if (scenario === 'invalid-port') f.receipt.ports.api = 443;
    if (scenario === 'shared-volume') f.receipt.volumes = ['supabase_db_flyeye'];
    if (scenario === 'docker-host') f.options.environment.DOCKER_HOST = 'tcp://remote.invalid';
    if (scenario === 'docker-context') f.options.environment.DOCKER_CONTEXT = 'remote';
    if (scenario === 'missing-lease')
      f.options.readLease = () => {
        throw new Error(privateCanary);
      };
    if (scenario === 'foreign-lease')
      f.options.readLease = () =>
        JSON.stringify({ root: 'foreign', projectId: f.projectId, approvedAt });
    if (scenario === 'unique-project') f.options.projectId = 'flyeye-stale-' + 'a'.repeat(32);
    if (scenario === 'different-profile-ports') f.receipt.ports.api = 59321;
    writeFileSync(
      f.options.receiptPath,
      scenario === 'oversize'
        ? 'x'.repeat(16385)
        : scenario === 'malformed'
          ? privateCanary
          : JSON.stringify(f.receipt),
    );
    if (scenario === 'missing') f.options.receiptPath = path.join(f.root, 'missing');
    expect(() => verifyLocalStaleTarget(f.options)).toThrow(
      'Disposable local stale-factors target rejected.',
    );
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([
    'remote-context',
    'wrong-daemon',
    'extra-container',
    'network-owner',
    'network-member',
    'old-network',
    'wrong-name',
    'wrong-id',
    'wrong-label',
    'stopped',
    'old-container',
    'second-network',
    'network-id',
    'wildcard',
    'wrong-port',
    'writable-bind',
    'foreign-volume',
    'volume-driver',
    'old-volume',
    'volume-shared',
    'smtp-remote',
    'smtp-auth',
    'auth-hook',
    'mail-relay',
    'mail-arguments',
    'mail-mount',
    'mail-image',
  ])('rejects %s before database reads or fixture mutation', (scenario) => {
    const f = fixture();
    const db = f.state.containers[0],
      auth = f.state.containers[1],
      mail = f.state.containers[3];
    if (scenario === 'remote-context')
      f.state.context[0].Endpoints.docker.Host = 'ssh://remote.invalid';
    if (scenario === 'wrong-daemon') f.state.daemon = 'other';
    if (scenario === 'extra-container') f.state.inventory += '\n' + 'f'.repeat(64);
    if (scenario === 'network-owner') f.state.network[0].Labels = {};
    if (scenario === 'network-member') f.state.network[0].Containers.extra = {};
    if (scenario === 'old-network') f.state.network[0].Created = '2025-01-01';
    if (scenario === 'wrong-name') db.Name = '/supabase_db_flyeye';
    if (scenario === 'wrong-id') db.Id = 'f'.repeat(64);
    if (scenario === 'wrong-label') db.Config.Labels = {};
    if (scenario === 'stopped') db.State.Running = false;
    if (scenario === 'old-container') db.Created = '2025-01-01';
    if (scenario === 'second-network') db.NetworkSettings.Networks.other = {};
    if (scenario === 'network-id')
      Object.values(db.NetworkSettings.Networks)[0].NetworkID = 'f'.repeat(64);
    if (scenario === 'wildcard') db.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0';
    if (scenario === 'wrong-port') db.NetworkSettings.Ports['5432/tcp'][0].HostPort = '55322';
    if (scenario === 'writable-bind') db.Mounts.push({ Type: 'bind', RW: true });
    if (scenario === 'foreign-volume') db.Mounts[0].Name = 'supabase_db_flyeye';
    if (scenario === 'volume-driver') f.state.volumes[0].Driver = 'nfs';
    if (scenario === 'old-volume') f.state.volumes[0].CreatedAt = '2025-01-01';
    if (scenario === 'volume-shared') f.state.volumeUsers += '\n' + 'f'.repeat(64);
    if (scenario === 'smtp-remote') auth.Config.Env[0] = 'GOTRUE_SMTP_HOST=remote.invalid';
    if (scenario === 'smtp-auth') auth.Config.Env.push(`GOTRUE_SMTP_PASS=${privateCanary}`);
    if (scenario === 'auth-hook')
      auth.Config.Env.push('GOTRUE_HOOK_SEND_EMAIL_URI=https://remote.invalid');
    if (scenario === 'mail-relay') mail.Config.Env.push(`MP_SMTP_RELAY_CONFIG=${privateCanary}`);
    if (scenario === 'mail-arguments') mail.Config.Cmd.push('--smtp-relay-config');
    if (scenario === 'mail-mount') mail.Mounts.push({ Type: 'bind', RW: false });
    if (scenario === 'mail-image') mail.Config.Image = 'unknown:smtp';
    expect(() => f.run()).toThrow('Disposable local stale-factors target rejected.');
    expect(f.execute.mock.calls.some(([, args]) => args[0] === 'exec')).toBe(false);
  });
  it.each(['populated', 'unreadable', 'spawn-error', 'bad-json'])(
    'rejects %s evidence with no secret/error echo',
    (scenario) => {
      const f = fixture();
      if (scenario === 'populated') f.state.empty = '1';
      if (scenario === 'unreadable') f.state.empty = privateCanary;
      if (scenario === 'spawn-error')
        f.execute.mockImplementation(() => ({ status: 1, stderr: privateCanary }));
      if (scenario === 'bad-json')
        f.execute.mockImplementation(() => ({ status: 0, stdout: privateCanary }));
      expect(() => f.run()).toThrow('Disposable local stale-factors target rejected.');
    },
  );
  it.each(['remote-api', 'wrong-api-port', 'remote-db', 'wrong-db-port', 'wrong-project'])(
    'rejects status endpoint mismatch %s',
    (scenario) => {
      const f = fixture(),
        capability = f.run();
      const status = {
        API_URL: 'http://127.0.0.1:58321',
        DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:58322/postgres',
      };
      if (scenario === 'remote-api') status.API_URL = 'https://remote.invalid';
      if (scenario === 'wrong-api-port') status.API_URL = 'http://127.0.0.1:55321';
      if (scenario === 'remote-db') status.DB_URL = 'postgresql://remote.invalid/postgres';
      if (scenario === 'wrong-db-port') status.DB_URL = 'postgresql://127.0.0.1:55322/postgres';
      expect(() =>
        verifyLocalStaleEndpoints(
          capability,
          scenario === 'wrong-project' ? 'flyeye' : f.projectId,
          status,
        ),
      ).toThrow('rejected');
    },
  );
});

describe('local trace wiring', () => {
  it('permits only trace categories after verified local ownership, without response or provider reads', async () => {
    const f = fixture(),
      capability = f.run();
    const body = vi.fn(),
      collect = vi.fn(),
      report = vi.fn();
    const options = {
      projectId: f.projectId,
      localStaleTarget: capability,
      response: { body },
      collect,
      report,
      traceDetail: 'bootstrap-trace-handler-503',
      ci: 'false',
      githubActions: 'false',
    };
    await reportBootstrapFailure(options);
    expect(report).toHaveBeenCalledExactlyOnceWith(
      'bootstrap-trace',
      'response',
      'bootstrap-trace-handler-503',
    );
    expect(body).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
    report.mockClear();
    await reportBootstrapFailure({ ...options, localStaleTarget: {} });
    await reportBootstrapFailure({ ...options, traceDetail: privateCanary });
    expect(report).not.toHaveBeenCalled();
    await reportBootstrapFailure({ ...options, traceDetail: undefined });
    expect(report).toHaveBeenCalledExactlyOnceWith(
      'bootstrap-trace',
      'response',
      'bootstrap-trace-unknown',
    );
    report.mockClear();
    const page = new EventEmitter();
    const observer = observeOnboardingLogin(
      page,
      report,
      'http://127.0.0.1:58321',
      {
        begin() {},
        finish: () => 'bootstrap-trace-handler-503',
      },
      capability,
    );
    observer.begin();
    await observer.diagnoseFailure(f.projectId);
    observer.dispose();
    expect(report).toHaveBeenCalledWith(
      'bootstrap-trace',
      'response',
      'bootstrap-trace-handler-503',
    );
    expect(page.eventNames()).toEqual([]);
  });
  it('checks ownership before local status credentials and keeps local activation out of other modes', () => {
    const source = readFileSync(new URL('../test-feat-003-runtime.mjs', import.meta.url), 'utf8');
    expect(source.indexOf('localStaleTarget = verifyLocalStaleTarget(')).toBeLessThan(
      source.indexOf('const local = localStatus();'),
    );
    expect(source.indexOf('verifyLocalStaleEndpoints(localStaleTarget')).toBeLessThan(
      source.indexOf('const apiUrl = local.API_URL;'),
    );
    expect(source).not.toMatch(/process\.env\.(?:CI|GITHUB_ACTIONS)\s*=(?!=)/);
  });
});

describe('local target preflight observations', () => {
  it.each([
    [
      'receipt',
      (f) => {
        f.receipt.configSha256 = 'b'.repeat(64);
      },
    ],
    [
      'daemon',
      (f) => {
        f.state.daemon = 'different-daemon';
      },
    ],
    [
      'network',
      (f) => {
        f.state.network[0].Driver = 'unexpected';
      },
    ],
    [
      'resources',
      (f) => {
        f.state.containers[0].State.Running = false;
      },
    ],
    [
      'smtp',
      (f) => {
        f.state.containers
          .find((c) => c.Id === f.receipt.containers.auth)
          .Config.Env.push('GOTRUE_SMTP_USER=' + privateCanary);
      },
    ],
    [
      'empty-data',
      (f) => {
        f.state.empty = 'BEGIN\n1\nCOMMIT';
      },
    ],
  ])(
    'retains denial and identifies the incomplete %s stage without its contents',
    (stage, alter) => {
      const f = fixture(),
        lines = [];
      f.options.environment = { FLYEYE_RUNTIME_DIAGNOSTICS: '1' };
      f.options.writeDiagnostic = (line) => lines.push(line);
      alter(f);
      expect(f.run).toThrow('Disposable local stale-factors target rejected.');
      expect(lines.at(-1)).toBe(
        stage === 'resources'
          ? 'FEAT-003 runtime diagnostic: stage=local-resource-db-state event=failed detail=unclassified.'
          : 'FEAT-003 runtime diagnostic: stage=local-preflight-target-' + stage + ' event=enter.',
      );
      expect(lines.join()).not.toContain(privateCanary);
      expect(lines.join()).not.toContain(f.root);
      expect(lines.join()).not.toContain(f.receipt.networkId);
    },
  );
  it('preserves the target capability when every diagnostic write fails', () => {
    const f = fixture();
    f.options.environment = { FLYEYE_RUNTIME_DIAGNOSTICS: '1' };
    f.options.writeDiagnostic = () => {
      throw Error(privateCanary);
    };
    expect(isLocalStaleTarget(f.run(), f.projectId)).toBe(true);
  });
});

describe('four owned Kong template exception', () => {
  it('admits reviewed private copies after complete exact-source inspection before SQL', () => {
    const f = fixture();
    expect(isLocalStaleTarget(f.run(), f.projectId)).toBe(true);
    const calls = f.execute.mock.calls.map(([, args]) => args);
    const binds = calls.filter((args) => args[0] === 'inspect' && args[1] === '--type');
    expect(binds).toHaveLength(1);
    expect(calls.findIndex((args) => args[0] === 'exec')).toBeGreaterThan(
      calls.findLastIndex((args) => binds.includes(args)),
    );
  });
  it.each([
    'external-source',
    'source-alias',
    'wrong-destination',
    'duplicate',
    'missing',
    'extra',
    'wrong-type',
    'wrong-mode',
    'propagation',
    'wrong-service',
    'shared-file',
    'unknown-sharing',
    'content-change',
  ])('rejects %s before SQL and preserves sanitized failure', (scenario) => {
    const f = fixture(),
      kong = f.state.containers[2],
      mount = kong.Mounts[0];
    if (scenario === 'external-source')
      mount.Source = path.join(path.dirname(f.root), 'outside.html');
    if (scenario === 'source-alias')
      mount.Source = f.root + '/supabase/templates/../templates/recovery.html';
    if (scenario === 'wrong-destination') mount.Destination += '/unexpected';
    if (scenario === 'duplicate') kong.Mounts[1] = { ...mount };
    if (scenario === 'missing') kong.Mounts.pop();
    if (scenario === 'extra') kong.Mounts.push({ ...mount });
    if (scenario === 'wrong-type') mount.Type = 'volume';
    if (scenario === 'wrong-mode') mount.Mode = 'rw,z';
    if (scenario === 'propagation') mount.Propagation = 'rshared';
    if (scenario === 'wrong-service') f.state.containers[1].Mounts.push({ ...mount });
    if (scenario === 'shared-file')
      f.state.attachmentContainers = [
        ...f.state.containers,
        { Id: 'f'.repeat(64), Mounts: [{ ...mount, Destination: '/different' }] },
      ];
    if (scenario === 'unknown-sharing') f.state.attachmentContainers = [];
    if (scenario === 'content-change') writeFileSync(mount.Source, privateCanary);
    expect(f.run).toThrow('Disposable local stale-factors target rejected.');
    expect(f.execute.mock.calls.some(([, args]) => args[0] === 'exec')).toBe(false);
  });
});

describe('resource subcheck attribution', () => {
  it.each(services)(
    'uses the fixed %s service category without inspection identifiers',
    (service) => {
      const f = fixture(),
        lines = [];
      f.options.environment = { FLYEYE_RUNTIME_DIAGNOSTICS: '1' };
      f.options.writeDiagnostic = (line) => lines.push(line);
      f.state.containers[services.indexOf(service)].Name = privateCanary;
      expect(f.run).toThrow('Disposable local stale-factors target rejected.');
      expect(lines.at(-1)).toBe(
        'FEAT-003 runtime diagnostic: stage=local-resource-' +
          service +
          '-name event=failed detail=unclassified.',
      );
      expect(lines.join()).not.toContain(privateCanary);
      expect(lines.join()).not.toContain(f.root);
      expect(f.execute.mock.calls.some(([, args]) => args[0] === 'exec')).toBe(false);
    },
  );
  it.each([
    [
      'container-count',
      (f) => {
        f.state.containers.pop();
      },
    ],
    [
      'db-label',
      (f) => {
        f.state.containers[0].Config.Labels = {};
      },
    ],
    [
      'db-state',
      (f) => {
        f.state.containers[0].State.Running = false;
      },
    ],
    [
      'db-created',
      (f) => {
        f.state.containers[0].Created = '2000-01-01';
      },
    ],
    [
      'db-network-set',
      (f) => {
        f.state.containers[0].NetworkSettings.Networks.extra = {};
      },
    ],
    [
      'db-network-id',
      (f) => {
        Object.values(f.state.containers[0].NetworkSettings.Networks)[0].NetworkID = 'b'.repeat(64);
      },
    ],
    [
      'db-bindings-read',
      (f) => {
        delete f.state.containers[0].NetworkSettings.Ports;
      },
    ],
    [
      'db-bindings-loopback',
      (f) => {
        f.state.containers[0].NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0';
      },
    ],
    [
      'db-required-port',
      (f) => {
        f.state.containers[0].NetworkSettings.Ports['5432/tcp'][0].HostPort = '1';
      },
    ],
    [
      'db-mount-kind',
      (f) => {
        f.state.containers[0].Mounts.push({ Type: 'bind', RW: true });
      },
    ],
    [
      'db-mount-owned',
      (f) => {
        f.state.containers[0].Mounts[0].Name = privateCanary;
      },
    ],
    [
      'volume-set',
      (f) => {
        f.state.containers[0].Mounts = [];
      },
    ],
    [
      'volume-identity',
      (f) => {
        f.state.volumes[0].Driver = 'other';
      },
    ],
    [
      'volume-options',
      (f) => {
        f.state.volumes[0].Options = { unexpected: privateCanary };
      },
    ],
    [
      'volume-created',
      (f) => {
        f.state.volumes[0].CreatedAt = '2000-01-01';
      },
    ],
    [
      'volume-attachments-owned',
      (f) => {
        f.state.volumeUsers += '\n' + 'f'.repeat(64);
      },
    ],
    [
      'template-destination',
      (f) => {
        f.state.containers[2].Mounts[0].Destination = privateCanary;
      },
    ],
    [
      'template-source',
      (f) => {
        f.state.containers[2].Mounts[0].Source = privateCanary;
      },
    ],
    [
      'template-content',
      (f) => {
        writeFileSync(f.state.containers[2].Mounts[0].Source, privateCanary);
      },
    ],
    [
      'template-attachments-exclusive',
      (f) => {
        f.state.attachmentContainers = structuredClone(f.state.containers);
        f.state.attachmentContainers[2].Mounts.pop();
      },
    ],
  ])('reports %s and retains the original denial without SQL', (category, alter) => {
    const f = fixture(),
      lines = [];
    f.options.environment = { FLYEYE_RUNTIME_DIAGNOSTICS: '1' };
    f.options.writeDiagnostic = (line) => lines.push(line);
    alter(f);
    expect(f.run).toThrow('Disposable local stale-factors target rejected.');
    expect(lines.filter((line) => line.includes('stage=local-resource-'))).toEqual([
      'FEAT-003 runtime diagnostic: stage=local-resource-' +
        category +
        ' event=failed detail=unclassified.',
    ]);
    expect(lines.join()).not.toContain(privateCanary);
    expect(lines.join()).not.toContain(f.root);
    expect(f.execute.mock.calls.some(([, args]) => args[0] === 'exec')).toBe(false);
  });
  it('clears resource attribution before a later SMTP failure', () => {
    const f = fixture(),
      lines = [];
    f.options.environment = { FLYEYE_RUNTIME_DIAGNOSTICS: '1' };
    f.options.writeDiagnostic = (line) => lines.push(line);
    f.state.containers[1].Config.Env.push('GOTRUE_SMTP_USER=' + privateCanary);
    expect(f.run).toThrow('Disposable local stale-factors target rejected.');
    expect(lines.some((line) => line.includes('stage=local-resource-'))).toBe(false);
  });
});

it('retains resource denial and no SQL when the diagnostic sink fails', () => {
  const f = fixture();
  f.options.environment = { FLYEYE_RUNTIME_DIAGNOSTICS: '1' };
  f.options.writeDiagnostic = () => {
    throw Error(privateCanary);
  };
  f.state.containers[0].State.Running = false;
  expect(f.run).toThrow('Disposable local stale-factors target rejected.');
  expect(f.execute.mock.calls.some(([, args]) => args[0] === 'exec')).toBe(false);
});
