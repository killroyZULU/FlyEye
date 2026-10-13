import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertStaleTransition, assertFactorRequests } from './onboarding-stale-evidence.mjs';

const uuid = (i) => `e3000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
function fixture(kind) {
  const context = {
    userId: uuid(1),
    organizationId: uuid(2),
    grantId: uuid(3),
    key: 'synthetic-key',
  };
  const before = {
    grant: { id: context.grantId, status: 'pending', version: 1 },
    members: [],
    profiles: [],
    roles: [],
    events: [{ id: uuid(4), metadata: { grantVersion: 1 } }],
  };
  const after = structuredClone(before);
  const denied = kind === 'entry';
  if (kind === 'cancel') after.grant.version++;
  const correlationId = uuid(5);
  const result = { status: denied ? 409 : 200, payload: { correlationId } };
  Object.assign(
    result.payload,
    denied
      ? {
          error: {
            code: 'admin_onboarding.conflict',
            message: 'Your administrator onboarding information needs review.',
          },
        }
      : kind === 'start'
        ? {
            decision: 'ready',
            bootstrapGrantId: context.grantId,
            organizationId: context.organizationId,
            organizationName: 'FEAT-003 Synthetic Flight School',
            grantVersion: 1,
            replayed: false,
            factorState: 'enrollment_required',
          }
        : { decision: 'cancelled', cleanupOutcome: 'not_attempted', replayed: kind === 'replay' },
  );
  if (kind !== 'replay')
    after.events.push({
      id: uuid(6),
      occurred_at: '2026-10-13T00:00:00Z',
      organization_id: denied ? null : context.organizationId,
      organization_ids: denied ? [] : [context.organizationId],
      actor_user_id: context.userId,
      actor_subject_id: context.userId,
      actor_kind: 'authenticated_subject',
      event_name: `admin_onboarding.${denied ? 'conflict' : kind === 'start' ? 'started' : 'cancelled'}`,
      outcome: denied ? 'denied' : 'success',
      correlation_id: correlationId,
      reason_code: denied
        ? 'factor_state_conflict'
        : kind === 'start'
          ? 'onboarding_started'
          : 'onboarding_cancelled',
      source_code: null,
      source_instance_id: null,
      target_kind: 'organization_admin_bootstrap_grant',
      target_id: context.grantId,
      idempotency_key_hash: denied ? null : createHash('sha256').update(context.key).digest('hex'),
      metadata: denied
        ? { currentAssuranceLevel: 'aal1' }
        : {
            grantVersion: after.grant.version,
            ...(kind === 'cancel' ? { cleanupOutcome: 'not_attempted' } : {}),
          },
    });
  return { before, after, result, context };
}
const check = (kind, v) => assertStaleTransition(kind, v.before, v.after, v.result, v.context);

describe.each(['entry', 'start', 'cancel', 'replay'])('R3 stale transition %s', (kind) => {
  it('accepts only the bounded response, grant and audit transition', () => {
    expect(() => check(kind, fixture(kind))).not.toThrow();
  });
  it.each([
    ['membership', (v) => v.after.members.push({ id: uuid(9) })],
    ['profile', (v) => v.after.profiles.push({ id: uuid(9) })],
    ['role', (v) => v.after.roles.push({ id: uuid(9) })],
    ['grant version', (v) => v.after.grant.version++],
    [
      'grant consumption',
      (v) => {
        v.after.grant.status = 'completed';
      },
    ],
    [
      'prior audit mutation',
      (v) => {
        v.after.events[0].metadata.grantVersion++;
      },
    ],
    ['prior audit deletion', (v) => v.after.events.shift()],
    ['extra audit', (v) => v.after.events.push({ id: uuid(99) })],
    [
      'response disclosure',
      (v) => {
        v.result.payload.secret = 'unexpected';
      },
    ],
    [
      'HTTP error',
      (v) => {
        v.result.status = 503;
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const v = fixture(kind);
    mutate(v);
    expect(() => check(kind, v)).toThrow();
  });
});
describe.each(['entry', 'start', 'cancel'])('R3 stale audit %s', (kind) => {
  it.each([
    'organization_id',
    'organization_ids',
    'actor_user_id',
    'target_id',
    'event_name',
    'reason_code',
    'source_code',
    'idempotency_key_hash',
    'metadata',
    'correlation_id',
  ])('rejects changed %s', (field) => {
    const v = fixture(kind);
    v.after.events[1][field] = 'unexpected';
    expect(() => check(kind, v)).toThrow();
  });
  it('rejects missing audit', () => {
    const v = fixture(kind);
    v.after.events.pop();
    expect(() => check(kind, v)).toThrow();
  });
});
describe('R3 stale provider requests', () => {
  const counts = { enroll: 1, challenge: 0, verify: 0, remove: 0, complete: 0 };
  it('accepts exactly one enrollment', () =>
    expect(() => assertFactorRequests(counts, 1)).not.toThrow());
  it.each(Object.keys(counts))('rejects unexpected %s', (field) => {
    expect(() => assertFactorRequests({ ...counts, [field]: counts[field] + 1 }, 1)).toThrow();
  });
});
