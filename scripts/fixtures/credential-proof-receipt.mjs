import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { hostname, tmpdir, userInfo } from 'node:os';

const project = 'flyeye-nosend-p3d1';
const network = project + '-isolated';
const label = 'com.supabase.cli.project';
const services = ['auth', 'db', 'inbucket', 'kong', 'rest'];
const lines = (s) => s.split(/\r?\n/).filter(Boolean).sort();
const hash = (s) => createHash('sha256').update(s).digest('hex');
const defaultDocker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 25000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
export function inventory(docker = defaultDocker) {
  return {
    containers: Object.fromEntries(
      lines(docker('ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.State}}')).map((line) => {
        const [id, state] = line.split(' ');
        return [hash(id), state];
      }),
    ),
    volumes: lines(docker('volume', 'ls', '-q'))
      .map(hash)
      .sort(),
    networks: lines(docker('network', 'ls', '--no-trunc', '--format', '{{.ID}}'))
      .map(hash)
      .sort(),
  };
}
export function differences(a, b) {
  return Object.fromEntries(
    Object.keys(a).map((k) => {
      const av = k === 'containers' ? Object.keys(a[k]) : a[k],
        bv = k === 'containers' ? Object.keys(b[k]) : b[k];
      return [
        k,
        {
          added: bv.filter((i) => !av.includes(i)),
          removed: av.filter((i) => !bv.includes(i)),
          changed:
            k === 'containers' ? av.filter((i) => bv.includes(i) && a[k][i] !== b[k][i]) : [],
        },
      ];
    }),
  );
}
export function operatorBinding() {
  return hash(
    JSON.stringify([
      process.platform,
      hostname(),
      userInfo().username,
      realpathSync('.'),
      realpathSync(tmpdir()),
    ]),
  );
}
export function makeLock(run) {
  return Buffer.from(
    JSON.stringify({
      version: 2,
      run,
      nonce: randomUUID(),
      pid: process.pid,
      operator: operatorBinding(),
    }),
  );
}
export function engineBinding(docker = defaultDocker) {
  assert.equal(process.platform, 'win32');
  assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONFIG);
  assert.equal(docker('context', 'show'), 'desktop-linux');
  assert.equal(
    docker('context', 'inspect', 'desktop-linux', '--format', '{{.Endpoints.docker.Host}}'),
    'npipe:////./pipe/dockerDesktopLinuxEngine',
  );
  const engine = docker('info', '--format', '{{.OSType}} {{.ID}}');
  assert.match(engine, /^linux [a-zA-Z0-9:-]{16,128}$/);
  return hash(engine);
}
export function openReceipt() {
  const id = randomUUID(),
    dir = path.resolve('.supabase', 'credential-proof-receipts');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id + '.json'),
    lock = path.join(tmpdir(), project + '-credential-proof.lock');
  const bytes = makeLock(id);
  const fd = openSync(lock, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const record = {
    run: id,
    lockDigest: hash(bytes),
    test: 'pending',
    teardown: 'not-started',
    comparison: 'pending',
    stages: [],
  };
  const save = () => {
    writeFileSync(file + '.tmp', JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    renameSync(file + '.tmp', file);
  };
  save();
  console.log('Local receipt: ' + path.relative(process.cwd(), file));
  return { id, record, save, release: () => unlinkSync(lock) };
}
export function ownedGuard(receipt, before, docker = defaultDocker) {
  let networkId, owners;
  function inspect() {
    assert.match(networkId, /^[0-9a-f]{64}$/);
    const [net] = JSON.parse(docker('network', 'inspect', networkId));
    assert.equal(net.Name, network);
    assert.equal(net.Labels['flyeye.s2.run'], receipt.id);
    assert.ok(!before.networks.includes(hash(networkId)));
    const ids = lines(
      docker('ps', '-aq', '--no-trunc', '--filter', 'label=' + label + '=' + project),
    );
    assert.deepEqual(ids, Object.keys(net.Containers).sort());
    assert.equal(ids.length, 5);
    const containers = JSON.parse(docker('inspect', ...ids));
    assert.deepEqual(
      containers.map((c) => c.Name).sort(),
      services.map((s) => '/supabase_' + s + '_' + project).sort(),
    );
    const volumes = new Set();
    for (const c of containers) {
      assert.ok(!(hash(c.Id) in before.containers));
      assert.equal(c.Config.Labels[label], project);
      assert.deepEqual(Object.keys(c.NetworkSettings.Networks), [network]);
      assert.equal(c.NetworkSettings.Networks[network].NetworkID, networkId);
      c.Mounts.filter((m) => m.Type === 'volume').forEach((m) => volumes.add(m.Name));
    }
    const named = lines(docker('volume', 'ls', '--filter', 'label=' + label + '=' + project, '-q'));
    assert.ok(
      named.every((v) => volumes.has(v)),
      'Unattributed labeled volume',
    );
    for (const v of volumes) {
      assert.ok(!before.volumes.includes(hash(v)));
      const [meta] = JSON.parse(docker('volume', 'inspect', v));
      assert.equal(meta.Name, v);
      assert.ok(
        meta.Labels?.[label] === project ||
          (/^[a-f0-9]{64}$/.test(v) && containers.some((c) => c.Mounts.some((m) => m.Name === v))),
      );
      const attached = lines(docker('ps', '-aq', '--no-trunc', '--filter', 'volume=' + v));
      assert.ok(attached.every((id) => ids.includes(id)));
    }
    return {
      ids,
      volumes: [...volumes].sort(),
      db: containers.find((c) => c.Name === '/supabase_db_' + project).Id,
    };
  }
  return {
    networkLabel: ['--label', 'flyeye.s2.run=' + receipt.id],
    storageResult(state, id, volumes) {
      if (state === 'removed') {
        receipt.record.storageOwned = { container: hash(id), volumes: volumes.map(hash).sort() };
      }
      if (state === 'test-failed') receipt.record.storageTest = state;
      else receipt.record.storageTeardown = state;
      receipt.save();
    },
    networkCreated(id) {
      networkId = id.trim();
    },
    capture() {
      owners = inspect();
      receipt.record.owned = {
        network: hash(networkId),
        containers: owners.ids.map(hash),
        volumes: owners.volumes.map(hash),
      };
      receipt.save();
    },
    verifiedNetwork() {
      assert.ok(owners);
      assert.deepEqual(inspect(), owners);
      return networkId;
    },
    get db() {
      assert.ok(owners);
      return owners.db;
    },
    close() {
      assert.ok(owners, 'No complete ownership receipt');
      assert.deepEqual(inspect(), owners);
      docker('rm', '-f', ...owners.ids);
      for (const v of owners.volumes) docker('volume', 'rm', v);
      docker('network', 'rm', networkId);
    },
  };
}
