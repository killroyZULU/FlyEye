import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { inventory } from './credential-proof-receipt.mjs';

try {
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.platform, 'linux');
  assert.ok(!process.env.DOCKER_HOST);
  const docker = (...args) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  assert.equal(docker('context', 'show'), 'default');
  assert.equal(
    docker('context', 'inspect', 'default', '--format', '{{.Endpoints.docker.Host}}'),
    'unix:///var/run/docker.sock',
  );
  const file = join(process.env.RUNNER_TEMP, 'credential-checkpoint-inventory.json');
  const snapshot = inventory(docker);
  if (process.argv[2] === 'before') {
    assert.equal(Object.keys(snapshot.containers).length, 0);
    assert.equal(snapshot.volumes.length, 0);
    assert.ok(snapshot.networks.length > 0);
    writeFileSync(file, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
    console.log('Fresh local runner inventory recorded.');
  } else {
    assert.equal(process.argv[2], 'after');
    assert.ok(isDeepStrictEqual(snapshot, JSON.parse(readFileSync(file, 'utf8'))));
    console.log('Final container, volume and network inventory matches baseline.');
  }
} catch {
  console.error('Runner inventory verification failed.');
  process.exitCode = 1;
}
