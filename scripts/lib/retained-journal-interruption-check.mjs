// Local-only proof. A guarded disposable database driver supplies query(). Never reclaim an operator lock.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { reconcileRetainedMembership } from './retained-membership.mjs';
import { seedDisposableRetainedAccounts } from './retained-membership-disposable-check.mjs';

const dirname = '.flyeye-staging-retained-accounts';
function identity(file, directory) {
  const s = fs.lstatSync(file, { bigint: true });
  assert.equal(directory ? s.isDirectory() : s.isFile(), true);
  assert.equal(s.uid, BigInt(process.geteuid()));
  assert.equal(s.mode & 0o7777n, directory ? 0o700n : 0o600n);
  assert.notEqual(s.ino, 0n);
  if (!directory) assert.equal(s.nlink, 1n);
  return [s.dev, s.ino];
}

if (process.argv[2] === '--retained-journal-test-child' && process.send) {
  const [{ home, input, selection, bound, slot }] = await once(process, 'message');
  // Substitute only the account home lookup in this disposable child. All lock, filesystem,
  // serialization, fsync, rename, inventory read and recovery paths remain the production ones.
  assert.equal(path.dirname(home), os.tmpdir());
  assert.match(path.basename(home), /^flyeye-journal-proof-[A-Za-z0-9]+$/);
  identity(home, true);
  const account = os.userInfo();
  mock.method(os, 'userInfo', () => ({ ...account, homedir: home }));
  const result = await reconcileRetainedMembership(
    {
      input,
      selection,
      witness: () => bound,
      query: async (sql) => {
        const response = once(process, 'message');
        process.send({ sql });
        return (await response)[0];
      },
    },
    slot,
  );
  process.send({ result }, () => process.disconnect());
}

async function worker(payload, handle) {
  const child = fork(fileURLToPath(import.meta.url), ['--retained-journal-test-child'], {
    execArgv: [],
    env: {},
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const exited = once(child, 'exit');
  let result;
  let signalSent = false;
  let failure;
  const timeout = setTimeout(() => {
    failure = new Error('Journal proof worker timed out');
    child.kill('SIGKILL');
  }, 30000);
  child.on('message', async (message) => {
    try {
      if ('result' in message) {
        result = message.result;
        return;
      }
      assert.equal(typeof message.sql, 'string');
      const reply = await handle(message.sql);
      if (reply === null) {
        signalSent = child.kill('SIGKILL');
        assert(signalSent);
      } else child.send(reply);
    } catch (error) {
      failure = error;
      child.kill('SIGKILL');
    }
  });
  try {
    child.send(payload);
    const [code, signal] = await exited;
    if (failure) throw failure;
    if (signalSent) {
      assert.equal(signal, 'SIGKILL');
      assert.equal(result, undefined);
    } else {
      assert.equal(code, 0);
      assert(result);
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkRetainedJournalInterruption(query, verifiedSystemId) {
  assert.equal(process.platform, 'linux');
  const { initial, bound, input, selection } = await seedDisposableRetainedAccounts(
    query,
    verifiedSystemId,
  );
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flyeye-journal-proof-'));
  const homeId = identity(home, true);
  const directory = path.join(home, dirname);
  fs.mkdirSync(directory, { mode: 0o700 });
  const dirId = identity(directory, true);
  const file = path.join(directory, 'journal.json'),
    lock = path.join(directory, 'inventory.lock');
  fs.writeFileSync(file, JSON.stringify(initial) + '\n', { flag: 'wx', mode: 0o600 });
  const read = () => {
    identity(file, false);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const snapshot = () => query('select count(*) from staging_private.retained_membership_receipts');
  const readOnly = (sql) => {
    assert(sql.startsWith('begin isolation level repeatable read read only;'));
    return query(sql);
  };
  for (const [slot, committed] of [
    ['student_pilot', true],
    ['instructor_pilot', false],
  ]) {
    const payload = { home, bound, input, selection, slot };
    let lockId,
      intent,
      writeRequests = 0;
    await worker(payload, async (sql) => {
      if (!sql.includes('do $establish$')) return readOnly(sql);
      assert.equal(++writeRequests, 1);
      lockId = identity(lock, true);
      intent = read().pendingMembership;
      assert.equal(intent.slot, slot);
      if (committed) await query(sql); // Lose the reply after the database committed the write.
      return null; // Otherwise stop before the database receives the write.
    });
    assert.equal(writeRequests, 1);
    assert.deepEqual(read().pendingMembership, intent);
    assert.equal(await snapshot(), '1');
    const row = await query(
      "select count(*) from staging_private.retained_membership_receipts where operation_id='" +
        intent.operationId +
        "' and attempt_id='" +
        intent.attemptId +
        "' and membership_id='" +
        intent.membershipId +
        "'",
    );
    assert.equal(row, committed ? '1' : '0');
    assert.deepEqual(
      await worker(payload, () => assert.fail('abandoned lock allowed database access')),
      { decision: 'stop', reason: 'inventory-locked' },
    );
    // Test operator only: both exclusive children exited; the original private, empty lock
    // is still the exact inode acquired by the interrupted worker. No stale-lock recovery API.
    assert.deepEqual(identity(home, true), homeId);
    assert.deepEqual(identity(directory, true), dirId);
    assert.deepEqual(identity(lock, true), lockId);
    assert.deepEqual(fs.readdirSync(lock), []);
    fs.rmdirSync(lock);
    const result = await worker(payload, readOnly);
    const saved = read();
    if (committed) {
      const subject = saved.ledger.slots.find((s) => s.role === slot);
      assert.equal(result.decision, 'plan');
      assert.equal(saved.pendingMembership, null);
      assert.equal(subject.membershipId, intent.membershipId);
      assert.equal(subject.databaseAttempt, 'committed');
    } else {
      assert.deepEqual(result, { decision: 'stop', reason: 'database-uncertain', role: slot });
      assert.deepEqual(saved.pendingMembership, intent);
    }
    assert.equal(await snapshot(), '1');
  }
  assert.deepEqual(identity(home, true), homeId);
  assert.deepEqual(identity(directory, true), dirId);
  assert.deepEqual(fs.readdirSync(home), [dirname]);
  assert.deepEqual(fs.readdirSync(directory), ['journal.json']);
  identity(file, false);
  fs.unlinkSync(file);
  fs.rmdirSync(directory);
  fs.rmdirSync(home);
  assert.equal(fs.existsSync(home), false);
}
