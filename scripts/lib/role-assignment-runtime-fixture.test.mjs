import { describe, expect, it, vi } from 'vitest';
import { createFixtureDiagnostics } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';
import {
  cleanupRoleAssignmentRuntime,
  runRoleAssignmentFixture,
} from './role-assignment-runtime-fixture.mjs';

const identities = [1, 2, 3].map((number) => ({
  id: `00000000-0000-4000-8000-00000000000${number}`,
  email: `role-${number}-111111111111@example.test`,
}));
const privateError = new Error('private-provider-response');

function harness(failure) {
  const lines = [];
  const diagnostics = createFixtureDiagnostics('FEAT-006B', {
    enabled: true,
    write: (line) => lines.push(line),
  });
  const options = {
    diagnostics,
    psql: vi.fn((sql) => {
      if (failure === 'database' && sql.startsWith('begin;')) throw privateError;
      if (failure === 'assertion-query' && sql.startsWith('select')) throw privateError;
      return failure === 'residue' ? '1' : '0';
    }),
    deleteUser: vi.fn(async (id) => {
      if (failure === 'auth-throw' && id === identities[0].id) throw privateError;
      return { error: failure === 'auth' && id === identities[0].id ? { status: 500 } : null };
    }),
    stopEdge: vi.fn(async () => {
      if (failure === 'shutdown') throw privateError;
    }),
    removeTemporaryFiles: vi.fn(async () => {
      if (failure === 'files') throw privateError;
    }),
    organizationId: '00000000-0000-4000-8000-000000000004',
    identities,
    limiterKeys: new Set(['a'.repeat(64)]),
  };
  return { options, lines, cleanup: () => cleanupRoleAssignmentRuntime(options) };
}

describe('role assignment fixture cleanup', () => {
  it('deletes and checks only exact-run database, limiter and Auth resources', async () => {
    const { options, cleanup, lines } = harness();
    await cleanup();
    expect(options.deleteUser.mock.calls.map(([id]) => id)).toEqual(identities.map(({ id }) => id));
    const [deletion, residue] = options.psql.mock.calls.map(([sql]) => sql);
    for (const table of [
      'member_administration_events',
      'member_administration_rate_limit_events',
      'member_administration_rate_limit_state',
      'member_mfa_readiness',
      'authentication_events',
      'organization_member_profiles',
      'membership_roles',
      'organization_memberships',
      'aircraft_document_categories',
      'organizations',
    ]) {
      expect(deletion).toContain(`delete from public.${table} where `);
      expect(residue).toContain(`select count(*) from public.${table} where `);
    }
    expect(deletion).toContain(`limiter_key_hash in ('${'a'.repeat(64)}')`);
    expect(deletion).toContain(`organization_id = '${options.organizationId}'::uuid`);
    expect(residue).toContain('from auth.users where id in');
    for (const { id, email } of identities) {
      expect(deletion).toContain(`'${id}'`);
      expect(residue).toContain(`'${email}'`);
    }
    expect(deletion + residue).not.toMatch(/\blike\b|222222222222/i);
    expect(runtimeDiagnosticLines('test-feat-006b-runtime.mjs', lines.join('\n'))).toEqual(lines);
  });

  it.each(['shutdown', 'database', 'auth', 'auth-throw', 'assertion-query', 'residue', 'files'])(
    'continues every independent cleanup step after %s failure and fails closed',
    async (failure) => {
      const { options, cleanup, lines } = harness(failure);
      await expect(options.diagnostics.run('fixture-cleanup', cleanup)).rejects.toThrow(
        'cleanup failed',
      );
      expect(options.stopEdge).toHaveBeenCalledOnce();
      expect(options.psql).toHaveBeenCalledTimes(2);
      expect(options.deleteUser).toHaveBeenCalledTimes(3);
      expect(options.removeTemporaryFiles).toHaveBeenCalledOnce();
      expect(lines.at(-1)).toContain('stage=fixture-cleanup event=failed');
      expect(lines).not.toContain(
        'FEAT-006B runtime diagnostic: stage=fixture-cleanup event=passed.',
      );
      expect(lines.join('\n')).not.toContain(privateError.message);
    },
  );

  it('never broadens limiter deletion when no request was made', async () => {
    const { options, cleanup } = harness();
    options.limiterKeys.clear();
    await cleanup();
    expect(options.psql.mock.calls[0][0]).toContain(
      'delete from public.member_administration_rate_limit_state where false;',
    );
    expect(options.psql.mock.calls[0][0]).toContain(
      'delete from public.member_administration_rate_limit_events where false;',
    );
  });

  it('requires independent zero-residue evidence even for already absent Auth users', async () => {
    const passed = harness();
    passed.options.deleteUser.mockResolvedValue({ error: { status: 404 } });
    await passed.cleanup();
    const failed = harness('residue');
    failed.options.deleteUser.mockResolvedValue({ error: { status: 404 } });
    await expect(failed.cleanup()).rejects.toThrow('cleanup failed');
  });
});

describe('role assignment fixture completion', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'publishes success only after scenario failure=%s and cleanup failure=%s are resolved',
    async (scenarioFails, cleanupFails) => {
      const { options, cleanup, lines } = harness(cleanupFails ? 'shutdown' : undefined);
      const onSuccess = vi.fn(() => {
        expect(lines.at(-1)).toBe(
          'FEAT-006B runtime diagnostic: stage=fixture-cleanup event=passed.',
        );
      });
      const result = runRoleAssignmentFixture({
        diagnostics: options.diagnostics,
        run: async () => {
          options.diagnostics.enter('actor-totp-verify');
          if (scenarioFails) throw privateError;
        },
        cleanup,
        onSuccess,
      });
      if (scenarioFails || cleanupFails) {
        await expect(result).rejects.toThrow(
          scenarioFails && cleanupFails ? 'scenario and cleanup failed' : 'failed',
        );
        expect(onSuccess).not.toHaveBeenCalled();
      } else {
        await result;
        expect(onSuccess).toHaveBeenCalledOnce();
      }
      expect(lines.join('\n')).toContain(
        `stage=actor-totp-verify event=${scenarioFails ? 'failed' : 'passed'}`,
      );
      expect(lines.join('\n')).toContain(
        `stage=fixture-cleanup event=${cleanupFails ? 'failed' : 'passed'}`,
      );
      expect(lines.join('\n')).not.toContain(privateError.message);
    },
  );

  it('retains fixed server-response categories while rejecting private or mismatched output', async () => {
    const { options, lines } = harness();
    options.diagnostics.enter('role-assignment');
    await options.diagnostics.readResponse(
      Response.json(
        { error: { code: 'member_administration.audit_failed' }, private: privateError.message },
        { status: 500 },
      ),
    );
    options.diagnostics.fail(privateError);
    expect(lines.join('\n')).toContain('detail=audit-failed');
    const valid = lines.at(-1);
    expect(
      runtimeDiagnosticLines(
        'test-feat-006b-runtime.mjs',
        [
          ...lines,
          `${valid} private`,
          valid.replace('role-assignment', 'private-token'),
          valid.replace('unclassified', 'private-token'),
          valid.replace('FEAT-006B', 'FEAT-005'),
          privateError.message,
        ].join('\n'),
      ),
    ).toEqual(lines);
  });
});
