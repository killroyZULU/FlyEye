import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  linuxPins,
  linuxSources,
  validateLinuxBuildInputs,
  verifyLinuxExecutable,
} from '../no-send-cli/linux-build-contract.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const noSendCliRejection = 'Disposable CLI artifact verification failed.';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceNames = ['guard.go', 'adapter.go', 'guard_test.go', 'adapter_test.go', 'build.ps1'];

// Pure validation: callers may not execute or access Docker before this succeeds.
export function validateNoSendCliArtifact(
  lock,
  receipt,
  binary,
  sources,
  platform,
  overrides,
  version,
) {
  try {
    if (!['win32-x64', 'linux-x64'].includes(platform) || version !== '2.109.1' || overrides)
      throw new Error();
    const linux = platform === 'linux-x64';
    const names = linux ? linuxSources : sourceNames;
    if (linux) {
      validateLinuxBuildInputs(lock, sources, platform, '--ci', overrides);
      verifyLinuxExecutable(binary);
    }
    const required = [
      'schemaVersion',
      'upstreamCommit',
      'cliVersion',
      'compilerVersion',
      'compilerArchiveSha256',
      'sourceArchiveSha256',
      'compilerExeSha256',
      'binarySha256',
      'sources',
      ...(linux ? ['platform'] : []),
    ];
    if (
      Object.keys(lock).sort().join() !== required.sort().join() ||
      Object.keys(receipt).sort().join() !== required.sort().join()
    )
      throw new Error();
    if (
      lock.schemaVersion !== (linux ? 2 : 1) ||
      lock.upstreamCommit !== '6d4c19870ed213ba7f682f117d0345c8a40bfa94' ||
      lock.cliVersion !== version ||
      lock.compilerVersion !== 'go1.25.11' ||
      lock.compilerArchiveSha256 !==
        (linux
          ? linuxPins.compilerArchiveSha256
          : 'b7401f1b41517428e537493316256fb7cf03c66a130a0103ab07f3a2152e2112')
    )
      throw new Error();
    for (const field of required.filter((key) => key !== 'sources')) {
      if (lock[field] !== receipt[field]) throw new Error();
      if (field.endsWith('Sha256') && !/^[a-f0-9]{64}$/.test(lock[field])) throw new Error();
    }
    if (
      Object.keys(lock.sources).sort().join() !== [...names].sort().join() ||
      Object.keys(receipt.sources).sort().join() !== [...names].sort().join()
    )
      throw new Error();
    for (const name of names) {
      if (
        lock.sources[name] !== hash(sources[name]) ||
        lock.sources[name] !== receipt.sources[name]
      )
        throw new Error();
    }
    if (!binary.length || hash(binary) !== lock.binarySha256) throw new Error();
    return true;
  } catch {
    throw new Error(noSendCliRejection);
  }
}

export function verifiedNoSendCliEnvironment() {
  try {
    const platform = `${process.platform}-${process.arch}`;
    if (!['win32-x64', 'linux-x64'].includes(platform)) throw new Error();
    const linux = platform === 'linux-x64';
    const nativeRequire = createRequire(
      realpathSync(path.join(root, 'node_modules/supabase/dist/supabase.js')),
    );
    if (
      nativeRequire(
        linux ? '@supabase/cli-linux-x64/package.json' : '@supabase/cli-windows-x64/package.json',
      ).version !== '2.109.1'
    )
      throw new Error();
    const readJson = (name) => JSON.parse(readFileSync(path.join(root, name), 'utf8'));
    const directory = linux ? '.supabase/no-send-cli-linux' : '.supabase/no-send-cli-build';
    const binaryPath = path.join(
      root,
      directory,
      linux ? 'supabase-go-loopback' : 'supabase-go-loopback.exe',
    );
    validateNoSendCliArtifact(
      readJson(
        `scripts/no-send-cli/${linux ? 'artifact-lock.linux-x64.json' : 'artifact-lock.json'}`,
      ),
      readJson(`${directory}/receipt.json`),
      readFileSync(binaryPath),
      Object.fromEntries(
        (linux ? linuxSources : sourceNames).map((name) => [
          name,
          readFileSync(path.join(root, 'scripts/no-send-cli', name)),
        ]),
      ),
      platform,
      Boolean(process.env.SUPABASE_GO_BINARY || process.env.SUPABASE_CLI_BINARY_OVERRIDE),
      readJson('node_modules/supabase/package.json').version,
    );
    return Object.freeze({ SUPABASE_GO_BINARY: binaryPath });
  } catch {
    throw new Error(noSendCliRejection);
  }
}
