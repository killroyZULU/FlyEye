import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ledgerSchema, roles } from './staging-account-evidence.mjs';
import { reconcileLocalAuthReadback } from './staging-account-local-readback.mjs';
import { localAccountProject } from './staging-account-reconciliation.mjs';

const stop = (reason) => ({ decision: 'stop', reason });
const requireState = (ok) => {
  if (!ok) throw new Error('Uncertain local journal state');
};
const stat = (name) => fs.lstatSync(name, { bigint: true });
function sameFile(left, right) {
  return left.ino !== 0n && left.dev === right.dev && left.ino === right.ino;
}
function privateEntry(info) {
  // Windows inherits the operator's protected directory ACL; POSIX also
  // permits checking the effective owner and group/other bits directly.
  return (
    process.platform === 'win32' ||
    (info.uid === BigInt(process.geteuid()) && (info.mode & 0o077n) === 0n)
  );
}
function readJournal(name) {
  const before = stat(name);
  requireState(
    before.isFile() && privateEntry(before) && before.nlink === 1n && before.size <= 65536n,
  );
  const fd = fs.openSync(name, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    requireState(sameFile(before, fs.fstatSync(fd, { bigint: true })));
    const bytes = Buffer.alloc(65537);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    requireState(BigInt(count) === before.size);
    return {
      info: before,
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(0, count),
      ),
    };
  } finally {
    fs.closeSync(fd);
  }
}

// All cooperating lifecycle writers for this disposable target must use this
// single operator-private directory. Never create it, seed a missing journal,
// or reclaim a stale lock here. Inventory and status are owned fixture readers.
async function withInventoryLock(
  operation,
  directoryName = '.' + localAccountProject + '-accounts',
) {
  try {
    const directory = path.join(fs.realpathSync(os.userInfo().homedir), directoryName);
    const directoryIdentity = stat(directory);
    requireState(directoryIdentity.isDirectory() && privateEntry(directoryIdentity));
    const lock = path.join(directory, 'inventory.lock');
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
    } catch (error) {
      return stop(error.code === 'EEXIST' ? 'inventory-locked' : 'journal-uncertain');
    }
    const lockIdentity = stat(lock);
    requireState(lockIdentity.isDirectory() && privateEntry(lockIdentity));
    const ownership = {
      preserve: false,
      check() {
        requireState(
          sameFile(directoryIdentity, stat(directory)) && sameFile(lockIdentity, stat(lock)),
        );
      },
    };
    let result;
    try {
      result = await operation(directory, lock, ownership);
    } finally {
      if (!ownership.preserve) {
        ownership.check();
        fs.rmdirSync(lock);
      }
    }
    return result;
  } catch {
    return stop('journal-uncertain');
  }
}

function saveLockedJournal(name, lock, ownership, initial, text) {
  requireState(Buffer.byteLength(text) <= 65536);
  const candidate = path.join(lock, 'journal.next');
  // Once persistence begins, retain the lock on any uncertainty. A crash or
  // ambiguous rename must be inspected before another operation can proceed.
  ownership.preserve = true;
  const fd = fs.openSync(candidate, 'wx', 0o600);
  let candidateInfo;
  try {
    candidateInfo = fs.fstatSync(fd, { bigint: true });
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  ownership.check();
  const staged = readJournal(candidate);
  requireState(sameFile(candidateInfo, staged.info) && staged.text === text);
  const current = readJournal(name);
  requireState(sameFile(initial.info, current.info) && initial.text === current.text);
  fs.renameSync(candidate, name);
  if (process.platform !== 'win32') {
    const dirFd = fs.openSync(path.dirname(name), 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  }
  const saved = readJournal(name);
  requireState(sameFile(candidateInfo, saved.info) && saved.text === text);
  ownership.preserve = false;
  return saved;
}

export const withRetainedAccountJournal = (work) =>
  process.platform !== 'linux'
    ? stop('journal-uncertain')
    : withInventoryLock(async (directory, lock, ownership) => {
        requireState(process.platform === 'linux' && (stat(directory).mode & 0o7777n) === 0o700n);
        const name = path.join(directory, 'journal.json');
        let current = readJournal(name);
        requireState((current.info.mode & 0o7777n) === 0o600n);
        return work({
          check: ownership.check,
          read() {
            ownership.check();
            const latest = readJournal(name);
            requireState(sameFile(latest.info, current.info) && latest.text === current.text);
            return JSON.parse(latest.text);
          },
          save(record) {
            ownership.check();
            current = saveLockedJournal(
              name,
              lock,
              ownership,
              current,
              JSON.stringify(record) + '\n',
            );
          },
        });
      }, '.flyeye-staging-retained-accounts');

export async function confirmLocalJournalledAuth(role, readInventory, loadStatus) {
  if (!roles.includes(role)) return stop('invalid-evidence');
  return withInventoryLock(async (directory, lock, ownership) => {
    const name = path.join(directory, 'journal.json');
    const initial = readJournal(name);
    const ledger = ledgerSchema.parse(JSON.parse(initial.text));
    if (ledger.projectRef !== localAccountProject) return stop('target-mismatch');

    const observation = await readInventory(initial.text);
    ownership.check();
    const decision = await reconcileLocalAuthReadback(initial.text, observation, role, async () => {
      const status = await loadStatus();
      ownership.check();
      return status;
    });
    if (decision.decision === 'stop') return decision;
    requireState(
      decision.decision === 'resume' &&
        decision.role === role &&
        decision.step === 'record-confirmed-auth',
    );

    ownership.check();
    const slot = ledger.slots.find((entry) => entry.role === role);
    slot.authId = slot.plannedAuthId;
    const text = JSON.stringify(ledger) + '\n';
    saveLockedJournal(name, lock, ownership, initial, text);
    return { decision: 'recorded', role, step: 'record-confirmed-auth' };
  });
}
