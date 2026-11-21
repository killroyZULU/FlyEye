import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedNoSendCliEnvironment } from './no-send-cli-artifact.mjs';
import { localStaleLeasePath, localStaleProfile } from './local-stale-target.mjs';
import { orderedMounts, startupFailureDiagnostic } from './local-stale-diagnostics.mjs';
import {
  prepareStaleWorkspace,
  removeStaleWorkspace,
  staleHash,
  staleSourceInventory,
} from './local-stale-workspace.mjs';

const repository = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const services = ['db', 'auth', 'kong', 'inbucket', 'rest'];
const check = (value) => {
  if (!value) throw new Error('Local stale-factors preparation rejected.');
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const { projectId, network, ports } = localStaleProfile;
const label = `com.supabase.cli.project=${projectId}`;

// No import-time IO. The caller's separately approved observation owns its child
// process lifetime; it must explicitly attest settled children, even on failure.
// No callback is entered when preparation fails. This is not a CI entrypoint.
export async function withPreparedLocalStaleProject(
  observe,
  {
    expectedSourceDigest,
    platform = process.platform,
    version = process.version,
    environment = process.env,
    execute = spawnSync,
    verifyArtifact = verifiedNoSendCliEnvironment,
    prepare = prepareStaleWorkspace,
    remove = removeStaleWorkspace,
    inventorySource = staleSourceInventory,
    leasePath = localStaleLeasePath(),
    clock = Date.now,
  } = {},
) {
  let stage = 'preflight',
    prepared,
    lease,
    leased = false,
    networkId,
    approvedAt,
    baseline;
  let outcome, cleanup, result, receipt, startupFailure;
  let startupLifetimeUnknown = false;
  let observationStarted = false,
    observationSettled = false;
  const childEnvironment = Object.fromEntries(
    [
      'PATH',
      'HOME',
      'USER',
      'LOGNAME',
      'LANG',
      'LC_ALL',
      'TMPDIR',
      'DISPLAY',
      'XDG_RUNTIME_DIR',
      'PLAYWRIGHT_BROWSERS_PATH',
    ]
      .filter((name) => typeof environment[name] === 'string')
      .map((name) => [name, environment[name]]),
  );
  childEnvironment.SUPABASE_TELEMETRY_DISABLED = '1';
  const command = (program, args, options = {}) => {
    const value = execute(program, args, {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnvironment,
      ...options,
    });
    if (stage === 'startup' && (value.error || value.signal)) startupLifetimeUnknown = true;
    if (
      stage === 'startup' &&
      program === process.execPath &&
      (value.status !== 0 || value.error || value.signal)
    )
      startupFailure = startupFailureDiagnostic(value);
    check(value.status === 0 && !value.error && !value.signal);
    return value.stdout.trim();
  };
  const docker = (args) => command('docker', args);
  const json = (args) => JSON.parse(docker(args));
  const lines = (value) => value.split(/\r?\n/).filter(Boolean).sort();
  const snapshot = () => {
    const ids = lines(docker(['ps', '-aq', '--no-trunc']));
    return {
      containers: (ids.length ? json(['inspect', ...ids]) : [])
        .map((item) => ({
          id: item.Id,
          name: item.Name,
          image: item.Image,
          running: item.State.Running,
          started: item.State.StartedAt,
          restarts: item.RestartCount,
          mounts: orderedMounts(item.Mounts),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      volumes: lines(docker(['volume', 'ls', '-q'])),
      networks: lines(docker(['network', 'ls', '--no-trunc', '--format', '{{.ID}}|{{.Name}}'])),
    };
  };
  const inspectOwned = (complete) => {
    const ids = lines(
      docker(['ps', '-a', '--filter', `label=${label}`, '--format', '{{.ID}}', '--no-trunc']),
    );
    const containers = ids.length ? json(['inspect', ...ids]) : [];
    const [ownedNetwork] = json(['network', 'inspect', networkId]);
    check(ownedNetwork.Id === networkId && ownedNetwork.Name === network);
    check(ownedNetwork.Labels?.['flyeye.fixture.owner'] === path.basename(prepared.root));
    check(equal(Object.keys(ownedNetwork.Containers).sort(), ids));
    const found = {};
    for (const container of containers) {
      const service = [...services, 'edge_runtime'].find(
        (name) => container.Name === `/supabase_${name}_${projectId}`,
      );
      check(service && !found[service]);
      check(container.Config.Labels?.['com.supabase.cli.project'] === projectId);
      check(Date.parse(container.Created) >= Date.parse(approvedAt));
      check(equal(Object.keys(container.NetworkSettings.Networks), [network]));
      check(container.NetworkSettings.Networks[network].NetworkID === networkId);
      if (receipt && service !== 'edge_runtime')
        check(receipt.containers[service] === container.Id);
      found[service] = container.Id;
    }
    if (complete) check(equal(Object.keys(found).sort(), [...services].sort()));
    const names = lines(docker(['volume', 'ls', '--filter', `label=${label}`, '-q']));
    const volumes = names.length ? json(['volume', 'inspect', ...names]) : [];
    for (const volume of volumes) {
      check(new RegExp(`^supabase_[a-z_]+_${projectId}$`).test(volume.Name));
      check(volume.Labels?.['com.supabase.cli.project'] === projectId);
      check(Date.parse(volume.CreatedAt) >= Date.parse(approvedAt));
      check(!baseline.volumes.includes(volume.Name));
      check(
        lines(
          docker([
            'ps',
            '-a',
            '--filter',
            `volume=${volume.Name}`,
            '--format',
            '{{.ID}}',
            '--no-trunc',
          ]),
        ).every((id) => ids.includes(id)),
      );
    }
    // No name-only adoption: every retained mounted volume must be freshly owned.
    check(
      containers
        .flatMap((item) => item.Mounts.filter((mount) => mount.Type === 'volume'))
        .every((mount) => names.includes(mount.Name)),
    );
    return { containers: found, ids, volumes: names };
  };
  try {
    check(platform === 'linux' && version === 'v24.14.0' && typeof observe === 'function');
    check(environment.CI !== 'true' && environment.GITHUB_ACTIONS !== 'true');
    check(!environment.DOCKER_HOST && !environment.DOCKER_CONTEXT);
    check(!environment.SUPABASE_GO_BINARY && !environment.SUPABASE_CLI_BINARY_OVERRIDE);
    check(/^[a-f0-9]{64}$/.test(expectedSourceDigest));
    const artifactEnvironment = verifyArtifact(); // Existing source/receipt/binary integrity gate.
    check(equal(Object.keys(artifactEnvironment), ['SUPABASE_GO_BINARY']));
    const [context] = json(['context', 'inspect']);
    check(context.Endpoints?.docker?.Host === 'unix:///var/run/docker.sock');
    const daemonId = docker(['info', '--format', '{{.ID}}']);
    baseline = snapshot();
    check(!baseline.containers.some((item) => item.name.includes(projectId)));
    check(!baseline.volumes.some((name) => name.includes(projectId)));
    check(!baseline.networks.some((name) => name.includes(projectId)));
    // A shared fixed profile cannot have two preparations; the original no-send
    // helper also rejects its network/resources once created.
    writeFileSync(leasePath, 'preparing\n', { flag: 'wx', mode: 0o600 });
    leased = true;
    stage = 'workspace';
    prepared = prepare(repository, expectedSourceDigest);
    approvedAt = new Date(Math.floor(clock() / 1000) * 1000).toISOString();
    lease = JSON.stringify({ root: prepared.root, projectId, approvedAt });
    writeFileSync(leasePath, lease);
    stage = 'network';
    networkId = docker([
      'network',
      'create',
      '--driver',
      'bridge',
      '--label',
      `flyeye.fixture.owner=${path.basename(prepared.root)}`,
      '--opt',
      'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
      network,
    ]);
    check(/^[a-f0-9]{64}$/.test(networkId));
    stage = 'startup';
    const cli = path.join(prepared.root, 'node_modules/supabase/dist/supabase.js');
    // start applies the full copied migration set; db.seed is disabled. Never reset.
    command(
      process.execPath,
      [
        cli,
        'start',
        '--workdir',
        prepared.root,
        '--network-id',
        network,
        '--exclude',
        'studio,postgres-meta,realtime,storage-api,imgproxy,edge-runtime,analytics,vector',
      ],
      {
        timeout: 180000,
        env: { ...childEnvironment, ...artifactEnvironment },
      },
    );
    stage = 'receipt';
    const owned = inspectOwned(true);
    receipt = {
      version: 1,
      purpose: 'one-local-stale-factors-observation',
      root: prepared.root,
      projectId,
      approvedAt,
      expiresAt: new Date(Date.parse(approvedAt) + 3600000).toISOString(),
      configSha256: staleHash(prepared.configuration),
      daemonId,
      networkId,
      containers: owned.containers,
      ports,
      volumes: owned.volumes,
    };
    const receiptPath = path.join(prepared.root, 'local-stale-target.json');
    writeFileSync(receiptPath, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
    stage = 'observation';
    // The reviewed fixture performs its full ownership/SMTP/empty-data check
    // and consumes the receipt before any mutation. No CI flags or patched CLI.
    observationStarted = true;
    result = await observe(
      Object.freeze({
        root: prepared.root,
        receiptPath,
        executable: process.execPath,
        args: Object.freeze([
          path.join(prepared.root, 'scripts/test-feat-003-runtime.mjs'),
          '--stale-factors',
          '--local-stale-target',
          receiptPath,
        ]),
        environment: Object.freeze({ ...childEnvironment, FLYEYE_RUNTIME_DIAGNOSTICS: '1' }),
      }),
    );
    observationSettled = result?.childrenSettled === true;
    check(observationSettled && Number.isInteger(result.exitCode) && result.exitCode === 0);
    outcome = 'passed';
  } catch {
    // Original errors and command output can contain local secrets; never forward them.
    if (stage === 'startup' && !startupFailure)
      startupFailure = startupFailureDiagnostic(undefined);
    outcome = 'failed';
  } finally {
    try {
      // A timed-out launcher may have surviving children. Do not race it with
      // destructive teardown or claim successful cleanup; preserve for recovery.
      check(!startupLifetimeUnknown && (!observationStarted || observationSettled));
      if (networkId) {
        const owned = inspectOwned(false); // Validate every identity before the first removal.
        if (owned.ids.length) docker(['rm', '--force', ...owned.ids]);
        if (owned.volumes.length) docker(['volume', 'rm', ...owned.volumes]);
        docker(['network', 'rm', networkId]);
      }
      if (baseline) check(equal(snapshot(), baseline));
      if (prepared) {
        check(inventorySource(repository).digest === expectedSourceDigest);
        verifyArtifact();
        remove(prepared.root);
      }
      if (leased) {
        check(readFileSync(leasePath, 'utf8') === (lease ?? 'preparing\n'));
        unlinkSync(leasePath);
      }
      cleanup = 'passed';
    } catch {
      cleanup = 'uncertain';
      outcome = 'failed';
      // Preserve workspace and lease for a separate recovery decision. Never retry.
    }
  }
  return Object.freeze({ outcome, stage, cleanup, ...(startupFailure ? { startupFailure } : {}) });
}
