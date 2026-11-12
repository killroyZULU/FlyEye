// @vitest-environment node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createNoSendRegressionDiagnostic } from './no-send-regression-diagnostic.mjs';

const canary = 'synthetic-private-value-must-not-be-reported';
describe('bounded regression diagnostic', () => {
  it('is inactive outside the regression block and clears stale observations', () => {
    const observer = createNoSendRegressionDiagnostic();
    observer.mark('login-status');
    observer.response({ status: 400, body: { error_code: 'invalid_credentials' } });
    expect(observer.snapshot()).toEqual({});
    observer.start();
    observer.mark('wrong-password-code');
    observer.response({ status: 400, body: { error_code: 'invalid_credentials', code: 400 } });
    expect(observer.snapshot().regressionDiagnostic).toEqual({
      checkpoint: 'wrong-password-code',
      httpStatus: 400,
      errorCodeField: 'legacy',
      errorCategory: 'invalid_credentials',
    });
    observer.mark('enroll-request');
    expect(observer.snapshot().regressionDiagnostic).toEqual({
      checkpoint: 'enroll-request',
      httpStatus: null,
      errorCodeField: 'unobserved',
      errorCategory: 'unknown',
    });
    observer.stop();
    expect(observer.snapshot()).toEqual({});
    observer.start();
    expect(observer.snapshot().regressionDiagnostic.checkpoint).toBe('unknown');
  });

  it.each([
    [{ error_code: 'mfa_verification_failed' }, 'legacy', 'mfa_verification_failed'],
    [{ code: 'invalid_credentials' }, 'versioned', 'invalid_credentials'],
    [{ code: 'invalid_credentials', error_code: 'invalid_credentials' }, 'ambiguous', 'unknown'],
    [{ error_code: canary }, 'legacy', 'unknown'],
    [{ code: canary }, 'versioned', 'unknown'],
    [{ error_code: { secret: canary } }, 'absent', 'unknown'],
    [null, 'absent', 'unknown'],
  ])(
    'classifies response fields without copying unrestricted values (%#)',
    (body, field, category) => {
      const observer = createNoSendRegressionDiagnostic();
      observer.start();
      observer.mark(canary);
      observer.response({ status: 422, body });
      expect(observer.snapshot().regressionDiagnostic).toEqual({
        checkpoint: 'unknown',
        httpStatus: 422,
        errorCodeField: field,
        errorCategory: category,
      });
      expect(JSON.stringify(observer.snapshot())).not.toContain(canary);
    },
  );

  it('ignores secrets and unsafe properties; unreadable evidence stays unknown', () => {
    const observer = createNoSendRegressionDiagnostic();
    observer.start();
    const body = Object.freeze({
      error_code: 'invalid_credentials',
      access_token: canary,
      refresh_token: canary,
      password: canary,
      totp: { secret: canary },
      email: canary,
      get message() {
        throw new Error(canary);
      },
      toJSON() {
        throw new Error(canary);
      },
    });
    observer.response(Object.freeze({ status: canary, body }));
    expect(observer.snapshot().regressionDiagnostic.httpStatus).toBeNull();
    expect(JSON.stringify(observer.snapshot())).not.toContain(canary);
    observer.response({
      status: 400,
      get body() {
        throw new Error(canary);
      },
    });
    expect(observer.snapshot().regressionDiagnostic.errorCodeField).toBe('unreadable');
    expect(observer.snapshot().regressionDiagnostic.errorCategory).toBe('unknown');
  });
});

// Execute the real helper and regression statements against in-memory replies.
// Do not import the executable harness or its Docker/project/client dependencies.
const source = readFileSync(
  new URL('../test-staging-no-send-runtime.mjs', import.meta.url),
  'utf8',
);
const helpers = source.slice(
  source.indexOf('async function api('),
  source.indexOf('function loadStatus('),
);
const block = source.slice(
  source.indexOf("  stage = 'password-totp-regression';"),
  source.indexOf("  stage = 'hook-failure-setup';"),
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction(
  'assert',
  'client',
  'regressionDiagnostic',
  'delay',
  'beforeRequest',
  'enrollmentOnly',
  'emit',
  `
  let stage, lastStatus, lastMailCount;
  const status = { API_URL: 'http://127.0.0.1:58321', ANON_KEY: 'synthetic', SERVICE_ROLE_KEY: 'synthetic' };
  const retain = value => value;
  const email = () => 'synthetic@example.invalid';
  const password = () => '${canary}';
  const randomUUID = () => '00000000-0000-0000-0000-000000000002';
  const currentTotp = () => { beforeRequest('good-verify-request'); return '123456'; };
  const incorrectTotp = () => { beforeRequest('bad-verify-request'); return '000000'; };
  const validateNoSendRequest = () => {};
  const report = (event) => emit({stage, ...event});
  ${helpers}
  try { enrollmentObservation: { ${block} } return { passed: true }; }
  catch (error) { return { error, ...regressionDiagnostic.snapshot() }; }
`,
);
const id = '00000000-0000-0000-0000-000000000001';
const jwt = (aal) =>
  `synthetic.${Buffer.from(JSON.stringify({ aal })).toString('base64url')}.synthetic`;
const responses = [
  {
    status: 200,
    body: { id, email: 'synthetic@example.invalid', email_confirmed_at: 'synthetic' },
  },
  { status: 200, body: { user: { id }, access_token: jwt('aal1') } },
  { status: 400, body: { error_code: 'invalid_credentials' } },
  { status: 200, body: { id, totp: { secret: canary } } },
  { status: 200, body: { id } },
  { status: 422, body: { error_code: 'mfa_verification_failed' } },
  { status: 200, body: { id } },
  { status: 200, body: { access_token: jwt('aal2') } },
  ...Array.from({ length: 5 }, () => ({ status: 200, body: { total: 0 } })),
];
async function run(overrides = new Map(), beforeRequest = () => {}, enrollmentOnly = false) {
  let index = 0;
  const request = vi.fn(async () => {
    const next = overrides.has(index) ? overrides.get(index) : responses[index];
    index++;
    if (next instanceof Error) throw next;
    return next;
  });
  const delay = vi.fn(async () => {});
  const events = [];
  const result = await execute(
    assert,
    { request },
    createNoSendRegressionDiagnostic(),
    delay,
    beforeRequest,
    enrollmentOnly,
    (event) => events.push(event),
  );
  return { result, request, delay, events };
}
describe('real regression-block diagnostic wiring with synthetic replies', () => {
  it('stops the focused mode after enrollment without issuing later requests', async () => {
    const { result, request, delay, events } = await run(new Map(), () => {}, true);
    expect(result).toEqual({ passed: true });
    expect(request).toHaveBeenCalledTimes(4);
    expect(delay).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ stage: 'totp-enrollment-observation', passed: true });
    expect(events[0]).not.toHaveProperty('totpAal2');
  });
  it('preserves successful password/TOTP checks and the existing sink observations', async () => {
    const { result, request, delay } = await run();
    expect(result).toEqual({ passed: true });
    expect(request).toHaveBeenCalledTimes(13);
    expect(delay.mock.calls).toEqual([[250], [250], [250], [250]]);
    expect(request.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/auth/v1/admin/users',
      '/auth/v1/token',
      '/auth/v1/token',
      '/auth/v1/factors',
      `/auth/v1/factors/${id}/challenge`,
      `/auth/v1/factors/${id}/verify`,
      `/auth/v1/factors/${id}/challenge`,
      `/auth/v1/factors/${id}/verify`,
      ...Array(5).fill('/api/v1/messages'),
    ]);
  });
  it.each([
    [0, { status: 400, body: {} }, 'fixture-status'],
    [1, { status: 400, body: { error_code: 'email_not_confirmed' } }, 'login-status'],
    [2, { status: 400, body: { code: 'invalid_credentials' } }, 'wrong-password-code'],
    [3, { status: 400, body: { error_code: 'validation_failed' } }, 'enroll-status'],
    [4, { status: 400, body: {} }, 'bad-challenge-status'],
    [5, { status: 422, body: { error_code: canary } }, 'bad-verify-code'],
    [6, { status: 400, body: {} }, 'good-challenge-status'],
    [7, { status: 200, body: { access_token: jwt('aal1') } }, 'good-verify-aal'],
    [8, { status: 200, body: { total: 1 } }, 'sink-no-extra-mail'],
  ])(
    'identifies the actual failed assertion without continuing (%#)',
    async (index, response, checkpoint) => {
      const { result, request } = await run(new Map([[index, response]]));
      expect(result.error.code).toBe('ERR_ASSERTION');
      expect(result.regressionDiagnostic.checkpoint).toBe(checkpoint);
      expect(result.regressionDiagnostic.httpStatus).toBe(response.status);
      expect(JSON.stringify(result.regressionDiagnostic)).not.toContain(canary);
      expect(request).toHaveBeenCalledTimes(index + 1);
    },
  );
  it('preserves the original transport error and reports no stale prior response', async () => {
    const error = new Error(canary);
    const { result, request } = await run(new Map([[3, error]]));
    expect(result.error).toBe(error);
    expect(result.regressionDiagnostic).toEqual({
      checkpoint: 'enroll-request',
      httpStatus: null,
      errorCodeField: 'unobserved',
      errorCategory: 'unknown',
    });
    expect(request).toHaveBeenCalledTimes(4);
  });
  it.each([
    ['bad-verify-request', 5],
    ['good-verify-request', 7],
  ])(
    'does not attribute the previous response to pre-request failure at %s',
    async (checkpoint, count) => {
      const error = new Error(canary);
      const { result, request } = await run(new Map(), (step) => {
        if (step === checkpoint) throw error;
      });
      expect(result.error).toBe(error);
      expect(result.regressionDiagnostic).toEqual({
        checkpoint,
        httpStatus: null,
        errorCodeField: 'unobserved',
        errorCategory: 'unknown',
      });
      expect(request).toHaveBeenCalledTimes(count);
    },
  );
});
