// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
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
import { validateNoSendCliArtifact, noSendCliRejection } from '../lib/no-send-cli-artifact.mjs';

function fixture() {
  const binary = Buffer.alloc(64);
  binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  binary.writeUInt16LE(62, 18);
  const sources = Object.fromEntries(
    linuxSources.map((name) => [name, Buffer.from(`synthetic ${name}`)]),
  );
  const lock = {
    ...linuxPins,
    compilerExeSha256: sha256('compiler'),
    binarySha256: sha256(binary),
    sources: Object.fromEntries(linuxSources.map((name) => [name, sha256(sources[name])])),
  };
  return { binary, sources, lock, receipt: structuredClone(lock) };
}
const validate = ({ lock, receipt, binary, sources }, platform = 'linux-x64') =>
  validateNoSendCliArtifact(lock, receipt, binary, sources, platform, false, '2.109.1');

describe('Linux no-send artifact portability boundary', () => {
  it('accepts actual Go trimpath metadata without omitted linker flags and rejects drift', () => {
    const metadata =
      '/synthetic/cli: go1.25.11\n\tpath\tgithub.com/supabase/cli\n\tmod\tgithub.com/supabase/cli\t(devel)\n\tbuild\t-buildmode=exe\n\tbuild\t-compiler=gc\n\tbuild\t-trimpath=true\n\tbuild\tCGO_ENABLED=0\n\tbuild\tGOARCH=amd64\n\tbuild\tGOOS=linux\n\tbuild\tGOAMD64=v1\n';
    expect(verifyLinuxBuildMetadata(metadata, '/synthetic/cli')).toBe(true);
    for (const value of [
      metadata.replace('-trimpath=true', '-trimpath=false'),
      metadata.replace('go1.25.11', 'go1.25.10'),
      metadata.replace('GOOS=linux', 'GOOS=windows'),
      metadata.replace('CGO_ENABLED=0', 'CGO_ENABLED=1'),
      metadata + '\tbuild\tGOOS=linux\n',
      'private-canary',
    ])
      expect(() => verifyLinuxBuildMetadata(value, '/synthetic/cli')).toThrow(
        'No-send Linux build metadata rejected.',
      );
  });
  it('accepts matching synthetic Linux provenance without executing a binary', () => {
    expect(validate(fixture())).toBe(true);
  });
  it.each(['win32-x64', 'linux-arm64', 'darwin-x64', 'unknown'])(
    'rejects platform %s',
    (platform) => {
      expect(() => validate(fixture(), platform)).toThrow(noSendCliRejection);
    },
  );
  it.each(Object.keys(fixture().lock))('rejects missing, extra or drifted %s', (field) => {
    for (const value of [null, undefined, 'private-canary']) {
      for (const target of ['lock', 'receipt']) {
        const input = fixture();
        input[target][field] = value;
        expect(() => validate(input)).toThrow(noSendCliRejection);
      }
    }
  });
  it.each(linuxSources)('rejects source tamper %s', (name) => {
    const input = fixture();
    input.sources[name] = Buffer.from('private-canary');
    expect(() => validate(input)).toThrow(noSendCliRejection);
  });
  it('rejects changed binary and wrong architecture even with a matching receipt', () => {
    const input = fixture();
    input.binary[18] = 0;
    expect(() => validate(input)).toThrow(noSendCliRejection);
    input.lock.binarySha256 = input.receipt.binarySha256 = sha256(input.binary);
    expect(() => validate(input)).toThrow(noSendCliRejection);
    expect(() => verifyLinuxExecutable(Buffer.from('MZ synthetic Windows'))).toThrow();
  });
  it('requires reviewed hashes for CI and execution, never trusts a candidate receipt', () => {
    const input = fixture();
    input.lock.binarySha256 = null;
    input.lock.compilerExeSha256 = null;
    expect(validateLinuxBuildInputs(input.lock, input.sources, 'linux-x64', '--candidate')).toBe(
      true,
    );
    expect(() =>
      validateLinuxBuildInputs(input.lock, input.sources, 'linux-x64', '--ci'),
    ).toThrow();
    expect(() => validate(input)).toThrow(noSendCliRejection);
  });
  it.each(['--other', '', undefined])('rejects unsupported mode %s before acquisition', (mode) => {
    const { lock, sources } = fixture();
    expect(() => validateLinuxBuildInputs(lock, sources, 'linux-x64', mode)).toThrow();
  });
  it('rejects overrides, extra keys and changed fixed pins even when both receipts agree', () => {
    const { lock, sources } = fixture();
    expect(() => validateLinuxBuildInputs(lock, sources, 'linux-x64', '--ci', true)).toThrow();
    for (const field of Object.keys(linuxPins)) {
      const input = fixture();
      input.lock[field] = input.receipt[field] = 'private-canary';
      expect(() => validate(input)).toThrow(noSendCliRejection);
    }
    for (const target of ['lock', 'receipt']) {
      const input = fixture();
      input[target].extra = 'private-canary';
      expect(() => validate(input)).toThrow(noSendCliRejection);
    }
  });
  it('keeps module files readonly and uses clean, explicit online/offline environments', () => {
    const online = linuxGoEnvironment('/synthetic/work', true);
    const offline = linuxGoEnvironment('/synthetic/work', false);
    expect(offline).toEqual({ ...online, GOPROXY: 'off', GOSUMDB: 'off' });
    expect(online.GOPROXY).toBe('https://proxy.golang.org');
    expect(online.GOTOOLCHAIN).toBe('local');
    expect(online.GOFLAGS).toBe('-mod=readonly');
    expect(online.GOAUTH).toBe('off');
    expect(online.CGO_ENABLED).toBe('0');
    expect(online.GOOS).toBe('linux');
    expect(online.GOARCH).toBe('amd64');
    expect(online.GOAMD64).toBe('v1');
    expect(online).not.toHaveProperty('SUPABASE_ACCESS_TOKEN');
    expect(online).not.toHaveProperty('GITHUB_TOKEN');
    expect(online).not.toHaveProperty('HTTP_PROXY');
  });
  it('injects the existing guard before the DockerStart body and rejects changed/duplicate anchors', () => {
    const anchor =
      'func DockerStart(ctx context.Context, config container.Config, hostConfig container.HostConfig, networkingConfig network.NetworkingConfig, containerName string) (string, error) {\n';
    const body = '\t// original operation\n}\n';
    const expected =
      '\tif err := flyEyeBindLoopback(config, &hostConfig, networkingConfig, containerName); err != nil {\n\t\treturn "", err\n\t}\n';
    expect(patchDockerStart(anchor + body)).toBe(anchor + expected + body);
    expect(() => patchDockerStart('different source')).toThrow();
    expect(() => patchDockerStart(anchor + anchor)).toThrow();
  });
  it('accepts the finalized repository lock without executing its builder', () => {
    const sources = Object.fromEntries(
      linuxSources.map((name) => [name, readFileSync(new URL(name, import.meta.url))]),
    );
    const lock = JSON.parse(
      readFileSync(new URL('artifact-lock.linux-x64.json', import.meta.url), 'utf8'),
    );
    expect(validateLinuxBuildInputs(lock, sources, 'linux-x64', '--ci')).toBe(true);
  });
  it('rejects a synthetic pending Linux lock before network, child execution or directory creation', async () => {
    const actualSources = Object.fromEntries(
      linuxSources.map((name) => [name, readFileSync(new URL(name, import.meta.url))]),
    );
    const actualLock = JSON.parse(
      readFileSync(new URL('artifact-lock.linux-x64.json', import.meta.url), 'utf8'),
    );
    expect(validateLinuxBuildInputs(actualLock, actualSources, 'linux-x64', '--ci')).toBe(true);
    const pendingLock = { ...actualLock, binarySha256: null, compilerExeSha256: null };
    const forbidden = () => {
      throw new Error('Unexpected synthetic-test side effect.');
    };
    const child = vi.fn(forbidden);
    const mkdir = vi.fn(forbidden);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(forbidden);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.doMock('node:child_process', () => ({ spawnSync: child }));
    vi.doMock('node:fs', async (original) => {
      const fs = await original();
      return {
        ...fs,
        mkdirSync: mkdir,
        mkdtempSync: mkdir,
        writeFileSync: mkdir,
        renameSync: mkdir,
        chmodSync: mkdir,
        rmSync: mkdir,
        readFileSync: (file, ...args) =>
          String(file).endsWith('artifact-lock.linux-x64.json')
            ? JSON.stringify(pendingLock)
            : fs.readFileSync(file, ...args),
      };
    });
    try {
      const { buildLinuxCli } = await import('./build-linux.mjs');
      await expect(
        buildLinuxCli({ mode: '--ci', platform: 'linux-x64', environment: {} }),
      ).rejects.toThrow('No-send Linux build failed');
      expect(fetch).not.toHaveBeenCalled();
      expect(child).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled();
      expect(stdout.mock.calls.flat().join('')).toBe(
        'No-send Linux build: stage=preflight result=failed.\n',
      );
    } finally {
      fetch.mockRestore();
      stdout.mockRestore();
      vi.doUnmock('node:child_process');
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
  it('pins the Linux compiler source metadata and keeps the installed wrapper/native version', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../node_modules/supabase/package.json', import.meta.url), 'utf8'),
    );
    expect(pkg.version).toBe(linuxPins.cliVersion);
    expect(pkg.optionalDependencies['@supabase/cli-linux-x64']).toBe(linuxPins.cliVersion);
  });
});
