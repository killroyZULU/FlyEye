// Linux x64 only. Candidate construction does not authorize fixture execution.
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  chmodSync,
  renameSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  linuxPins,
  linuxSources,
  sha256,
  validateLinuxBuildInputs,
  patchDockerStart,
  linuxGoEnvironment,
  verifyLinuxExecutable,
  verifyLinuxBuildMetadata,
} from './linux-build-contract.mjs';
import { validateNoSendCliArtifact } from '../lib/no-send-cli-artifact.mjs';
import { cleanupLinuxBuild } from './cleanup-linux.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const budgetMs = 10 * 60 * 1000;
const report = (stage, result) =>
  process.stdout.write(`No-send Linux build: stage=${stage} result=${result}.\n`);

function cleanupBuild(work, compilerSha256, timeoutMs) {
  try {
    cleanupLinuxBuild({ repositoryRoot: root, work, compilerSha256, timeoutMs });
    report('build-cleanup', 'passed');
  } catch {
    report('build-cleanup', 'failed');
    throw new Error('No-send Linux build cleanup failed.');
  }
}

export async function buildLinuxCli({
  mode,
  platform = `${process.platform}-${process.arch}`,
  environment = process.env,
  repoRoot = root,
} = {}) {
  let stage = 'preflight';
  let work;
  let deadline;
  let cleanupCompilerSha256;
  let preserveCandidate = false;
  try {
    // No downloads, child processes, Docker or output directory before this gate.
    if (repoRoot !== root || !['--ci', '--candidate'].includes(mode)) throw new Error();
    const inputsDir = path.join(root, 'scripts/no-send-cli');
    const readInputs = () =>
      Object.fromEntries(
        linuxSources.map((name) => [name, readFileSync(path.join(inputsDir, name))]),
      );
    const sources = readInputs();
    const lock = JSON.parse(
      readFileSync(path.join(inputsDir, 'artifact-lock.linux-x64.json'), 'utf8'),
    );
    validateLinuxBuildInputs(
      lock,
      sources,
      platform,
      mode,
      Boolean(environment.SUPABASE_GO_BINARY || environment.SUPABASE_CLI_BINARY_OVERRIDE),
    );
    const output = path.join(root, '.supabase/no-send-cli-linux');
    // Never overwrite an existing receipt, candidate or executable.
    if (
      mode === '--ci' &&
      (existsSync(path.join(output, 'receipt.json')) ||
        existsSync(path.join(output, 'supabase-go-loopback')))
    )
      throw new Error();
    deadline = Date.now() + budgetMs;
    const remaining = () => {
      const value = deadline - Date.now();
      if (value <= 0) throw new Error();
      return value;
    };
    mkdirSync(output, { recursive: true });
    work = mkdtempSync(path.join(output, 'candidate-'));
    for (const directory of [
      'compiler',
      'source',
      'home',
      'tmp',
      'cache/gopath',
      'cache/build',
      'cache/modules',
    ])
      mkdirSync(path.join(work, directory), { recursive: true });
    const baseEnv = {
      PATH: '/usr/bin:/bin',
      HOME: path.join(work, 'home'),
      LANG: 'C',
      LC_ALL: 'C',
    };
    const run = (executable, args, cwd = work, env = baseEnv, capture = false) => {
      // GNU timeout owns a process group, including compiler grandchildren.
      // No shell, inherited credentials, command echo, stderr or raw failure text.
      const result = spawnSync(
        '/usr/bin/timeout',
        ['--signal=KILL', `${Math.max(0.001, remaining() / 1000)}s`, executable, ...args],
        {
          cwd,
          env,
          encoding: 'utf8',
          stdio: capture ? ['ignore', 'pipe', 'ignore'] : 'ignore',
          maxBuffer: 1024 * 1024,
        },
      );
      if (result.error || result.status !== 0 || result.signal) throw new Error();
      remaining();
      return capture ? result.stdout : '';
    };
    const acquire = async (url, name, expected, maxBytes) => {
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(remaining()),
      });
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks = [];
      let count = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          count += item.value.length;
          if (count > maxBytes) throw new Error();
          chunks.push(item.value);
          remaining();
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const bytes = Buffer.concat(chunks);
      if (sha256(bytes) !== expected) throw new Error();
      writeFileSync(path.join(work, name), bytes, { flag: 'wx', mode: 0o600 });
    };
    stage = 'archives';
    await acquire(
      'https://dl.google.com/go/go1.25.11.linux-amd64.tar.gz',
      'go.tar.gz',
      linuxPins.compilerArchiveSha256,
      64 * 1024 * 1024,
    );
    await acquire(
      `https://codeload.github.com/supabase/cli/zip/${linuxPins.upstreamCommit}`,
      'source.zip',
      linuxPins.sourceArchiveSha256,
      128 * 1024 * 1024,
    );
    run('/usr/bin/tar', [
      '--no-same-owner',
      '--no-same-permissions',
      '-xzf',
      path.join(work, 'go.tar.gz'),
      '-C',
      path.join(work, 'compiler'),
    ]);
    run('/usr/bin/unzip', ['-q', path.join(work, 'source.zip'), '-d', path.join(work, 'source')]);
    report(stage, 'passed');

    stage = 'patch';
    const source = path.join(work, `source/cli-${linuxPins.upstreamCommit}/apps/cli-go`);
    const go = path.join(work, 'compiler/go/bin/go');
    const compilerHash = sha256(readFileSync(go));
    if (mode === '--ci' && compilerHash !== lock.compilerExeSha256) throw new Error();
    cleanupCompilerSha256 = compilerHash;
    const docker = path.join(source, 'internal/utils/docker.go');
    const patchedDocker = patchDockerStart(readFileSync(docker, 'utf8'));
    writeFileSync(docker, patchedDocker);
    const destinations = {
      'internal/flyeyeloopback/guard.go': 'guard.go',
      'internal/flyeyeloopback/guard_test.go': 'guard_test.go',
      'internal/utils/flyeye_loopback.go': 'adapter.go',
      'internal/flyeyeloopbackadapter/adapter.go': 'adapter.go',
      'internal/flyeyeloopbackadapter/adapter_test.go': 'adapter_test.go',
    };
    for (const [destination, name] of Object.entries(destinations)) {
      mkdirSync(path.dirname(path.join(source, destination)), { recursive: true });
      writeFileSync(path.join(source, destination), sources[name], { flag: 'wx' });
    }
    const moduleHashes = Object.fromEntries(
      ['go.mod', 'go.sum'].map((name) => [name, sha256(readFileSync(path.join(source, name)))]),
    );
    const unchanged = () => {
      validateLinuxBuildInputs(lock, readInputs(), platform, mode);
      for (const [name, expected] of Object.entries(moduleHashes))
        if (sha256(readFileSync(path.join(source, name))) !== expected) throw new Error();
      for (const [destination, name] of Object.entries(destinations))
        if (sha256(readFileSync(path.join(source, destination))) !== sha256(sources[name]))
          throw new Error();
      if (
        readFileSync(docker, 'utf8') !== patchedDocker ||
        sha256(readFileSync(go)) !== compilerHash
      )
        throw new Error();
    };
    const online = linuxGoEnvironment(work, true);
    const offline = linuxGoEnvironment(work, false);
    // Only the reviewed source go.mod/go.sum govern dependencies. Any mutation
    // aborts before compilation; no direct VCS fallback or implicit toolchain fetch.
    stage = 'dependencies';
    run(go, ['mod', 'download'], source, online);
    unchanged();
    run(
      go,
      [
        'list',
        '-deps',
        '-test',
        './internal/flyeyeloopback',
        './internal/flyeyeloopbackadapter',
        '.',
      ],
      source,
      online,
    );
    unchanged();
    report(stage, 'passed');
    stage = 'guard-tests';
    run(
      go,
      ['test', '-count=1', './internal/flyeyeloopback', './internal/flyeyeloopbackadapter'],
      source,
      offline,
    );
    unchanged();
    report(stage, 'passed');
    stage = 'compile';
    const binaryPath = path.join(work, 'supabase-go-loopback');
    run(
      go,
      [
        'build',
        '-trimpath',
        '-buildvcs=false',
        '-ldflags=-X github.com/supabase/cli/internal/utils.Version=2.109.1-flyeye-loopback.1',
        '-o',
        binaryPath,
        '.',
      ],
      source,
      offline,
    );
    unchanged();
    stage = 'integrity';
    run(go, ['mod', 'verify'], source, offline);
    const metadata = run(go, ['version', '-m', binaryPath], source, offline, true);
    verifyLinuxBuildMetadata(metadata, binaryPath);
    unchanged();
    const binary = readFileSync(binaryPath);
    verifyLinuxExecutable(binary);
    const receipt = {
      ...linuxPins,
      compilerExeSha256: compilerHash,
      binarySha256: sha256(binary),
      sources: Object.fromEntries(linuxSources.map((name) => [name, sha256(sources[name])])),
    };
    writeFileSync(path.join(work, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    if (mode === '--ci') {
      validateNoSendCliArtifact(
        lock,
        receipt,
        binary,
        sources,
        platform,
        false,
        linuxPins.cliVersion,
      );
      chmodSync(binaryPath, 0o700);
      renameSync(binaryPath, path.join(output, 'supabase-go-loopback'));
      renameSync(path.join(work, 'receipt.json'), path.join(output, 'receipt.json'));
    } else {
      preserveCandidate = true;
    }
    report(stage, mode === '--ci' ? 'verified' : 'candidate-only');
    return true;
  } catch {
    report(stage, 'failed');
    throw new Error('No-send Linux build failed; raw child output suppressed.');
  } finally {
    // Only the exact newly-created subtree is removed. Candidates retain their
    // evidence for separate artifact review; no shared cache or service is touched.
    if (work && !preserveCandidate) {
      cleanupBuild(work, cleanupCompilerSha256, Math.min(60_000, deadline - Date.now()));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    report('preflight', 'failed');
    process.exitCode = 1;
  } else {
    await buildLinuxCli({ mode: process.argv[2] }).catch(() => {
      process.exitCode = 1;
    });
  }
}
