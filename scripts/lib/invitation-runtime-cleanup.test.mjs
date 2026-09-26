import { describe, expect, it, vi } from 'vitest';
import { cleanupInvitationRuntime, cleanInvitationMail } from './invitation-runtime-cleanup.mjs';
import { createFixtureDiagnostics } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

const admin = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'invite-admin-111111111111@example.test',
};
const existing = {
  id: '00000000-0000-4000-8000-000000000002',
  email: 'invite-existing-111111111111@example.test',
};
const recipientId = '00000000-0000-4000-8000-000000000003';
const recipientEmail = 'invite-recipient-111111111111@example.test';

function harness(failure) {
  const lines = [];
  const diagnostics = createFixtureDiagnostics('FEAT-004', {
    enabled: true,
    write: (line) => lines.push(line),
  });
  const error = new Error('private-provider-response');
  const options = {
    diagnostics,
    psql: vi.fn((sql) => {
      if (sql.includes('json_agg')) {
        if (failure === 'discovery') throw error;
        return JSON.stringify([admin.id, existing.id, recipientId]);
      }
      if (sql.includes('begin;')) {
        if (failure === 'database') throw error;
        return '';
      }
      return failure === 'residue' ? '1' : '0';
    }),
    deleteUser: vi.fn(async (id) => ({
      error: id === admin.id && failure === 'auth' ? { status: 500, message: error.message } : null,
    })),
    stopEdge: vi.fn(async () => {
      if (failure === 'shutdown') throw error;
    }),
    cleanMail: vi.fn(async () => {
      if (failure === 'mail') throw error;
    }),
    removeTemporaryFiles: vi.fn(async () => {
      if (failure === 'files') throw error;
    }),
    organizationId: '00000000-0000-4000-8000-000000000004',
    identities: [admin, existing],
    recipientEmail,
    limiterKeys: new Set(['a'.repeat(64)]),
    correlations: new Set(),
  };
  return {
    options,
    lines,
    run: () => diagnostics.run('fixture-cleanup', () => cleanupInvitationRuntime(options)),
  };
}

describe('invitation fixture cleanup evidence', () => {
  it('finds an issued recipient before callback and checks residue using exact current-run identities', async () => {
    const { options, lines, run } = harness();
    await run();
    expect(options.deleteUser.mock.calls.map(([id]) => id)).toEqual([
      admin.id,
      existing.id,
      recipientId,
    ]);
    const queries = options.psql.mock.calls.map(([sql]) => sql);
    expect(queries[0]).toContain(`'${recipientEmail}'`);
    expect(queries.join('\n')).not.toMatch(/\blike\b|invite-.*222222222222/i);
    expect(queries[1]).toContain('actor_user_id in');
    expect(queries[1]).toContain('member_invitation_rate_limit_events where limiter_key_hash in');
    expect(queries[2]).toContain('from auth.users');
    expect(queries[2]).toContain('from public.authentication_events');
    expect(options.cleanMail).toHaveBeenCalledWith([admin.email, existing.email, recipientEmail]);
    expect(lines.at(-1)).toBe('FEAT-004 runtime diagnostic: stage=fixture-cleanup event=passed.');
    expect(runtimeDiagnosticLines('test-feat-004-runtime.mjs', lines.join('\n'))).toEqual(lines);
  });

  it.each(['shutdown', 'discovery', 'database', 'auth', 'residue', 'mail', 'files'])(
    'continues independent cleanup after %s failure and never reports success',
    async (failure) => {
      const { options, lines, run } = harness(failure);
      await expect(run()).rejects.toThrow('fixture cleanup failed');
      expect(options.deleteUser).toHaveBeenCalledWith(admin.id);
      expect(options.deleteUser).toHaveBeenCalledWith(existing.id);
      expect(options.cleanMail).toHaveBeenCalledOnce();
      expect(options.removeTemporaryFiles).toHaveBeenCalledOnce();
      expect(options.psql.mock.calls.some(([sql]) => sql.includes('select count(*)'))).toBe(true);
      expect(lines).not.toContain(
        'FEAT-004 runtime diagnostic: stage=fixture-cleanup event=passed.',
      );
      expect(lines.at(-1)).toContain('stage=fixture-cleanup event=failed');
      expect(lines.join('\n')).not.toContain('private-provider-response');
    },
  );

  it('allows already absent Auth users only when the independent residue query also passes', async () => {
    const { options, run } = harness();
    options.deleteUser.mockResolvedValue({ error: { status: 404 } });
    await run();
    const failed = harness('residue');
    failed.options.deleteUser.mockResolvedValue({ error: { status: 404 } });
    await expect(failed.run()).rejects.toThrow('cleanup failed');
  });

  it('filters private payloads, unknown stages and another fixture from invitation evidence', () => {
    const valid =
      'FEAT-004 runtime diagnostic: stage=new-recipient-prepare event=failed detail=http-503.';
    expect(
      runtimeDiagnosticLines(
        'test-feat-004-runtime.mjs',
        [
          valid,
          `${valid} private`,
          valid.replace('new-recipient-prepare', 'private-token'),
          valid.replace('http-503', 'private'),
          valid.replace('FEAT-004', 'FEAT-005'),
          'AssertionError: private-provider-response',
        ].join('\n'),
      ),
    ).toEqual([valid]);
  });
});

const message = (ID, email) => ({ ID, To: [{ Address: email }] });
describe('invitation mailbox cleanup', () => {
  it('deletes only exact-run recipient messages across pages and verifies absence', async () => {
    const unrelated = message('unrelated', 'invite-recipient-222222222222@example.test');
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ messages: Array.from({ length: 100 }, () => unrelated) }),
      )
      .mockResolvedValueOnce(Response.json({ messages: [message('owned', recipientEmail)] }))
      .mockResolvedValueOnce(Response.json({ messages: [] }))
      .mockResolvedValueOnce(new Response('ok'))
      .mockResolvedValueOnce(Response.json({ messages: [unrelated] }))
      .mockResolvedValueOnce(Response.json({ messages: [] }));
    await cleanInvitationMail('http://127.0.0.1:54324', [recipientEmail], request);
    expect(request.mock.calls[1][0]).toContain('start=100');
    expect(request.mock.calls[2][0]).toContain('start=101');
    expect(JSON.parse(request.mock.calls[3][1].body)).toEqual({ IDs: ['owned'] });
  });
  it('never sends an empty deletion request that would delete the entire mailbox', async () => {
    const request = vi.fn().mockImplementation(async () => Response.json({ messages: [] }));
    await cleanInvitationMail('http://127.0.0.1:54324', [recipientEmail], request);
    expect(request.mock.calls.every(([, init]) => init.method !== 'DELETE')).toBe(true);
  });
  it.each(['delete-failure', 'residue', 'inventory-failure'])(
    'fails closed for %s',
    async (failure) => {
      const owned = { messages: [message('owned', recipientEmail)] };
      const request = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(owned, { status: failure === 'inventory-failure' ? 503 : 200 }),
        )
        .mockResolvedValueOnce(Response.json({ messages: [] }))
        .mockResolvedValueOnce(
          new Response('', { status: failure === 'delete-failure' ? 503 : 200 }),
        )
        .mockResolvedValueOnce(Response.json(owned))
        .mockResolvedValueOnce(Response.json({ messages: [] }));
      await expect(
        cleanInvitationMail('http://127.0.0.1:54324', [recipientEmail], request),
      ).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(
        failure === 'inventory-failure' ? 1 : failure === 'delete-failure' ? 3 : 5,
      );
    },
  );
  it('rejects remote targets before performing I/O', async () => {
    const request = vi.fn();
    await expect(
      cleanInvitationMail('https://remote.example.test', [recipientEmail], request),
    ).rejects.toThrow('loopback');
    expect(request).not.toHaveBeenCalled();
  });
});
