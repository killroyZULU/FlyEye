// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { withPreparedLocalStaleProject } from './local-stale-preparation.mjs';
import { localStaleProfile } from './local-stale-target.mjs';
import {
  prepareStaleWorkspace,
  removeStaleWorkspace,
  staleConfiguration,
  staleSourceInventory,
} from './local-stale-workspace.mjs';

const original = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
const secret = 'synthetic-private-output';
const digest = 'b'.repeat(64);
const projectId = localStaleProfile.projectId,
  network = localStaleProfile.network;
const created = '2026-11-13T00:00:01.000Z';
const createRoot = () => {
  const root = path.join(realpathSync(tmpdir()), `flyeye-stale-${randomBytes(16).toString('hex')}`);
  mkdirSync(root);
  onTestFinished(() => {
    if (existsSync(root)) removeStaleWorkspace(root);
  });
  return root;
};

function harness() {
  const root = createRoot(),
    temporary = createRoot();
  const leasePath = path.join(temporary, 'test.lock');
  const state = { containers: [], networks: [], volumes: [], fail: '', collision: false };
  const preexisting = {
    Id: 'f'.repeat(64),
    Name: '/preserve-existing',
    Image: 'preserve',
    State: { Running: true, StartedAt: created },
    RestartCount: 0,
    Mounts: [],
  };
  const networkId = 'a'.repeat(64);
  const volumeName = `supabase_db_${projectId}`;
  const makeContainer = (service, i) => ({
    Id: String(i + 1).repeat(64),
    Name: `/supabase_${service}_${projectId}`,
    Created: created,
    Config: { Labels: { 'com.supabase.cli.project': projectId } },
    State: { Running: true, StartedAt: created },
    RestartCount: 0,
    Image: 'pinned',
    NetworkSettings: { Networks: { [network]: { NetworkID: networkId } } },
    Mounts: service === 'db' ? [{ Type: 'volume', Name: volumeName }] : [],
  });
  const execute = vi.fn((program, args, options) => {
    let value = '';
    if (program !== 'docker') {
      expect(program).toBe(process.execPath);
      expect(args).toContain('start');
      expect(args).not.toContain('reset');
      expect(args).toContain(network);
      expect(options.env.SUPABASE_GO_BINARY).toBe('/verified/unchanged-artifact');
      expect(options.env.SUPABASE_ACCESS_TOKEN).toBeUndefined();
      expect(options.timeout).toBe(180000);
      expect(options.maxBuffer).toBe(8 * 1024 * 1024);
      state.containers = ['db', 'auth', 'kong', 'inbucket', 'rest'].map(makeContainer);
      // Pinned CLI 2.109.1 starts pg-meta when Studio is enabled unless its
      // image basename, postgres-meta, is excluded. Excluding studio alone
      // or the invalid shorthand meta does not exclude this service.
      if (state.exerciseStudioExclusion) {
        const excluded = args[args.indexOf('--exclude') + 1].split(',');
        if (!excluded.includes('postgres-meta')) state.containers.push(makeContainer('pg_meta', 5));
      }
      state.volumes = [
        { Name: volumeName, CreatedAt: created, Labels: { 'com.supabase.cli.project': projectId } },
      ];
      if (state.startupResult) return state.startupResult;
      if (state.fail === 'startup') return { status: 1, stderr: secret };
      if (state.fail === 'startup-timeout')
        return { status: null, error: { code: 'ETIMEDOUT' }, stderr: secret };
      return { status: 0, stdout: secret }; // suppressed, never exposed
    }
    expect(options.env.SUPABASE_GO_BINARY).toBeUndefined();
    if (args[0] === 'context')
      value = [
        {
          Endpoints: {
            docker: {
              Host:
                state.fail === 'remote' ? 'ssh://remote.invalid' : 'unix:///var/run/docker.sock',
            },
          },
        },
      ];
    else if (args[0] === 'info') value = 'local-daemon';
    else if (args[0] === 'ps') {
      if (args.includes('-aq'))
        value = [preexisting.Id, ...state.containers.map((item) => item.Id)].join('\n');
      else if (args.some((item) => item.startsWith('volume=')))
        value = state.containers
          .filter((item) => item.Mounts.length)
          .map((item) => item.Id)
          .join('\n');
      else
        value = state.containers
          .map((item) => item.Id)
          .sort()
          .join('\n');
    } else if (args[0] === 'inspect')
      value = [preexisting, ...state.containers].filter((item) => args.includes(item.Id));
    else if (args[0] === 'network' && args[1] === 'ls')
      value = state.networks.map((item) => `${item.Id}|${item.Name}`).join('\n');
    else if (args[0] === 'volume' && args[1] === 'ls')
      value = state.volumes.map((item) => item.Name).join('\n');
    else if (args[0] === 'network' && args[1] === 'create') {
      if (state.collision) return { status: 1, stderr: secret };
      state.networks = [
        { Id: networkId, Name: network, Labels: { 'flyeye.fixture.owner': path.basename(root) } },
      ];
      value = networkId;
    } else if (args[0] === 'network' && args[1] === 'inspect')
      value = state.networks.map((item) => ({
        ...item,
        Containers: Object.fromEntries(state.containers.map((container) => [container.Id, {}])),
      }));
    else if (args[0] === 'volume' && args[1] === 'inspect') value = state.volumes;
    else if (args[0] === 'rm') {
      expect(args).not.toContain(preexisting.Id);
      if (state.fail === 'cleanup') return { status: 1, stderr: secret };
      state.containers = state.containers.filter((item) => !args.includes(item.Id));
    } else if (args[0] === 'volume' && args[1] === 'rm') state.volumes = [];
    else if (args[0] === 'network' && args[1] === 'rm') state.networks = [];
    else throw new Error(secret);
    return { status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) };
  });
  const prepare = vi.fn(() => ({
    root,
    configuration: staleConfiguration(original),
    sourceDigest: digest,
  }));
  const verifyArtifact = vi.fn(() => ({ SUPABASE_GO_BINARY: '/verified/unchanged-artifact' }));
  const remove = vi.fn((value) => removeStaleWorkspace(value));
  const options = {
    expectedSourceDigest: digest,
    platform: 'linux',
    version: 'v24.14.0',
    environment: { SUPABASE_ACCESS_TOKEN: secret },
    execute,
    verifyArtifact,
    prepare,
    remove,
    inventorySource: () => ({ digest }),
    leasePath,
    clock: () => Date.parse('2026-11-13T00:00:00.000Z'),
  };
  return {
    root,
    state,
    options,
    execute,
    prepare,
    verifyArtifact,
    remove,
    leasePath,
    makeContainer,
    preexisting,
  };
}

describe('bounded stale preparation lifecycle', () => {
  it.each([false, true])(
    'preserves the five-service boundary with Studio enabled (old shorthand: %s)',
    async (oldShorthand) => {
      const h = harness();
      expect(staleConfiguration(original)).toMatch(/\[studio\]\s+enabled = true/);
      h.state.exerciseStudioExclusion = true;
      if (oldShorthand)
        h.options.execute = (program, args, options) =>
          h.execute(
            program,
            program === process.execPath
              ? args.map((arg) => arg.replace('postgres-meta', 'meta'))
              : args,
            options,
          );
      const observe = vi.fn(async (input) => {
        const receipt = JSON.parse(readFileSync(input.receiptPath));
        expect(Object.keys(receipt.containers).sort()).toEqual([
          'auth',
          'db',
          'inbucket',
          'kong',
          'rest',
        ]);
        return { exitCode: 0, childrenSettled: true };
      });
      const result = await withPreparedLocalStaleProject(observe, h.options);
      const starts = h.execute.mock.calls.filter(([program]) => program === process.execPath);
      expect(starts).toHaveLength(1);
      const excluded = starts[0][1][starts[0][1].indexOf('--exclude') + 1].split(',');
      expect(excluded).toContain('studio');
      expect(excluded).toContain(oldShorthand ? 'meta' : 'postgres-meta');
      expect(excluded).not.toContain(oldShorthand ? 'postgres-meta' : 'meta');
      expect(result).toMatchObject(
        oldShorthand
          ? { outcome: 'failed', stage: 'receipt', cleanup: 'uncertain' }
          : { outcome: 'passed', stage: 'observation', cleanup: 'passed' },
      );
      expect(observe).toHaveBeenCalledTimes(oldShorthand ? 0 : 1);
      if (oldShorthand) expect(h.remove).not.toHaveBeenCalled();
    },
  );
  it('ignores only mount order during complete lifecycle preservation checks', async () => {
    const h = harness();
    const first = { Type: 'bind', Source: '/synthetic/a', Destination: '/a', RW: false };
    const second = { Type: 'volume', Name: 'preserve-volume', Destination: '/b', RW: true };
    h.preexisting.Mounts = [first, second];
    const result = await withPreparedLocalStaleProject(async () => {
      h.preexisting.Mounts = [second, first];
      return { exitCode: 0, childrenSettled: true };
    }, h.options);
    expect(result).toMatchObject({ outcome: 'passed', cleanup: 'passed' });
    expect(h.remove).toHaveBeenCalledTimes(1);
  });
  it.each([
    'Id',
    'Name',
    'Image',
    'Running',
    'StartedAt',
    'RestartCount',
    'mount-field',
    'mount-added',
    'mount-removed',
    'mount-duplicate',
  ])('still retains the workspace on a real preexisting %s change', async (field) => {
    const h = harness();
    h.preexisting.Mounts = [{ Type: 'bind', Source: '/synthetic/a', Destination: '/a', RW: false }];
    const result = await withPreparedLocalStaleProject(async () => {
      if (field === 'Running') h.preexisting.State.Running = false;
      else if (field === 'StartedAt') h.preexisting.State.StartedAt = created + '-changed';
      else if (field === 'RestartCount') h.preexisting.RestartCount++;
      else if (field === 'mount-field') h.preexisting.Mounts[0].RW = true;
      else if (field === 'mount-added') h.preexisting.Mounts.push({ Type: 'volume', Name: 'new' });
      else if (field === 'mount-removed') h.preexisting.Mounts = [];
      else if (field === 'mount-duplicate')
        h.preexisting.Mounts.push({ ...h.preexisting.Mounts[0] });
      else h.preexisting[field] += '-changed';
      return { exitCode: 0, childrenSettled: true };
    }, h.options);
    expect(result).toMatchObject({ outcome: 'failed', cleanup: 'uncertain' });
    expect(h.remove).not.toHaveBeenCalled();
    expect(existsSync(h.leasePath)).toBe(true);
  });
  it('retains only sanitized startup failure evidence across a later cleanup failure', async () => {
    const h = harness();
    h.state.startupResult = {
      status: 1,
      stdout: secret,
      stderr: 'failed to apply migration: ' + secret,
    };
    h.state.fail = 'cleanup';
    const observe = vi.fn();
    const result = await withPreparedLocalStaleProject(observe, h.options);
    expect(result).toMatchObject({
      outcome: 'failed',
      stage: 'startup',
      cleanup: 'uncertain',
      startupFailure: {
        exitCode: 1,
        signal: 'none',
        error: 'none',
        output: 'available',
        category: 'migration',
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(observe).not.toHaveBeenCalled();
    expect(h.execute.mock.calls.filter(([program]) => program === process.execPath)).toHaveLength(
      1,
    );
  });
  it('records timeout metadata without changing uncertain-child retention', async () => {
    const h = harness();
    h.state.fail = 'startup-timeout';
    const result = await withPreparedLocalStaleProject(vi.fn(), h.options);
    expect(result).toMatchObject({
      outcome: 'failed',
      cleanup: 'uncertain',
      startupFailure: { exitCode: 'unknown', error: 'ETIMEDOUT', category: 'unknown' },
    });
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.execute.mock.calls.some(([, args]) => args.includes('rm'))).toBe(false);
  });
  it.each(['startup-timeout', 'observer-rejection', 'unsettled'])(
    'retains resources on %s instead of racing live children',
    async (scenario) => {
      const h = harness();
      if (scenario === 'startup-timeout') h.state.fail = scenario;
      const result = await withPreparedLocalStaleProject(async () => {
        if (scenario === 'observer-rejection') throw new Error(secret);
        return { exitCode: 1, childrenSettled: false };
      }, h.options);
      expect(result).toMatchObject({ outcome: 'failed', cleanup: 'uncertain' });
      expect(h.execute.mock.calls.some(([, args]) => args[0] === 'rm' || args[1] === 'rm')).toBe(
        false,
      );
      expect(existsSync(h.root)).toBe(true);
      expect(existsSync(h.leasePath)).toBe(true);
    },
  );
  it('starts only the verified profile, prepares one receipt, preserves existing resources and cleans up', async () => {
    const h = harness();
    const observe = vi.fn(async (input) => {
      expect(input.environment.SUPABASE_GO_BINARY).toBeUndefined();
      expect(input.environment.CI).toBeUndefined();
      expect(input.environment.GITHUB_ACTIONS).toBeUndefined();
      expect(input.environment.SUPABASE_ACCESS_TOKEN).toBeUndefined();
      expect(input.args.slice(1, 3)).toEqual(['--stale-factors', '--local-stale-target']);
      const receipt = JSON.parse(readFileSync(input.receiptPath));
      expect(receipt.projectId).toBe(projectId);
      expect(receipt.ports).toEqual(localStaleProfile.ports);
      expect(Object.keys(receipt.containers)).toHaveLength(5);
      expect(JSON.stringify(receipt)).not.toContain(secret);
      h.state.containers.push(h.makeContainer('edge_runtime', 5));
      return { exitCode: 0, childrenSettled: true };
    });
    expect(await withPreparedLocalStaleProject(observe, h.options)).toEqual({
      outcome: 'passed',
      stage: 'observation',
      cleanup: 'passed',
    });
    expect(observe).toHaveBeenCalledTimes(1);
    expect(h.verifyArtifact).toHaveBeenCalledTimes(2);
    expect(h.state.containers).toEqual([]);
    expect(h.state.volumes).toEqual([]);
    expect(h.state.networks).toEqual([]);
    expect(existsSync(h.root)).toBe(false);
    expect(existsSync(h.leasePath)).toBe(false);
  });
  it.each(['platform', 'node', 'ci', 'docker-host', 'override', 'artifact', 'digest'])(
    'rejects %s before any child execution',
    async (scenario) => {
      const h = harness();
      if (scenario === 'platform') h.options.platform = 'win32';
      if (scenario === 'node') h.options.version = 'v22.0.0';
      if (scenario === 'ci') h.options.environment.CI = 'true';
      if (scenario === 'docker-host') h.options.environment.DOCKER_HOST = 'tcp://remote.invalid';
      if (scenario === 'override') h.options.environment.SUPABASE_GO_BINARY = secret;
      if (scenario === 'artifact')
        h.verifyArtifact.mockImplementation(() => {
          throw new Error(secret);
        });
      if (scenario === 'digest') h.options.expectedSourceDigest = secret;
      expect((await withPreparedLocalStaleProject(vi.fn(), h.options)).outcome).toBe('failed');
      expect(h.execute).not.toHaveBeenCalled();
      expect(h.prepare).not.toHaveBeenCalled();
    },
  );
  it.each(['occupied-container', 'occupied-volume', 'occupied-network', 'locked', 'remote'])(
    'does not adopt %s',
    async (scenario) => {
      const h = harness();
      if (scenario === 'occupied-container') h.state.containers = [h.makeContainer('db', 0)];
      if (scenario === 'occupied-volume') h.state.volumes = [{ Name: `supabase_db_${projectId}` }];
      if (scenario === 'occupied-network')
        h.state.networks = [{ Id: 'a'.repeat(64), Name: network }];
      if (scenario === 'locked') writeFileSync(h.leasePath, 'preserve');
      if (scenario === 'remote') h.state.fail = 'remote';
      const observe = vi.fn();
      expect((await withPreparedLocalStaleProject(observe, h.options)).outcome).toBe('failed');
      expect(observe).not.toHaveBeenCalled();
      expect(h.prepare).not.toHaveBeenCalled();
      expect(
        h.execute.mock.calls.some(([, args]) => args.includes('rm') || args.includes('create')),
      ).toBe(false);
      if (scenario === 'locked') expect(readFileSync(h.leasePath, 'utf8')).toBe('preserve');
    },
  );
  it.each(['startup', 'observation', 'preflight', 'network-collision'])(
    'cleans proven owned resources after %s failure without retry',
    async (scenario) => {
      const h = harness();
      if (scenario === 'startup') h.state.fail = 'startup';
      if (scenario === 'network-collision') h.state.collision = true;
      const observe = vi.fn(async () => {
        if (scenario === 'preflight') return { exitCode: 1, childrenSettled: true };
        return { exitCode: 1, childrenSettled: true };
      });
      const result = await withPreparedLocalStaleProject(observe, h.options);
      expect(result.outcome).toBe('failed');
      expect(result.cleanup).toBe('passed');
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(h.execute.mock.calls.filter(([program]) => program !== 'docker')).toHaveLength(
        scenario === 'network-collision' ? 0 : 1,
      );
      expect(h.state.containers).toEqual([]);
      expect(h.state.networks).toEqual([]);
      expect(h.state.volumes).toEqual([]);
    },
  );
  it.each(['cleanup', 'changed-id', 'foreign-volume', 'source-changed'])(
    'retains workspace and lease when %s is uncertain',
    async (scenario) => {
      const h = harness();
      const observe = async () => {
        if (scenario === 'cleanup') h.state.fail = 'cleanup';
        if (scenario === 'changed-id') h.state.containers[0].Id = 'd'.repeat(64);
        if (scenario === 'foreign-volume') h.state.volumes[0].CreatedAt = '2025-01-01';
        if (scenario === 'source-changed') h.options.inventorySource = () => ({ digest: secret });
        return { exitCode: 0, childrenSettled: true };
      };
      // Dependencies are captured when called; make the source observation mutable via a closure.
      let currentDigest = digest;
      h.options.inventorySource = () => ({ digest: currentDigest });
      const result = await withPreparedLocalStaleProject(async () => {
        await observe();
        if (scenario === 'source-changed') currentDigest = secret;
        return { exitCode: 0, childrenSettled: true };
      }, h.options);
      expect(result).toMatchObject({ outcome: 'failed', cleanup: 'uncertain' });
      expect(existsSync(h.root)).toBe(true);
      expect(existsSync(h.leasePath)).toBe(true);
      expect(h.remove).not.toHaveBeenCalled();
    },
  );
});

describe('reviewed local workspace inputs', () => {
  it('changes only required local profile values and disables seeding', () => {
    const result = staleConfiguration(original);
    expect(result).toContain(`project_id = "${projectId}"`);
    expect(result).toContain('site_url = "http://127.0.0.1:58329"');
    expect(result).toContain('[db.seed]\nenabled = false');
    expect(
      result
        .replace(projectId, 'flyeye')
        .replaceAll('5832', '5532')
        .replace('site_url = "http://127.0.0.1:55329"', 'site_url = "http://127.0.0.1:5173"')
        .replace(/\n\n\[db.seed\]\nenabled = false\n$/, '\n'),
    ).toBe(original.replace(/\r\n/g, '\n').trimEnd() + '\n');
    expect(() => staleConfiguration(original + '\n[db.seed]\nenabled=true')).toThrow('rejected');
  });
  it('copies complete allowlisted inputs and private dependencies, rejecting stale hashes and secret files', () => {
    const source = createRoot();
    for (const relative of [
      'src',
      'public',
      'scripts',
      'supabase/functions',
      'supabase/migrations',
      'supabase/templates',
      'node_modules',
    ])
      mkdirSync(path.join(source, relative), { recursive: true });
    for (const file of [
      'package.json',
      'pnpm-lock.yaml',
      'index.html',
      'vite.config.ts',
      'tsconfig.json',
      'tsconfig.app.json',
      'tsconfig.node.json',
    ])
      writeFileSync(path.join(source, file), 'synthetic');
    writeFileSync(path.join(source, 'supabase/config.toml'), original);
    writeFileSync(path.join(source, 'supabase/migrations/one.sql'), '-- synthetic');
    writeFileSync(path.join(source, 'node_modules/dependency.txt'), 'preserve dependency');
    const inventory = staleSourceInventory(source);
    expect(() => prepareStaleWorkspace(source, '0'.repeat(64))).toThrow('rejected');
    const prepared = prepareStaleWorkspace(source, inventory.digest);
    onTestFinished(() => {
      if (existsSync(prepared.root)) removeStaleWorkspace(prepared.root);
    });
    expect(readFileSync(path.join(prepared.root, 'supabase/migrations/one.sql'), 'utf8')).toBe(
      '-- synthetic',
    );
    writeFileSync(path.join(prepared.root, 'node_modules/dependency.txt'), 'owned mutation');
    expect(readFileSync(path.join(source, 'node_modules/dependency.txt'), 'utf8')).toBe(
      'preserve dependency',
    );
    expect(readFileSync(path.join(source, 'supabase/config.toml'), 'utf8')).toBe(original);
    writeFileSync(path.join(source, 'scripts/.env'), secret);
    writeFileSync(path.join(source, 'supabase/functions/.env.example'), secret);
    expect(existsSync(new URL('../../supabase/functions/.env.example', import.meta.url))).toBe(
      true,
    );
    expect(staleSourceInventory(source)).toEqual(inventory);
  });
});
