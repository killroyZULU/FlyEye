import { describe, expect, it, vi } from 'vitest';
import { withFactorTransportDiagnostics } from './provider-transport-diagnostics.mjs';
import { fixtureDiagnostic, fixtureDiagnosticLines } from './fixture-diagnostics.mjs';

const apiUrl = 'http://127.0.0.1:54321';
const factorPath = '/auth/v1/factors/00000000-0000-4000-8000-000000000000/challenge';
const secret = 'private-provider-message-token-url';
function context() {
  return { input: apiUrl + factorPath, apiUrl, method: 'POST', report: vi.fn() };
}

describe('provider factor transport diagnostics', () => {
  it.each([
    ['ECONNREFUSED', 'transport-connection-refused'],
    ['ECONNRESET', 'transport-connection-reset'],
    ['UND_ERR_SOCKET', 'transport-socket-closed'],
    ['ENOTFOUND', 'transport-dns-failed'],
    ['EAI_AGAIN', 'transport-dns-failed'],
    ['UND_ERR_CONNECT_TIMEOUT', 'transport-timeout'],
    ['UND_ERR_HEADERS_TIMEOUT', 'transport-timeout'],
    ['UND_ERR_BODY_TIMEOUT', 'transport-timeout'],
    ['ERR_INVALID_URL', 'transport-invalid-request'],
    ['ERR_INVALID_ARG_TYPE', 'transport-invalid-request'],
    ['ERR_INVALID_CHAR', 'transport-invalid-request'],
    [secret, 'transport-unknown'],
  ])('classifies %s without copying the native error or retrying', async (code, expected) => {
    const error = new TypeError(secret, { cause: Object.assign(new Error(secret), { code }) });
    const operation = vi.fn().mockRejectedValue(error);
    const options = context();
    await expect(withFactorTransportDiagnostics(operation, options)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
    expect(options.report).toHaveBeenCalledExactlyOnceWith(expected);
    const line = fixtureDiagnostic('FEAT-003', 'provider-transport', 'failed', expected);
    expect(fixtureDiagnosticLines('FEAT-003', `${line}\n${secret}`)).toEqual([line]);
    expect(line).not.toContain(secret);
  });
  it.each(['AbortError', 'TimeoutError'])('retains %s without retry', async (name) => {
    const error = Object.assign(new Error(secret), { name });
    const options = context();
    await expect(withFactorTransportDiagnostics(() => Promise.reject(error), options)).rejects.toBe(
      error,
    );
    expect(options.report).toHaveBeenCalledWith(
      name === 'AbortError' ? 'transport-aborted' : 'transport-timeout',
    );
  });
  it.each([200, 404, 502])(
    'does not classify or consume an HTTP %i response as a transport failure',
    async (status) => {
      const response = Response.json({ private: secret }, { status });
      const options = context();
      const operation = vi.fn().mockResolvedValue(response);
      expect(await withFactorTransportDiagnostics(operation, options)).toBe(response);
      expect(response.bodyUsed).toBe(false);
      expect(options.report).not.toHaveBeenCalled();
      expect(operation).toHaveBeenCalledOnce();
    },
  );
  it.each([
    { input: 'https://foreign.invalid' + factorPath },
    { input: apiUrl + '/auth/v1/token' },
    { input: apiUrl + '/functions/v1/organization-admin-onboarding' },
    { input: secret },
    { method: 'GET' },
  ])('does not observe an unrelated request: %j', async (override) => {
    const error = new Error(secret);
    const options = { ...context(), ...override };
    await expect(withFactorTransportDiagnostics(() => Promise.reject(error), options)).rejects.toBe(
      error,
    );
    expect(options.report).not.toHaveBeenCalled();
  });
  it('matches Request/URL inputs and the verify endpoint without printing identifiers', async () => {
    for (const input of [
      new Request(apiUrl + factorPath),
      new URL((apiUrl + factorPath).replace('challenge', 'verify')),
    ]) {
      const options = { ...context(), input };
      await expect(
        withFactorTransportDiagnostics(() => Promise.reject(new Error(secret)), options),
      ).rejects.toThrow(secret);
      expect(options.report).toHaveBeenCalledExactlyOnceWith('transport-unknown');
    }
  });
  it('bounds cyclic causes and preserves the original failure when diagnostics throw', async () => {
    const error = new Error(secret);
    error.cause = error;
    const options = context();
    await expect(withFactorTransportDiagnostics(() => Promise.reject(error), options)).rejects.toBe(
      error,
    );
    expect(options.report).toHaveBeenCalledExactlyOnceWith('transport-unknown');
    options.report.mockImplementation(() => {
      throw new Error('diagnostic failure');
    });
    await expect(withFactorTransportDiagnostics(() => Promise.reject(error), options)).rejects.toBe(
      error,
    );
    Object.defineProperty(error, 'code', {
      get() {
        throw new Error(secret);
      },
    });
    await expect(withFactorTransportDiagnostics(() => Promise.reject(error), options)).rejects.toBe(
      error,
    );
  });
});
