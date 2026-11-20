// @vitest-environment node
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localStudentOperations } from './local-student-fixture.mjs';
import { isOwnedLocalStudentTarget } from './no-send-local-project.mjs';
vi.mock('./no-send-local-project.mjs', () => ({ isOwnedLocalStudentTarget: vi.fn() }));

describe('fresh local Student transaction and journal', () => {
  let home, base, platform, uid, auth, commands, instance, fail, profile, student;
  const prior = 'preserved historical journal\n';
  const intentPath = (runId, kind) => path.join(base, 'runs', runId, kind + '.json');
  const writes = () => commands.filter((source) => source.includes('do $student$'));
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'flyeye-student-journal-test-'));
    vi.spyOn(os, 'userInfo').mockReturnValue({ homedir: home });
    base = path.join(home, '.flyeye-nosend-p3d1-accounts');
    fs.mkdirSync(base, { mode: 0o700 });
    fs.writeFileSync(path.join(base, 'journal.json'), prior);
    platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    // Exercise actual exclusive opens, links, journal bytes and lock directories.
    // Model the approved UID; Windows also needs synthetic mode and directory sync.
    vi.stubEnv('HOME', 'ignored');
    const lstat = fs.lstatSync.bind(fs);
    vi.spyOn(fs, 'lstatSync').mockImplementation((name, opts) => {
      const info = lstat(name, opts);
      if (opts?.bigint) {
        info.uid = 1000n;
        if (platform.value === 'win32')
          info.mode = (info.mode & ~0o7777n) | (info.isDirectory() ? 0o700n : 0o600n);
      }
      return info;
    });
    if (platform.value === 'win32') {
      const open = fs.openSync.bind(fs),
        sync = fs.fsyncSync.bind(fs),
        close = fs.closeSync.bind(fs);
      vi.spyOn(fs, 'openSync').mockImplementation((name, flags, ...rest) =>
        typeof flags === 'number' && lstat(name).isDirectory() ? -88 : open(name, flags, ...rest),
      );
      vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => (fd === -88 ? undefined : sync(fd)));
      vi.spyOn(fs, 'closeSync').mockImplementation((fd) => (fd === -88 ? undefined : close(fd)));
    }
    uid = Object.getOwnPropertyDescriptor(process, 'geteuid');
    Object.defineProperty(process, 'geteuid', { configurable: true, value: () => 1000 });
    commands = [];
    instance = 'a'.repeat(64);
    profile = randomUUID();
    fail = '';
    auth = vi.fn();
    isOwnedLocalStudentTarget.mockReturnValue(true);
    student = localStudentOperations({
      witness: () => ({ instance, systemId: '1234567890' }),
      sql(source) {
        commands.push(source);
        if (source.includes('do $student$')) {
          if (fail === 'unknown-commit') throw new Error('private-provider-detail');
          return '';
        }
        if (source.includes('select p.id')) {
          if (fail === 'extra-auth' || fail === 'extra-membership') {
            const table = fail === 'extra-auth' ? 'auth.users' : 'public.organization_memberships';
            expect(source).toContain('(select count(*) from ' + table + ') = 1');
            return '';
          }
          return fail === 'receipt' ? '' : profile;
        }
        if (source.includes('from auth.users;')) return fail === 'auth' ? 'f' : 't';
        return fail === 'inventory' ? 'f' : 't';
      },
    });
  });
  afterEach(() => {
    expect(fs.readFileSync(path.join(base, 'journal.json'), 'utf8')).toBe(prior);
    Object.defineProperty(process, 'platform', platform);
    if (uid) Object.defineProperty(process, 'geteuid', uid);
    else delete process.geteuid;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true });
  });

  it('journals intent before Auth, holds the common lock, and confirms only joined readback', async () => {
    auth.mockImplementation(async (plan) => {
      const intent = JSON.parse(fs.readFileSync(intentPath(plan.runId, 'intent')));
      expect(plan).toEqual({
        runId: intent.runId,
        operationId: intent.operationId,
        id: intent.userId,
        email: 'student_pilot@school.invalid',
      });
      await expect(student.establishStudent(vi.fn())).rejects.toThrow();
      expect(fs.existsSync(intentPath(plan.runId, 'attempt'))).toBe(false);
      return { ignored: 'synthetic-untrusted-ack' };
    });
    const result = await student.establishStudent(auth);
    expect(result.profileId).toBe(profile);
    expect(writes()).toHaveLength(1);
    const files = ['intent', 'attempt', 'confirmed'].map((kind) =>
      fs.readFileSync(intentPath(result.runId, kind), 'utf8'),
    );
    expect(files.join('')).not.toMatch(/password|token|untrusted-ack/);
    expect(JSON.parse(files[2])).toEqual({
      runId: result.runId,
      attemptId: JSON.parse(files[1]).id,
      profileId: profile,
    });
    expect(await student.reconcileStudent(result.runId)).toEqual(result);
    expect(writes()).toHaveLength(1);
    expect(fs.existsSync(path.join(base, 'inventory.lock'))).toBe(false);
    await expect(student.establishStudent(auth)).rejects.toThrow();
    expect(auth).toHaveBeenCalledTimes(1);
    expect(await student.reconcileStudent(result.runId)).toEqual(result);
  });
  it.each(['inventory', 'auth', 'target', 'intent', 'lock'])(
    'rejects %s before database writes',
    async (fault) => {
      fail = fault;
      auth.mockImplementation((plan) => {
        if (fault === 'target') instance = 'b'.repeat(64);
        if (fault === 'intent') fs.writeFileSync(intentPath(plan.runId, 'intent'), '{}');
      });
      if (fault === 'lock') fs.mkdirSync(path.join(base, 'inventory.lock'));
      await expect(student.establishStudent(auth)).rejects.toThrow();
      expect(auth).toHaveBeenCalledTimes(['lock', 'inventory'].includes(fault) ? 0 : 1);
      expect(writes()).toHaveLength(0);
    },
  );
  it('requires a matching readback after ambiguous commit and cannot write again', async () => {
    fail = 'unknown-commit';
    await expect(student.establishStudent(auth)).rejects.toThrow('journal rejected');
    const runId = auth.mock.calls[0][0].runId;
    expect(fs.existsSync(intentPath(runId, 'attempt'))).toBe(true);
    fail = 'receipt';
    await expect(student.reconcileStudent(runId)).rejects.toThrow();
    expect(fs.existsSync(intentPath(runId, 'confirmed'))).toBe(false);
    fail = '';
    expect((await student.reconcileStudent(runId)).profileId).toBe(profile);
    profile = randomUUID();
    await expect(student.reconcileStudent(runId)).rejects.toThrow();
    instance = 'b'.repeat(64);
    const count = commands.length;
    await expect(student.reconcileStudent(runId)).rejects.toThrow();
    expect(commands).toHaveLength(count);
    expect(writes()).toHaveLength(1);
  });
  it.each(['extra-auth', 'extra-membership'])(
    'withholds confirmation for %s in the receipt inventory',
    async (fault) => {
      fail = fault;
      await expect(student.establishStudent(auth)).rejects.toThrow();
      const { runId } = auth.mock.calls[0][0];
      await expect(student.reconcileStudent(runId)).rejects.toThrow();
      expect(fs.existsSync(intentPath(runId, 'confirmed'))).toBe(false);
      expect(writes()).toHaveLength(1);
    },
  );
  it('reports exact Auth readback alone if its acknowledgement was lost', async () => {
    auth.mockRejectedValue(new Error('private-provider-detail'));
    await expect(student.establishStudent(auth)).rejects.toThrow('journal rejected');
    const { runId } = auth.mock.calls[0][0];
    expect(await student.reconcileStudent(runId)).toEqual({
      runId,
      state: 'auth-confirmed-membership-pending',
    });
    fail = 'auth';
    await expect(student.reconcileStudent(runId)).rejects.toThrow();
    for (const table of [
      'organization_memberships',
      'organization_member_profiles',
      'membership_roles',
      'organization_admin_bootstrap_grants',
    ])
      expect(commands.at(-1)).toContain('not exists (select from public.' + table + ')');
    expect(commands.at(-1)).toContain(
      'not exists (select from staging_private.student_fixture_receipts)',
    );
    expect(writes()).toHaveLength(0);
  });
  it('rejects a caller-supplied transport before any SQL', () => {
    isOwnedLocalStudentTarget.mockReturnValue(false);
    expect(() => localStudentOperations({})).toThrow('evidence rejected');
    expect(commands).toHaveLength(0);
  });
  it('rejects historic paths, linked records and changed bindings', async () => {
    await expect(student.reconcileStudent('../journal.json')).rejects.toThrow();
    const { runId } = await student.establishStudent(auth);
    fs.linkSync(intentPath(runId, 'intent'), path.join(home, 'alias'));
    await expect(student.reconcileStudent(runId)).rejects.toThrow();
    fs.unlinkSync(path.join(home, 'alias'));
    const intent = JSON.parse(fs.readFileSync(intentPath(runId, 'intent')));
    for (const [key, value] of Object.entries({
      projectRef: 'hosted',
      schoolId: randomUUID(),
      role: 'admin',
      email: 'other@school.invalid',
      revision: 'stale',
      userId: "';rollback;",
    })) {
      fs.writeFileSync(intentPath(runId, 'intent'), JSON.stringify({ ...intent, [key]: value }));
      await expect(student.reconcileStudent(runId)).rejects.toThrow();
    }
    expect(writes()).toHaveLength(1);
  });
});

describe('offline SQL contract', () => {
  const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  it('makes the receipt private and append-only while leaving the existing hook and app grants alone', () => {
    const migration = read(
      '../../supabase/migrations/20261118084658_feat_003_local_student_fixture_receipt.sql',
    );
    expect(migration).toContain('enable row level security');
    expect(migration).toContain(
      'from public, anon, authenticated, service_role, supabase_auth_admin',
    );
    expect(migration).toContain('before update or delete or truncate');
    expect(migration).toContain('unique (organization_id, role_code)');
    expect(migration).not.toMatch(/grant\s|security definer|create policy|insert into/i);
  });
  it('keeps membership, existing single role and provenance in one write, letting the trigger create the profile', () => {
    const write = read('../sql/local-student-fixture.sql');
    expect(Array.from(write.matchAll(/insert into ([\w.]+)/gi), (m) => m[1])).toEqual([
      'public.organization_memberships',
      'public.membership_roles',
      'staging_private.student_fixture_receipts',
    ]);
    expect(write).toContain('select id into strict profile');
    expect(write).toContain('in share row exclusive mode');
    expect(write).not.toMatch(/on conflict|commit;|exception when|raw_user_meta_data/i);
    const readback = read('../sql/local-student-fixture-readback.sql');
    expect(readback).not.toMatch(/\b(insert|update|delete|truncate|call)\b/i);
    for (const sql of [write, readback]) {
      for (const field of [
        'operation_id',
        'attempt_id',
        'run_id',
        'user_id',
        'membership_id',
        'instance_digest',
        'database_system_id',
      ])
        expect(sql).toContain(`current_setting('fixture.${field}')`);
      expect(sql).toContain('pg_catalog.pg_control_system()');
      expect(sql).toContain('flyeye_fixture_create_operation');
      expect(sql).toContain('student_pilot@school.invalid');
    }
  });
});
