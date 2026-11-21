import { createHash } from 'node:crypto';
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

// Reviewed content, not hashes derived from an inspected container or mutable receipt.
export const localStaleTemplates = Object.freeze(
  [
    {
      file: 'recovery.html',
      sha256: '70a33fa18a66ab1c632245d774d51687c179e1e93ca7c2eab32ca37ef62538d8',
    },
    {
      file: 'invite.html',
      sha256: 'c645259daabf0e427129000e50c903fb800dcc53c0deb67e3d5d781eda076c73',
    },
    {
      file: 'magic_link.html',
      sha256: '16297890f9956ada13b9ddc3043eb08ab33db724d65f25de5e9f3480712572d8',
    },
    {
      file: 'password_changed_notification.html',
      sha256: '1e2e8e17b21ff813c5686b6450f83812903c8369755fd958d9b32bcabc9c76f1',
    },
  ].map(Object.freeze),
);
const check = (value) => {
  if (!value) throw new Error('Disposable template mounts rejected.');
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function checkOwner(stat, directory, mark, scope) {
  if (typeof process.getuid === 'function') {
    mark(`local-resource-template-${scope}-uid`);
    check(stat.uid === process.getuid());
    mark(`local-resource-template-${scope}-write-mode`);
    check((stat.mode & 0o022) === 0);
    if (directory) {
      mark('local-resource-template-root-private-mode');
      check((stat.mode & 0o077) === 0);
    }
  }
}

function closeObserved(fd, mark) {
  try {
    closeSync(fd);
  } catch (error) {
    mark('local-resource-template-file-close');
    throw error;
  }
}

function canonicalInventorySource(source) {
  if (
    typeof source !== 'string' ||
    [...source].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return false;
  // Validate metadata syntax, never translate or normalize a source before comparison.
  if (source.startsWith('/') && !source.startsWith('//') && !source.includes('\\'))
    return path.posix.isAbsolute(source) && path.posix.normalize(source) === source;
  if (!/^[A-Za-z]:\\/.test(source) || source.includes('/')) return false;
  const segments = source.slice(3).split('\\');
  return (
    path.win32.isAbsolute(source) &&
    path.win32.normalize(source) === source &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        !/[ .]$/.test(segment) &&
        !/[<>:"|?*]/.test(segment) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
    )
  );
}

function verifyAttachments(kong, command, mark) {
  mark('local-resource-template-attachments-read');
  const inventory = () => {
    const ids = command(['ps', '-a', '--format', '{{.ID}}', '--no-trunc']).split(/\r?\n/);
    check(ids.length > 0 && ids.length <= 100);
    check(ids.every((id) => /^[a-f0-9]{64}$/.test(id)) && new Set(ids).size === ids.length);
    return ids.sort();
  };
  const ids = inventory();
  check(ids.includes(kong.Id));
  // Project only attachment metadata; never request container environment or logs.
  const text = command([
    'inspect',
    '--type',
    'container',
    '--format',
    '{"Id":{{json .Id}},"Mounts":{{json .Mounts}}}',
    ...ids,
  ]);
  const containers = text.split(/\r?\n/).map((line) => JSON.parse(line));
  check(containers.length === ids.length);
  const seen = new Set();
  for (const container of containers) {
    check(container && ids.includes(container.Id) && !seen.has(container.Id));
    seen.add(container.Id);
    check(Array.isArray(container.Mounts) && container.Mounts.length <= 100);
    for (const mount of container.Mounts) {
      check(mount && ['bind', 'volume', 'tmpfs'].includes(mount.Type));
      if (mount.Type === 'bind') {
        check(canonicalInventorySource(mount.Source));
        check(typeof mount.Destination === 'string' && mount.Destination.startsWith('/'));
      }
    }
  }
  check(JSON.stringify(inventory()) === JSON.stringify(ids));
  mark('local-resource-template-attachments-exclusive');
  const inspectedKong = containers.find((container) => container.Id === kong.Id);
  const mapping = (mounts) =>
    mounts
      .map(({ Type, Source, Destination, RW, Mode, Propagation }) =>
        JSON.stringify({ Type, Source, Destination, RW, Mode, Propagation }),
      )
      .sort();
  check(JSON.stringify(mapping(inspectedKong.Mounts)) === JSON.stringify(mapping(kong.Mounts)));
  for (const expected of kong.Mounts) {
    const users = containers.flatMap((container) =>
      container.Mounts.filter((mount) => mount.Source === expected.Source).map(() => container.Id),
    );
    check(users.length === 1 && users[0] === kong.Id);
  }
}

export function verifyLocalStaleTemplateMounts(root, kong, command, mark = () => {}) {
  try {
    mark('local-resource-template-root-path');
    check(realpathSync(root) === root && path.dirname(root) === realpathSync(tmpdir()));
    check(/^flyeye-stale-[a-f0-9]{32}$/.test(path.basename(root)));
    mark('local-resource-template-root-metadata');
    const rootStat = lstatSync(root);
    check(rootStat.isDirectory() && !rootStat.isSymbolicLink());
    checkOwner(rootStat, true, mark, 'root');
    for (const relative of ['supabase', 'supabase/templates']) {
      mark('local-resource-template-parent-path');
      const directory = path.join(root, relative),
        stat = lstatSync(directory);
      check(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(directory) === directory);
      checkOwner(stat, false, mark, 'parent');
    }
    // No aliases, Docker path remapping, extra mounts or destination shadowing.
    // Unknown inspection forms stay rejected rather than broadening the exception.
    mark('local-resource-template-mount-count');
    check(kong.Mounts.length === localStaleTemplates.length);
    const seen = new Set();
    for (const mount of kong.Mounts) {
      mark('local-resource-template-destination');
      const pin = localStaleTemplates.find(
        (item) => mount.Destination === '/home/kong/templates/email/' + item.file,
      );
      check(pin && !seen.has(pin.file));
      seen.add(pin.file);
      mark('local-resource-template-source');
      const source = path.join(root, 'supabase/templates', pin.file);
      check(mount.Type === 'bind' && mount.Source === source && realpathSync(source) === source);
      mark('local-resource-template-mode');
      check(typeof mount.RW === 'boolean' && mount.Mode === (mount.RW ? 'rw' : 'ro'));
      mark('local-resource-template-propagation');
      check(mount.Propagation === 'rprivate');
      mark('local-resource-template-file-metadata');
      const before = lstatSync(source);
      check(
        before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= 65536,
      );
      checkOwner(before, false, mark, 'file');
      mark('local-resource-template-file-open');
      const fd = openSync(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        mark('local-resource-template-opened-metadata');
        const opened = fstatSync(fd);
        check(
          opened.isFile() &&
            opened.nlink === 1 &&
            opened.dev === before.dev &&
            opened.ino === before.ino &&
            opened.size === before.size,
        );
        mark('local-resource-template-content');
        check(hash(readFileSync(fd)) === pin.sha256);
        mark('local-resource-template-final-metadata');
        const after = lstatSync(source);
        check(
          !after.isSymbolicLink() &&
            after.dev === opened.dev &&
            after.ino === opened.ino &&
            after.nlink === 1,
        );
      } finally {
        closeObserved(fd, mark);
      }
    }
    verifyAttachments(kong, command, mark);
  } catch {
    // Never expose a path, file content, inspection payload or nested error.
    throw new Error('Disposable template mounts rejected.');
  }
}
