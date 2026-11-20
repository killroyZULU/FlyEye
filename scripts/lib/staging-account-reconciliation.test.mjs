// @vitest-environment node
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { feat003StagingTarget } from '../../config/feat-003-staging-target.mjs';
import { reconcileStagingAccounts } from './staging-account-reconciliation.mjs';
import { reconcileLocalAuthReadback } from './staging-account-local-readback.mjs';
import { confirmLocalJournalledAuth } from './staging-account-journal.mjs';

import { completed, fixture, grant, id, own, roles } from './staging-account-test-data.mjs';

const step = (data, i) => data.run().slots?.[roles[i]];
const stopped = (data, reason) => expect(data.run()).toMatchObject({ decision: 'stop', reason });

const localProject = 'flyeye-nosend-p3d1';
const localOrigin = 'http://127.0.0.1:58321';
function message(body, statusCode = 200, complete = true) {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode, complete });
}
function pendingLocal(i = 0) {
  const data = fixture();
  data.ledger.projectRef = data.view.projectRef = localProject;
  const { s, v } = own(data, i);
  s.authId = null;
  v.users[0].operationId = null;
  const user = {
    id: s.plannedAuthId,
    email: s.email,
    email_confirmed_at: '2020-01-01T00:00:00Z',
    app_metadata: { flyeye_fixture_create_operation: s.operationId },
    user_metadata: { flyeye_fixture_create_operation: s.operationId },
  };
  const status = {
    API_URL: localOrigin,
    ANON_KEY: 'synthetic-public',
    SERVICE_ROLE_KEY: 'synthetic-private',
  };
  const load = vi.fn(async () => status);
  const reply = vi.fn(async () => message(JSON.stringify(user)));
  const get = vi.spyOn(http, 'get').mockImplementation((_url, _options, onResponse) => {
    const request = new EventEmitter();
    reply().then(onResponse, (error) => request.emit('error', error));
    return request;
  });
  const read = (role = s.role) =>
    reconcileLocalAuthReadback(JSON.stringify(data.ledger), JSON.stringify(data.view), role, load);
  return { ...data, s, v, user, status, load, get, reply, read };
}

describe('local exact-ID readback after a lost creation acknowledgement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(roles)(
    'confirms only the outstanding %s Auth journal step with one exact read',
    async (role) => {
      vi.stubEnv('NODE_USE_ENV_PROXY', '1');
      vi.stubEnv('HTTP_PROXY', 'http://proxy.invalid');
      const d = pendingLocal(roles.indexOf(role));
      d.user.banned_until = '2020-01-01T00:00:00Z';
      expect(await d.read()).toEqual({ decision: 'resume', role, step: 'record-confirmed-auth' });
      expect(d.load).toHaveBeenCalledTimes(1);
      expect(d.get.mock.calls).toEqual([
        [
          localOrigin + '/auth/v1/admin/users/' + d.s.plannedAuthId,
          {
            agent: false,
            signal: expect.any(AbortSignal),
            headers: {
              apikey: d.status.ANON_KEY,
              Authorization: 'Bearer ' + d.status.SERVICE_ROLE_KEY,
            },
          },
          expect.any(Function),
        ],
      ]);
      expect(d.s.authId).toBeNull();
      // The ordinary reconciler still rejects a disposable target.
      stopped(d, 'target-mismatch');
    },
  );

  it.each([
    [
      'hosted target',
      (d) => {
        d.ledger.projectRef = d.view.projectRef = feat003StagingTarget.projectRef;
      },
    ],
    [
      'wrong inventory target',
      (d) => {
        d.view.projectRef = 'other';
      },
    ],
    [
      'absent exclusivity',
      (d) => {
        d.view.exclusiveRun = false;
      },
    ],
    [
      'missing no-send evidence',
      (d) => {
        d.view.noSendVerified = false;
      },
    ],
    [
      'partial inventory',
      (d) => {
        d.view.inventoryComplete = false;
      },
    ],
    [
      'absent candidate',
      (d) => {
        d.v.users = [];
      },
    ],
    [
      'email collision',
      (d) => {
        d.v.users.push({ ...d.v.users[0], id: id(66) });
      },
    ],
    [
      'different inventory marker',
      (d) => {
        d.v.users[0].operationId = id(70);
      },
    ],
    [
      'already acknowledged',
      (d) => {
        d.s.authId = d.s.plannedAuthId;
        d.v.users[0].operationId = d.s.operationId;
      },
    ],
    [
      'unjournalled ID',
      (d) => {
        delete d.s.plannedAuthId;
      },
    ],
    [
      'wrong preallocated ID',
      (d) => {
        d.s.plannedAuthId = id(91);
      },
    ],
    [
      'reused operation ID',
      (d) => {
        d.s.plannedAuthId = d.s.operationId;
      },
    ],
    [
      'another slot claims the same planned ID',
      (d) => {
        d.ledger.slots[1].plannedAuthId = d.s.plannedAuthId;
        d.ledger.slots[1].authIntentRecorded = true;
      },
    ],
    [
      'conflict in another role',
      (d) => {
        d.view.slots[2].operationId = id(91);
      },
    ],
  ])('stops before loading credentials on %s', async (_case, change) => {
    const d = pendingLocal();
    change(d);
    expect(await d.read()).toMatchObject({ decision: 'stop' });
    expect(d.load).not.toHaveBeenCalled();
    expect(d.get).not.toHaveBeenCalled();
  });

  it.each([
    [
      'hosted origin',
      (d) => {
        d.status.API_URL = 'https://synthetic.invalid';
      },
    ],
    [
      'different loopback port',
      (d) => {
        d.status.API_URL = 'http://127.0.0.1:54321';
      },
    ],
    [
      'missing credential',
      (d) => {
        delete d.status.SERVICE_ROLE_KEY;
      },
    ],
    [
      'status read failed',
      (d) => {
        d.load.mockRejectedValue(new Error('private-fixture-detail'));
      },
    ],
  ])('issues zero requests on %s', async (_case, change) => {
    const d = pendingLocal();
    change(d);
    expect(await d.read()).toEqual({ decision: 'stop', reason: 'auth-uncertain' });
    expect(d.get).not.toHaveBeenCalled();
  });

  it.each([
    [
      'wrong ID',
      (d) => {
        d.user.id = id(90);
      },
    ],
    [
      'wrong email',
      (d) => {
        d.user.email = 'other@school.invalid';
      },
    ],
    [
      'wrong trusted marker despite matching editable marker',
      (d) => {
        d.user.app_metadata.flyeye_fixture_create_operation = id(61);
      },
    ],
    [
      'only an editable marker',
      (d) => {
        delete d.user.app_metadata;
      },
    ],
    [
      'unconfirmed',
      (d) => {
        d.user.email_confirmed_at = null;
      },
    ],
    [
      'future confirmation',
      (d) => {
        d.user.email_confirmed_at = '2099-01-01T00:00:00Z';
      },
    ],
    [
      'invalid timestamp',
      (d) => {
        d.user.banned_until = 'invalid';
      },
    ],
    [
      'active ban',
      (d) => {
        d.user.banned_until = '2099-01-01T00:00:00Z';
      },
    ],
    [
      'deleted account',
      (d) => {
        d.user.deleted_at = '2020-01-01T00:00:00Z';
      },
    ],
    [
      'redirect',
      (d) => {
        d.reply.mockResolvedValue(message('', 302));
      },
    ],
    [
      'missing account',
      (d) => {
        d.reply.mockResolvedValue(message('private-fixture-detail', 404));
      },
    ],
    [
      'invalid JSON',
      (d) => {
        d.reply.mockResolvedValue(message('private-fixture-detail'));
      },
    ],
    [
      'oversized body',
      (d) => {
        d.reply.mockResolvedValue(message(' '.repeat(262145) + JSON.stringify(d.user)));
      },
    ],
    [
      'transport error',
      (d) => {
        d.reply.mockRejectedValue(new Error('private-fixture-detail'));
      },
    ],
    [
      'incomplete response',
      (d) => {
        d.reply.mockResolvedValue(message(JSON.stringify(d.user), 200, false));
      },
    ],
  ])('returns a fixed stop after a single request on %s', async (_case, change) => {
    const d = pendingLocal();
    change(d);
    expect(await d.read()).toEqual({ decision: 'stop', reason: 'auth-uncertain' });
    expect(d.get).toHaveBeenCalledTimes(1);
  });
});

describe('local inventory lock and confirmation journal', () => {
  let home;
  function store(i = 0) {
    const d = pendingLocal(i);
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'flyeye-journal-test-'));
    vi.spyOn(os, 'userInfo').mockReturnValue({ homedir: home });
    const directory = path.join(home, '.' + localProject + '-accounts');
    fs.mkdirSync(directory, { mode: 0o700 });
    const name = path.join(directory, 'journal.json');
    const lock = path.join(directory, 'inventory.lock');
    const initial = JSON.stringify(d.ledger);
    fs.writeFileSync(name, initial, { flag: 'wx', mode: 0o600 });
    const inventory = vi.fn(async () => JSON.stringify(d.view));
    const run = () => confirmLocalJournalledAuth(d.s.role, inventory, d.load);
    return { ...d, directory, name, lock, initial, inventory, run };
  }
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (home) fs.rmSync(home, { recursive: true });
    home = undefined;
  });
  it('keeps the same lock domain despite environment home overrides', async () => {
    const d = store();
    const alternate = path.join(home, 'different-home');
    vi.stubEnv('HOME', alternate);
    vi.stubEnv('USERPROFILE', alternate);
    expect((await d.run()).decision).toBe('recorded');
    expect(fs.existsSync(alternate)).toBe(false);
    expect(JSON.parse(fs.readFileSync(d.name, 'utf8')).slots[0].authId).toBe(d.s.plannedAuthId);
  });
  it.each(roles)(
    'persists only the %s confirmation, releases the lock and exposes no credentials',
    async (role) => {
      const d = store(roles.indexOf(role));
      expect(await d.run()).toEqual({ decision: 'recorded', role, step: 'record-confirmed-auth' });
      const expected = JSON.parse(d.initial);
      expected.slots[roles.indexOf(role)].authId = d.s.plannedAuthId;
      expect(JSON.parse(fs.readFileSync(d.name, 'utf8'))).toEqual(expected);
      expect(fs.readdirSync(d.directory)).toEqual(['journal.json']);
      expect(d.get).toHaveBeenCalledTimes(1);
      expect(d.inventory.mock.calls).toEqual([[d.initial]]);
      expect((await d.run()).decision).toBe('stop');
      expect(d.get).toHaveBeenCalledTimes(1);
    },
  );
  it('excludes a competing role during inventory, exact-ID readback and atomic replacement', async () => {
    const d = store();
    const otherInventory = vi.fn(),
      otherLoad = vi.fn(),
      contenders = [];
    const contend = () =>
      contenders.push(confirmLocalJournalledAuth('admin', otherInventory, otherLoad));
    d.inventory.mockImplementationOnce(async () => {
      contend();
      return JSON.stringify(d.view);
    });
    d.reply.mockImplementationOnce(async () => {
      contend();
      return message(JSON.stringify(d.user));
    });
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce((from, to) => {
      contend();
      return rename(from, to);
    });
    expect((await d.run()).decision).toBe('recorded');
    expect(await Promise.all(contenders)).toEqual(
      Array(3).fill({ decision: 'stop', reason: 'inventory-locked' }),
    );
    expect(otherInventory).not.toHaveBeenCalled();
    expect(otherLoad).not.toHaveBeenCalled();
    expect(d.get).toHaveBeenCalledTimes(1);
  });
  it.each(['absent', 'replaced'])(
    'preserves a confirmed Student journal when its disposable Auth identity is %s',
    async (state) => {
      const d = store();
      d.s.authId = d.s.plannedAuthId;
      const confirmed = JSON.stringify(d.ledger);
      fs.writeFileSync(d.name, confirmed);
      if (state === 'absent') d.v.users = [];
      else d.v.users[0] = { ...d.v.users[0], id: id(91), operationId: id(92) };
      expect(await d.run()).toEqual({
        decision: 'stop',
        reason: state === 'absent' ? 'auth-uncertain' : 'ownership-conflict',
        role: 'student_pilot',
      });
      expect(d.inventory).toHaveBeenCalledExactlyOnceWith(confirmed);
      expect(d.load).not.toHaveBeenCalled();
      expect(d.get).not.toHaveBeenCalled();
      expect(fs.readFileSync(d.name, 'utf8')).toBe(confirmed);
      expect(fs.readdirSync(d.directory)).toEqual(['journal.json']);
    },
  );
  it('leaves an abandoned lock untouched before inventory or credentials', async () => {
    const d = store();
    fs.mkdirSync(d.lock);
    fs.writeFileSync(path.join(d.lock, 'owner'), 'preserved');
    expect(await d.run()).toEqual({ decision: 'stop', reason: 'inventory-locked' });
    expect(fs.readFileSync(path.join(d.lock, 'owner'), 'utf8')).toBe('preserved');
    expect(d.inventory).not.toHaveBeenCalled();
    expect(d.load).not.toHaveBeenCalled();
    expect(fs.readFileSync(d.name, 'utf8')).toBe(d.initial);
  });
  it.each(['missing journal', 'invalid journal', 'wrong project', 'linked journal'])(
    'rejects %s before inventory',
    async (kind) => {
      const d = store();
      if (kind === 'missing journal') fs.unlinkSync(d.name);
      if (kind === 'invalid journal') fs.writeFileSync(d.name, '{}');
      if (kind === 'wrong project')
        fs.writeFileSync(
          d.name,
          JSON.stringify({ ...d.ledger, projectRef: feat003StagingTarget.projectRef }),
        );
      if (kind === 'linked journal') fs.linkSync(d.name, path.join(d.directory, 'alias'));
      expect((await d.run()).decision).toBe('stop');
      expect(d.inventory).not.toHaveBeenCalled();
      expect(d.load).not.toHaveBeenCalled();
      expect(fs.existsSync(d.lock)).toBe(false);
    },
  );
  it.each(['inventory error', 'missing completeness', 'readback mismatch'])(
    'preserves the original journal on %s',
    async (kind) => {
      const d = store();
      if (kind === 'inventory error')
        d.inventory.mockRejectedValueOnce(new Error('private-detail'));
      if (kind === 'missing completeness') d.view.inventoryComplete = false;
      if (kind === 'readback mismatch')
        d.user.app_metadata.flyeye_fixture_create_operation = id(97);
      const result = await d.run();
      expect(result.decision).toBe('stop');
      expect(JSON.stringify(result)).not.toContain('private-detail');
      expect(d.get).toHaveBeenCalledTimes(kind === 'readback mismatch' ? 1 : 0);
      expect(fs.readFileSync(d.name, 'utf8')).toBe(d.initial);
      expect(fs.readdirSync(d.directory)).toEqual(['journal.json']);
    },
  );
  it('stops on lock substitution and preserves both lock directories', async () => {
    const d = store();
    d.inventory.mockImplementationOnce(async () => {
      fs.renameSync(d.lock, d.lock + '.old');
      fs.mkdirSync(d.lock);
      return JSON.stringify(d.view);
    });
    expect(await d.run()).toEqual({ decision: 'stop', reason: 'journal-uncertain' });
    expect(d.load).not.toHaveBeenCalled();
    expect(fs.readdirSync(d.directory).sort()).toEqual([
      'inventory.lock',
      'inventory.lock.old',
      'journal.json',
    ]);
  });
  it.each([
    'journal changed',
    'candidate changed',
    'flush failed',
    'rename failed',
    'lost rename acknowledgement',
    'release failed',
  ])('holds the lock on %s and returns no confirmation', async (kind) => {
    const d = store();
    const fail = () => {
      throw new Error('private-detail');
    };
    if (kind === 'journal changed')
      d.reply.mockImplementationOnce(async () => {
        fs.writeFileSync(d.name, 'changed');
        return message(JSON.stringify(d.user));
      });
    if (kind === 'flush failed') vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(fail);
    if (kind === 'candidate changed') {
      const flush = fs.fsyncSync.bind(fs);
      vi.spyOn(fs, 'fsyncSync').mockImplementationOnce((fd) => {
        flush(fd);
        fs.writeFileSync(path.join(d.lock, 'journal.next'), 'changed');
      });
    }
    if (kind === 'rename failed') vi.spyOn(fs, 'renameSync').mockImplementationOnce(fail);
    if (kind === 'lost rename acknowledgement') {
      const rename = fs.renameSync.bind(fs);
      vi.spyOn(fs, 'renameSync').mockImplementationOnce((from, to) => {
        rename(from, to);
        fail();
      });
    }
    if (kind === 'release failed') vi.spyOn(fs, 'rmdirSync').mockImplementationOnce(fail);
    expect(await d.run()).toEqual({ decision: 'stop', reason: 'journal-uncertain' });
    expect(fs.existsSync(d.lock)).toBe(true);
    const text = fs.readFileSync(d.name, 'utf8');
    if (kind === 'journal changed') expect(text).toBe('changed');
    else if (kind === 'lost rename acknowledgement' || kind === 'release failed')
      expect(JSON.parse(text).slots[0].authId).toBe(d.s.plannedAuthId);
    else expect(text).toBe(d.initial);
    expect(d.get).toHaveBeenCalledTimes(1);
  });
});

describe('retained synthetic accounts: offline reconciliation', () => {
  it('plans intent before creation and never repeats creation after an uncertain acknowledgement', () => {
    const data = fixture();
    expect(Object.values(data.run().slots)).toEqual(
      roles.map(() => ({ decision: 'create', step: 'record-intent-before-auth' })),
    );
    data.ledger.slots[0].authIntentRecorded = true;
    data.ledger.slots[0].plannedAuthId = id(20);
    stopped(data, 'auth-uncertain');
    const { s } = own(data, 0);
    s.authId = null;
    expect(step(data, 0)).toEqual({ decision: 'resume', step: 'record-confirmed-auth' });
  });
  it.each(roles)('resumes only the next role-specific operation for an owned %s', (role) => {
    const data = fixture(),
      i = roles.indexOf(role);
    own(data, i);
    expect(step(data, i).step).toBe(
      role === 'admin' ? 'issue-pending-grant' : 'establish-audited-student-membership',
    );
  });
  it('requires confirmed rollback before another membership operation', () => {
    const data = fixture(),
      { s, v } = own(data, 1);
    s.databaseAttempt = 'unacknowledged';
    s.databaseAttemptId = id(71);
    stopped(data, 'database-uncertain');
    s.databaseAttempt = 'rolled-back';
    stopped(data, 'database-conflict');
    v.confirmedRollback = { operationId: s.operationId, attemptId: id(70) };
    stopped(data, 'database-conflict');
    v.confirmedRollback.attemptId = s.databaseAttemptId;
    expect(step(data, 1).step).toBe('establish-audited-student-membership');
  });
  it('reconciles a committed membership after its acknowledgement was lost', () => {
    const data = completed(),
      s = data.ledger.slots[0];
    Object.assign(s, {
      complete: false,
      membershipId: null,
      profileId: null,
      databaseAttempt: 'unacknowledged',
    });
    expect(step(data, 0).step).toBe('record-confirmed-membership');
    data.view.slots[0].memberships[0].auditedOperationId = null;
    stopped(data, 'membership-conflict');
  });
  it('resumes an owned live grant but stops on expiry or ambiguous issuance', () => {
    const data = fixture(),
      { s, v } = own(data, 2);
    s.databaseAttempt = 'unacknowledged';
    s.databaseAttemptId = id(72);
    stopped(data, 'database-uncertain');
    v.grant = grant(s, 'live');
    stopped(data, 'database-conflict');
    v.grant.issuanceAttemptId = s.databaseAttemptId;
    expect(step(data, 2).step).toBe('record-confirmed-grant');
    s.databaseAttempt = 'committed';
    expect(step(data, 2).step).toBe('protected-admin-onboarding');
    v.grant.status = 'expired';
    stopped(data, 'grant-conflict');
  });
  it('resumes protected Instructor MFA only while the retained operation is consistent', () => {
    const data = completed(),
      s = data.ledger.slots[1],
      v = data.view.slots[1];
    s.complete = false;
    s.factorId = null;
    v.factor = null;
    delete s.assignmentKeyHash;
    delete v.assignments;
    v.memberships[0].role = 'student_pilot';
    expect(step(data, 1).step).toBe('protected-mfa-enrollment');
    v.factor = {
      id: id(77),
      authId: s.authId,
      slotOperationId: s.operationId,
      state: 'protected-resumable',
    };
    expect(step(data, 1).step).toBe('protected-mfa-enrollment');
    v.factor.state = 'verified-bound';
    stopped(data, 'staging-assignment-unavailable');
    s.assignmentKeyHash = '7'.repeat(64);
    stopped(data, 'assignment-uncertain');
    delete s.assignmentKeyHash;
    v.factor.state = 'conflict';
    stopped(data, 'factor-conflict');
  });
  it('rejects email-only adoption and ambiguous provider matches', () => {
    const data = fixture(),
      { s, v } = own(data, 0);
    s.authId = null;
    v.users[0].operationId = null;
    stopped(data, 'ownership-conflict');
    v.users[0].operationId = s.operationId;
    v.users.push({ ...v.users[0], id: id(85) });
    stopped(data, 'ownership-conflict');
  });
  it.each([
    ['target-mismatch', (d) => (d.view.projectRef = 'other')],
    ['school-conflict', (d) => (d.view.schools = [])],
    ['school-conflict', (d) => d.view.schools.push({ id: id(98), active: true })],
    ['preconditions-unverified', (d) => (d.view.inventoryComplete = false)],
    ['preconditions-unverified', (d) => (d.view.noSendVerified = false)],
    ['preconditions-unverified', (d) => (d.view.exclusiveRun = false)],
    ['slot-conflict', (d) => (d.ledger.slots[0].email = d.ledger.slots[2].email)],
    [
      'invalid-evidence',
      (d) => {
        const canonical = 'aaaa0000-0000-4000-8000-000000000001';
        d.ledger.slots[0].authId = canonical;
        d.ledger.slots[1].authId = canonical.toUpperCase();
      },
    ],
    ['slot-conflict', (d) => (d.view.slots[1].users[0].id = d.view.slots[0].users[0].id)],
    ['grant-conflict', (d) => (d.view.otherAdminOrLiveGrant = true)],
    [
      'slot-conflict',
      (d) => {
        d.ledger.slots[1].email = 'other@school.invalid';
        d.view.slots[1].users[0].email = 'other@school.invalid';
      },
    ],
    ['assignment-conflict', (d) => delete d.view.slots[1].assignments],
    [
      'assignment-conflict',
      (d) => (d.view.slots[1].assignments[0].actorId = d.ledger.slots[1].authId),
    ],
    ['assignment-conflict', (d) => (d.view.slots[1].assignments[0].schoolId = id(88))],
    ['assignment-conflict', (d) => (d.view.slots[1].assignments[0].keyHash = '8'.repeat(64))],
    ['assignment-conflict', (d) => (d.view.slots[1].factor = null)],
    ['grant-conflict', (d) => (d.view.slots[2].grant.auditedOperationId = null)],
    ['grant-conflict', (d) => (d.view.slots[2].grant = null)],
    ['ownership-conflict', (d) => (d.view.slots[0].users[0].eligible = false)],
    ['membership-conflict', (d) => (d.view.slots[0].memberships[0].schoolId = id(98))],
    ['membership-conflict', (d) => (d.view.slots[0].memberships[0].role = 'admin')],
    ['membership-conflict', (d) => (d.view.slots[1].memberships[0].profileId = null)],
    ['membership-conflict', (d) => (d.view.slots[0].memberships[0].databaseAttemptId = id(92))],
    ['factor-conflict', (d) => (d.view.slots[2].factor.id = id(98))],
    ['invalid-evidence', (d) => (d.view.slots[1].untrusted = 'private-test-marker')],
  ])('returns a fixed batch stop on %s', (reason, change) => {
    const data = completed();
    change(data);
    stopped(data, reason);
    expect(data.run()).not.toHaveProperty('slots');
    expect(JSON.stringify(data.run())).not.toContain('private-test-marker');
  });
  it('returns zero write steps on both passes with three retained, fully evidenced identities', () => {
    const data = completed();
    data.view.slots.reverse();
    const expected = Object.fromEntries(
      roles.map((role) => [role, { decision: 'already-complete' }]),
    );
    expect(data.run()).toEqual({ decision: 'plan', slots: expected });
    expect(data.run()).toEqual({ decision: 'plan', slots: expected });
  });
  it('rejects malformed or oversized input without disclosing it', () => {
    for (const text of ['private-test-marker', 'x'.repeat(65537), null])
      expect(reconcileStagingAccounts(text, '{}')).toEqual({
        decision: 'stop',
        reason: 'invalid-evidence',
      });
  });
});
