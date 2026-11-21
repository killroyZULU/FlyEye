// @vitest-environment node
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { noSendCliRejection, validateNoSendCliArtifact } from './no-send-cli-artifact.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const names = ['guard.go', 'adapter.go', 'guard_test.go', 'adapter_test.go', 'build.ps1'];
function fixture() {
  const sources = Object.fromEntries(names.map((name) => [name, Buffer.from(`synthetic ${name}`)]));
  const binary = Buffer.from('synthetic executable, never executed');
  const lock = {
    schemaVersion: 1,
    upstreamCommit: '6d4c19870ed213ba7f682f117d0345c8a40bfa94',
    cliVersion: '2.109.1',
    compilerVersion: 'go1.25.11',
    compilerArchiveSha256: 'b7401f1b41517428e537493316256fb7cf03c66a130a0103ab07f3a2152e2112',
    sourceArchiveSha256: hash('source archive'),
    compilerExeSha256: hash('compiler'),
    binarySha256: hash(binary),
    sources: Object.fromEntries(names.map((name) => [name, hash(sources[name])])),
  };
  return [lock, structuredClone(lock), binary, sources, 'win32-x64', false, '2.109.1'];
}

describe('disposable CLI artifact gate', () => {
  it('does not include rejected input or a raw cause in its error', () => {
    const input = fixture();
    input[0].upstreamCommit = 'secret-canary';
    let failure;
    try {
      validateNoSendCliArtifact(...input);
    } catch (error) {
      failure = error;
    }
    expect(failure?.message).toBe(noSendCliRejection);
    expect(failure?.cause).toBeUndefined();
    expect(failure?.stack).not.toContain('secret-canary');
  });
  it('rejects another working directory before artifact access or child execution', async () => {
    vi.resetModules();
    const spawn = vi.fn();
    const gate = vi.fn();
    vi.doMock('node:child_process', () => ({ spawnSync: spawn }));
    vi.doMock('./no-send-cli-artifact.mjs', () => ({ verifiedNoSendCliEnvironment: gate }));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(tmpdir());
    try {
      const { localNoSendProject } = await import('./no-send-local-project.mjs');
      expect(() => localNoSendProject()).toThrow('Disposable no-send working directory rejected.');
      expect(gate).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      cwd.mockRestore();
      vi.doUnmock('node:child_process');
      vi.doUnmock('./no-send-cli-artifact.mjs');
      vi.resetModules();
    }
  });
  it('accepts matching synthetic provenance without network or process execution', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network forbidden');
    });
    try {
      expect(validateNoSendCliArtifact(...fixture())).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
  it.each(Object.keys(fixture()[0]))('rejects missing or mismatched %s', (field) => {
    for (const target of [0, 1]) {
      for (const value of [undefined, null, 'secret-canary']) {
        const input = fixture();
        input[target][field] = value;
        expect(() => validateNoSendCliArtifact(...input)).toThrow(noSendCliRejection);
      }
    }
  });
  it.each([0, 1])('rejects additional provenance fields in document %i', (target) => {
    const input = fixture();
    input[target].unexpected = 'secret-canary';
    expect(() => validateNoSendCliArtifact(...input)).toThrow(noSendCliRejection);
  });
  it.each(names)('rejects changed or missing patch input %s', (name) => {
    for (const value of [undefined, Buffer.from('secret-canary')]) {
      const input = fixture();
      input[3][name] = value;
      expect(() => validateNoSendCliArtifact(...input)).toThrow(noSendCliRejection);
    }
  });
  it('rejects substituted targets even when receipt agrees', () => {
    for (const field of [
      'schemaVersion',
      'upstreamCommit',
      'compilerVersion',
      'compilerArchiveSha256',
      'cliVersion',
    ]) {
      const input = fixture();
      input[0][field] = input[1][field] = 'secret-canary';
      expect(() => validateNoSendCliArtifact(...input)).toThrow(noSendCliRejection);
    }
  });
  it('rejects corrupt binary, foreign platform, overrides and installed-version drift', () => {
    for (const [index, value] of [
      [2, Buffer.from('secret-canary')],
      [2, Buffer.alloc(0)],
      [4, 'linux-x64'],
      [5, true],
      [6, 'other'],
    ]) {
      const input = fixture();
      input[index] = value;
      expect(() => validateNoSendCliArtifact(...input)).toThrow(noSendCliRejection);
    }
  });
  it('uses an explicit gate before Docker and passes the override only to CLI subprocesses', async () => {
    vi.resetModules();
    const spawn = vi.fn(() => {
      throw new Error('Unexpected child process');
    });
    vi.doMock('node:child_process', () => ({ spawnSync: spawn }));
    vi.doMock('./no-send-cli-artifact.mjs', () => ({
      verifiedNoSendCliEnvironment: () => {
        throw new Error(noSendCliRejection);
      },
    }));
    try {
      const { localNoSendProject } = await import('./no-send-local-project.mjs');
      expect(() => localNoSendProject()).toThrow(noSendCliRejection);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('node:child_process');
      vi.doUnmock('./no-send-cli-artifact.mjs');
      vi.resetModules();
    }
  });
});
