import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requestSchema } from '../../supabase/functions/member-invitations/contracts.ts';
import { postgresSession, waitForSql } from './h002-postgres-session.mjs';
import { snapshot } from './invitation-recipient-state.mjs';
import { commandWins } from './invitation-recipient-runtime.mjs';
import { recipientResult, releaseRecipientSessions } from './invitation-recipient-locks.mjs';
import { createFixtureDiagnostics } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

vi.mock('./h002-postgres-session.mjs', () => ({
  postgresSession: vi.fn(),
  waitForSql: vi.fn(),
}));
vi.mock('./invitation-recipient-state.mjs', async (original) => ({
  ...(await original()),
  snapshot: vi.fn(),
}));

function fixture() {
  const lines = [];
  const blocker = { query: vi.fn().mockResolvedValue(''), close: vi.fn().mockResolvedValue() };
  const observer = { query: vi.fn().mockResolvedValue('0'), close: vi.fn().mockResolvedValue() };
  postgresSession.mockImplementation((name) => (name.endsWith('blocker') ? blocker : observer));
  const context = {
    psql: vi.fn().mockReturnValue('0'),
    diagnostics: createFixtureDiagnostics('FEAT-004', {
      enabled: true,
      write: (line) => lines.push(line),
    }),
    invoke: vi.fn().mockResolvedValue({ response: { status: 200 }, payload: {} }),
    register: vi.fn(),
    organization: 'synthetic-organization',
    server: { auth: { admin: { updateUserById: vi.fn() } } },
  };
  return { blocker, observer, context, lines };
}

beforeEach(() => {
  vi.resetAllMocks();
  snapshot.mockReturnValue({});
  waitForSql.mockResolvedValue();
});

describe('recipient owned-session cleanup and sanitized diagnostics', () => {
  it('does not create SQL sessions when the pre-lock snapshot fails', async () => {
    const { context, lines } = fixture();
    const error = new Error('private snapshot payload');
    snapshot.mockImplementation(() => {
      throw error;
    });
    await expect(commandWins(context, { id: 'actor' }, {}, 'invitation')).rejects.toBe(error);
    expect(postgresSession).not.toHaveBeenCalled();
    expect(lines.at(-1)).toContain('stage=recipient-before event=failed');
    expect(lines.join('\n')).not.toContain('private');
  });

  it('closes both sessions and checks absence after lock acquisition fails', async () => {
    const { context, blocker, observer, lines } = fixture();
    const error = new Error('private lock payload');
    blocker.query.mockRejectedValue(error);
    await expect(commandWins(context, { id: 'actor' }, {}, 'invitation')).rejects.toBe(error);
    expect(blocker.close).toHaveBeenCalledOnce();
    expect(observer.close).toHaveBeenCalledOnce();
    expect(context.psql).toHaveBeenCalledOnce();
    expect(lines.some((line) => line.includes('recipient-lock event=failed'))).toBe(true);
    expect(lines.at(-1)).toContain('recipient-session-absence event=passed');
    expect(runtimeDiagnosticLines('test-feat-004-runtime.mjs', lines.join('\n'))).toEqual(lines);
    expect(lines.join('\n')).not.toContain('private');
  });

  it('retains the observed-wait failure alongside cleanup failure and settles the request', async () => {
    const { context, blocker, observer, lines } = fixture();
    const waitError = new Error('private wait payload');
    const closeError = new Error('private close payload');
    waitForSql.mockRejectedValueOnce(waitError);
    blocker.close.mockRejectedValue(closeError);
    const failure = await commandWins(
      context,
      { id: 'actor' },
      { token: 'private' },
      'invitation',
    ).catch((error) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors[0]).toBe(waitError);
    expect(failure.errors[1].errors).toContain(closeError);
    expect(observer.close).toHaveBeenCalledOnce();
    expect(context.psql).toHaveBeenCalledOnce();
    expect(lines.some((line) => line.includes('recipient-command-response event=passed'))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes('recipient-command-wait event=failed'))).toBe(true);
    expect(lines.some((line) => line.includes('recipient-release event=failed'))).toBe(true);
    expect(lines.join('\n')).not.toContain('private');
  });

  it('sends a schema-valid acceptance request before observing the command wait', async () => {
    const { context, observer } = fixture();
    const invitation = randomUUID();
    const waitError = new Error('controlled wait interruption');
    context.invoke.mockImplementation(async (_token, body) => {
      expect(requestSchema.parse(body)).toEqual(body);
      expect(body.invitationId).toBe(invitation);
      return { response: { status: 200 }, payload: {} };
    });
    waitForSql.mockRejectedValueOnce(waitError);
    await expect(commandWins(context, { id: 'actor' }, {}, invitation)).rejects.toBe(waitError);
    expect(context.invoke).toHaveBeenCalledOnce();
    expect(observer.close).toHaveBeenCalledOnce();
  });

  it('preserves request errors internally without exposing payloads or skipping later cleanup', async () => {
    const { context, blocker, observer, lines } = fixture();
    const error = Object.assign(new Error('private provider payload'), {
      name: 'AuthRetryableFetchError',
      status: 0,
    });
    const tasks = [Promise.resolve({ error }), Promise.resolve({ value: { error: null } })];
    await expect(recipientResult(tasks[0])).rejects.toBe(error);
    await expect(
      releaseRecipientSessions(blocker, observer, tasks, [42], context.psql, context.diagnostics),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(observer.close).toHaveBeenCalledOnce();
    expect(context.psql).toHaveBeenCalledOnce();
    expect(
      lines.some((line) =>
        line.includes('recipient-command-response event=failed detail=transport-failed'),
      ),
    ).toBe(true);
    expect(lines.some((line) => line.includes('recipient-auth-response event=passed'))).toBe(true);
    expect(lines.at(-1)).toContain('recipient-session-absence event=passed');
    expect(lines.join('\n')).not.toContain('private');
  });

  it('classifies resolved SDK errors and still checks every later cleanup boundary', async () => {
    const { context, blocker, observer, lines } = fixture();
    const error = Object.assign(new Error('private resolved provider payload'), {
      name: 'AuthRetryableFetchError',
      status: 0,
    });
    const tasks = [
      Promise.resolve({ value: { response: { status: 200 } } }),
      Promise.resolve({ value: { data: null, error } }),
    ];
    const failure = await releaseRecipientSessions(
      blocker,
      observer,
      tasks,
      [42],
      context.psql,
      context.diagnostics,
    ).catch((caught) => caught);
    expect(failure.errors).toEqual([error]);
    expect(
      lines.some((line) =>
        line.includes('recipient-auth-response event=failed detail=transport-failed'),
      ),
    ).toBe(true);
    expect(observer.close).toHaveBeenCalledOnce();
    expect(context.psql).toHaveBeenCalledOnce();
    expect(lines.at(-1)).toContain('recipient-session-absence event=passed');
    expect(lines.join('\n')).not.toContain('private');
  });

  it.each(['idle', 'blocker', 'observer', 'absence'])(
    'continues cleanup after %s verification fails',
    async (stage) => {
      const { context, blocker, observer, lines } = fixture();
      const error = new Error('private cleanup payload');
      if (stage === 'idle') waitForSql.mockRejectedValue(error);
      if (stage === 'blocker') observer.query.mockResolvedValue('1');
      if (stage === 'observer') observer.close.mockRejectedValue(error);
      if (stage === 'absence') context.psql.mockReturnValue('1');
      await expect(
        releaseRecipientSessions(blocker, observer, [], [42], context.psql, context.diagnostics),
      ).rejects.toBeInstanceOf(AggregateError);
      expect(blocker.close).toHaveBeenCalledOnce();
      expect(observer.close).toHaveBeenCalledOnce();
      expect(context.psql).toHaveBeenCalledOnce();
      expect(lines.some((line) => line.includes('event=failed'))).toBe(true);
      expect(runtimeDiagnosticLines('test-feat-004-runtime.mjs', lines.join('\n'))).toEqual(lines);
      expect(lines.join('\n')).not.toContain('private');
    },
  );
});
