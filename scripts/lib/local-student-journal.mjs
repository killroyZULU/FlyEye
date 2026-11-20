import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const rejected = () => new Error('Local Student journal rejected.');
const heldJournals = new WeakSet();
export const isHeldLocalFixtureJournal = (journal) => heldJournals.has(journal);
export const studentUuid = (value) =>
  typeof value === 'string' &&
  value.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

const stat = (name) => fs.lstatSync(name, { bigint: true });
const same = (a, b) => a.ino !== 0n && a.ino === b.ino && a.dev === b.dev;
function privateEntry(entry, mode) {
  if (
    entry.uid !== BigInt(process.geteuid()) ||
    (entry.mode & 0o7777n) !== mode ||
    !(mode === 0o700n ? entry.isDirectory() : entry.isFile() && entry.nlink === 1n)
  )
    throw rejected();
}
function syncDirectory(directory) {
  const fd = fs.openSync(
    directory,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

// Immutable records: an interrupted exclusive append can never look like permission
// to repeat an operation. A malformed or partial record requires owner inspection.
export async function withStudentJournal(existingRun, operation) {
  if (
    process.platform !== 'linux' ||
    process.geteuid() !== 1000 ||
    (existingRun !== null && !studentUuid(existingRun))
  )
    throw rejected();
  const home = fs.realpathSync(os.userInfo().homedir);
  const base = path.join(home, '.flyeye-nosend-p3d1-accounts');
  const rootIdentity = stat(base);
  privateEntry(rootIdentity, 0o700n);
  const lock = path.join(base, 'inventory.lock');
  fs.mkdirSync(lock, { mode: 0o700 });
  const lockIdentity = stat(lock);
  privateEntry(lockIdentity, 0o700n);
  const checkLock = () => {
    const root = stat(base),
      current = stat(lock);
    privateEntry(root, 0o700n);
    privateEntry(current, 0o700n);
    if (!same(root, rootIdentity) || !same(current, lockIdentity)) throw rejected();
  };
  let safeToUnlock = true;
  try {
    checkLock();
    const runs = path.join(base, 'runs');
    if (existingRun === null && !fs.existsSync(runs)) {
      fs.mkdirSync(runs, { mode: 0o700 });
      syncDirectory(base);
    }
    const runsIdentity = stat(runs);
    privateEntry(runsIdentity, 0o700n);
    const runId = existingRun ?? randomUUID();
    const dir = path.join(runs, runId);
    if (existingRun === null) {
      fs.mkdirSync(dir, { mode: 0o700 });
      syncDirectory(runs);
    }
    const runIdentity = stat(dir);
    privateEntry(runIdentity, 0o700n);
    const check = () => {
      checkLock();
      for (const [name, original] of [
        [runs, runsIdentity],
        [dir, runIdentity],
      ]) {
        const current = stat(name);
        privateEntry(current, 0o700n);
        if (!same(current, original)) throw rejected();
      }
    };
    const file = (kind) => {
      check();
      if (
        !['intent', 'attempt', 'confirmed'].includes(kind) &&
        !(
          typeof kind === 'string' && /^instructor-(?:intent|(?:pending|receipt)-[0-6])$/.test(kind)
        )
      )
        throw rejected();
      return path.join(dir, kind + '.json');
    };
    function read(kind) {
      const name = file(kind);
      let entry;
      try {
        entry = stat(name);
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw rejected();
      }
      privateEntry(entry, 0o600n);
      if (entry.size < 2n || entry.size > 4096n) throw rejected();
      const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        if (!same(entry, fs.fstatSync(fd, { bigint: true }))) throw rejected();
        const bytes = Buffer.alloc(Number(entry.size) + 1);
        if (fs.readSync(fd, bytes, 0, bytes.length, 0) !== Number(entry.size)) throw rejected();
        return JSON.parse(bytes.subarray(0, Number(entry.size)).toString('utf8'));
      } finally {
        fs.closeSync(fd);
      }
    }
    function record(kind, data) {
      const name = file(kind);
      safeToUnlock = false;
      const fd = fs.openSync(name, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(data) + '\n');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      syncDirectory(dir);
      if (JSON.stringify(read(kind)) !== JSON.stringify(data)) throw rejected();
      safeToUnlock = true;
    }
    function bindInstance(instance, fresh) {
      check();
      if (typeof instance !== 'string' || instance.length !== 64 || !/^[a-f0-9]+$/.test(instance))
        throw rejected();
      const name = path.join(runs, 'instance-' + instance);
      if (fresh) {
        const fd = fs.openSync(name, 'wx', 0o600);
        safeToUnlock = false;
        try {
          fs.writeFileSync(fd, runId);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        syncDirectory(runs);
      }
      const entry = stat(name);
      privateEntry(entry, 0o600n);
      if (entry.size !== 36n) throw rejected();
      const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        if (
          !same(entry, fs.fstatSync(fd, { bigint: true })) ||
          fs.readFileSync(fd, 'utf8') !== runId
        )
          throw rejected();
      } finally {
        fs.closeSync(fd);
      }
      if (fresh) safeToUnlock = true;
    }
    const journal = Object.freeze({
      runId,
      record,
      read,
      check() {
        if (!safeToUnlock) throw rejected();
        check();
      },
      bindInstance,
      retainLock() {
        safeToUnlock = false;
      },
    });
    heldJournals.add(journal);
    try {
      return await operation(journal);
    } finally {
      heldJournals.delete(journal);
    }
  } catch {
    if (!safeToUnlock)
      throw new Error('Local Student state uncertain; preserve lock and inspect owned resources.');
    throw rejected();
  } finally {
    if (safeToUnlock) {
      checkLock();
      fs.rmdirSync(lock);
    }
  }
}
