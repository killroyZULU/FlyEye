import { describe, expect, it, vi } from 'vitest';
import { runInactiveRoleProbe } from './feat-005-inactive-role-probe.mjs';
import { createFixtureDiagnostics, fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

const stages = ['disable', 'request', 'response', 'status', 'restore'];
const line = (phase, event, detail) =>
  fixtureDiagnostic('FEAT-005', `inactive-role-${phase}`, event, detail);

function fixture({ enabled = true, status = 404 } = {}) {
  const lines = [];
  const response = {
    status,
    json: vi.fn().mockResolvedValue({ error: { message: 'synthetic-private-response' } }),
  };
  const options = {
    diagnostics: createFixtureDiagnostics('FEAT-005', {
      enabled,
      write: (value) => lines.push(value),
    }),
    disableRole: vi.fn(),
    requestProfile: vi.fn().mockResolvedValue(response),
    restoreRole: vi.fn(),
  };
  return { lines, response, options };
}

function expectSafeOutput(lines) {
  expect(lines.join('\n')).not.toContain('synthetic-private');
  expect(
    runtimeDiagnosticLines(
      'test-feat-005-runtime.mjs',
      [...lines, 'Error: synthetic-private-token', `${lines[0]} synthetic-private-payload`].join(
        '\n',
      ),
    ),
  ).toEqual(lines);
}

describe('FEAT-005 inactive-role probe', () => {
  it('requires a decoded 404 response and restores the role after all five phases', async () => {
    const { options, response, lines } = fixture();
    await runInactiveRoleProbe(options);
    expect(options.disableRole).toHaveBeenCalledOnce();
    expect(options.requestProfile).toHaveBeenCalledOnce();
    expect(response.json).toHaveBeenCalledOnce();
    expect(options.restoreRole).toHaveBeenCalledOnce();
    expect(lines).toEqual(stages.flatMap((stage) => [line(stage, 'enter'), line(stage, 'passed')]));
    expectSafeOutput(lines);
  });

  it.each([
    ['disable', 'database-operation-failed'],
    ['request', 'transport-failed'],
    ['response', 'response-decoding-failed'],
    ['restore', 'database-operation-failed'],
  ])('identifies %s failures and still attempts restoration', async (phase, detail) => {
    const { options, response, lines } = fixture();
    const error = new Error('synthetic-private-database-or-provider-error');
    const operation = {
      disable: options.disableRole,
      request: options.requestProfile,
      response: response.json,
      restore: options.restoreRole,
    }[phase];
    operation.mockImplementation(() => {
      throw error;
    });
    await expect(runInactiveRoleProbe(options)).rejects.toBe(error);
    expect(options.restoreRole).toHaveBeenCalledOnce();
    expect(lines).toContain(line(phase, 'failed', detail));
    expect(lines).not.toContain(line(phase, 'passed'));
    if (phase !== 'restore') expect(lines.at(-1)).toBe(line('restore', 'passed'));
    for (const skipped of stages.slice(stages.indexOf(phase) + 1, -1)) {
      expect(lines).not.toContain(line(skipped, 'enter'));
    }
    if (phase === 'disable') expect(options.requestProfile).not.toHaveBeenCalled();
    if (['disable', 'request'].includes(phase)) expect(response.json).not.toHaveBeenCalled();
    expectSafeOutput(lines);
  });

  it('distinguishes request timeout from transport failure without retrying the probe', async () => {
    const { options, lines } = fixture();
    const error = new DOMException('synthetic-private-url', 'TimeoutError');
    options.requestProfile.mockRejectedValue(error);
    await expect(runInactiveRoleProbe(options)).rejects.toBe(error);
    expect(options.requestProfile).toHaveBeenCalledOnce();
    expect(options.restoreRole).toHaveBeenCalledOnce();
    expect(lines).toContain(line('request', 'failed', 'timeout'));
    expectSafeOutput(lines);
  });

  it.each([
    [200, 'assertion'],
    [403, 'http-403'],
    [503, 'http-503'],
    [418, 'http-other'],
  ])('retains the exact 404 expectation when the server returns %i', async (status, detail) => {
    const { options, lines } = fixture({ status });
    await expect(runInactiveRoleProbe(options)).rejects.toMatchObject({
      actual: status,
      expected: 404,
    });
    expect(lines).toContain(line('status', 'failed', detail));
    expect(lines).not.toContain(line('status', 'passed'));
    expect(lines.at(-1)).toBe(line('restore', 'passed'));
    expectSafeOutput(lines);
  });

  it('keeps bounded retry and malformed-response evidence in the correct phases', async () => {
    const { options, lines } = fixture();
    options.requestProfile.mockImplementation(async () => {
      options.diagnostics.retry(503);
      return new Response('synthetic-private-invalid-json', { status: 503 });
    });
    await expect(runInactiveRoleProbe(options)).rejects.toThrow();
    expect(lines).toContain(line('request', 'retry', 'http-503'));
    expect(lines).toContain(line('response', 'response', 'unknown-server-response'));
    expect(lines).toContain(line('response', 'failed', 'response-decoding-failed'));
    expect(lines).not.toContain(line('status', 'enter'));
    expect(options.restoreRole).toHaveBeenCalledOnce();
    expectSafeOutput(lines);
  });

  it('preserves both failures when restoration fails, even if outer cleanup succeeds', async () => {
    const { options, lines } = fixture();
    const primary = new TypeError('synthetic-private-request');
    const restoration = new Error('synthetic-private-sql');
    options.requestProfile.mockRejectedValue(primary);
    options.restoreRole.mockImplementation(() => {
      throw restoration;
    });
    await expect(runInactiveRoleProbe(options)).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [primary, restoration],
    });
    options.diagnostics.fail(new Error('synthetic-private-outer-error'));
    await options.diagnostics.run('fixture-cleanup', async () => {});
    expect(lines.filter((value) => value.includes('event=failed'))).toEqual([
      line('request', 'failed', 'transport-failed'),
      line('restore', 'failed', 'database-operation-failed'),
    ]);
    expect(lines).not.toContain(line('request', 'passed'));
    expect(lines).not.toContain(line('restore', 'passed'));
    expectSafeOutput(lines);
  });

  it('preserves failure and restoration semantics when logging is disabled', async () => {
    const { options, lines } = fixture({ enabled: false });
    const error = new Error('synthetic-private-error');
    options.disableRole.mockImplementation(() => {
      throw error;
    });
    await expect(runInactiveRoleProbe(options)).rejects.toBe(error);
    expect(options.restoreRole).toHaveBeenCalledOnce();
    expect(options.requestProfile).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
});
