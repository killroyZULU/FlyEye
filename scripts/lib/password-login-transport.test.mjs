import { describe, expect, it, vi } from 'vitest';
import { withPasswordLoginTransportDiagnostics } from './provider-transport-diagnostics.mjs';
import { createFixtureDiagnostics, fixtureDiagnostic } from './fixture-diagnostics.mjs';
import { runtimeDiagnosticLines } from './runtime-diagnostics.mjs';

const apiUrl = 'http://127.0.0.1:54321';
const path = '/auth/v1/token?grant_type=password';
const privateText = 'private-credential-url-body';
const options = (extra = {}) => ({
  input: apiUrl + path,
  method: 'POST',
  apiUrl,
  report: vi.fn(),
  ...extra,
});

describe('churn password-login transport diagnostics', () => {
  it.each([
    ['ECONNRESET', 'transport-connection-reset'],
    ['UND_ERR_SOCKET', 'transport-socket-closed'],
    ['ECONNREFUSED', 'transport-connection-refused'],
    ['ENOTFOUND', 'transport-dns-failed'],
    ['UND_ERR_CONNECT_TIMEOUT', 'transport-timeout'],
    [privateText, 'transport-unknown'],
  ])(
    'reports only the fixed category for %s and preserves the one-shot failure',
    async (code, detail) => {
      const error = new TypeError(privateText, {
        cause: Object.assign(new Error(privateText), { code }),
      });
      const operation = vi.fn().mockRejectedValue(error);
      const context = options();
      await expect(withPasswordLoginTransportDiagnostics(operation, context)).rejects.toBe(error);
      expect(operation).toHaveBeenCalledOnce();
      expect(context.report).toHaveBeenCalledExactlyOnceWith(detail);
      const line = fixtureDiagnostic('FEAT-003', 'password-transport', 'failed', detail);
      expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', line)).toEqual([line]);
      expect(line).not.toContain(privateText);
    },
  );

  it.each([200, 400, 429, 503])(
    'preserves the exact HTTP %i response without reading its body',
    async (status) => {
      const response = Response.json({ private: privateText }, { status });
      const context = options();
      const operation = vi.fn().mockResolvedValue(response);
      expect(await withPasswordLoginTransportDiagnostics(operation, context)).toBe(response);
      expect(response.bodyUsed).toBe(false);
      expect(operation).toHaveBeenCalledOnce();
      expect(context.report).not.toHaveBeenCalled();
    },
  );

  it.each([
    { method: 'GET' },
    { input: apiUrl + '/auth/v1/token?grant_type=refresh_token' },
    { input: apiUrl + '/auth/v1/token' },
    { input: apiUrl + path + '&grant_type=refresh_token' },
    { input: apiUrl + '/auth/v1/factors/synthetic/challenge' },
    { input: apiUrl + '/functions/v1/organization-admin-onboarding' },
    { input: 'http://127.0.0.1:1234' + path },
    { input: 'https://foreign.invalid' + path },
    { input: 'https://foreign.invalid' + path, apiUrl: 'https://foreign.invalid' },
    { input: privateText },
  ])('does not observe unrelated requests: %j', async (extra) => {
    const error = new Error(privateText);
    const context = options(extra);
    const operation = vi.fn().mockRejectedValue(error);
    await expect(withPasswordLoginTransportDiagnostics(operation, context)).rejects.toBe(error);
    expect(context.report).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledOnce();
  });

  it('accepts Request and URL inputs without reading credentials or mutating request options', async () => {
    for (const input of [new URL(apiUrl + path), new Request(apiUrl + path)]) {
      const context = options({ input });
      const error = new Error(privateText);
      const signal = new AbortController().signal;
      const init = Object.freeze({ method: 'POST', body: privateText, signal });
      const fetch = vi.fn().mockRejectedValue(error);
      await expect(
        withPasswordLoginTransportDiagnostics(() => fetch(input, init), context),
      ).rejects.toBe(error);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(input, init);
      expect(context.report).toHaveBeenCalledExactlyOnceWith('transport-unknown');
    }
  });

  it('bounds cause traversal and never replaces the error if reporting fails', async () => {
    const error = new Error(privateText);
    error.cause = error;
    const context = options();
    context.report.mockImplementation(() => {
      throw new Error('report failure');
    });
    await expect(
      withPasswordLoginTransportDiagnostics(() => Promise.reject(error), context),
    ).rejects.toBe(error);
    expect(context.report).toHaveBeenCalledExactlyOnceWith('transport-unknown');
  });

  it('keeps the password stage failure distinct from successful cleanup', async () => {
    const lines = [];
    const diagnostics = createFixtureDiagnostics('FEAT-003', {
      enabled: true,
      write: (line) => lines.push(line),
    });
    diagnostics.enter('churn-password');
    diagnostics.fail({ name: 'AuthRetryableFetchError', status: 0, message: privateText });
    await diagnostics.run('fixture-cleanup', async () => {});
    expect(lines).toContain(
      fixtureDiagnostic('FEAT-003', 'churn-password', 'failed', 'transport-failed'),
    );
    expect(lines.at(-1)).toBe(fixtureDiagnostic('FEAT-003', 'fixture-cleanup', 'passed'));
    expect(runtimeDiagnosticLines('test-feat-003-runtime.mjs', lines.join('\n'))).toEqual(lines);
    expect(lines.join('\n')).not.toContain(privateText);
  });
});
