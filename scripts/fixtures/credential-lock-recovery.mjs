// Read-only assessor used while the Windows release procedure holds both evidence handles.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual as equal } from 'node:util';
import {
  differences,
  engineBinding,
  inventory,
  operatorBinding,
} from './credential-proof-receipt.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hashed = (s) => typeof s === 'string' && hex.test(s);
const hashes = (list) =>
  Array.isArray(list) && list.every(hashed) && new Set(list).size === list.length;
function requireProof(condition, reason) {
  if (!condition) throw new Error(reason);
}
function validInventory(s) {
  return (
    s &&
    equal(Object.keys(s).sort(), ['containers', 'networks', 'volumes']) &&
    hashes(s.networks) &&
    s.networks.length > 0 &&
    hashes(s.volumes) &&
    s.containers &&
    typeof s.containers === 'object' &&
    !Array.isArray(s.containers) &&
    hashes(Object.keys(s.containers)) &&
    Object.values(s.containers).every((state) =>
      ['running', 'created', 'restarting', 'paused', 'exited', 'removing', 'dead'].includes(state),
    )
  );
}
export function checkRecovery(approval, lockBytes, receiptBytes, probe) {
  requireProof(approval.approve === true && approval.exclusive === true, 'approval-required');
  requireProof(
    uuid.test(approval.run) && hashed(approval.lock) && hashed(approval.receipt),
    'approval-binding',
  );
  requireProof(
    lockBytes.length > 0 &&
      digest(lockBytes) === approval.lock &&
      digest(receiptBytes) === approval.receipt,
    'missing-or-unbound-evidence',
  );
  const lock = JSON.parse(lockBytes);
  const r = JSON.parse(receiptBytes);
  requireProof(
    lock.version === 2 &&
      uuid.test(lock.nonce) &&
      lock.nonce !== lock.run &&
      lock.run === approval.run &&
      r.run === lock.run &&
      r.lockDigest === approval.lock &&
      lock.operator === probe.operator() &&
      Number.isSafeInteger(lock.pid) &&
      lock.pid > 0,
    'provenance',
  );
  requireProof(
    r.test === 'passed' &&
      !r.failure &&
      r.submissionWorkers === 'settled' &&
      r.teardown === 'passed' &&
      !r.storageTest &&
      r.storageTeardown === 'removed',
    'incomplete-teardown',
  );
  requireProof(
    r.comparison === 'match' &&
      validInventory(r.before) &&
      equal(r.before, r.after) &&
      equal(r.delta, differences(r.before, r.after)),
    'unreconciled-inventory',
  );
  requireProof(hashed(r.engineBefore) && r.engineBefore === r.engineAfter, 'engine-evidence');
  const o = r.owned,
    s = r.storageOwned;
  requireProof(
    o &&
      hashed(o.network) &&
      hashes(o.containers) &&
      o.containers.length === 5 &&
      hashes(o.volumes) &&
      s &&
      hashed(s.container) &&
      !o.containers.includes(s.container) &&
      hashes(s.volumes) &&
      !s.volumes.some((v) => o.volumes.includes(v)),
    'ownership-evidence',
  );
  requireProof(probe.ownerGone(lock.pid) === true, 'owner-active-or-unknown');
  requireProof(probe.engine() === r.engineBefore, 'engine-mismatch');
  const current = probe.inventory();
  requireProof(equal(current, r.before), 'current-inventory-differs');
  requireProof(
    !current.networks.includes(o.network) &&
      ![...o.containers, s.container].some((k) => Object.hasOwn(current.containers, k)) &&
      ![...o.volumes, ...s.volumes].some((v) => current.volumes.includes(v)) &&
      probe.residueAbsent() === true,
    'fixture-residue',
  );
  requireProof(probe.engine() === r.engineAfter, 'engine-changed');
}

const project = 'flyeye-nosend-p3d1';
export function noResidue(docker) {
  const list = [
    ['ps', '-aq'],
    ['volume', 'ls', '-q'],
    ['network', 'ls', '-q'],
  ];
  const filters = [
    'label=com.supabase.cli.project=' + project,
    'label=flyeye.s2.proof',
    'label=flyeye.s2.run',
    'name=' + project,
    'name=flyeye-s2-storage-',
  ];
  return list.every((cmd) => filters.every((filter) => docker(...cmd, '--filter', filter) === ''));
}
function ownerGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === 'ESRCH';
  }
}
export function assessEnvelope(argv, input, probe) {
  const [run, lock, receipt, mode] = argv;
  const [a, b] = input.trim().split(' ');
  checkRecovery(
    {
      run,
      lock,
      receipt,
      approve: mode === 'approved-exclusive',
      exclusive: mode === 'approved-exclusive',
    },
    Buffer.from(a, 'base64'),
    Buffer.from(b, 'base64'),
    probe,
  );
  return 'verified ' + run + ' ' + lock + ' ' + receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const docker = (...args) =>
      execFileSync('docker', ['--context', 'desktop-linux', ...args], {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    console.log(
      assessEnvelope(process.argv.slice(2), readFileSync(0, 'utf8'), {
        operator: operatorBinding,
        ownerGone,
        engine: () => engineBinding(),
        inventory: () => inventory(docker),
        residueAbsent: () => noResidue(docker),
      }),
    );
  } catch {
    console.error('Retained-lock evidence incomplete or contradictory.');
    process.exitCode = 1;
  }
}
