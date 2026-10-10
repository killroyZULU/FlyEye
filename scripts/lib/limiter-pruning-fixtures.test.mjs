import { describe, expect, it } from 'vitest';
import * as invitation from './invitation-limiter-fixture.mjs';
import * as onboarding from './onboarding-limiter-fixture.mjs';

const fixtures = [
  ['invitation', invitation, 'resend', 'invitation-subject-scope-v1'],
  ['onboarding', onboarding, 'complete', 'subject-action-v1'],
];
function denied(fixture, action, policy, retry) {
  const input = fixture.request(action);
  const time = '2026-10-10T00:00:00+00:00';
  const result = {
    allowed: false,
    retryAfterSeconds: retry,
    correlationId: input.correlation,
    networkSourceUsed: false,
    policyVersion: policy,
  };
  const state = [fixture.row(action, 0, time)];
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
      ...(fixture === onboarding ? { policy_version: policy } : {}),
    },
  ];
  return { actual: { state, events }, record: { ...input, time, result }, state };
}

describe.each(fixtures)('%s limiter exact retry assertions', (_, fixture, action, policy) => {
  const full = fixture.policies[action].refill;
  it('retains the full-interval expectation without a partial-refill override', () => {
    const { actual, record, state } = denied(fixture, action, policy, full - 1);
    expect(() => fixture.assertRecords(actual, [record], state)).toThrow();
    record.result.retryAfterSeconds = full;
    actual.events[0].retry_after_seconds = full;
    expect(() => fixture.assertRecords(actual, [record], state)).not.toThrow();
  });
  it('accepts an independently calculated partial-refill expectation', () => {
    const { actual, record, state } = denied(fixture, action, policy, full - 1);
    expect(() =>
      fixture.assertRecords(actual, [{ ...record, expectedRetry: full - 1 }], state),
    ).not.toThrow();
  });
  it('rejects response or event retry disagreement with the calculated value', () => {
    const { actual, record, state } = denied(fixture, action, policy, full - 1);
    record.expectedRetry = full - 2;
    expect(() => fixture.assertRecords(actual, [record], state)).toThrow();
    record.expectedRetry = full - 1;
    actual.events[0].retry_after_seconds = full - 2;
    expect(() => fixture.assertRecords(actual, [record], state)).toThrow();
  });
  it('rejects a response from the wrong policy', () => {
    const { actual, record, state } = denied(fixture, action, policy, full);
    record.result.policyVersion = 'wrong-policy';
    expect(() => fixture.assertRecords(actual, [record], state)).toThrow();
  });
});

describe('onboarding fixture compatibility', () => {
  it('retains the frozen default and third-position key', () => {
    expect(onboarding.seed('complete')).toContain(
      `1000,'${onboarding.frozen}','${onboarding.frozen}'`,
    );
    expect(onboarding.seed('complete', 0, onboarding.keys[1])).toContain(
      `'${onboarding.keys[1]}','complete',0,'${onboarding.frozen}'`,
    );
  });
  it('uses an explicit fourth-position time without changing the selected key', () => {
    const time = '2026-10-10T00:00:00+00:00';
    const sql = onboarding.seed('complete', 0, onboarding.keys[1], time);
    expect(sql).toContain(`'${onboarding.keys[1]}','complete',0,'${time}','${time}'`);
    expect(sql).not.toContain(onboarding.frozen);
  });
  it('requires the onboarding event policy version', () => {
    const { actual, record, state } = denied(onboarding, 'complete', 'subject-action-v1', 20);
    delete actual.events[0].policy_version;
    expect(() => onboarding.assertRecords(actual, [record], state)).toThrow();
    actual.events[0].policy_version = 'wrong-policy';
    expect(() => onboarding.assertRecords(actual, [record], state)).toThrow();
  });
});
