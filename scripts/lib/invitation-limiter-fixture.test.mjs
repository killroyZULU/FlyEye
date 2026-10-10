import { describe, expect, it } from 'vitest';
import { assertRecords, request, row } from './invitation-limiter-fixture.mjs';

function denied(retry) {
  const input = request();
  const time = '2026-10-10T00:00:00+00:00';
  const result = {
    allowed: false,
    retryAfterSeconds: retry,
    correlationId: input.correlation,
    networkSourceUsed: false,
    policyVersion: 'invitation-subject-scope-v1',
  };
  const state = [row('resend', 0, time)];
  const events = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      correlation_id: input.correlation,
      limiter_key_hash: input.key,
      action: input.action,
      outcome: 'rate_limited',
      status_code: 429,
      retry_after_seconds: retry,
      network_source_used: false,
      occurred_at: time,
    },
  ];
  return { actual: { state, events }, record: { ...input, time, result }, state };
}

describe('invitation limiter exact retry assertions', () => {
  it('retains the full-interval expectation when no partial refill is supplied', () => {
    const { actual, record, state } = denied(1199);
    expect(() => assertRecords(actual, [record], state)).toThrow();
    record.result.retryAfterSeconds = 1200;
    actual.events[0].retry_after_seconds = 1200;
    expect(() => assertRecords(actual, [record], state)).not.toThrow();
  });
  it('accepts an independently calculated partial-refill expectation', () => {
    const { actual, record, state } = denied(1199);
    expect(() => assertRecords(actual, [{ ...record, expectedRetry: 1199 }], state)).not.toThrow();
  });
  it('rejects response or event retry disagreement with the calculated value', () => {
    const { actual, record, state } = denied(1199);
    record.expectedRetry = 1198;
    expect(() => assertRecords(actual, [record], state)).toThrow();
    record.expectedRetry = 1199;
    actual.events[0].retry_after_seconds = 1198;
    expect(() => assertRecords(actual, [record], state)).toThrow();
  });
});
