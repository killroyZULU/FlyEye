import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedNoSendCliEnvironment } from './no-send-cli-artifact.mjs';

import { readLifecycleMigrations } from './local-lifecycle-migrations.mjs';
import { withStudentJournal } from './local-student-journal.mjs';
import { createNoSendHttpClient } from './no-send-http-client.mjs';

const id = 'flyeye-nosend-p3d1';
const network = `${id}-isolated`;
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const cli = path.join(repositoryRoot, 'node_modules/supabase/dist/supabase.js');
const migration = '20261107105251_feat_003_staging_no_send.sql';
const studentReceipt = '20261118084658_feat_003_local_student_fixture_receipt.sql';
const digest = (text) => createHash('sha256').update(text).digest('hex');
const studentTargets = new WeakSet();
export const isOwnedLocalStudentTarget = (target) => studentTargets.has(target);

function verifyLocalMailBoundary(docker) {
  // Fixed labels, counts and booleans only; never emit inspect values or errors.
  const report = (check, summary = {}) =>
    process.stdout.write(`${JSON.stringify({ noSendSafeguard: { check, ...summary } })}\n`);
  report('container-inspection');
  const inspect = (service) => JSON.parse(docker(['inspect', `supabase_${service}_${id}`]))[0];
  const containers = ['db', 'auth', 'kong', 'inbucket', 'rest'].map(inspect);
  report('network-inspection');
  const networkState = JSON.parse(docker(['network', 'inspect', network]))[0];
  report('exact-network-membership', { count: Object.keys(networkState.Containers).length });
  assert.deepEqual(
    Object.keys(networkState.Containers).sort(),
    containers.map((container) => container.Id).sort(),
  );
  for (const container of containers) {
    const service = ['db', 'auth', 'kong', 'inbucket', 'rest'][containers.indexOf(container)];
    report('single-network-attachment', {
      service,
      count: Object.keys(container.NetworkSettings.Networks).length,
    });
    assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [network]);
    const bindings = Object.values(container.NetworkSettings.Ports ?? {}).flatMap(
      (ports) => ports ?? [],
    );
    report('loopback-bindings', {
      service,
      count: bindings.length,
      ipv4Loopback: bindings.filter((binding) => binding.HostIp === '127.0.0.1').length,
      ipv4Wildcard: bindings.filter((binding) => binding.HostIp === '0.0.0.0').length,
      ipv6Wildcard: bindings.filter((binding) => binding.HostIp === '::').length,
      other: bindings.filter((binding) => !['127.0.0.1', '0.0.0.0', '::'].includes(binding.HostIp))
        .length,
    });
    assert.ok(bindings.every((binding) => binding.HostIp === '127.0.0.1'));
  }
  const [database, auth, gateway, mail] = containers;
  const bound = (container, port, hostPort) =>
    container.NetworkSettings.Ports[port]?.some(
      (binding) => binding.HostIp === '127.0.0.1' && binding.HostPort === hostPort,
    );
  report('required-db-binding', { matches: Boolean(bound(database, '5432/tcp', '58322')) });
  assert.ok(bound(database, '5432/tcp', '58322'));
  report('required-api-binding', { matches: Boolean(bound(gateway, '8000/tcp', '58321')) });
  assert.ok(bound(gateway, '8000/tcp', '58321'));
  report('required-mail-binding', { matches: Boolean(bound(mail, '8025/tcp', '58324')) });
  assert.ok(bound(mail, '8025/tcp', '58324'));
  process.stdout.write('No-send compatibility: owned network and loopback bindings passed.\n');
  const environment = (container) =>
    Object.fromEntries(
      container.Config.Env.map((entry) => {
        const separator = entry.indexOf('=');
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
    );
  const authEnvironment = environment(auth);
  report('smtp-owned-host');
  assert.equal(authEnvironment.GOTRUE_SMTP_HOST, `supabase_inbucket_${id}`);
  report('smtp-local-port');
  assert.equal(authEnvironment.GOTRUE_SMTP_PORT, '1025');
  report('smtp-no-credentials');
  assert.ok(!authEnvironment.GOTRUE_SMTP_USER && !authEnvironment.GOTRUE_SMTP_PASS);
  const mailEnvironment = environment(mail);
  report('mail-no-relay-environment');
  assert.ok(Object.keys(mailEnvironment).every((key) => !/RELAY|FORWARD|CONFIG/i.test(key)));
  const mailArguments = [...(mail.Config.Entrypoint ?? []), ...(mail.Config.Cmd ?? [])];
  report('mail-no-relay-arguments');
  assert.ok(mailArguments.every((value) => !/relay|forward|config/i.test(value)));
  report('mail-no-mounts');
  assert.equal(mail.Mounts.length, 0);
  // Only booleans/assertions leave this inspection; local keys remain in memory.
  return {
    container: database.Id,
    containers: containers.map((container) => container.Id),
    ownedLabels: containers.every(
      (container) => container.Config.Labels?.['com.supabase.cli.project'] === id,
    ),
    volumes: [
      ...new Set(
        containers
          .flatMap((container) => container.Mounts ?? [])
          .filter((mount) => mount.Type === 'volume')
          .map((mount) => mount.Name),
      ),
    ].sort(),
    network: networkState.Id,
    hook:
      authEnvironment.GOTRUE_HOOK_SEND_EMAIL_ENABLED === 'true' &&
      authEnvironment.GOTRUE_HOOK_SEND_EMAIL_URI ===
        'pg-functions://postgres/staging_private/reject_email',
  };
}

function command(executable, args, input, environment = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    input,
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1', ...environment },
  });
  if (result.status !== 0 || result.error || result.signal) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const categories = [
      ['configuration', /invalid config|unknown key|unrecognized key|failed to parse/i],
      ['migration', /error.*migration|failed.*migration|SQLSTATE/i],
      ['image', /failed to pull|pull access denied|manifest unknown/i],
      ['health', /unhealthy|health check|healthcheck/i],
      ['network', /network.*not found|network.*error|connection refused/i],
      ['port', /port is already allocated|address already in use/i],
      ['timeout', /timed out|timeout/i],
    ];
    const category = categories.find(([, pattern]) => pattern.test(output))?.[0] ?? 'unknown';
    throw new Error(`No-send disposable command failed: ${category}.`);
  }
  return result.stdout;
}

export function noSendLocalConfiguration(hook) {
  return `project_id = "${id}"
[api]
enabled = true
port = 58321
[db]
port = 58322
shadow_port = 58320
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
port = 58323
[local_smtp]
enabled = true
port = 58324
smtp_port = 58325
pop3_port = 58326
[analytics]
enabled = false
port = 58327
[auth]
site_url = "http://127.0.0.1:58329"
enable_signup = false
minimum_password_length = 15
[auth.rate_limit]
email_sent = 30
[auth.email]
enable_signup = true
enable_confirmations = true
double_confirm_changes = true
secure_password_change = false
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
[auth.hook.send_email]
enabled = ${hook}
uri = "pg-functions://postgres/staging_private/reject_email"
[auth.email.notification.password_changed]
enabled = false
[auth.email.notification.email_changed]
enabled = false
[auth.email.notification.phone_changed]
enabled = false
[auth.email.notification.identity_linked]
enabled = false
[auth.email.notification.identity_unlinked]
enabled = false
[auth.email.notification.mfa_factor_enrolled]
enabled = false
[auth.email.notification.mfa_factor_unenrolled]
enabled = false
`;
}

export function localNoSendProject() {
  return prepareNoSendProject(false);
}

// journalText is the caller's verified, locked local journal snapshot.
// Only this disposable route installs the school schema and a synthetic row.
export function startLocalLifecycleSchool(journalText) {
  return startSchool(journalText, false);
}

async function checkStudentMailSink(transport) {
  transport.witness();
  const client = createNoSendHttpClient();
  try {
    const response = await client.request('http://127.0.0.1:58324/api/v1/messages');
    if (response.status !== 200 || response.body?.total !== 0)
      throw new Error('Local Student sink was not verified empty.');
  } finally {
    await client.close();
  }
  transport.witness();
}

export async function withFreshLocalStudentSchool(use) {
  if (typeof use !== 'function') throw new Error('Local Student operation required.');
  const receiptChecks = readFileSync(
    new URL('../sql/local-student-receipt-checks.sql', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  if (digest(receiptChecks) !== '6e4465101cf96600e139d762412a413df7efc408a2cf3506b7580fa4c0e814df')
    throw new Error('Local Student receipt check inventory rejected.');
  const { localStudentOperations } = await import('./local-student-fixture.mjs');
  // Acquire the existing shared inventory lock before any startup or school seed.
  return withStudentJournal(null, async (journal) => {
    const school = startSchool(
      JSON.stringify({ projectRef: id, schoolId: '00000000-0000-4000-8000-000000000099' }),
      journal,
    );
    let pending,
      open = true,
      confirmed = false,
      failed = false,
      accepted = false;
    // An Auth call may finish after its caller has exited or another check failed.
    // The same check fences its continuation before any further SQL or persistence.
    const operatorJournal = {
      ...journal,
      check() {
        if (!open || failed) throw new Error('Local Student operation rejected.');
        journal.check();
      },
    };
    let adapterUsed = false;
    const exclusive = async (operation) => {
      try {
        operatorJournal.check();
        if (pending) throw new Error('Local Student operation rejected.');
        pending = Promise.resolve().then(() => {
          operatorJournal.check();
          return operation();
        });
        try {
          return await pending;
        } finally {
          pending = undefined;
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    };
    const withJournal = (runId, operation) =>
      exclusive(async () => {
        if (runId === null ? journal.read('intent') !== null : runId !== journal.runId)
          throw new Error('Local Student operation rejected.');
        const result = await operation(operatorJournal);
        confirmed = Boolean(result.profileId);
        return result;
      });
    const status = () => {
      try {
        operatorJournal.check();
        school.transport.witness();
        const current = school.status();
        if (current.API_URL !== 'http://127.0.0.1:58321')
          throw new Error('Local Student API rejected.');
        return current;
      } catch (error) {
        failed = true;
        throw error;
      }
    };
    try {
      await checkStudentMailSink(school.transport);
      journal.check();
      school.initialize();
      const result = await use({
        runId: journal.runId,
        ...localStudentOperations(school.transport, withJournal),
        status,
        withBrowserAdapter(useBrowser) {
          return exclusive(async () => {
            if (!confirmed || adapterUsed || typeof useBrowser !== 'function')
              throw new Error('Local Student browser stage rejected.');
            adapterUsed = true;
            const { withLocalStudentAdapter } = await import('./local-student-adapter.mjs');
            return withLocalStudentAdapter(
              status,
              journal.read('intent').userId,
              (publicTarget) => {
                operatorJournal.check();
                return useBrowser(publicTarget);
              },
            );
          });
        },
      });
      open = false;
      if (failed || pending || !confirmed) throw new Error('Local Student checks incomplete.');
      // Reconcile the exact committed tuple on the bound target after the operator returns.
      const readback = localStudentOperations(school.transport, (_id, read) => read(journal));
      if (!(await readback.reconcileStudent(journal.runId)).profileId)
        throw new Error('Local Student receipt readback incomplete.');
      if (school.transport.sql(receiptChecks) !== 'receipt-verified')
        throw new Error('Local Student receipt checks incomplete.');
      await checkStudentMailSink(school.transport);
      if (failed) throw new Error('Local Student operation rejected.');
      journal.check();
      school.transport.witness();
      school.close();
      accepted = true;
      return result;
    } finally {
      open = false;
      try {
        await pending;
      } finally {
        studentTargets.delete(school.transport);
        if (!accepted) journal.retainLock();
      }
    }
  });
}

// Separate operator entrypoint: it is never invoked by startup, CI or Student runs.
export async function runFreshLocalInstructorFixture(keys, operator) {
  return executeInstructorFixture(keys, operator);
}

export async function runInstructorBrowserProof() {
  const { createInstructorOperator } = await import('./local-instructor-operator.mjs');
  const { verifyInstructorBrowser } = await import('./local-instructor-browser.mjs');
  const { withLocalStudentAdapter } = await import('./local-student-adapter.mjs');
  let readStatus;
  const setup = createInstructorOperator(() => readStatus());
  const mark = (stage) => process.stdout.write('Instructor checkpoint passed: ' + stage + '\n');
  return executeInstructorFixture(setup.keys, setup.operator, {
    mark,
    bind(read) {
      readStatus = read;
    },
    async browser(intent, factorHash) {
      const candidate = setup.candidateForBrowser(intent, factorHash);
      await withLocalStudentAdapter(
        readStatus,
        candidate.id,
        (publicConfig) => verifyInstructorBrowser(publicConfig, candidate, mark),
        candidate.factorId,
      );
      mark('browser-worker-group-listener-closed');
    },
  });
}

async function executeInstructorFixture(keys, operator, proof) {
  const { localInstructorFixture, checkInstructorOperator } =
    await import('./local-instructor-fixture.mjs');
  checkInstructorOperator(keys, operator);
  return withStudentJournal(null, async (journal) => {
    const school = startSchool(
      JSON.stringify({ projectRef: id, schoolId: '00000000-0000-4000-8000-000000000099' }),
      journal,
    );
    let accepted = false;
    try {
      await checkStudentMailSink(school.transport);
      school.initialize();
      const checks = readFileSync(
        new URL('../sql/local-student-receipt-checks.sql', import.meta.url),
        'utf8',
      ).replaceAll('\r\n', '\n');
      if (
        digest(checks) !== '6e4465101cf96600e139d762412a413df7efc408a2cf3506b7580fa4c0e814df' ||
        school.transport.sql(checks) !== 'receipt-verified'
      )
        throw new Error('Local receipt rejected.');
      const fixture = localInstructorFixture(school.transport, journal);
      proof?.bind(() => {
        journal.check();
        school.transport.witness();
        return school.status();
      });
      await fixture.initialize(keys);
      proof?.mark('owned-target-empty-mail-and-journal');
      // Each call advances exactly one durable checkpoint. No retry on ambiguity.
      const adminOnly = proof?.adminBrowser !== undefined;
      for (let index = 0; index < (adminOnly ? 5 : 7); index++) {
        const result = await fixture.advance(operator);
        if (result.decision !== 'record') throw new Error('Instructor checkpoint missing.');
        proof?.mark(result.phase);
      }
      if (adminOnly) {
        await proof.adminBrowser(await fixture.adminBrowserBinding());
        await fixture.adminBrowserBinding();
      } else if ((await fixture.advance(operator)).decision !== 'complete')
        throw new Error('Instructor fixture incomplete.');
      if (proof && !adminOnly) {
        await proof.browser(
          journal.read('instructor-intent').intent,
          journal.read('instructor-receipt-5').receipt.factorHash,
        );
        if ((await fixture.advance(operator)).decision !== 'complete')
          throw new Error('Instructor final readback failed.');
      }
      await checkStudentMailSink(school.transport);
      proof?.mark('final-readback-and-empty-mail');
      journal.check();
      school.transport.witness();
      school.close();
      accepted = true;
      proof?.mark('owned-teardown');
      return { runId: journal.runId, decision: 'complete' };
    } finally {
      studentTargets.delete(school.transport);
      if (!accepted) journal.retainLock();
    }
  });
}

export async function runAdminBrowserProof() {
  const { createInstructorOperator } = await import('./local-instructor-operator.mjs');
  const { verifyAdminBrowser } = await import('./local-instructor-browser.mjs');
  const { withLocalStudentAdapter } = await import('./local-student-adapter.mjs');
  let readStatus;
  const setup = createInstructorOperator(() => readStatus());
  const mark = (stage) => process.stdout.write('Admin checkpoint passed: ' + stage + '\n');
  return executeInstructorFixture(setup.keys, setup.operator, {
    mark,
    bind(read) {
      readStatus = read;
    },
    async adminBrowser(binding) {
      const admin = setup.adminForBrowser(binding);
      await withLocalStudentAdapter(
        readStatus,
        admin.id,
        (config) => verifyAdminBrowser(config, admin, mark),
        admin.factorId,
        'admin',
      );
      mark('browser-worker-group-listener-closed');
    },
  });
}

function startSchool(journalText, freshJournal) {
  const schoolId = '00000000-0000-4000-8000-000000000099';
  let journal;
  try {
    if (typeof journalText !== 'string' || journalText.length > 65536) throw new Error();
    journal = JSON.parse(journalText);
    if (journal.projectRef !== id || journal.schoolId !== schoolId) throw new Error();
  } catch {
    throw new Error('Disposable lifecycle journal target rejected.');
  }
  if (process.platform !== 'linux' || process.env.DOCKER_CONTEXT || process.env.DOCKER_HOST)
    throw new Error('Local lifecycle Docker target rejected.');

  // Use the same ordered application schema as the full local migration path,
  // including the later security fixes. Generic seed files stay disabled.
  const project = prepareNoSendProject(true, Boolean(freshJournal));
  try {
    project.start(true);
    if (freshJournal) {
      const transport = project.studentTransport();
      return {
        transport,
        status: project.status,
        close: project.close,
        initialize() {
          transport.applyReceipt();
          seedAndVerifySchool(transport.sql, schoolId);
        },
      };
    }
    seedAndVerifySchool(project.sql, schoolId);
    return { status: project.status, sql: project.sql, close: project.close };
  } catch (error) {
    if (freshJournal) freshJournal.retainLock();
    else project.close();
    throw error;
  }
}

function seedAndVerifySchool(sql, schoolId) {
  const inserted = sql(`with seeded as (
      insert into public.organizations (id, name, status)
      select '${schoolId}'::uuid, 'Synthetic lifecycle school', 'active'
      where not exists (select 1 from public.organizations)
      returning id
    ) select count(*) from seeded;`);
  if (inserted !== '1') throw new Error('Disposable lifecycle school seed rejected.');
  const matches = sql(`select count(*) = 1 and
      count(*) filter (where id = '${schoolId}'::uuid and status = 'active') = 1
      from public.organizations;`);
  if (matches !== 't') throw new Error('Disposable lifecycle school readback rejected.');
}

function prepareNoSendProject(lifecycleSchool, freshStudent = false) {
  if (realpathSync(process.cwd()) !== realpathSync(repositoryRoot)) {
    throw new Error('Disposable no-send working directory rejected.');
  }
  const cliEnvironment = verifiedNoSendCliEnvironment();
  if (
    lifecycleSchool &&
    command('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim() !==
      'unix:///var/run/docker.sock'
  )
    throw new Error('Local lifecycle Docker target rejected.');
  const dockerEnvironment = lifecycleSchool
    ? { DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_CONTEXT: '' }
    : {};
  const docker = (args, input) => command('docker', args, input, dockerEnvironment);
  const ownedFilter = ['--filter', 'label=com.supabase.cli.project=' + id];
  const ownedContainers = () =>
    docker(['ps', '-aq', '--no-trunc', ...ownedFilter])
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .sort();
  const ownedVolumes = () =>
    docker(['volume', 'ls', '-q', ...ownedFilter])
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .sort();
  const cliCommand = (args) =>
    command(process.execPath, [cli, ...args], undefined, {
      ...cliEnvironment,
      ...dockerEnvironment,
    });
  const directory = path.join(repositoryRoot, 'supabase/migrations');
  const migrations = lifecycleSchool
    ? readLifecycleMigrations(directory)
    : [{ name: migration, bytes: readFileSync(path.join(directory, migration)) }];
  const original = digest(readFileSync('supabase/config.toml'));
  const existing = docker(['ps', '-a', '--format', '{{.Names}}']);
  const volumes = docker(['volume', 'ls', '--format', '{{.Name}}']);
  const networks = docker(['network', 'ls', '--format', '{{.Name}}']);
  assert.ok(![existing, volumes, networks].some((text) => text.includes(id)));
  if (freshStudent && (ownedContainers().length || ownedVolumes().length))
    throw new Error('Local Student resource collision.');
  const root = mkdtempSync(path.join(tmpdir(), 'flyeye-nosend-'));
  try {
    mkdirSync(path.join(root, 'supabase/migrations'), { recursive: true });
    for (const { name, bytes } of migrations) {
      if (name === studentReceipt) continue;
      writeFileSync(path.join(root, 'supabase/migrations', name), bytes, {
        flag: 'wx',
        mode: 0o600,
      });
    }
  } catch (error) {
    // This newly allocated directory has no running services yet.
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  let ownsNetwork = false;
  let started = false;
  let originalBoundary;
  let networkId;
  function start(hook) {
    writeFileSync(path.join(root, 'supabase/config.toml'), noSendLocalConfiguration(hook));
    if (!ownsNetwork) {
      // Internal networks did not publish the DB host port on the verified engine.
      // Email containment instead uses the owned, non-relaying local SMTP sink.
      networkId = docker([
        'network',
        'create',
        '--driver',
        'bridge',
        '--opt',
        'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
        network,
      ]).trim();
      ownsNetwork = true;
    }
    started = true; // partial startup must also be cleaned up
    cliCommand([
      'start',
      '--workdir',
      root,
      '--network-id',
      network,
      '--exclude',
      'studio,meta,realtime,storage-api,imgproxy,edge-runtime,analytics,vector',
    ]);
    originalBoundary = verifyLocalMailBoundary(docker);
    process.stdout.write(
      'No-send compatibility: loopback bindings and local SMTP containment passed.\n',
    );
  }
  return {
    start,
    studentTransport() {
      if (!freshStudent || !originalBoundary?.hook) throw new Error('Local Student hook rejected.');
      const runSql = (source) =>
        docker(
          [
            'exec',
            '-i',
            originalBoundary.container,
            'psql',
            '-X',
            '-qAt',
            '-U',
            'postgres',
            '-d',
            'postgres',
            '-v',
            'ON_ERROR_STOP=1',
          ],
          source,
        ).trim();
      function observe() {
        const boundary = verifyLocalMailBoundary(docker);
        const daemon = docker(['info', '--format', '{{.ID}}']).trim();
        if (
          !started ||
          !boundary.hook ||
          !boundary.ownedLabels ||
          boundary.network !== networkId ||
          JSON.stringify(ownedContainers()) !== JSON.stringify([...boundary.containers].sort()) ||
          boundary.volumes.some(
            (volume) => !/^supabase_[a-z_]+_flyeye-nosend-p3d1$/.test(volume),
          ) ||
          ownedVolumes().some((volume) => !boundary.volumes.includes(volume)) ||
          !/^[a-f0-9]{64}$/.test(boundary.container) ||
          !/^[a-f0-9]{64}$/.test(boundary.network) ||
          !/^[a-zA-Z0-9:-]{16,100}$/.test(daemon) ||
          boundary.containers.some(
            (value, index) =>
              !/^[a-f0-9]{64}$/.test(value) || value !== originalBoundary.containers[index],
          ) ||
          boundary.network !== originalBoundary.network
        )
          throw new Error('Local Student target rejected.');
        const systemId = runSql(
          'select system_identifier::text from pg_catalog.pg_control_system();',
        );
        if (!/^[1-9][0-9]{0,19}$/.test(systemId))
          throw new Error('Local Student cluster rejected.');
        return {
          instance: digest([daemon, boundary.network, ...boundary.containers, systemId].join('/')),
          systemId,
          daemon,
          network: boundary.network,
          containers: Object.fromEntries(
            ['db', 'auth', 'kong', 'inbucket', 'rest'].map((name, index) => [
              name,
              boundary.containers[index],
            ]),
          ),
        };
      }
      const initial = observe();
      const witness = () => {
        if (observe().instance !== initial.instance)
          throw new Error('Local Student instance changed.');
        return { instance: initial.instance, systemId: initial.systemId };
      };
      const transport = {
        witness,
        instructorWitness() {
          const current = observe();
          if (current.instance !== initial.instance)
            throw new Error('Local fixture instance changed.');
          return current;
        },
        instructorKeys() {
          witness();
          const current = JSON.parse(cliCommand(['status', '--workdir', root, '-o', 'json']));
          if (
            current.API_URL !== 'http://127.0.0.1:58321' ||
            !current.ANON_KEY ||
            !current.SERVICE_ROLE_KEY
          )
            throw new Error('Local Auth target rejected.');
          witness();
          return { publicKey: current.ANON_KEY, serviceKey: current.SERVICE_ROLE_KEY };
        },
        applyReceipt() {
          witness();
          runSql(migrations.find(({ name }) => name === studentReceipt).bytes);
        },
        sql(source) {
          witness();
          return runSql(source);
        },
      };
      studentTargets.add(transport);
      return Object.freeze(transport);
    },
    enableHook() {
      cliCommand(['stop', '--project-id', id, '--workdir', root]);
      start(true);
    },
    status(observe = () => {}) {
      observe('status-command', 'entered');
      const output = cliCommand(['status', '--workdir', root, '-o', 'json']);
      observe('status-command', 'passed');
      observe('status-json', 'entered');
      const status = JSON.parse(output);
      observe('status-json', 'passed');
      observe('status-origin', 'entered');
      assert.equal(new URL(status.API_URL).hostname, '127.0.0.1');
      assert.equal(new URL(status.API_URL).port, '58321');
      observe('status-origin', 'passed');
      return status;
    },
    sql(sql) {
      return docker(
        [
          'exec',
          '-i',
          `supabase_db_${id}`,
          'psql',
          '-X',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-At',
          '-v',
          'ON_ERROR_STOP=1',
        ],
        sql,
      ).trim();
    },
    logsContain(values) {
      const result = spawnSync('docker', ['logs', `supabase_auth_${id}`], {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, ...dockerEnvironment },
      });
      if (result.status !== 0 || result.error || result.signal)
        throw new Error('Auth log inspection unavailable.');
      const logs = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      return values.some((value) => value && logs.includes(value));
    },
    close() {
      if (started) cliCommand(['stop', '--no-backup', '--project-id', id, '--workdir', root]);
      started = false;
      if (ownsNetwork) docker(['network', 'rm', freshStudent ? networkId : network]);
      if (
        freshStudent &&
        (ownedContainers().length ||
          ownedVolumes().length ||
          docker(['network', 'ls', '--format', '{{.Name}}']).split(/\s+/).includes(network))
      )
        throw new Error('Local Student resources remain.');
      assert.ok(!docker(['ps', '-a', '--format', '{{.Names}}']).includes(id));
      assert.ok(!docker(['volume', 'ls', '--format', '{{.Name}}']).includes(id));
      assert.equal(digest(readFileSync('supabase/config.toml')), original);
      assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
      rmSync(root, { recursive: true, force: true });
    },
  };
}
