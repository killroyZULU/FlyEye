import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  localStalePreflightDiagnostics,
  localStaleResourceDiagnostics,
} from './local-stale-preflight-diagnostics.mjs';
import { verifyLocalStaleTemplateMounts } from './local-stale-template-mounts.mjs';

const rejection = 'Disposable local stale-factors target rejected.';
const services = ['db', 'auth', 'kong', 'inbucket', 'rest'];
export const localStaleProfile = Object.freeze({
  projectId: 'flyeye-nosend-p3d1',
  network: 'flyeye-nosend-p3d1-isolated',
  ports: Object.freeze({ api: 58321, database: 58322, mail: 58324 }),
});
export const localStaleLeasePath = () =>
  path.join(realpathSync(tmpdir()), 'flyeye-stale-profile.lock');
const capabilities = new WeakMap();
const check = (condition) => {
  if (!condition) throw new Error(rejection);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const environmentOf = (container) =>
  Object.fromEntries(
    container.Config.Env.map((item) => {
      const at = item.indexOf('=');
      return [item.slice(0, at), item.slice(at + 1)];
    }),
  );

// This is a local operator attestation, not an authentication/permissions system.
// Preparation and resource teardown remain separately authorized operator work.
export function localStaleRequest(args, providerMode, environment = process.env) {
  const flag = args.indexOf('--local-stale-target');
  if (flag < 0) {
    if (providerMode && (environment.CI !== 'true' || environment.GITHUB_ACTIONS !== 'true'))
      throw new Error('Onboarding provider cases require disposable GitHub Actions services.');
    return undefined;
  }
  check(same(args.slice(0, 2), ['--stale-factors', '--local-stale-target']));
  check(args.length === 3 && path.isAbsolute(args[2]));
  check(environment.CI !== 'true' && environment.GITHUB_ACTIONS !== 'true');
  check(environment.FLYEYE_RUNTIME_DIAGNOSTICS === '1');
  check(!environment.SUPABASE_GO_BINARY && !environment.SUPABASE_CLI_BINARY_OVERRIDE);
  return args[2];
}

export function verifyLocalStaleTarget({
  receiptPath,
  root,
  scriptRoot,
  config,
  projectId,
  environment = process.env,
  now = Date.now(),
  execute = spawnSync,
  readLease = readFileSync,
  writeDiagnostic,
}) {
  const preflight = localStalePreflightDiagnostics({
    enabled: environment.FLYEYE_RUNTIME_DIAGNOSTICS === '1',
    write: writeDiagnostic,
  });
  const resource = localStaleResourceDiagnostics({
    enabled: environment.FLYEYE_RUNTIME_DIAGNOSTICS === '1',
    write: writeDiagnostic,
  });
  try {
    preflight('local-preflight-target-receipt', 'enter');
    check(!environment.DOCKER_HOST && !environment.DOCKER_CONTEXT);
    check(projectId === localStaleProfile.projectId);
    const owned = realpathSync(root);
    check(owned === realpathSync(scriptRoot));
    check(path.dirname(owned) === realpathSync(tmpdir()));
    check(
      /^flyeye-stale-[a-f0-9]{32}$/.test(path.basename(owned)) && !lstatSync(root).isSymbolicLink(),
    );
    check(receiptPath === path.join(owned, 'local-stale-target.json'));
    const file = lstatSync(receiptPath);
    check(file.isFile() && !file.isSymbolicLink() && file.size <= 16384);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    check(
      same(
        Object.keys(receipt).sort(),
        [
          'approvedAt',
          'configSha256',
          'containers',
          'daemonId',
          'expiresAt',
          'networkId',
          'ports',
          'projectId',
          'purpose',
          'root',
          'version',
          'volumes',
        ].sort(),
      ),
    );
    check(receipt.version === 1 && receipt.purpose === 'one-local-stale-factors-observation');
    check(receipt.root === owned && receipt.projectId === projectId);
    check(hex(receipt.configSha256) && receipt.configSha256 === hash(config));
    const approved = Date.parse(receipt.approvedAt);
    const expires = Date.parse(receipt.expiresAt);
    check(typeof receipt.approvedAt === 'string' && /\.000Z$/.test(receipt.approvedAt));
    check(Number.isFinite(approved) && approved <= now && now < expires);
    check(expires - approved <= 60 * 60 * 1000);
    const lease = JSON.parse(readLease(localStaleLeasePath(), 'utf8'));
    check(same(lease, { root: owned, projectId, approvedAt: receipt.approvedAt }));
    check(typeof receipt.daemonId === 'string' && /^[a-zA-Z0-9:-]{1,128}$/.test(receipt.daemonId));
    check(hex(receipt.networkId));
    check(same(Object.keys(receipt.containers).sort(), [...services].sort()));
    check(Object.values(receipt.containers).every(hex));
    check(new Set(Object.values(receipt.containers)).size === services.length);
    check(same(Object.keys(receipt.ports).sort(), ['api', 'database', 'mail']));
    check(
      Object.values(receipt.ports).every(
        (port) => Number.isInteger(port) && port >= 1024 && port <= 65535,
      ),
    );
    check(new Set(Object.values(receipt.ports)).size === 3);
    check(same(receipt.ports, localStaleProfile.ports));
    check(
      Array.isArray(receipt.volumes) && receipt.volumes.length > 0 && receipt.volumes.length <= 8,
    );
    check(new Set(receipt.volumes).size === receipt.volumes.length);
    check(
      receipt.volumes.every(
        (name) =>
          typeof name === 'string' && new RegExp(`^supabase_[a-z_]+_${projectId}$`).test(name),
      ),
    );
    // Claim once before child processes or credential access. Failed preflight also consumes it.
    writeFileSync(path.join(owned, 'local-stale-target.consumed'), 'consumed\n', {
      flag: 'wx',
      mode: 0o600,
    });
    const command = (args, input) => {
      const result = execute('docker', args, {
        input,
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      check(result.status === 0 && !result.error && !result.signal);
      return result.stdout.trim();
    };
    const json = (args) => JSON.parse(command(args));
    preflight('local-preflight-target-receipt', 'passed');
    preflight('local-preflight-target-daemon', 'enter');
    const context = json(['context', 'inspect']);
    check(context.length === 1);
    check(
      [
        'unix:///var/run/docker.sock',
        'npipe:////./pipe/dockerDesktopLinuxEngine',
        'npipe:////./pipe/docker_engine',
      ].includes(context[0].Endpoints?.docker?.Host),
    );
    check(command(['info', '--format', '{{.ID}}']) === receipt.daemonId);
    const inventory = command([
      'ps',
      '-a',
      '--filter',
      `label=com.supabase.cli.project=${projectId}`,
      '--format',
      '{{.ID}}',
      '--no-trunc',
    ]);
    check(same(inventory.split(/\r?\n/).sort(), Object.values(receipt.containers).sort()));
    preflight('local-preflight-target-daemon', 'passed');
    preflight('local-preflight-target-network', 'enter');
    const networkName = localStaleProfile.network;
    const [network] = json(['network', 'inspect', receipt.networkId]);
    check(
      network.Id === receipt.networkId &&
        network.Name === networkName &&
        network.Driver === 'bridge',
    );
    check(network.Labels?.['flyeye.fixture.owner'] === path.basename(owned));
    check(network.Options?.['com.docker.network.bridge.host_binding_ipv4'] === '127.0.0.1');
    check(Date.parse(network.Created) >= approved && Date.parse(network.Created) <= now);
    check(same(Object.keys(network.Containers).sort(), Object.values(receipt.containers).sort()));
    preflight('local-preflight-target-network', 'passed');
    preflight('local-preflight-target-resources', 'enter');
    resource.mark('local-resource-inspection');
    const containers = json(['inspect', ...services.map((service) => receipt.containers[service])]);
    resource.mark('local-resource-container-count');
    check(containers.length === services.length);
    const mounts = new Set();
    for (const service of services) {
      resource.mark(`local-resource-${service}-lookup`);
      const container = containers.find((item) => item.Id === receipt.containers[service]);
      resource.mark(`local-resource-${service}-name`);
      check(container?.Name === `/supabase_${service}_${projectId}`);
      resource.mark(`local-resource-${service}-label`);
      check(container.Config.Labels?.['com.supabase.cli.project'] === projectId);
      resource.mark(`local-resource-${service}-state`);
      check(container.State.Running === true && container.HostConfig.Privileged !== true);
      resource.mark(`local-resource-${service}-created`);
      check(Date.parse(container.Created) >= approved && Date.parse(container.Created) <= now);
      resource.mark(`local-resource-${service}-network-set`);
      check(same(Object.keys(container.NetworkSettings.Networks), [networkName]));
      resource.mark(`local-resource-${service}-network-id`);
      check(container.NetworkSettings.Networks[networkName].NetworkID === receipt.networkId);
      resource.mark(`local-resource-${service}-bindings-read`);
      const bindings = Object.values(container.NetworkSettings.Ports).flatMap(
        (ports) => ports ?? [],
      );
      resource.mark(`local-resource-${service}-bindings-loopback`);
      check(bindings.every((binding) => binding.HostIp === '127.0.0.1'));
      const port = {
        db: ['5432/tcp', 'database'],
        kong: ['8000/tcp', 'api'],
        inbucket: ['8025/tcp', 'mail'],
      }[service];
      resource.mark(`local-resource-${service}-required-port`);
      if (port)
        check(
          same(container.NetworkSettings.Ports[port[0]], [
            { HostIp: '127.0.0.1', HostPort: String(receipt.ports[port[1]]) },
          ]),
        );
      if (service === 'kong')
        verifyLocalStaleTemplateMounts(owned, container, command, resource.mark);
      resource.mark(`local-resource-${service}-mount-list`);
      for (const mount of container.Mounts) {
        // Only the separately verified four owned Kong templates may be writable binds.
        resource.mark(`local-resource-${service}-mount-kind`);
        check(
          mount.Type === 'volume' ||
            (mount.Type === 'bind' && (mount.RW === false || service === 'kong')),
        );
        if (mount.Type === 'volume') {
          resource.mark(`local-resource-${service}-mount-owned`);
          check(receipt.volumes.includes(mount.Name));
          mounts.add(mount.Name);
        }
      }
    }
    resource.mark('local-resource-volume-set');
    check(same([...mounts].sort(), [...receipt.volumes].sort()));
    for (const volume of receipt.volumes) {
      resource.mark('local-resource-volume-inspection');
      const [metadata] = json(['volume', 'inspect', volume]);
      resource.mark('local-resource-volume-identity');
      check(metadata.Name === volume && metadata.Driver === 'local');
      resource.mark('local-resource-volume-options');
      check(!metadata.Options || Object.keys(metadata.Options).length === 0);
      resource.mark('local-resource-volume-created');
      check(Date.parse(metadata.CreatedAt) >= approved && Date.parse(metadata.CreatedAt) <= now);
      resource.mark('local-resource-volume-attachments-read');
      const attached = command([
        'ps',
        '-a',
        '--filter',
        `volume=${volume}`,
        '--format',
        '{{.ID}}',
        '--no-trunc',
      ]);
      resource.mark('local-resource-volume-attachments-owned');
      check(attached.split(/\r?\n/).every((id) => Object.values(receipt.containers).includes(id)));
    }
    resource.clear();
    preflight('local-preflight-target-resources', 'passed');
    preflight('local-preflight-target-smtp', 'enter');
    const auth = containers.find((item) => item.Id === receipt.containers.auth);
    const mail = containers.find((item) => item.Id === receipt.containers.inbucket);
    const authEnvironment = environmentOf(auth);
    check(authEnvironment.GOTRUE_SMTP_HOST === `supabase_inbucket_${projectId}`);
    check(authEnvironment.GOTRUE_SMTP_PORT === '1025');
    check(!authEnvironment.GOTRUE_SMTP_USER && !authEnvironment.GOTRUE_SMTP_PASS);
    check(
      Object.entries(authEnvironment).every(
        ([name, value]) => !/^GOTRUE_HOOK_.*_URI$/.test(name) || !value,
      ),
    );
    check(Object.keys(environmentOf(mail)).every((name) => !/RELAY|FORWARD|CONFIG/i.test(name)));
    check(
      [...(mail.Config.Entrypoint ?? []), ...(mail.Config.Cmd ?? [])].every(
        (arg) => !/relay|forward|config/i.test(arg),
      ),
    );
    check(mail.Mounts.length === 0);
    check(/(?:^|\/)mailpit:[a-zA-Z0-9.-]+$/.test(mail.Config.Image));
    preflight('local-preflight-target-smtp', 'passed');
    preflight('local-preflight-target-empty-data', 'enter');
    // Read-only absence check after ownership checks; never reset or delete an unknown target.
    check(
      command(
        [
          'exec',
          '-i',
          receipt.containers.db,
          'psql',
          '-X',
          '-At',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          'postgres',
          '-d',
          'postgres',
        ],
        'begin read only; select (select count(*) from auth.users) + (select count(*) from public.organizations) + (select count(*) from storage.objects); commit;\n',
      )
        .split(/\r?\n/)
        .filter((line) => !['BEGIN', 'COMMIT'].includes(line))
        .join('') === '0',
    );
    preflight('local-preflight-target-empty-data', 'passed');
    const capability = Object.freeze({});
    capabilities.set(capability, {
      projectId,
      ports: receipt.ports,
      containers: receipt.containers,
    });
    return capability;
  } catch {
    resource.fail();
    // Never include file contents, provider output, URLs or nested error messages.
    throw new Error(rejection);
  }
}

export function isLocalStaleTarget(capability, projectId) {
  return capabilities.has(capability) && capabilities.get(capability).projectId === projectId;
}

export function localStaleContainer(capability, projectId, service) {
  check(isLocalStaleTarget(capability, projectId));
  check(['db', 'auth'].includes(service));
  return capabilities.get(capability).containers[service];
}

export function localStaleNetworkArgs(capability, projectId) {
  check(isLocalStaleTarget(capability, projectId));
  return ['--network-id', localStaleProfile.network];
}

export function verifyLocalStaleEndpoints(capability, projectId, status) {
  try {
    check(isLocalStaleTarget(capability, projectId));
    const { ports } = capabilities.get(capability);
    check(status.API_URL === `http://127.0.0.1:${ports.api}`);
    const database = new URL(status.DB_URL);
    check(database.protocol === 'postgresql:' && database.hostname === '127.0.0.1');
    check(database.username === 'postgres');
    check(database.port === String(ports.database) && database.pathname === '/postgres');
    check(!database.search && !database.hash);
  } catch {
    throw new Error(rejection);
  }
}
