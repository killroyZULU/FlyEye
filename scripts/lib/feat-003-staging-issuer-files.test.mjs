// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:fs/promises', async (original) => {
  const actual = await original();
  return { ...actual, lstat: vi.fn(actual.lstat), readFile: vi.fn(actual.readFile) };
});
import { lstat, readFile } from 'node:fs/promises';
import {
  readIssuerFile,
  readIssuerRevision,
  loadIssuerInputs,
} from './feat-003-staging-issuer-files.mjs';

let root;
const prefix = path.join(os.tmpdir(), 'flyeye-p3b-files-');
const revision = 'a'.repeat(40);
async function file(name, value) {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
  return target;
}
beforeEach(async () => {
  root = await mkdtemp(prefix);
});
afterEach(async () => {
  // Only this test's fresh, absolute temporary directory may be removed.
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !root.startsWith(prefix)) {
    throw new Error('Unsafe fixture cleanup');
  }
  await rm(root, { recursive: true });
});

describe('P3b issuer package files', () => {
  it.each([
    '\\\\synthetic.invalid\\share\\package',
    '//synthetic.invalid/share/package',
    '\\\\?\\C:\\package',
  ])('rejects explicit network/device paths before file access', async (networkPath) => {
    vi.mocked(lstat).mockClear();
    vi.mocked(readFile).mockClear();
    await expect(loadIssuerInputs(root, networkPath)).rejects.toThrow('Local absolute package');
    await expect(readIssuerFile(networkPath)).rejects.toThrow('Local absolute issuer');
    await expect(readIssuerRevision(networkPath)).rejects.toThrow('Local absolute issuer');
    expect(lstat).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });
  it('accepts exact bounded bytes and rejects an oversized file or directory', async () => {
    const target = await file('artifact', 'synthetic');
    expect((await readIssuerFile(target, 9)).toString()).toBe('synthetic');
    await expect(readIssuerFile(target, 8)).rejects.toThrow('Invalid issuer file');
    await expect(readIssuerFile(root)).rejects.toThrow('Invalid issuer file');
  });
  it.each(['detached', 'loose', 'packed', 'worktree'])(
    'reads %s HEAD without Git execution',
    async (kind) => {
      if (kind === 'worktree') {
        await file('.git', 'gitdir: metadata/worktree');
        await file('metadata/worktree/HEAD', 'ref: refs/heads/task');
        await file('metadata/worktree/commondir', '../common');
        await file('metadata/common/refs/heads/task', revision);
      } else {
        await file('.git/HEAD', kind === 'detached' ? revision : 'ref: refs/heads/task');
        if (kind === 'loose') await file('.git/refs/heads/task', revision);
        if (kind === 'packed')
          await file('.git/packed-refs', `# pack-refs\n${revision} refs/heads/task\n`);
      }
      expect(await readIssuerRevision(root)).toBe(revision);
    },
  );
  it('rejects a malformed Git pointer instead of treating it as a path', async () => {
    await file('.git', 'metadata');
    await expect(readIssuerRevision(root)).rejects.toThrow('Invalid Git metadata');
  });
  it('rejects a traversal ref', async () => {
    await file('.git/HEAD', 'ref: refs/heads/../../../outside');
    await expect(readIssuerRevision(root)).rejects.toThrow('Invalid HEAD');
  });
  it('requires a complete fixed-name package and loads only its artifact inventory', async () => {
    await file('.git/HEAD', revision);
    await file('config/feat-003-staging-environment.json', '{}');
    await file('bundle/package.json', '{}');
    await file('bundle/review.json', '{}');
    for (const name of ['configuration', 'edge', 'frontend', 'lockfile', 'migrations']) {
      await file(`bundle/artifacts/${name}`, `synthetic ${name}`);
    }
    await file('bundle/artifacts/ignored', 'not loaded');
    const input = await loadIssuerInputs(root, path.join(root, 'bundle'));
    expect(input.checkoutRevision).toBe(revision);
    expect([...input.artifacts.keys()]).toEqual([
      'configuration',
      'edge',
      'frontend',
      'lockfile',
      'migrations',
    ]);
    await rm(path.join(root, 'bundle/review.json'));
    await expect(loadIssuerInputs(root, path.join(root, 'bundle'))).rejects.toThrow();
    await expect(loadIssuerInputs(root, 'relative')).rejects.toThrow('Local absolute package');
  });
});
