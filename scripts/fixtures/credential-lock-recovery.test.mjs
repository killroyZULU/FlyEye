import { describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { checkRecovery, noResidue } from './credential-lock-recovery.mjs';
import { differences, makeLock, operatorBinding, ownedGuard } from './credential-proof-receipt.mjs';

const hash = (s) => createHash('sha256').update(s).digest('hex');
function setup() {
  const run = randomUUID(),
    lockBytes = makeLock(run);
  const before = {
    containers: { [hash('unrelated')]: 'running' },
    volumes: [],
    networks: [hash('bridge')],
  };
  const record = {
    run,
    lockDigest: hash(lockBytes),
    before,
    after: structuredClone(before),
    delta: differences(before, before),
    engineBefore: hash('engine'),
    engineAfter: hash('engine'),
    comparison: 'match',
    test: 'passed',
    teardown: 'passed',
    storageTeardown: 'removed',
    submissionWorkers: 'settled',
    owned: {
      containers: ['1', '2', '3', '4', '5'].map(hash),
      network: hash('net'),
      volumes: [hash('volume')],
    },
    storageOwned: { container: hash('six'), volumes: [hash('anon')] },
  };
  const probe = {
    operator: operatorBinding,
    ownerGone: vi.fn(() => true),
    engine: vi.fn(() => hash('engine')),
    inventory: vi.fn(() => structuredClone(before)),
    residueAbsent: vi.fn(() => true),
  };
  const verify = (options = {}, bytes = lockBytes) => {
    const receipt = Buffer.from(JSON.stringify(record));
    return checkRecovery(
      {
        run,
        lock: hash(bytes),
        receipt: hash(receipt),
        approve: true,
        exclusive: true,
        ...options,
      },
      bytes,
      receipt,
      probe,
    );
  };
  return { verify, probe, record, lockBytes };
}
describe('separate retained-lock recovery', () => {
  it('records only hashed Storage identities with the removal receipt', () => {
    const receipt = { record: {}, save: vi.fn() };
    const guard = ownedGuard(receipt, {}, () => {
      throw Error('Unexpected inspection');
    });
    guard.storageResult('test-failed');
    expect(receipt.record.storageOwned).toBeUndefined();
    guard.storageResult('removed', 'synthetic-storage', ['synthetic-volume']);
    expect(receipt.record).toEqual({
      storageTest: 'test-failed',
      storageTeardown: 'removed',
      storageOwned: { container: hash('synthetic-storage'), volumes: [hash('synthetic-volume')] },
    });
  });
  it('accepts only complete, run-bound terminal proof and compares the live engine twice', () => {
    const { verify, probe } = setup();
    verify();
    expect(probe.engine).toHaveBeenCalledTimes(2);
    expect(probe.residueAbsent).toHaveBeenCalledOnce();
  });
  it.each([
    { approve: false },
    { exclusive: false },
    { run: randomUUID() },
    { lock: hash('other') },
    { receipt: hash('other') },
  ])('requires exact approval %o', (options) => {
    const { verify, probe } = setup();
    expect(() => verify(options)).toThrow();
    expect(probe.ownerGone).not.toHaveBeenCalled();
  });
  it.each(['', '{}', 'not JSON'])(
    'refuses ambiguous historical lock %j before inspection',
    (text) => {
      const { verify, probe } = setup();
      expect(() => verify({}, Buffer.from(text))).toThrow();
      expect(probe.inventory).not.toHaveBeenCalled();
    },
  );
  it.each([
    'prior-process-active',
    'pid-reused',
    'access-unknown',
    'engine-differs',
    'engine-changed',
    'selector-residue',
    'selector-unreadable',
  ])('refuses %s', (kind) => {
    const { verify, probe } = setup();
    if (['prior-process-active', 'pid-reused', 'access-unknown'].includes(kind))
      probe.ownerGone.mockReturnValue(kind === 'access-unknown' ? undefined : false);
    if (kind === 'engine-differs') probe.engine.mockReturnValue(hash('other'));
    if (kind === 'engine-changed')
      probe.engine.mockReturnValueOnce(hash('engine')).mockReturnValueOnce(hash('other'));
    if (kind === 'selector-residue') probe.residueAbsent.mockReturnValue(false);
    if (kind === 'selector-unreadable')
      probe.residueAbsent.mockImplementation(() => {
        throw Error('unavailable');
      });
    expect(() => verify()).toThrow();
  });
  it.each([
    'network-change',
    'current-change',
    'recorded-delta',
    'container-state',
    'storage',
    'container',
    'volume',
    'network',
    'missing-inventory',
    'missing-workers',
    'missing-storage',
    'missing-capture',
    'missing-engine',
    'incomplete',
    'shared-id',
    'contradictory-failure',
  ])('refuses %s even when the operator attests to maintenance', (kind) => {
    const { verify, record: r, probe } = setup();
    if (kind === 'network-change') r.after.networks = [hash('different bridge')];
    if (kind === 'current-change')
      probe.inventory.mockReturnValue({ ...r.before, networks: [hash('new bridge')] });
    if (kind === 'recorded-delta') r.delta.networks.added = [hash('unexpected')];
    if (kind === 'container-state') r.after.containers[hash('unrelated')] = 'exited';
    if (kind === 'storage') r.storageOwned.container = hash('unrelated');
    if (kind === 'container') r.owned.containers[0] = hash('unrelated');
    if (kind === 'volume') {
      r.after.volumes = [...r.owned.volumes];
      r.before.volumes = [...r.owned.volumes];
    }
    if (kind === 'network') r.owned.network = hash('bridge');
    if (kind === 'missing-inventory') r.before = r.after = {};
    if (kind === 'missing-workers') delete r.submissionWorkers;
    if (kind === 'missing-storage') delete r.storageOwned;
    if (kind === 'missing-capture') delete r.owned;
    if (kind === 'missing-engine') delete r.engineBefore;
    if (kind === 'incomplete') r.teardown = 'failed';
    if (kind === 'shared-id') r.storageOwned.container = r.owned.containers[0];
    if (kind === 'contradictory-failure') r.failure = { stage: 'mount' };
    expect(() => verify()).toThrow();
  });
  it('checks names and labels for each Docker resource class using list-only operations', () => {
    const docker = vi.fn(() => '');
    expect(noResidue(docker)).toBe(true);
    expect(docker.mock.calls).toHaveLength(15);
    expect(docker.mock.calls.every((args) => args[0] === 'ps' || args[1] === 'ls')).toBe(true);
    expect(noResidue((...args) => (args.includes('label=flyeye.s2.proof') ? 'retained' : ''))).toBe(
      false,
    );
  });
});
it.skipIf(process.platform !== 'win32')(
  'uses exclusive handles, checks hard links and deletes only the inspected synthetic file',
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'credential-recovery-unit-'));
    const target = join(dir, 'synthetic.lock'),
      peer = join(dir, 'peer.lock');
    const script = `
    $ErrorActionPreference='Stop'
    Add-Type -Path 'scripts/fixtures/CredentialProofHandle.cs'
    $target=$env:FIXTURE_TEST_LOCK
    $user=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl=[Security.AccessControl.FileSecurity]::new()
    $acl.SetSecurityDescriptorSddlForm("D:P(A;;FA;;;$($user.Value))",[Security.AccessControl.AccessControlSections]::Access)
    [IO.File]::SetAccessControl($target,$acl)
    $h=[CredentialProofHandle]::new($target,$true,4096)
    try {
      if ($h.ReadBase64() -ne 'Zml4dHVyZQ==') { throw 'Wrong object.' }
      $shared=$false
      try { $other=[IO.File]::OpenRead($target); $other.Dispose(); $shared=$true } catch [IO.IOException] {}
      if ($shared) { throw 'Shared open allowed.' }
      $h.ReleaseInspectedLock()
    } finally { $h.Dispose() }
    if ([IO.File]::Exists($target)) { throw 'Still present.' }
    [IO.File]::WriteAllText($target,'second')
    $acl.SetSecurityDescriptorSddlForm("D:P(A;;FA;;;$($user.Value))",[Security.AccessControl.AccessControlSections]::Access)
    [IO.File]::SetAccessControl($target,$acl)
    $single=[CredentialProofHandle]::new($target,$true,4096)
    $single.Dispose()
    New-Item -ItemType HardLink -Path $env:FIXTURE_TEST_PEER -Target $target | Out-Null
    $opened=$false
    try { $h=[CredentialProofHandle]::new($target,$true,4096); $h.Dispose(); $opened=$true } catch {}
    if ($opened) { throw 'Hard link accepted.' }
    exit 0
  `;
    try {
      writeFileSync(target, 'fixture', { flag: 'wx' });
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, FIXTURE_TEST_LOCK: target, FIXTURE_TEST_PEER: peer },
        stdio: 'pipe',
        timeout: 15000,
      });
      expect(readFileSync(peer, 'utf8')).toBe('second');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
it.skipIf(process.platform !== 'win32')(
  'records an approved synthetic recovery once, preserving the terminal receipt',
  () => {
    // An isolated, owner-private worktree and TEMP. The assessor uses synthetic observations
    // in this copy only; the operator script, exact-handle implementation and policy are real.
    const root = mkdtempSync(join(homedir(), 'flyeye-lock-unit-'));
    const fixtures = join(root, 'scripts', 'fixtures'),
      temp = join(root, 'temp');
    const files = join(root, '.supabase', 'credential-proof-receipts');
    const recovery = pathToFileURL(resolve('scripts/fixtures/credential-lock-recovery.mjs')).href;
    const producer = pathToFileURL(resolve('scripts/fixtures/credential-proof-receipt.mjs')).href;
    const ps = (args, env) =>
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', ...args], {
        cwd: root,
        env,
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 15000,
      });
    try {
      ps(
        [
          '-Command',
          `$ErrorActionPreference='Stop'
      $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      $acl=[Security.AccessControl.DirectorySecurity]::new()
      $acl.SetSecurityDescriptorSddlForm("D:P(A;OICI;FA;;;$sid)",[Security.AccessControl.AccessControlSections]::Access)
      [IO.Directory]::SetAccessControl((Get-Location).Path,$acl)`,
        ],
        process.env,
      );
      for (const dir of [temp, fixtures, files]) mkdirSync(dir, { recursive: true });
      for (const name of ['recover-credential-proof-lock.ps1', 'CredentialProofHandle.cs'])
        copyFileSync(resolve('scripts/fixtures', name), join(fixtures, name));
      const env = { ...process.env, TEMP: temp, TMP: temp };
      const acquire = `import {openReceipt} from ${JSON.stringify(producer)}; openReceipt();`;
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', acquire], {
        cwd: root,
        env,
        encoding: 'utf8',
      });
      const run = output.match(/([a-f0-9-]{36})\.json/)[1];
      const lockPath = join(temp, 'flyeye-nosend-p3d1-credential-proof.lock'),
        receiptPath = join(files, run + '.json');
      const original = readFileSync(lockPath);
      expect(() =>
        execFileSync(process.execPath, ['--input-type=module', '-e', acquire], {
          cwd: root,
          env,
          stdio: 'pipe',
        }),
      ).toThrow();
      expect(readFileSync(lockPath)).toEqual(original);
      const { record } = setup();
      Object.assign(record, JSON.parse(readFileSync(receiptPath)), {
        test: 'passed',
        teardown: 'passed',
        comparison: 'match',
      });
      const receipt = JSON.stringify(record);
      writeFileSync(receiptPath, receipt);
      const shim = `import {readFileSync} from 'node:fs';
      import {assessEnvelope} from ${JSON.stringify(recovery)};
      import {operatorBinding} from ${JSON.stringify(producer)};
      console.log(assessEnvelope(process.argv.slice(2),readFileSync(0,'utf8'),{
        operator:operatorBinding, ownerGone:()=>true, engine:()=>${JSON.stringify(record.engineBefore)},
        inventory:()=> (${JSON.stringify(record.before)}),residueAbsent:()=>true
      }));`;
      writeFileSync(join(fixtures, 'credential-lock-recovery.mjs'), shim);
      const args = [
        '-ExecutionPolicy',
        'RemoteSigned',
        '-File',
        join(fixtures, 'recover-credential-proof-lock.ps1'),
        '-Run',
        run,
        '-LockSha256',
        hash(original),
        '-ReceiptSha256',
        hash(receipt),
        '-ExclusiveMaintenance',
      ];
      expect(() => ps(args, env)).toThrow();
      expect(existsSync(receiptPath + '.recovery-intent')).toBe(false);
      const intent = receiptPath + '.recovery-intent';
      writeFileSync(intent, 'unresolved synthetic intent', { flag: 'wx' });
      expect(() => ps([...args, '-ApproveRelease'], env)).toThrow();
      expect(readFileSync(lockPath)).toEqual(original);
      rmSync(intent);
      expect(ps([...args, '-ApproveRelease'], env)).toContain('Release recorded');
      expect(existsSync(lockPath)).toBe(false);
      expect(readFileSync(receiptPath, 'utf8')).toBe(receipt);
      for (const [suffix, outcome] of [
        ['intent', 'release-authorized'],
        ['result', 'release-confirmed'],
      ])
        expect(JSON.parse(readFileSync(receiptPath + '.recovery-' + suffix))).toMatchObject({
          run,
          lockDigest: hash(original),
          receiptDigest: hash(receipt),
          outcome,
        });
      const elsewhere = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {operatorBinding} from ${JSON.stringify(producer)}; console.log(operatorBinding());`,
        ],
        { cwd: root, env: { ...env, TEMP: root, TMP: root }, encoding: 'utf8' },
      ).trim();
      expect(elsewhere).not.toBe(JSON.parse(original).operator);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  20000,
);
