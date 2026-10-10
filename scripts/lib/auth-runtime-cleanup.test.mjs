import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  authCleanupScope,
  authScopeSql,
  checkedRuntimeSql,
  onboardingCleanupSecret,
  preflightAuthCleanup,
} from './auth-runtime-scope.mjs';
import {
  cleanupAuthRuntime,
  runAuthFixture,
  authFrontendShutdown,
} from './auth-runtime-cleanup.mjs';
import { createFixtureDiagnostics } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

const identities = [1, 2].map((n) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  email: `runtime-${n}@example.test`,
}));
const organizationId = '00000000-0000-4000-8000-000000000003';
const extraId = '00000000-0000-4000-8000-000000000004';
const secret = 'synthetic-unit-ownership-material-0000000000';
const scope = () =>
  authCleanupScope({
    identities,
    organizationId,
    extraEmails: ['blocked-run@example.test'],
    limiterSecret: secret,
  });
const privateError = new Error('private-provider-token-or-sql');
function harness(failure, feature = 'FEAT-001') {
  const lines = [];
  let snapshotRead = false;
  const diagnostics = createFixtureDiagnostics(feature, {
    enabled: true,
    write: (line) => lines.push(line),
  });
  const options = {
    scope: scope(),
    diagnostics,
    psql: vi.fn((sql) => {
      if (sql.includes('jsonb_build_object')) {
        if (failure === 'discovery') throw privateError;
        return JSON.stringify({
          ids: [extraId],
          sessions: [identities[0].id],
          factors: [identities[1].id],
        });
      }
      if (sql.includes('jsonb_build_array')) {
        if (failure === 'inventory') throw privateError;
        if (snapshotRead && failure === 'foreign') return '["changed"]';
        snapshotRead = true;
        return '["foreign sentinel"]';
      }
      if (sql.startsWith('begin;')) {
        if (
          failure === 'sql' ||
          (failure === 'quota' && sql.includes('delete from public.admin_onboarding'))
        )
          throw privateError;
        return '';
      }
      if (sql.includes('from auth.audit_log_entries')) {
        if (failure === 'provider') throw privateError;
        return '3';
      }
      return failure === 'residue' ? '1' : '0';
    }),
    deleteUser: vi.fn(async (id) => {
      if (id === identities[0].id && failure === 'throw') throw privateError;
      return {
        error:
          id === identities[0].id && failure === 'auth'
            ? { status: 500, message: privateError.message }
            : null,
      };
    }),
    cleanMail: vi.fn(async () => {
      if (failure === 'mail') throw privateError;
    }),
    stopFrontend: vi.fn(async () => {
      if (failure === 'shutdown') throw privateError;
    }),
  };
  return {
    options,
    lines,
    run: () => diagnostics.run('fixture-cleanup', () => cleanupAuthRuntime(options)),
  };
}

describe('A026 Auth cleanup ownership and errors', () => {
  it('binds keys to exact subjects/actions and validates scope before I/O', () => {
    const owned = scope();
    expect(owned.limiterKeys[0]).toBe(
      createHmac('sha256', secret).update(`${identities[0].id}\u0000status`).digest('hex'),
    );
    expect(new Set(owned.limiterKeys).size).toBe(8);
    const sql = authScopeSql(owned);
    expect(sql.limiterCleanup).not.toMatch(/not in|where true/i);
    expect(sql.limiterCleanup).toContain(`limiter_key_hash in ('${owned.limiterKeys[0]}'`);
    for (const invalid of [
      [],
      [{ id: "'malformed", email: identities[0].email }],
      [{ id: identities[0].id, email: 'real@example.com' }],
    ]) {
      expect(() => authCleanupScope({ identities: invalid, organizationId })).toThrow();
    }
    const psql = vi.fn();
    expect(() => preflightAuthCleanup({ ...owned, ids: ["'invalid"] }, psql)).toThrow();
    expect(psql).not.toHaveBeenCalled();
  });

  it('requires the synthetic profile/policy/secret and never includes secrets in errors', () => {
    const environment = {
      FLYEYE_RUNTIME_PROFILE: 'local-synthetic-v1',
      FEAT003_DATA_CLASSIFICATION: 'synthetic-only',
      FEAT003_LIMITER_POLICY_VERSION: 'subject-action-v1',
      FEAT003_LIMITER_HMAC_SECRET: secret,
    };
    expect(onboardingCleanupSecret(environment)).toBe(secret);
    for (const key of Object.keys(environment)) {
      expect(() => onboardingCleanupSecret({ ...environment, [key]: 'private-invalid' })).toThrow(
        'ownership is unavailable',
      );
    }
  });

  it('stops SQL at its first error and redacts failed commands', () => {
    const execute = vi.fn(() => ({
      status: 1,
      stdout: privateError.message,
      stderr: privateError.message,
    }));
    expect(() => checkedRuntimeSql('synthetic query', true, execute)).toThrow(
      'Synthetic database operation failed.',
    );
    expect(execute.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['-X', '-v', 'ON_ERROR_STOP=1', '-At']),
    );
    execute.mockReturnValue({ status: null, error: privateError });
    expect(() => checkedRuntimeSql('query', false, execute)).toThrow(
      'Synthetic database operation failed.',
    );
    execute.mockReturnValue({ status: 0, stdout: '0\n' });
    expect(checkedRuntimeSql('query', true, execute)).toBe('0');
  });

  it('preflights all owned table/column predicates before seeding and refuses collisions/schema failure', () => {
    const psql = vi.fn(() => '0');
    preflightAuthCleanup(scope(), psql);
    const query = psql.mock.calls[0][0];
    for (const table of [
      'auth.users',
      'auth.sessions',
      'auth.identities',
      'auth.refresh_tokens',
      'auth.mfa_factors',
      'auth.mfa_challenges',
      'auth.mfa_amr_claims',
      'auth.flow_state',
      'auth.one_time_tokens',
    ])
      expect(query).toContain(table);
    psql.mockReturnValue('1');
    expect(() => preflightAuthCleanup(scope(), psql)).toThrow();
    psql.mockImplementation(() => {
      throw privateError;
    });
    expect(() => preflightAuthCleanup(scope(), psql)).toThrow();
  });

  it.each(['FEAT-001', 'FEAT-002'])(
    'emits only allowlisted %s cleanup evidence and preserves foreign state',
    async (feature) => {
      const { options, lines, run } = harness(undefined, feature);
      await run();
      expect(options.deleteUser.mock.calls.map(([id]) => id)).toEqual([
        ...identities.map((x) => x.id),
        extraId,
      ]);
      expect(options.cleanMail).toHaveBeenCalledWith([
        ...identities.map((x) => x.email),
        'blocked-run@example.test',
      ]);
      const queries = options.psql.mock.calls.map(([sql]) => sql);
      const residue = queries.find((sql) => sql.startsWith('select (select count'));
      expect(residue).toContain(`session_id::text in ('${identities[0].id}')`);
      expect(residue).toContain(`factor_id::text in ('${identities[1].id}')`);
      expect(residue).toContain(`'${extraId}'`);
      expect(queries.join('\n')).not.toContain('delete from auth.');
      expect(lines.at(-1)).toContain('stage=fixture-cleanup event=passed.');
      expect(
        runtimeDiagnosticLines(
          feature === 'FEAT-001' ? 'test-edge-runtime.mjs' : 'test-recovery-runtime.mjs',
          lines.join('\n'),
        ),
      ).toEqual(lines);
    },
  );

  it.each([
    'shutdown',
    'discovery',
    'inventory',
    'quota',
    'sql',
    'auth',
    'throw',
    'residue',
    'foreign',
    'mail',
    'provider',
  ])(
    'attempts every independent stage after %s failure and never reports success',
    async (failure) => {
      const { options, lines, run } = harness(failure);
      await expect(run()).rejects.toThrow('Synthetic Auth fixture cleanup failed.');
      for (const user of identities) expect(options.deleteUser).toHaveBeenCalledWith(user.id);
      expect(options.cleanMail).toHaveBeenCalledOnce();
      expect(
        options.psql.mock.calls.some(([sql]) => sql.includes('from auth.audit_log_entries')),
      ).toBe(true);
      expect(lines.join('\n')).not.toContain(privateError.message);
      expect(lines.at(-1)).toContain('stage=fixture-cleanup event=failed');
    },
  );

  it.each([false, true])(
    'accepts Auth 404 only with zero independent residue (residue=%s)',
    async (residue) => {
      const { options, run } = harness(residue ? 'residue' : undefined);
      options.deleteUser.mockResolvedValue({ error: { status: 404 } });
      if (residue) await expect(run()).rejects.toThrow('cleanup failed');
      else await run();
    },
  );
});

describe('A026 interrupted scenario propagation', () => {
  it.each(['scenario', 'cleanup', 'both', 'missed-probe'])(
    'does not turn %s failure into a successful fixture',
    async (failure) => {
      const { options, lines } = harness();
      const scenario = vi.fn(async () => {
        options.diagnostics.enter('authentication');
        if (['scenario', 'both'].includes(failure)) throw privateError;
      });
      const cleanup = vi.fn(async () => {
        if (['cleanup', 'both'].includes(failure)) throw privateError;
      });
      await expect(
        runAuthFixture({
          diagnostics: options.diagnostics,
          scenario,
          cleanup,
          probe: failure === 'missed-probe',
        }),
      ).rejects.toThrow('Synthetic Auth runtime fixture failed.');
      expect(cleanup).toHaveBeenCalledOnce();
      expect(lines.join('\n')).not.toContain(privateError.message);
    },
  );

  it.each([false, true])(
    'runs cleanup once after the normal or controlled interrupted checkpoint (probe=%s)',
    async (probe) => {
      const { options, lines } = harness();
      const after = vi.fn();
      const cleanup = vi.fn();
      await runAuthFixture({
        diagnostics: options.diagnostics,
        probe,
        cleanup,
        scenario: async (interrupt) => {
          options.diagnostics.enter('database-fixture');
          interrupt();
          after();
        },
      });
      expect(after).toHaveBeenCalledTimes(probe ? 0 : 1);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(lines.at(-1)).toContain('stage=fixture-cleanup event=passed');
    },
  );
});

it('keeps uncertain browser/server shutdown in the final cleanup result while attempting other stages', async () => {
  const { options, lines } = harness();
  const shutdown = authFrontendShutdown();
  options.stopFrontend = () => shutdown.assertStopped();
  await expect(
    runAuthFixture({
      diagnostics: options.diagnostics,
      scenario: async () => {
        options.diagnostics.enter('authentication');
        try {
          await shutdown.stop(async () => {
            throw privateError;
          });
        } finally {
          await shutdown.stop(async () => {});
        }
      },
      cleanup: () => cleanupAuthRuntime(options),
    }),
  ).rejects.toThrow('fixture failed');
  expect(options.cleanMail).toHaveBeenCalledOnce();
  expect(options.deleteUser).toHaveBeenCalledTimes(3);
  expect(lines.join('\n')).toContain('stage=cleanup-edge-shutdown event=failed');
  expect(lines.at(-1)).toContain('stage=fixture-cleanup event=failed');
  expect(lines.join('\n')).not.toContain('stage=fixture-cleanup event=passed');
});
