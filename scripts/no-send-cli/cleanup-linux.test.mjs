// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from './linux-build-contract.mjs';

const mocks = vi.hoisted(() => ({
  lstatSync: vi.fn(),
  realpathSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
  spawnSync: vi.fn(),
}));
vi.mock('node:fs', () => mocks);
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }));
import { cleanupLinuxBuild, cleanupRejection } from './cleanup-linux.mjs';

const root = '/native/project';
const output = `${root}/.supabase/no-send-cli-linux`;
const work = `${output}/candidate-Ab12Cd`;
const cache = `${work}/cache/modules`;
const go = `${work}/compiler/go/bin/go`;
const compiler = Buffer.from('synthetic compiler bytes, never executed');
const options = () => ({
  repositoryRoot: root,
  work,
  compilerSha256: sha256(compiler),
  timeoutMs: 12345,
});
let tree;
const directory = (extra = {}) => ({
  uid: 1000,
  dev: 7,
  ino: 42,
  mode: 0o700,
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false,
  ...extra,
});
const regular = () => directory({ isDirectory: () => false, isFile: () => true });

beforeEach(() => {
  vi.stubGlobal('process', { ...process, platform: 'linux', getuid: () => 1000 });
  tree = new Map(
    [
      root,
      output,
      work,
      `${work}/cache`,
      cache,
      `${cache}/module@v1.0.0`,
      `${work}/compiler`,
      `${work}/compiler/go`,
      `${work}/compiler/go/bin`,
    ].map((name) => [name, directory()]),
  );
  tree.set(`${cache}/module@v1.0.0`, directory({ mode: 0o555 }));
  tree.set(go, regular());
  tree.set(`${output}/supabase-go-loopback`, regular());
  tree.set(`${output}/receipt.json`, regular());
  mocks.lstatSync.mockImplementation((name) => {
    if (!tree.has(name)) throw Object.assign(new Error('synthetic absent'), { code: 'ENOENT' });
    return tree.get(name);
  });
  mocks.realpathSync.mockImplementation((name) => name);
  mocks.readFileSync.mockReturnValue(compiler);
  mocks.readdirSync.mockReturnValue(['module@v1.0.0']);
  mocks.spawnSync.mockImplementation(() => {
    tree.delete(cache);
    return { status: 0 };
  });
  mocks.rmSync.mockImplementation((name) => {
    tree.delete(name);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('owned Linux build cleanup', () => {
  it('uses offline pinned Go cleanup before removing only its private child; preserves outputs', () => {
    expect(cleanupLinuxBuild(options())).toBe(true);
    expect(mocks.spawnSync).toHaveBeenCalledTimes(1);
    const [executable, args, settings] = mocks.spawnSync.mock.calls[0];
    expect(executable).toBe('/usr/bin/timeout');
    expect(args).toEqual(['--signal=KILL', '12.345s', go, 'clean', '-modcache']);
    expect(settings.cwd).toBe(work);
    expect(settings.stdio).toBe('ignore');
    expect(settings.env).toMatchObject({
      GOMODCACHE: cache,
      GOPROXY: 'off',
      GOSUMDB: 'off',
      GOTOOLCHAIN: 'local',
      GOENV: 'off',
      GOWORK: 'off',
      GOAUTH: 'off',
      GOFLAGS: '-mod=readonly',
    });
    expect(settings.env).not.toHaveProperty('SUPABASE_ACCESS_TOKEN');
    expect(settings.env).not.toHaveProperty('GITHUB_TOKEN');
    expect(mocks.rmSync).toHaveBeenCalledExactlyOnceWith(work, { recursive: true });
    expect(mocks.spawnSync.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rmSync.mock.invocationCallOrder[0],
    );
    expect(tree.has(`${output}/receipt.json`)).toBe(true);
    expect(tree.has(`${output}/supabase-go-loopback`)).toBe(true);
  });
  it.each(['absent-cache', 'empty-cache'])(
    'handles %s before compiler acquisition without running Go',
    (state) => {
      if (state === 'absent-cache') {
        tree.delete(cache);
        tree.delete(`${work}/cache`);
      } else mocks.readdirSync.mockReturnValue([]);
      tree.delete(go);
      expect(cleanupLinuxBuild({ ...options(), compilerSha256: undefined })).toBe(true);
      expect(mocks.spawnSync).not.toHaveBeenCalled();
    },
  );
  it.each([
    output,
    root,
    `${output}/other-Ab12Cd`,
    `${output}/candidate-Ab12Cd/nested`,
    `${output}/../candidate-Ab12Cd`,
    '/elsewhere/candidate-Ab12Cd',
  ])('rejects non-owned target %s', (target) => {
    expect(() => cleanupLinuxBuild({ ...options(), work: target })).toThrow(cleanupRejection);
    expect(mocks.spawnSync).not.toHaveBeenCalled();
    expect(mocks.rmSync).not.toHaveBeenCalled();
  });
  it.each([
    root,
    output,
    work,
    `${work}/cache`,
    cache,
    `${work}/compiler`,
    `${work}/compiler/go`,
    `${work}/compiler/go/bin`,
    go,
  ])('rejects symlink, redirected and foreign-owned path %s', (target) => {
    for (const bad of ['symlink', 'redirect', 'owner']) {
      const saved = tree.get(target);
      if (bad === 'symlink') tree.set(target, { ...saved, isSymbolicLink: () => true });
      if (bad === 'owner') tree.set(target, { ...saved, uid: 0 });
      if (bad === 'redirect')
        mocks.realpathSync.mockImplementation((name) => (name === target ? '/outside' : name));
      expect(() => cleanupLinuxBuild(options())).toThrow(cleanupRejection);
      expect(mocks.spawnSync).not.toHaveBeenCalled();
      expect(mocks.rmSync).not.toHaveBeenCalled();
      tree.set(target, saved);
      mocks.realpathSync.mockImplementation((name) => name);
    }
  });
  it('rejects a non-private work directory, foreign cache device and changed compiler bytes', () => {
    tree.set(work, directory({ mode: 0o755 }));
    expect(() => cleanupLinuxBuild(options())).toThrow(cleanupRejection);
    tree.set(work, directory());
    tree.set(cache, directory({ dev: 8 }));
    expect(() => cleanupLinuxBuild(options())).toThrow(cleanupRejection);
    tree.set(cache, directory());
    mocks.readFileSync.mockReturnValue(Buffer.from('private-canary'));
    expect(() => cleanupLinuxBuild(options())).toThrow(cleanupRejection);
    expect(mocks.spawnSync).not.toHaveBeenCalled();
    expect(mocks.rmSync).not.toHaveBeenCalled();
  });
  it.each([0, -1, 60_001, NaN, 0.5])('rejects unsafe time allowance %s', (timeoutMs) => {
    expect(() => cleanupLinuxBuild({ ...options(), timeoutMs })).toThrow(cleanupRejection);
    expect(mocks.spawnSync).not.toHaveBeenCalled();
    expect(mocks.rmSync).not.toHaveBeenCalled();
  });
  it.each([
    { status: 1 },
    { status: null, signal: 'private-canary' },
    { status: null, error: new Error('private-canary') },
    { status: 0 },
  ])('fails closed on failed cleanup or residual cache: %j', (result) => {
    mocks.spawnSync.mockReturnValue(result);
    let error;
    try {
      cleanupLinuxBuild(options());
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toBe(cleanupRejection);
    expect(error.cause).toBeUndefined();
    expect(error.stack).not.toContain('private-canary');
    expect(mocks.rmSync).not.toHaveBeenCalled();
  });
  it('rejects work replacement after Go cleanup and residual work after removal', () => {
    mocks.spawnSync.mockImplementation(() => {
      tree.delete(cache);
      tree.set(work, directory({ ino: 99 }));
      return { status: 0 };
    });
    expect(() => cleanupLinuxBuild(options())).toThrow(cleanupRejection);
    expect(mocks.rmSync).not.toHaveBeenCalled();
    tree.set(work, directory());
    mocks.rmSync.mockImplementation(() => {});
    expect(() => cleanupLinuxBuild(options())).toThrow(cleanupRejection);
  });
  it('sanitizes filesystem errors and rejects missing compiler or non-Linux operation', () => {
    tree.delete(go);
    expect(() => cleanupLinuxBuild(options())).toThrow(cleanupRejection);
    tree.set(go, regular());
    mocks.lstatSync.mockImplementation(() => {
      throw new Error('private-canary');
    });
    expect(() => cleanupLinuxBuild(options())).toThrow(cleanupRejection);
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    expect(() => cleanupLinuxBuild(options())).toThrow(cleanupRejection);
    expect(mocks.spawnSync).not.toHaveBeenCalled();
    expect(mocks.rmSync).not.toHaveBeenCalled();
  });
});
