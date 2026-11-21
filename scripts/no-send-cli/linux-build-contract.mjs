import { createHash } from 'node:crypto';

export const linuxPins = Object.freeze({
  schemaVersion: 2,
  platform: 'linux-x64',
  upstreamCommit: '6d4c19870ed213ba7f682f117d0345c8a40bfa94',
  cliVersion: '2.109.1',
  compilerVersion: 'go1.25.11',
  // Official go.dev download metadata; archive acquisition is a separate action.
  compilerArchiveSha256: '34f14304e856893f4ba30c2cacfe93906e9de7915c5f6aaaf3a81cdccd7ba30b',
  sourceArchiveSha256: '8cac81470d00f822e1ccfcafa369fd8774c9027ed6006842ec4aeb849aeb0643',
});
export const linuxSources = Object.freeze([
  'guard.go',
  'adapter.go',
  'guard_test.go',
  'adapter_test.go',
  'build-linux.mjs',
  'linux-build-contract.mjs',
  'cleanup-linux.mjs',
]);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keysEqual = (value, keys) =>
  value && Object.keys(value).sort().join() === [...keys].sort().join();

// CI cannot bootstrap trust from its own generated receipt. Only --candidate
// permits missing executable hashes; it never installs an executable for the fixture.
export function validateLinuxBuildInputs(lock, sources, platform, mode, overrides = false) {
  try {
    if (platform !== linuxPins.platform || !['--ci', '--candidate'].includes(mode) || overrides)
      throw new Error();
    if (
      !keysEqual(lock, [...Object.keys(linuxPins), 'compilerExeSha256', 'binarySha256', 'sources'])
    )
      throw new Error();
    for (const [key, value] of Object.entries(linuxPins))
      if (lock[key] !== value) throw new Error();
    for (const key of ['compilerExeSha256', 'binarySha256']) {
      if (!(digest(lock[key]) || (mode === '--candidate' && lock[key] === null))) throw new Error();
    }
    if (!keysEqual(lock.sources, linuxSources) || !keysEqual(sources, linuxSources))
      throw new Error();
    for (const name of linuxSources)
      if (lock.sources[name] !== sha256(sources[name])) throw new Error();
    return true;
  } catch {
    throw new Error('No-send Linux build inputs rejected.');
  }
}

export function patchDockerStart(original) {
  const anchor =
    'func DockerStart(ctx context.Context, config container.Config, hostConfig container.HostConfig, networkingConfig network.NetworkingConfig, containerName string) (string, error) {\n';
  if (original.split(anchor).length !== 2) throw new Error('No-send Linux patch anchor rejected.');
  return original.replace(
    anchor,
    `${anchor}\tif err := flyEyeBindLoopback(config, &hostConfig, networkingConfig, containerName); err != nil {\n\t\treturn "", err\n\t}\n`,
  );
}

// Rebuilds on another checkout must have the same architecture, Go flags and
// content inputs. No inherited credentials, proxy overrides or compiler options.
export function linuxGoEnvironment(work, online) {
  return {
    PATH: `${work}/compiler/go/bin:/usr/bin:/bin`,
    HOME: `${work}/home`,
    TMPDIR: `${work}/tmp`,
    GOROOT: `${work}/compiler/go`,
    GOPATH: `${work}/cache/gopath`,
    GOCACHE: `${work}/cache/build`,
    GOMODCACHE: `${work}/cache/modules`,
    GOENV: 'off',
    GOTOOLCHAIN: 'local',
    GOWORK: 'off',
    GOAUTH: 'off',
    GOPROXY: online ? 'https://proxy.golang.org' : 'off',
    GOSUMDB: online ? 'sum.golang.org' : 'off',
    GOPRIVATE: '',
    GONOPROXY: '',
    GONOSUMDB: '',
    CGO_ENABLED: '0',
    GOOS: 'linux',
    GOARCH: 'amd64',
    GOAMD64: 'v1',
    GOFLAGS: '-mod=readonly',
    GOMAXPROCS: '2',
    LANG: 'C',
    LC_ALL: 'C',
  };
}

export function verifyLinuxExecutable(bytes) {
  // Static ELF64 little-endian x86-64 check, never --version execution.
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 64 ||
    bytes.subarray(0, 4).toString('hex') !== '7f454c46' ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes.readUInt16LE(18) !== 62
  )
    throw new Error('No-send Linux executable format rejected.');
  return true;
}

export function verifyLinuxBuildMetadata(metadata, binaryPath) {
  const lines = typeof metadata === 'string' ? metadata.split('\n') : [];
  if (
    lines[0] !== `${binaryPath}: go1.25.11` ||
    lines.filter((line) => line === '\tpath\tgithub.com/supabase/cli').length !== 1
  )
    throw new Error('No-send Linux build metadata rejected.');
  const required = {
    '-trimpath': 'true',
    '-buildmode': 'exe',
    '-compiler': 'gc',
    CGO_ENABLED: '0',
    GOOS: 'linux',
    GOARCH: 'amd64',
    GOAMD64: 'v1',
  };
  for (const [key, value] of Object.entries(required)) {
    const entries = lines.filter((line) => line.startsWith(`\tbuild\t${key}=`));
    if (entries.length !== 1 || entries[0] !== `\tbuild\t${key}=${value}`)
      throw new Error('No-send Linux build metadata rejected.');
  }
  // Go deliberately omits -ldflags from build info with -trimpath (issue 52372).
  // The reviewed builder bytes and executable digest bind the fixed CLI version
  // linker command; this metadata check does not claim to recover that value.
  return true;
}
