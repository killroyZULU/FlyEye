// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  readLifecycleMigrations,
  retainedReceiptMigration,
  retainedAssignmentMigration,
} from './local-lifecycle-migrations.mjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { verifiedNoSendCliEnvironment } from './no-send-cli-artifact.mjs';
import {
  localNoSendProject,
  runFreshLocalInstructorFixture,
  startLocalLifecycleSchool,
  withFreshLocalStudentSchool,
} from './no-send-local-project.mjs';
import { withStudentJournal } from './local-student-journal.mjs';
import { randomUUID } from 'node:crypto';
import { createNoSendHttpClient } from './no-send-http-client.mjs';
import { withLocalStudentAdapter } from './local-student-adapter.mjs';
import { localInstructorFixture } from './local-instructor-fixture.mjs';
vi.mock('./local-instructor-fixture.mjs', async (original) => ({
  ...(await original()),
  localInstructorFixture: vi.fn(),
}));
vi.mock('./local-student-adapter.mjs', () => ({ withLocalStudentAdapter: vi.fn() }));
vi.mock('./no-send-http-client.mjs', () => ({ createNoSendHttpClient: vi.fn() }));

vi.mock('./local-student-journal.mjs', async (original) => ({
  ...(await original()),
  withStudentJournal: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('./no-send-cli-artifact.mjs', () => ({ verifiedNoSendCliEnvironment: vi.fn() }));
const target = 'flyeye-nosend-p3d1';
const network = target + '-isolated';
const school = '00000000-0000-4000-8000-000000000099';
const journal = JSON.stringify({ projectRef: target, schoolId: school });
const hook = '20261107105251_feat_003_staging_no_send.sql';
const receipt = '20261118084658_feat_003_local_student_fixture_receipt.sql';

function transport({
  inserted = '1',
  matches = 't',
  unsafeMail = false,
  socket = 'unix:///var/run/docker.sock',
  studentState,
} = {}) {
  const sql = [];
  const services = ['db', 'auth', 'kong', 'inbucket', 'rest'];
  const containerId = (service) =>
    studentState
      ? (studentState.replace === service ? 'f' : String(services.indexOf(service) + 1)).repeat(64)
      : service;
  let running = false;
  let workspace;
  function output(executable, args, opts) {
    if (executable === process.execPath) {
      if (args[1] === 'status') return JSON.stringify({ API_URL: 'http://127.0.0.1:58321' });
      if (args[1] === 'start' || args[1] === 'stop') {
        running = args[1] === 'start';
        workspace = args[args.indexOf('--workdir') + 1];
        if (running && studentState) {
          const files = fs.readdirSync(path.join(workspace, 'supabase/migrations')).sort();
          expect(files).toEqual(
            readLifecycleMigrations('supabase/migrations')
              .map((m) => m.name)
              .filter((name) => name !== receipt),
          );
        }
        return '';
      }
    } else if (executable === 'docker') {
      if (args[0] === 'context') return socket;
      if (studentState && args[0] === 'info') return 'a'.repeat(32);
      if (studentState && args[0] === 'ps' && args.includes('--filter'))
        return running ? services.map(containerId).join('\n') : '';
      if (studentState && args[0] === 'network' && args[1] === 'create') return 'a'.repeat(64);
      if (args[0] === 'exec') {
        if (studentState) {
          expect(args[2]).toBe(containerId('db'));
          expect(args).toContain('-qAt');
          if (Buffer.isBuffer(opts.input)) {
            expect(
              opts.input.equals(fs.readFileSync(path.join('supabase/migrations', receipt))),
            ).toBe(true);
            studentState.migrations++;
            if (studentState.migrationFailure) throw new Error('simulated migration failure');
            return '';
          }
          if (opts.input.startsWith('select system_identifier')) return '184400331212';
          sql.push(opts.input);
          if (opts.input.includes("select 'receipt-verified'")) {
            if (studentState.permissionFailure) return '';
            if (studentState.triggerFailure) throw new Error('simulated missing append-only guard');
            return 'receipt-verified';
          }
          if (opts.input.startsWith('with seeded')) return '1';
          if (opts.input.includes('select p.id')) return '11111111-1111-4111-8111-111111111111';
          return 't';
        }
        expect(args).toContain('supabase_db_' + target);
        sql.push(opts.input);
        return sql.length === 1 ? inserted : matches;
      }
      if (args[0] === 'inspect') {
        const service = services.find((s) => args[1] === 'supabase_' + s + '_' + target);
        const bindings = {
          db: ['5432/tcp', '58322'],
          kong: ['8000/tcp', '58321'],
          inbucket: ['8025/tcp', '58324'],
        };
        const binding = bindings[service];
        return JSON.stringify([
          {
            Id: containerId(service),
            NetworkSettings: {
              Networks: { [network]: {} },
              Ports: binding
                ? { [binding[0]]: [{ HostIp: '127.0.0.1', HostPort: binding[1] }] }
                : {},
            },
            Config: {
              Labels: { 'com.supabase.cli.project': target },
              Env:
                service === 'auth'
                  ? [
                      'GOTRUE_SMTP_HOST=supabase_inbucket_' + target,
                      'GOTRUE_SMTP_PORT=1025',
                      'GOTRUE_HOOK_SEND_EMAIL_ENABLED=true',
                      'GOTRUE_HOOK_SEND_EMAIL_URI=pg-functions://postgres/staging_private/reject_email',
                    ]
                  : [],
            },
            Mounts: service === 'inbucket' && unsafeMail ? [{}] : [],
          },
        ]);
      }
      if (args[0] === 'network' && args[1] === 'inspect')
        return JSON.stringify([
          {
            Id: 'a'.repeat(64),
            Containers: Object.fromEntries(services.map((s) => [containerId(s), {}])),
          },
        ]);
      if (
        args[0] === 'ps' ||
        args[0] === 'volume' ||
        (args[0] === 'network' && ['ls', 'create', 'rm'].includes(args[1]))
      )
        return '';
    }
    throw new Error('Unexpected synthetic command');
  }
  spawnSync.mockImplementation((...args) => ({ status: 0, stdout: output(...args), stderr: '' }));
  return { sql, workspace: () => workspace };
}
describe('disposable lifecycle school preparation', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    vi.stubEnv('DOCKER_CONTEXT', undefined);
    vi.stubEnv('DOCKER_HOST', undefined);
    verifiedNoSendCliEnvironment.mockReturnValue({});
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });
  it.each(['success', 'checkpoint-failure', 'final-mail', 'initial-mail', 'permission-failure'])(
    'gates Instructor teardown and retains the private lock on uncertainty: %s',
    async (outcome) => {
      const state = { migrations: 0, permissionFailure: outcome === 'permission-failure' };
      const fake = transport({ studentState: state });
      const retainLock = vi.fn();
      const ownedJournal = { runId: randomUUID(), check: vi.fn(), retainLock };
      withStudentJournal.mockImplementation(async (run, work) => {
        expect(run).toBe(null);
        return work(ownedJournal);
      });
      const request = vi
        .fn()
        .mockResolvedValueOnce({ status: 200, body: { total: outcome === 'initial-mail' ? 1 : 0 } })
        .mockResolvedValueOnce({ status: 200, body: { total: outcome === 'final-mail' ? 1 : 0 } });
      createNoSendHttpClient.mockImplementation(() => ({ request, close: vi.fn() }));
      let count = 0;
      const advance = vi.fn(async () => {
        if (outcome === 'checkpoint-failure') throw new Error('checkpoint rejected');
        return { decision: ++count === 8 ? 'complete' : 'record' };
      });
      localInstructorFixture.mockReturnValue({ initialize: vi.fn(), advance });
      try {
        const keys = {
          adminCompleteHash: 'a'.repeat(64),
          enrollmentCompleteHash: 'b'.repeat(64),
          assignmentKeyHash: 'c'.repeat(64),
        };
        const operator = Object.fromEntries(
          [
            'passwordFor',
            'privateSession',
            'protected-admin-onboarding',
            'protected-self-enrollment',
            'protected-role-assignment',
          ].map((name) => [name, vi.fn()]),
        );
        const result = runFreshLocalInstructorFixture(keys, operator);
        if (outcome === 'success')
          await expect(result).resolves.toEqual({
            runId: ownedJournal.runId,
            decision: 'complete',
          });
        else await expect(result).rejects.toThrow();
        expect(advance).toHaveBeenCalledTimes(
          {
            success: 8,
            'checkpoint-failure': 1,
            'final-mail': 8,
            'initial-mail': 0,
            'permission-failure': 0,
          }[outcome],
        );
        expect(retainLock).toHaveBeenCalledTimes(outcome === 'success' ? 0 : 1);
        expect(spawnSync.mock.calls.some(([, args]) => args[1] === 'stop')).toBe(
          outcome === 'success',
        );
        expect(fs.existsSync(fake.workspace())).toBe(outcome !== 'success');
      } finally {
        // Only the harness-created temporary directory survives a synthetic failure.
        if (fake.workspace() && fs.existsSync(fake.workspace()))
          fs.rmSync(fake.workspace(), { recursive: true });
      }
    },
  );
  it.each(['missing-method', 'duplicate-keys', 'wrong-key'])(
    'rejects invalid Instructor input %s before lock or startup',
    async (fault) => {
      const keys = {
        adminCompleteHash: 'a'.repeat(64),
        enrollmentCompleteHash: 'b'.repeat(64),
        assignmentKeyHash: 'c'.repeat(64),
      };
      const operator = Object.fromEntries(
        [
          'passwordFor',
          'privateSession',
          'protected-admin-onboarding',
          'protected-self-enrollment',
          'protected-role-assignment',
        ].map((name) => [name, vi.fn()]),
      );
      if (fault === 'missing-method') delete operator['protected-role-assignment'];
      if (fault === 'duplicate-keys') keys.assignmentKeyHash = keys.adminCompleteHash;
      if (fault === 'wrong-key') keys.assignmentKeyHash = 'invalid';
      await expect(runFreshLocalInstructorFixture(keys, operator)).rejects.toThrow();
      expect(withStudentJournal).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
      Object.values(operator).forEach((method) => expect(method).not.toHaveBeenCalled());
    },
  );
  it.each([
    '{',
    '{}',
    JSON.stringify({ projectRef: 'hosted', schoolId: school }),
    JSON.stringify({ projectRef: target, schoolId: school + 'x' }),
  ])('rejects unbound journal before any command', (input) => {
    expect(() => startLocalLifecycleSchool(input)).toThrow('journal target rejected');
    expect(spawnSync).not.toHaveBeenCalled();
  });
  it('rejects a remote daemon before resource preparation', () => {
    transport({ socket: 'tcp://other.invalid:2376' });
    expect(() => startLocalLifecycleSchool(journal)).toThrow('Docker target rejected');
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });
  it.each([
    'confirmed',
    'replaced',
    'no-auth-ack',
    'early-drift',
    'initial-mail',
    'migration-failure',
    'skipped-student',
    'operator-failure',
    'permission-failure',
    'trigger-failure',
    'final-mail',
    'unreadable-sink',
    'caught-operation',
    'caught-invalid-auth',
    'adapter-shutdown',
    'unfinished-auth',
    'concurrent-failure',
  ])('holds the fresh run lock through ownership-checked teardown (%s)', async (outcome) => {
    const state = {
      migrations: 0,
      migrationFailure: outcome === 'migration-failure',
      permissionFailure: outcome === 'permission-failure',
      triggerFailure: outcome === 'trigger-failure',
    };
    const fake = transport({ studentState: state });
    let sinkReads = 0;
    const request = vi.fn(async (url) => {
      expect(url).toBe('http://127.0.0.1:58324/api/v1/messages');
      sinkReads++;
      if (sinkReads === 1) {
        expect(state.migrations).toBe(0);
        expect(fake.sql).toEqual([]);
        if (outcome === 'early-drift') state.replace = 'auth';
        return { status: 200, body: { total: outcome === 'initial-mail' ? 1 : 0 } };
      }
      expect(fake.sql.at(-1)).toContain("select 'receipt-verified'");
      if (outcome === 'unreadable-sink') throw new Error('simulated missing sink');
      return { status: 200, body: { total: outcome === 'final-mail' ? 1 : 0 } };
    });
    const close = vi.fn();
    createNoSendHttpClient.mockImplementation(() => ({ request, close }));
    const records = new Map(),
      runId = randomUUID(),
      retainLock = vi.fn();
    let locked = false,
      after,
      stoppedAuth;
    withStudentJournal.mockImplementation(async (initial, operation) => {
      expect(initial).toBe(null);
      expect(spawnSync).not.toHaveBeenCalled();
      locked = true;
      try {
        return await operation({
          runId,
          read: (name) => records.get(name) ?? null,
          record: (name, value) => records.set(name, value),
          bindInstance: vi.fn(),
          check: () => expect(locked).toBe(true),
          retainLock,
        });
      } finally {
        locked = false;
      }
    });
    try {
      const run = withFreshLocalStudentSchool(async (school) => {
        expect(state.migrations).toBe(1);
        expect(sinkReads).toBe(1);
        expect(Object.keys(school).sort()).toEqual([
          'establishStudent',
          'reconcileStudent',
          'runId',
          'status',
          'withBrowserAdapter',
        ]);
        expect(school.status().API_URL).toBe('http://127.0.0.1:58321');
        after = school;
        if (outcome === 'skipped-student') return;
        if (outcome === 'unfinished-auth' || outcome === 'concurrent-failure') {
          const entered = Promise.withResolvers();
          const release = Promise.withResolvers();
          const work = school.establishStudent(() => {
            entered.resolve();
            return release.promise;
          });
          // Attach the rejection handler before releasing the pending synthetic call.
          stoppedAuth = expect(work).rejects.toThrow('operation rejected');
          await entered.promise;
          if (outcome === 'concurrent-failure') {
            await expect(school.reconcileStudent(runId)).rejects.toThrow('operation rejected');
            release.resolve();
            await stoppedAuth;
          } else {
            setImmediate(release.resolve);
          }
          return;
        }
        const result = await school.establishStudent(() => {
          expect(locked).toBe(true);
          if (outcome === 'no-auth-ack') throw new Error('simulated ambiguous Auth outcome');
        });
        expect(await school.reconcileStudent(runId)).toEqual(result);
        if (['confirmed', 'adapter-shutdown'].includes(outcome)) {
          withLocalStudentAdapter.mockImplementation(async (load, id, callback) => {
            expect(load().API_URL).toBe('http://127.0.0.1:58321');
            expect(id).toBe(records.get('intent').userId);
            await callback({ origin: 'synthetic' });
            if (outcome === 'adapter-shutdown') throw new Error('uncertain shutdown');
          });
          const browser = vi.fn();
          const stage = school.withBrowserAdapter(browser);
          if (outcome === 'confirmed') await stage;
          else await expect(stage).rejects.toThrow('uncertain shutdown');
          expect(browser).toHaveBeenCalledOnce();
        }
        if (outcome === 'operator-failure') throw new Error('simulated final operator failure');
        if (outcome === 'caught-operation')
          await expect(school.reconcileStudent(randomUUID())).rejects.toThrow();
        if (outcome === 'caught-invalid-auth')
          await expect(school.establishStudent(null)).rejects.toThrow();
        if (outcome === 'replaced') state.replace = 'auth';
        return result;
      });
      if (outcome !== 'confirmed') {
        await expect(run).rejects.toThrow(
          {
            replaced: 'target rejected',
            'no-auth-ack': 'ambiguous Auth outcome',
            'early-drift': 'target rejected',
            'initial-mail': 'verified empty',
            'migration-failure': 'simulated migration failure',
            'skipped-student': 'checks incomplete',
            'operator-failure': 'final operator failure',
            'permission-failure': 'receipt checks incomplete',
            'trigger-failure': 'missing append-only guard',
            'final-mail': 'verified empty',
            'unreadable-sink': 'missing sink',
            'caught-operation': 'checks incomplete',
            'caught-invalid-auth': 'checks incomplete',
            'adapter-shutdown': 'checks incomplete',
            'unfinished-auth': 'operation rejected',
            'concurrent-failure': 'checks incomplete',
          }[outcome],
        );
        expect(retainLock).toHaveBeenCalledOnce();
      } else {
        expect((await run).runId).toBe(runId);
        expect(retainLock).not.toHaveBeenCalled();
      }
      await stoppedAuth;
      expect(spawnSync.mock.calls.some(([, args]) => args[1] === 'stop')).toBe(
        outcome === 'confirmed',
      );
      expect(fs.existsSync(fake.workspace())).toBe(outcome !== 'confirmed');
      if (after) await expect(after.reconcileStudent(runId)).rejects.toThrow();
      expect(close).toHaveBeenCalledTimes(sinkReads);
      expect(sinkReads).toBe(
        ['confirmed', 'final-mail', 'unreadable-sink'].includes(outcome) ? 2 : 1,
      );
      expect(state.migrations).toBe(['early-drift', 'initial-mail'].includes(outcome) ? 0 : 1);
      expect(
        spawnSync.mock.calls.some(([, args]) => args[0] === 'network' && args[1] === 'rm'),
      ).toBe(outcome === 'confirmed');
      expect(fake.sql.filter((s) => s.includes('do $student$'))).toHaveLength(
        [
          'no-auth-ack',
          'early-drift',
          'initial-mail',
          'migration-failure',
          'skipped-student',
          'unfinished-auth',
          'concurrent-failure',
        ].includes(outcome)
          ? 0
          : 1,
      );
      if (['unfinished-auth', 'concurrent-failure'].includes(outcome))
        expect(records.has('attempt')).toBe(false);
    } finally {
      // Only the generated unit-test workspace exists; all process calls are mocks.
      if (fake.workspace() && fs.existsSync(fake.workspace()))
        fs.rmSync(fake.workspace(), { recursive: true });
    }
  });
  it('keeps ordinary no-send runs hook-only', () => {
    const fake = transport(),
      project = localNoSendProject();
    try {
      project.start(false);
      expect(fs.readdirSync(path.join(fake.workspace(), 'supabase/migrations'))).toEqual([hook]);
      expect(fake.sql).toEqual([]);
    } finally {
      project.close();
    }
  });
  it.each([
    'omitted',
    'substituted',
    'extra',
    'missing retained receipt',
    'altered retained receipt',
  ])('rejects a migration set with an %s SQL file', (kind) => {
    const directory = fs.mkdtempSync(path.join(tmpdir(), 'flyeye-migration-test-'));
    try {
      fs.cpSync('supabase/migrations', directory, { recursive: true });
      const first = path.join(directory, hook);
      const retained = path.join(directory, retainedReceiptMigration);
      if (kind === 'omitted') fs.unlinkSync(first);
      if (kind === 'substituted') fs.appendFileSync(first, '-- changed');
      if (kind === 'missing retained receipt') fs.unlinkSync(retained);
      if (kind === 'altered retained receipt') fs.appendFileSync(retained, '-- changed');
      if (kind === 'extra')
        fs.writeFileSync(path.join(directory, '20990101000000_extra.sql'), 'select 1;');
      expect(() => readLifecycleMigrations(directory)).toThrow('inventory mismatch');
      expect(spawnSync).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });
  it('copies the repository migrations exactly, guards the insert and reads the table independently', () => {
    const fake = transport(),
      project = startLocalLifecycleSchool(journal);
    try {
      const destination = path.join(fake.workspace(), 'supabase/migrations');
      const files = fs
        .readdirSync('supabase/migrations')
        .filter(
          (f) =>
            f.endsWith('.sql') &&
            ![receipt, retainedReceiptMigration, retainedAssignmentMigration].includes(f),
        )
        .sort();
      expect(files).toHaveLength(31);
      expect(fs.readdirSync(destination).sort()).toEqual(files);
      for (const f of files)
        expect(
          fs
            .readFileSync(path.join(destination, f))
            .equals(fs.readFileSync(path.join('supabase/migrations', f))),
        ).toBe(true);
      const config = fs.readFileSync(path.join(fake.workspace(), 'supabase/config.toml'), 'utf8');
      expect(config).toContain('[db.seed]\nenabled = false');
      expect(config).toContain('[auth.hook.send_email]\nenabled = true');
      expect(fake.sql).toHaveLength(2);
      expect(fake.sql[0]).toContain('where not exists (select 1 from public.organizations)');
      expect(fake.sql[0]).toContain(
        "'" + school + "'::uuid, 'Synthetic lifecycle school', 'active'",
      );
      expect(fake.sql[1]).toMatch(/select count\(\*\) = 1 and\s+count\(\*\) filter/);
      expect(fake.sql[1]).toContain("where id = '" + school + "'::uuid and status = 'active'");
      expect(fake.sql[1]).not.toMatch(/insert|update|delete/i);
      vi.stubEnv('DOCKER_CONTEXT', 'different-context');
      vi.stubEnv('DOCKER_HOST', 'tcp://other.invalid:2376');
      project.status();
    } finally {
      project.close();
    }
    expect(fs.existsSync(fake.workspace())).toBe(false);
    for (const [, args, options] of spawnSync.mock.calls) {
      if (args[0] !== 'context')
        expect(options.env).toMatchObject({
          DOCKER_HOST: 'unix:///var/run/docker.sock',
          DOCKER_CONTEXT: '',
        });
    }
  });
  it.each([
    [{ unsafeMail: true }, 0],
    [{ inserted: '0' }, 1],
    [{ inserted: '2' }, 1],
    [{ matches: 'f' }, 2],
    [{ matches: '' }, 2],
  ])('cleans up and withholds the project on safeguard or SQL failure', (options, count) => {
    const fake = transport(options);
    expect(() => startLocalLifecycleSchool(journal)).toThrow();
    expect(fake.sql).toHaveLength(count);
    expect(fs.existsSync(fake.workspace())).toBe(false);
    expect(
      spawnSync.mock.calls.some(([, args]) => args[1] === 'stop' && args.includes('--no-backup')),
    ).toBe(true);
  });
});
