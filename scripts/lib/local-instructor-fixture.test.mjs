// @vitest-environment node
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { expect, it, vi, beforeEach } from 'vitest';
import { localInstructorFixture } from './local-instructor-fixture.mjs';
import { createNoSendHttpClient } from './no-send-http-client.mjs';
import { isHeldLocalFixtureJournal } from './local-student-journal.mjs';
import { isOwnedLocalStudentTarget } from './no-send-local-project.mjs';
import { setup, now, id, intent, receipts, phases } from './local-instructor-test-data.mjs';

vi.mock('./no-send-http-client.mjs', () => ({ createNoSendHttpClient: vi.fn() }));
vi.mock('./no-send-local-project.mjs', () => ({ isOwnedLocalStudentTarget: vi.fn() }));
vi.mock('./local-student-journal.mjs', async (original) => ({
  ...(await original()),
  isHeldLocalFixtureJournal: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  isOwnedLocalStudentTarget.mockReturnValue(true);
  isHeldLocalFixtureJournal.mockReturnValue(true);
});

function harness() {
  const records = new Map();
  const journal = {
    runId: intent.runId,
    check: vi.fn(),
    bindInstance: vi.fn(),
    read: (key) => structuredClone(records.get(key) ?? null),
    record: (key, value) => {
      expect(records.has(key)).toBe(false);
      records.set(key, structuredClone(value));
    },
  };
  const { target, witness } = setup(0)[1];
  const { systemId, instance } = target;
  const rawWitness = {
    systemId,
    instance,
    daemon: witness.daemon,
    network: witness.network,
    containers: witness.containers,
  };
  const h = { stage: 0, alter: () => {}, fault: null, lastToken: null };
  const journalIntent = () => records.get('instructor-intent').intent;
  function mappedInventory() {
    const known = setup(h.stage)[1].inventory;
    const current = records.get('instructor-intent')?.intent;
    if (!current) return known;
    const map = Object.fromEntries(
      Object.entries(intent)
        .filter(([k]) => typeof intent[k] === 'string')
        .map(([k, v]) => [v, current[k]]),
    );
    return JSON.parse(JSON.stringify(known), (_k, v) =>
      typeof v === 'string' ? (map[v] ?? v) : v,
    );
  }
  const writes = [];
  const transport = {
    instructorWitness: vi.fn(() => structuredClone(rawWitness)),
    instructorKeys: vi.fn(() => ({
      publicKey: 'synthetic-public',
      serviceKey: 'synthetic-private',
    })),
    sql: vi.fn((source) => {
      if (!source.includes('read only')) {
        writes.push(source);
        expect(records.has('instructor-pending-' + h.stage)).toBe(true);
        const encoded = source.match(/convert_from\(decode\('([0-9a-f]+)','hex'\),'UTF8'\)::jsonb/);
        const expected = JSON.parse(Buffer.from(encoded[1], 'hex').toString('utf8'));
        const locked = mappedInventory();
        expect(expected).toEqual(locked);
        if (h.fault === 'locked-drift') locked.users[0].createOperationId = id(87);
        if (!isDeepStrictEqual(expected, locked)) throw new Error('synthetic transaction rejected');
        h.stage++;
        return '';
      }
      const inventory = mappedInventory();
      const actorId =
        h.stage === 5
          ? journalIntent().candidateId
          : records.get('instructor-intent')?.intent.adminId;
      const privileged = h.stage === 6;
      const actor = source.includes("fixture.session_id = '" + id(17) + "'")
        ? {
            sessionId: id(17),
            userId: actorId,
            notAfter: null,
            assurance: privileged ? 'aal2' : 'aal1',
            sessionFactorHash: privileged ? receipts[4].factorHash : null,
            totpMethod: privileged,
            passwordMethod: true,
            bindingSessionId: id(17),
            bindingUserId: actorId,
            boundFactorHash: privileged ? receipts[4].factorHash : null,
            canAssignRole: privileged,
          }
        : null;
      const data = { systemId, nowSeconds: now, inventory, actor };
      h.alter(data);
      return JSON.stringify(data);
    }),
  };
  const close = vi.fn();
  const request = vi.fn(async (url, options) => {
    expect(new URL(url).origin).toBe('http://127.0.0.1:58321');
    if (url.endsWith('/admin/users')) {
      const body = JSON.parse(options.body);
      const candidate = h.stage === 0;
      const i = journalIntent();
      expect(records.has('instructor-pending-' + h.stage)).toBe(true);
      expect(body).toEqual({
        id: candidate ? i.candidateId : i.adminId,
        email: candidate ? 'instructor_pilot@school.invalid' : 'admin@school.invalid',
        password: 'synthetic-passphrase-for-fixture',
        email_confirm: true,
        app_metadata: {
          flyeye_fixture_create_operation: candidate ? i.candidateCreateId : i.adminCreateId,
        },
      });
      if (h.fault !== 'no-write') h.stage++;
      if (h.fault === 'lost-ack') throw new Error('synthetic-private-error');
      return { status: 200, body: { id: id(77) } };
    }
    expect(url.endsWith('/auth/v1/user')).toBe(true);
    expect(options.headers.authorization).toBe('Bearer ' + h.lastToken);
    const candidate = h.stage === 5;
    return {
      status: h.fault === 'provider-denial' ? 401 : 200,
      body: {
        id: candidate ? journalIntent().candidateId : journalIntent().adminId,
        email:
          h.fault === 'provider-address'
            ? 'wrong@school.invalid'
            : candidate
              ? 'instructor_pilot@school.invalid'
              : 'admin@school.invalid',
      },
    };
  });
  createNoSendHttpClient.mockImplementation(() => ({ request, close }));
  const privateSession = vi.fn(async ({ id: sub }) => {
    const privileged = h.stage === 6;
    const amr = [{ method: 'password', timestamp: now - 100 }];
    if (privileged) amr.push({ method: 'totp', timestamp: now });
    const claims = { sub, session_id: id(17), aal: privileged ? 'aal2' : 'aal1', amr };
    h.lastToken = [
      'fixture',
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      'synthetic',
    ].join('.');
    return h.lastToken;
  });
  const operator = {
    privateSession,
    passwordFor: vi.fn(async () => 'synthetic-passphrase-for-fixture'),
  };
  for (const phase of phases.slice(4))
    operator[phase] = vi.fn(async (_args, token) => {
      expect(token).toBe(h.lastToken);
      expect(records.has('instructor-pending-' + h.stage)).toBe(true);
      h.stage++;
    });
  const adapter = localInstructorFixture(transport, journal);
  const keys = Object.fromEntries(
    ['adminCompleteHash', 'enrollmentCompleteHash', 'assignmentKeyHash'].map((k) => [k, intent[k]]),
  );
  const initialize = () => adapter.initialize(keys);
  const advance = () => adapter.advance(operator);
  const until = async (n) => {
    await initialize();
    for (let index = 0; index < n; index++) await advance();
  };
  return Object.assign(h, {
    adapter,
    initialize,
    advance,
    until,
    rawWitness,
    transport,
    journal,
    records,
    request,
    close,
    operator,
    writes,
  });
}

it('reads the exact onboarded Admin without advancing or accepting a substituted receipt', async () => {
  const h = harness();
  await h.until(5);
  const stored = h.records.get('instructor-receipt-4');
  expect((await h.adapter.adminBrowserBinding()).receipt).toEqual(stored.receipt);
  stored.receipt.membershipId = id(89);
  await expect(h.adapter.adminBrowserBinding()).rejects.toThrow();
  expect(h.records.has('instructor-pending-5')).toBe(false);
  expect(h.writes).toHaveLength(2);
});

it('advances seven exact checkpoints with separate private readbacks and fixed Auth addresses', async () => {
  const h = harness();
  await h.until(7);
  expect(await h.advance()).toEqual({ decision: 'complete' });
  expect(h.writes).toHaveLength(2);
  expect(h.writes[0]).toContain("email = 'instructor_pilot@school.invalid'");
  expect(h.writes[0]).not.toContain("email = 'student_pilot@school.invalid'");
  expect(h.writes[1]).toContain('insert into public.authentication_events');
  for (const command of h.writes) {
    const lock = command.indexOf('lock table public.organizations');
    const recheck = command.indexOf("observed->'inventory'");
    expect(lock).toBeGreaterThan(0);
    expect(recheck).toBeGreaterThan(lock);
    expect(command.indexOf('insert into')).toBeGreaterThan(recheck);
    expect(command.lastIndexOf('commit;')).toBeGreaterThan(command.lastIndexOf('insert into'));
    expect(command).toContain('staging_private.student_fixture_receipts, auth.mfa_factors');
  }
  expect(h.operator[phases[6]]).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'assign_role',
      roleCode: 'instructor_pilot',
      expectedVersion: 1,
      reasonCode: 'responsibility_changed',
    }),
    h.lastToken,
  );
  expect(h.request).toHaveBeenCalledTimes(5);
  expect(h.close).toHaveBeenCalledTimes(5);
  expect(JSON.stringify([...h.records])).not.toMatch(
    /synthetic-private|synthetic-passphrase|Bearer |eyJ/,
  );
});
it('a lost creation acknowledgement reconciles by exact readback without a second request', async () => {
  const h = harness();
  await h.initialize();
  h.fault = 'lost-ack';
  await expect(h.advance()).rejects.toThrow('fixture stopped');
  expect(await h.advance()).toEqual({ decision: 'record', phase: phases[0] });
  expect(h.request).toHaveBeenCalledTimes(1);
});
it('a fabricated successful response and an empty readback cannot be acknowledged or replayed', async () => {
  const h = harness();
  await h.initialize();
  h.fault = 'no-write';
  await expect(h.advance()).rejects.toThrow('fixture stopped');
  await expect(h.advance()).rejects.toThrow('fixture stopped');
  expect(h.request).toHaveBeenCalledTimes(1);
  expect(h.records.has('instructor-receipt-0')).toBe(false);
});
it.each([
  [
    'fixed candidate address',
    1,
    (d) => {
      d.inventory.users[0].email = 'student_pilot@school.invalid';
    },
  ],
  [
    'server marker',
    1,
    (d) => {
      d.inventory.users[0].createOperationId = id(84);
    },
  ],
  [
    'cluster',
    1,
    (d) => {
      d.systemId = '5678';
    },
  ],
  ['duplicate subject', 2, (d) => d.inventory.users.push({ ...d.inventory.users[0] })],
  [
    'receipt',
    2,
    (d) => {
      d.inventory.candidateReceipts = [];
    },
  ],
  [
    'foreign role',
    4,
    (d) => {
      d.inventory.roles[0].schoolId = id(82);
    },
  ],
  [
    'audit',
    4,
    (d) => {
      d.inventory.events = [];
    },
  ],
  [
    'wrong factor',
    6,
    (d) => {
      d.inventory.factors[1].referenceHash = receipts[4].factorHash;
    },
  ],
  [
    'missing assignment audit',
    7,
    (d) => {
      d.inventory.events.pop();
    },
  ],
])('stops on mismatched %s before any further credentials or writes', async (_, stage, alter) => {
  const h = harness();
  await h.until(stage);
  h.alter = alter;
  const reads = h.request.mock.calls.length,
    writes = h.writes.length;
  const credentials = h.transport.instructorKeys.mock.calls.length;
  await expect(h.advance()).rejects.toThrow('fixture stopped');
  expect(h.writes).toHaveLength(writes);
  expect(h.request).toHaveBeenCalledTimes(reads);
  expect(h.transport.instructorKeys).toHaveBeenCalledTimes(credentials);
});
it.each([
  'provider-denial',
  'provider-address',
  'session-user',
  'binding-session',
  'retired-factor',
  'permission',
  'expired-session',
])('denies protected role dispatch for %s', async (fault) => {
  const h = harness();
  await h.until(6);
  h.fault = fault;
  h.alter = (d) => {
    if (!d.actor) return;
    if (fault === 'session-user') d.actor.userId = id(78);
    if (fault === 'binding-session') d.actor.bindingSessionId = id(78);
    if (fault === 'retired-factor') d.actor.boundFactorHash = receipts[5].factorHash;
    if (fault === 'permission') d.actor.canAssignRole = false;
    if (fault === 'expired-session') d.actor.notAfter = now;
  };
  await expect(h.advance()).rejects.toThrow('fixture stopped');
  expect(h.operator[phases[6]]).not.toHaveBeenCalled();
  expect(h.records.has('instructor-pending-6')).toBe(false);
});
it.each(['unowned', 'lost-lock', 'journal-hole', 'changed-network', 'foreign-student-intent'])(
  'cannot load credentials for %s',
  async (fault) => {
    const h = harness();
    await h.initialize();
    if (fault === 'unowned') isOwnedLocalStudentTarget.mockReturnValue(false);
    if (fault === 'lost-lock') isHeldLocalFixtureJournal.mockReturnValue(false);
    if (fault === 'journal-hole')
      h.records.set('instructor-pending-4', { runId: intent.runId, phase: phases[4] });
    if (fault === 'changed-network') h.rawWitness.network = '0'.repeat(64);
    if (fault === 'foreign-student-intent') h.records.set('intent', {});
    await expect(h.advance()).rejects.toThrow('fixture stopped');
    expect(h.transport.instructorKeys).not.toHaveBeenCalled();
  },
);
it.each([1, 3])(
  'preserves the write intent and never repeats a failed transaction at phase %i',
  async (stage) => {
    const h = harness();
    await h.until(stage);
    h.fault = 'locked-drift';
    await expect(h.advance()).rejects.toThrow('fixture stopped');
    const count = h.writes.length;
    await expect(h.advance()).rejects.toThrow('fixture stopped');
    expect(h.records.has('instructor-pending-' + stage)).toBe(true);
    expect(h.stage).toBe(stage);
    expect(h.records.has('instructor-receipt-' + stage)).toBe(false);
    expect(h.writes).toHaveLength(count);
  },
);

it('reads the separate server-owned inventories in a single read-only SQL snapshot', () => {
  const sql = readFileSync(
    new URL('../sql/local-instructor-evidence.sql', import.meta.url),
    'utf8',
  );
  for (const source of [
    'auth.users',
    'auth.sessions',
    'auth.mfa_amr_claims',
    'auth.mfa_factors',
    'public.admin_session_factor_bindings',
    'public.organization_admin_bootstrap_grants',
    'public.organization_memberships',
    'public.organization_member_profiles',
    'public.membership_roles',
    'staging_private.student_fixture_receipts',
    'public.member_mfa_enrollment_operations',
    'public.member_mfa_readiness',
    'public.authentication_events',
    'public.member_administration_events',
    'public.member_administration_actor_is_authorized',
    'pg_catalog.pg_control_system()',
  ])
    expect(sql).toContain(source);
  expect(sql).toContain("raw_app_meta_data->>'flyeye_fixture_create_operation'");
  expect(sql).not.toMatch(
    /raw_user_meta_data|encrypted_password|\bsecret\b|select\s+\*|\b(insert|update|delete|call)\b/i,
  );
});
