// @vitest-environment node
import { localStaleResourceDiagnostics } from './local-stale-preflight-diagnostics.mjs';
import { runInNewContext } from 'node:vm';
import {
  readFileSync,
  lstatSync,
  fstatSync,
  realpathSync,
  openSync,
  closeSync,
  constants,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  localStaleTemplates,
  verifyLocalStaleTemplateMounts,
} from './local-stale-template-mounts.mjs';
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal()),
  readFileSync: vi.fn(),
  lstatSync: vi.fn(),
  fstatSync: vi.fn(),
  realpathSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
}));
const originalFs = await vi.importActual('node:fs');
const content = localStaleTemplates.map((pin) =>
  originalFs.readFileSync(new URL('../../supabase/templates/' + pin.file, import.meta.url)),
);
const root = path.join(tmpdir(), 'flyeye-stale-' + 'a'.repeat(32));
const owner = Object.getOwnPropertyDescriptor(process, 'getuid');
let opened, mutation;
function metadata(file) {
  const directory = !file.endsWith('.html');
  const result = {
    uid: 12345,
    mode: directory ? 0o700 : 0o600,
    nlink: 1,
    size: directory
      ? 0
      : content[localStaleTemplates.findIndex((pin) => file.endsWith(pin.file))].length,
    dev: 1,
    ino: 2,
    isFile: () => !directory,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
  };
  return mutation?.(file, result) ?? result;
}
beforeEach(() => {
  vi.resetAllMocks();
  mutation = undefined;
  opened = undefined;
  Object.defineProperty(process, 'getuid', { value: () => 12345, configurable: true });
  vi.mocked(realpathSync).mockImplementation((file) => file);
  vi.mocked(lstatSync).mockImplementation(metadata);
  vi.mocked(openSync).mockImplementation((file) => {
    opened = file;
    return 99;
  });
  vi.mocked(fstatSync).mockImplementation(() => metadata(opened));
  vi.mocked(readFileSync).mockImplementation(
    () => content[localStaleTemplates.findIndex((pin) => opened.endsWith(pin.file))],
  );
});
afterEach(() => {
  if (owner) Object.defineProperty(process, 'getuid', owner);
  else delete process.getuid;
});
function fixture(mark) {
  const kong = {
    Id: 'c'.repeat(64),
    Mounts: localStaleTemplates.map((pin) => ({
      Type: 'bind',
      Source: path.join(root, 'supabase/templates', pin.file),
      Destination: '/home/kong/templates/email/' + pin.file,
      RW: true,
      Mode: 'rw',
      Propagation: 'rprivate',
    })),
  };
  const state = { containers: [kong], before: null, after: null, inspection: null };
  let reads = 0;
  const command = vi.fn((args) => {
    if (args[0] === 'ps')
      return (
        (reads++ === 0 ? state.before : state.after) ??
        state.containers.map((container) => container.Id).join('\n')
      );
    return (
      state.inspection ?? state.containers.map((container) => JSON.stringify(container)).join('\n')
    );
  });
  return {
    kong,
    state,
    command,
    run: () => verifyLocalStaleTemplateMounts(root, kong, command, mark),
  };
}
describe('owned template file boundaries with synthetic filesystem metadata', () => {
  it('accepts pinned bytes, exact mappings and exclusive attachments; closes every file', () => {
    const f = fixture();
    expect(f.run).not.toThrow();
    expect(f.command).toHaveBeenCalledTimes(3);
    expect(closeSync).toHaveBeenCalledTimes(4);
    expect(openSync).toHaveBeenCalledWith(
      f.kong.Mounts[0].Source,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    expect(f.command).toHaveBeenCalledWith(['ps', '-a', '--format', '{{.ID}}', '--no-trunc']);
    expect(f.command).toHaveBeenCalledWith([
      'inspect',
      '--type',
      'container',
      '--format',
      '{"Id":{{json .Id}},"Mounts":{{json .Mounts}}}',
      f.kong.Id,
    ]);
  });
  it.each([
    'root-symlink',
    'parent-symlink',
    'file-symlink',
    'hardlink',
    'directory-instead-of-file',
    'wrong-owner',
    'shared-root',
    'writable-parent',
    'writable-file',
    'oversized-file',
    'changed-opened-inode',
    'replaced-after-read',
    'file-read-error',
    'sharing-error',
  ])('rejects %s with a fixed error and no content leakage', (scenario) => {
    const f = fixture();
    mutation = (file, stat) => {
      const isFile = file.endsWith('.html');
      if (
        (scenario === 'root-symlink' && file === root) ||
        (scenario === 'parent-symlink' && file === path.join(root, 'supabase')) ||
        (scenario === 'file-symlink' && isFile)
      )
        stat.isSymbolicLink = () => true;
      if (scenario === 'hardlink' && isFile) stat.nlink = 2;
      if (scenario === 'directory-instead-of-file' && isFile) stat.isFile = () => false;
      if (scenario === 'wrong-owner' && isFile) stat.uid = 54321;
      if (scenario === 'shared-root' && file === root) stat.mode = 0o755;
      if (scenario === 'writable-parent' && file === path.join(root, 'supabase')) stat.mode = 0o777;
      if (scenario === 'writable-file' && isFile) stat.mode = 0o666;
      if (scenario === 'oversized-file' && isFile) stat.size = 65537;
      return stat;
    };
    if (scenario === 'changed-opened-inode')
      vi.mocked(fstatSync).mockImplementation(() => ({ ...metadata(opened), ino: 3 }));
    if (scenario === 'replaced-after-read')
      vi.mocked(readFileSync).mockImplementation(() => {
        const bytes = content[0];
        mutation = (file, stat) => (file.endsWith('.html') ? { ...stat, ino: 3 } : stat);
        return bytes;
      });
    if (scenario === 'file-read-error')
      vi.mocked(readFileSync).mockImplementation(() => {
        throw Error('synthetic-private-file-content');
      });
    if (scenario === 'sharing-error')
      f.command.mockImplementation(() => {
        throw Error('synthetic-private-inspection');
      });
    expect(f.run).toThrow(/^Disposable template mounts rejected\.$/);
    if (openSync.mock.calls.length) expect(closeSync).toHaveBeenCalled();
  });
});

describe('complete exact-source attachment inventory', () => {
  it('accepts mixed POSIX and Windows drive metadata without host-default path parsing', () => {
    const f = fixture();
    f.state.containers.push({
      Id: 'd'.repeat(64),
      Mounts: [
        { Type: 'bind', Source: '/synthetic/unrelated/file.txt', Destination: '/posix' },
        { Type: 'bind', Source: String.raw`C:\Synthetic Data\file.txt`, Destination: '/windows' },
        {
          Type: 'bind',
          Source: String.raw`d:\synthetic\file.txt`,
          Destination: '/lowercase-drive',
        },
      ],
    });
    const before = JSON.stringify(f.state.containers);
    expect(f.run).not.toThrow();
    expect(JSON.stringify(f.state.containers)).toBe(before);
    // Execute the real parser with host-default methods unavailable, on either test host.
    const source = originalFs.readFileSync(
      new URL('./local-stale-template-mounts.mjs', import.meta.url),
      'utf8',
    );
    const parser = source.slice(
      source.indexOf('function canonicalInventorySource'),
      source.indexOf('function verifyAttachments'),
    );
    const rejectHostDefault = () => {
      throw Error('host path parser used');
    };
    const validate = runInNewContext(parser + '\ncanonicalInventorySource;', {
      path: {
        posix: path.posix,
        win32: path.win32,
        isAbsolute: rejectHostDefault,
        normalize: rejectHostDefault,
      },
    });
    for (const mount of f.state.containers[1].Mounts) expect(validate(mount.Source)).toBe(true);
  });
  it.each([
    ['relative', 'synthetic-private/file'],
    ['drive-relative', String.raw`C:synthetic-private\file`],
    ['root-relative', String.raw`\synthetic-private\file`],
    ['unc', String.raw`\\synthetic-private\share\file`],
    ['forward-unc', '//synthetic-private/share/file'],
    ['device', String.raw`\\.\synthetic-private`],
    ['namespace', String.raw`\\?\C:\synthetic-private\file`],
    ['wsl-unc', String.raw`\\wsl.localhost\Ubuntu\tmp\synthetic-private`],
    ['drive-forward-slashes', 'C:/synthetic-private/file'],
    ['mixed-separators', String.raw`C:\synthetic-private/file`],
    ['windows-parent', String.raw`C:\synthetic-private\..\file`],
    ['posix-parent', '/synthetic-private/../file'],
    ['windows-dot', String.raw`C:\synthetic-private\.\file`],
    ['posix-dot', '/synthetic-private/./file'],
    ['windows-double-separator', String.raw`C:\synthetic-private\\file`],
    ['posix-double-separator', '/synthetic-private//file'],
    ['trailing-dot', String.raw`C:\synthetic-private\file.`],
    ['trailing-space', String.raw`C:\synthetic-private\file `],
    ['alternate-stream', String.raw`C:\synthetic-private\file:stream`],
    ['reserved-device', String.raw`C:\synthetic-private\NUL.txt`],
    ['control', '/synthetic-private/\nfile'],
    ['null-byte', '/synthetic-private/\0file'],
  ])('rejects %s metadata with no private path in diagnostics', (_name, source) => {
    const lines = [],
      observer = localStaleResourceDiagnostics({
        enabled: true,
        write: (line) => lines.push(line),
      });
    const f = fixture(observer.mark);
    f.state.containers.push({
      Id: 'd'.repeat(64),
      Mounts: [{ Type: 'bind', Source: source, Destination: '/unrelated' }],
    });
    expect(f.run).toThrow(/^Disposable template mounts rejected\.$/);
    observer.fail();
    expect(lines).toEqual([
      'FEAT-003 runtime diagnostic: stage=local-resource-template-attachments-read event=failed detail=unclassified.',
    ]);
    expect(lines.join()).not.toContain('synthetic-private');
    expect(closeSync).toHaveBeenCalledTimes(4);
  });
  it('does not admit a Windows inventory path as a replacement for an exact protected source', () => {
    const f = fixture();
    f.kong.Mounts[0].Source = String.raw`C:\synthetic\recovery.html`;
    expect(f.run).toThrow(/^Disposable template mounts rejected\.$/);
    expect(f.command).not.toHaveBeenCalled();
  });
  it('accepts exactly 100 containers and 100 unrelated mounts', () => {
    const f = fixture();
    for (let i = 0; i < 99; i++)
      f.state.containers.push({
        Id: i.toString(16).padStart(64, '0'),
        Mounts: Array.from({ length: 100 }, () => ({ Type: 'tmpfs' })),
      });
    expect(f.run).not.toThrow();
    expect(f.command).toHaveBeenCalledTimes(3);
  });
  it('accepts unrelated mounts and reordered inventory without a volume filter', () => {
    const f = fixture();
    f.state.containers.push({
      Id: 'd'.repeat(64),
      Mounts: [
        { Type: 'bind', Source: path.join(tmpdir(), 'unrelated'), Destination: '/different' },
        { Type: 'volume' },
        { Type: 'tmpfs' },
      ],
    });
    f.state.after = f.state.containers
      .map((c) => c.Id)
      .reverse()
      .join('\n');
    expect(f.run).not.toThrow();
    expect(f.command.mock.calls.flat(2).join(' ')).not.toContain('--filter');
  });
  it.each(['running', 'stopped'])(
    'denies a %s container sharing a source at another destination',
    (status) => {
      const f = fixture();
      f.state.containers.push({
        Id: 'd'.repeat(64),
        State: { Status: status },
        Mounts: [{ ...f.kong.Mounts[0], Destination: '/different', RW: false }],
      });
      expect(f.run).toThrow(/^Disposable template mounts rejected\.$/);
    },
  );
  it.each([
    'empty-inventory',
    'malformed-id',
    'duplicate-id',
    'too-many-containers',
    'missing-kong',
    'invalid-json',
    'missing-result',
    'truncated-result',
    'duplicate-result',
    'unexpected-result',
    'null-result',
    'missing-mounts',
    'too-many-mounts',
    'null-mount',
    'unknown-type',
    'missing-source',
    'relative-source',
    'aliased-source',
    'missing-destination',
    'changed-kong',
    'changed-inventory',
    'read-error',
    'duplicate-attachment',
  ])('fails closed with sanitized attribution: %s', (scenario) => {
    const lines = [],
      observer = localStaleResourceDiagnostics({
        enabled: true,
        write: (line) => lines.push(line),
      });
    const f = fixture(observer.mark);
    const copy = structuredClone(f.kong);
    if (scenario === 'empty-inventory') f.state.before = '';
    if (scenario === 'malformed-id') f.state.before = 'synthetic-private-id';
    if (scenario === 'duplicate-id') f.state.before = f.kong.Id + '\n' + f.kong.Id;
    if (scenario === 'too-many-containers')
      f.state.before = Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(64, '0')).join(
        '\n',
      );
    if (scenario === 'missing-kong') f.state.before = 'd'.repeat(64);
    if (scenario === 'invalid-json') f.state.inspection = 'synthetic-private-inspection';
    if (scenario === 'missing-result') f.state.inspection = '';
    if (scenario === 'truncated-result') f.state.before = f.kong.Id + '\n' + 'd'.repeat(64);
    if (scenario === 'duplicate-result') {
      f.state.before = f.kong.Id + '\n' + 'd'.repeat(64);
      f.state.inspection = JSON.stringify(copy) + '\n' + JSON.stringify(copy);
    }
    if (scenario === 'unexpected-result') copy.Id = 'd'.repeat(64);
    if (scenario === 'null-result') f.state.inspection = 'null';
    if (scenario === 'missing-mounts') delete copy.Mounts;
    if (scenario === 'too-many-mounts') copy.Mounts = Array(101).fill({ Type: 'tmpfs' });
    if (scenario === 'null-mount') copy.Mounts[0] = null;
    if (scenario === 'unknown-type') copy.Mounts[0].Type = 'unknown';
    if (scenario === 'missing-source') delete copy.Mounts[0].Source;
    if (scenario === 'relative-source') copy.Mounts[0].Source = 'relative';
    if (scenario === 'aliased-source')
      copy.Mounts[0].Source = root + '/supabase/templates/../templates/recovery.html';
    if (scenario === 'missing-destination') delete copy.Mounts[0].Destination;
    if (scenario === 'changed-kong') copy.Mounts[0].RW = false;
    if (scenario === 'changed-inventory') f.state.after = f.kong.Id + '\n' + 'd'.repeat(64);
    if (scenario === 'read-error')
      f.command.mockImplementation(() => {
        throw Error('synthetic-private-command');
      });
    if (scenario === 'duplicate-attachment') copy.Mounts.push({ ...copy.Mounts[0] });
    if (f.state.inspection === null) f.state.inspection = JSON.stringify(copy);
    expect(f.run).toThrow(/^Disposable template mounts rejected\.$/);
    observer.fail();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^FEAT-003 runtime diagnostic: stage=local-resource-template-attachments-(read|exclusive) event=failed detail=unclassified\.$/,
    );
    expect(lines.join()).not.toContain('synthetic-private');
    expect(closeSync).toHaveBeenCalledTimes(4);
  });
});

it('registers owned fixture cleanup before a template setup failure', () => {
  const source = originalFs.readFileSync(
    new URL('./local-stale-target.test.mjs', import.meta.url),
    'utf8',
  );
  const fixtureSource = source.slice(
    source.indexOf('function fixture()'),
    source.indexOf("describe('explicit local stale-factors selection'"),
  );
  const callbacks = [],
    remove = vi.fn(),
    failure = new Error('synthetic setup failure');
  const context = {
    localStaleProfile: { projectId: 'synthetic' },
    path,
    tmpdir,
    randomBytes: () => Buffer.alloc(16, 1),
    realpathSync: (value) => value,
    mkdirSync: vi.fn(),
    rmSync: remove,
    onTestFinished: (callback) => callbacks.push(callback),
    localStaleTemplates,
    URL,
    readFileSync: () => {
      throw failure;
    },
    writeFileSync: vi.fn(),
    expect,
  };
  expect(() =>
    runInNewContext(
      fixtureSource.replaceAll('import.meta.url', "'file:///synthetic/fixture.mjs'") +
        '\nfixture();',
      context,
    ),
  ).toThrow(failure);
  expect(callbacks).toHaveLength(1);
  callbacks[0]();
  expect(remove).toHaveBeenCalledExactlyOnceWith(
    path.join(tmpdir(), 'flyeye-stale-' + '01'.repeat(16)),
    { recursive: true, force: true },
  );
});

it.each(['content', 'close', 'content-and-close'])(
  'retains failure attribution and cleanup precedence: %s',
  (failure) => {
    const lines = [],
      observer = localStaleResourceDiagnostics({
        enabled: true,
        write: (line) => lines.push(line),
      });
    const f = fixture(observer.mark);
    if (failure !== 'close')
      vi.mocked(readFileSync).mockImplementation(() => {
        throw Error('synthetic-private-read');
      });
    if (failure !== 'content')
      vi.mocked(closeSync).mockImplementation(() => {
        throw Error('synthetic-private-close');
      });
    expect(f.run).toThrow(/^Disposable template mounts rejected\.$/);
    observer.fail();
    expect(closeSync).toHaveBeenCalledExactlyOnceWith(99);
    expect(lines).toEqual([
      'FEAT-003 runtime diagnostic: stage=local-resource-template-' +
        (failure === 'content' ? 'content' : 'file-close') +
        ' event=failed detail=unclassified.',
    ]);
    expect(lines.join()).not.toContain('synthetic-private');
  },
);
