import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const project = 'flyeye-nosend-p3d1';
const image = 'public.ecr.aws/supabase/storage-api:v1.62.5';
export { image as proofStorageImage };
const docker = (args, env = {}) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  }).trim();

// Add one private Storage service after the existing isolated five-service preflight.
// No host port, reused volume, externally routable URL or secret-bearing arguments.
export async function withProofStorage(status, ownership, run) {
  const network = project + '-isolated';
  const netId = ownership.verifiedNetwork();
  const owner = randomUUID(),
    name = 'flyeye-s2-storage-' + owner;
  const db = new URL(status.DB_URL);
  assert.equal(db.hostname, '127.0.0.1');
  assert.equal(db.port, '58322');
  db.username = 'supabase_storage_admin';
  db.hostname = 'supabase_db_' + project;
  db.port = '5432';
  const required = {
    DATABASE_URL: db.href,
    AUTH_JWT_SECRET: status.JWT_SECRET,
    SERVICE_KEY: status.SERVICE_ROLE_KEY,
    ANON_KEY: status.ANON_KEY,
    STORAGE_BACKEND: 'file',
    FILE_STORAGE_BACKEND_PATH: '/tmp/credential-proof',
    TENANT_ID: 'stub',
    REGION: 'local',
    GLOBAL_S3_BUCKET: 'stub',
    FILE_SIZE_LIMIT: '10000000',
    ENABLE_IMAGE_TRANSFORMATION: 'false',
    DB_INSTALL_ROLES: 'false',
  };
  assert.ok(Object.values(required).every((v) => typeof v === 'string' && v.length > 0));
  const existingVolumes = new Set(docker(['volume', 'ls', '-q']).split(/\r?\n/));
  const imageId = docker(['image', 'inspect', '-f', '{{.Id}}', image]);
  const id = docker(
    [
      'create',
      '--pull',
      'never',
      '--name',
      name,
      '--label',
      'flyeye.s2.proof=' + owner,
      '--network',
      netId,
      '--network-alias',
      'supabase_storage_' + project,
      '--network-alias',
      'storage',
      ...Object.keys(required).flatMap((k) => ['-e', k]),
      image,
    ],
    required,
  );
  const owned = () => {
    const [c] = JSON.parse(docker(['inspect', id]));
    assert.equal(c.Id, id);
    assert.equal(c.Name, '/' + name);
    assert.equal(c.Image, imageId);
    assert.equal(c.Config.Labels['flyeye.s2.proof'], owner);
    assert.deepEqual(Object.keys(c.NetworkSettings.Networks), [network]);
    assert.equal(c.NetworkSettings.Networks[network].NetworkID, netId);
    assert.deepEqual(Object.keys(c.HostConfig.PortBindings ?? {}), []);
    assert.ok(
      c.Mounts.every(
        (m) => !existingVolumes.has(m.Name) && m.Type === 'volume' && /^[a-f0-9]{64}$/.test(m.Name),
      ),
    );
  };
  let testError;
  try {
    docker(['start', id]);
    owned();
    let ready = false;
    for (let i = 0; i < 25; i++) {
      try {
        docker([
          'exec',
          id,
          'node',
          '-e',
          "fetch('http://127.0.0.1:5000/status').then(x=>process.exit(x.ok?0:1)).catch(()=>process.exit(1))",
        ]);
        ready = true;
        break;
      } catch {
        await delay(500);
      }
    }
    if (!ready) throw new Error('Local Storage readiness failed.');
    console.log('Submission proof passed: private pinned Storage ready.');
    await run();
  } catch (error) {
    testError = error;
    ownership.storageResult('test-failed');
  }
  try {
    // A stopped container may have empty live network metadata. Its immutable
    // create-time name, label, image and network mode still establish identity.
    const [c] = JSON.parse(docker(['inspect', id]));
    assert.equal(c.Id, id);
    assert.equal(c.Name, '/' + name);
    assert.equal(c.Image, imageId);
    assert.equal(c.HostConfig.NetworkMode, netId);
    assert.equal(c.Config.Labels['flyeye.s2.proof'], owner);
    assert.ok(
      c.Mounts.every(
        (m) => !existingVolumes.has(m.Name) && m.Type === 'volume' && /^[a-f0-9]{64}$/.test(m.Name),
      ),
    );
    docker(['rm', '-f', '-v', id]);
    assert.equal(docker(['ps', '-aq', '--filter', 'label=flyeye.s2.proof=' + owner]), '');
    ownership.storageResult(
      'removed',
      id,
      c.Mounts.map((m) => m.Name),
    );
  } catch (error) {
    ownership.storageResult('teardown-failed');
    if (!testError) throw error;
  }
  if (testError) throw testError;
}
