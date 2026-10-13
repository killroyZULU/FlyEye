import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  assertProviderCompletion,
  assertProviderBootstrap,
  providerAuthenticationMethods,
} from './onboarding-provider-evidence.mjs';

const uuid = (index) => `e2000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
function bootstrapFixture(removed) {
  const { after: before, context } = fixture();
  const event = {
    id: uuid(10),
    occurred_at: '2026-10-13T00:00:01+00:00',
    organization_id: context.organizationId,
    organization_ids: [context.organizationId],
    actor_user_id: context.userId,
    actor_subject_id: context.userId,
    actor_kind: 'authenticated_subject',
    event_name: removed ? 'authentication.access_denied' : 'authentication.access_context_loaded',
    outcome: removed ? 'denied' : 'success',
    correlation_id: uuid(11),
    reason_code: removed ? 'factor_state_conflict' : 'access_context_granted',
    source_code: null,
    source_instance_id: null,
    target_kind: null,
    target_id: null,
    idempotency_key_hash: null,
    metadata: { membershipCount: 1, currentAssuranceLevel: 'aal2' },
  };
  const after = structuredClone(before);
  after.events.push(event);
  const result = removed
    ? { status: 409, payload: { error: { code: 'auth.access_context_conflict' } } }
    : {
        status: 200,
        payload: {
          decision: 'granted',
          correlationId: uuid(11),
          memberships: [{ role: 'admin', organizationId: context.organizationId }],
        },
      };
  return { before, after, result, context: { ...context, removed } };
}

describe.each([false, true])('R3 final bootstrap evidence (removed=%s)', (removed) => {
  it('accepts exact access outcome and audit while preserving completion state', () => {
    const v = bootstrapFixture(removed);
    expect(() => assertProviderBootstrap(v.before, v.after, v.result, v.context)).not.toThrow();
  });
  it.each([
    [
      'deleted completion audit',
      (v) => {
        v.after.events.splice(1, 1);
      },
    ],
    [
      'mutated completion audit',
      (v) => {
        v.after.events[1].outcome = 'denied';
      },
    ],
    [
      'tenant',
      (v) => {
        v.after.events[2].organization_id = uuid(99);
      },
    ],
    [
      'source',
      (v) => {
        v.after.events[2].source_code = 'unexpected';
      },
    ],
    [
      'target',
      (v) => {
        v.after.events[2].target_id = uuid(99);
      },
    ],
    [
      'key',
      (v) => {
        v.after.events[2].idempotency_key_hash = 'unexpected';
      },
    ],
    [
      'invalid correlation',
      (v) => {
        v.after.events[2].correlation_id = 'invalid';
      },
    ],
    [
      'invalid timestamp',
      (v) => {
        v.after.events[2].occurred_at = 'invalid';
      },
    ],
    [
      'missing event',
      (v) => {
        v.after.events.pop();
      },
    ],
    [
      'extra event',
      (v) => {
        v.after.events.push({ ...v.after.events[2], id: uuid(99) });
      },
    ],
    [
      'domain mutation',
      (v) => {
        v.after.members[0].version += 1;
      },
    ],
    [
      'rate limit',
      (v) => {
        v.result.status = 429;
      },
    ],
    [
      'infrastructure failure',
      (v) => {
        v.result.status = 503;
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const v = bootstrapFixture(removed);
    mutate(v);
    expect(() => assertProviderBootstrap(v.before, v.after, v.result, v.context)).toThrow();
  });
});
it('rejects a retained-factor response whose correlation differs from its audit', () => {
  const v = bootstrapFixture(false);
  v.result.payload.correlationId = uuid(99);
  expect(() => assertProviderBootstrap(v.before, v.after, v.result, v.context)).toThrow();
});
function fixture() {
  const context = {
    userId: uuid(1),
    organizationId: uuid(2),
    grantId: uuid(3),
    key: 'synthetic-key',
    adminRoleId: uuid(4),
    authenticationMethods: ['password', 'totp'],
  };
  const timestamp = '2026-10-13T00:00:00+00:00';
  const before = {
    grant: { id: uuid(3), eligible_user_id: uuid(1), version: 1, status: 'pending' },
    events: [{ id: uuid(5), preserved: true }],
  };
  const result = {
    status: 200,
    payload: {
      decision: 'completed',
      bootstrapGrantId: uuid(3),
      organizationId: uuid(2),
      organizationName: 'FEAT-003 Synthetic Flight School',
      membershipId: uuid(6),
      grantVersion: 2,
      correlationId: uuid(7),
    },
  };
  const after = {
    grant: {
      ...before.grant,
      status: 'completed',
      version: 2,
      completed_at: timestamp,
      completed_membership_id: uuid(6),
      completion_idempotency_key_hash: createHash('sha256').update(context.key).digest('hex'),
    },
    members: [
      {
        id: uuid(6),
        organization_id: uuid(2),
        user_id: uuid(1),
        status: 'active',
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        created_by: uuid(1),
        updated_by: uuid(1),
      },
    ],
    profiles: [
      {
        id: uuid(8),
        organization_id: uuid(2),
        membership_id: uuid(6),
        display_name: null,
        contact_number: null,
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        created_by: uuid(1),
        updated_by: uuid(1),
      },
    ],
    roles: [
      {
        organization_id: uuid(2),
        membership_id: uuid(6),
        role_id: uuid(4),
        assigned_at: timestamp,
        assigned_by: uuid(1),
      },
    ],
    events: [
      ...before.events,
      {
        id: uuid(9),
        occurred_at: timestamp,
        organization_id: uuid(2),
        organization_ids: [uuid(2)],
        actor_user_id: uuid(1),
        actor_subject_id: uuid(1),
        actor_kind: 'authenticated_subject',
        event_name: 'admin_onboarding.completed',
        outcome: 'success',
        correlation_id: uuid(7),
        reason_code: 'first_admin_created',
        source_code: null,
        source_instance_id: null,
        target_kind: 'organization_admin_bootstrap_grant',
        target_id: uuid(3),
        idempotency_key_hash: null,
        metadata: {
          grantVersion: 2,
          membershipId: uuid(6),
          assuranceLevel: 'aal2',
          authenticationMethods: ['password', 'totp'],
          factorCount: 1,
        },
      },
    ],
  };
  return { before, after, result, context };
}

describe('R3 exact provider completion evidence', () => {
  const token = (methods, subject = uuid(1)) =>
    `synthetic.${Buffer.from(
      JSON.stringify({
        sub: subject,
        aal: 'aal2',
        amr: methods.map((method) => ({ method })),
      }),
    ).toString('base64url')}.synthetic`;
  it('preserves valid provider method order instead of imposing an audit order', () => {
    const v = fixture();
    v.context.authenticationMethods = providerAuthenticationMethods(
      token(['totp', 'password']),
      uuid(1),
    );
    v.after.events[1].metadata.authenticationMethods = ['totp', 'password'];
    expect(() => assertProviderCompletion(v.before, v.after, v.result, v.context)).not.toThrow();
  });
  it.each([['totp'], ['password'], ['totp', 'password', 'recovery']])(
    'rejects unsupported provider method set %j',
    (...methods) => {
      expect(() => providerAuthenticationMethods(token(methods), uuid(1))).toThrow();
    },
  );
  it('rejects a token belonging to a different synthetic subject', () => {
    expect(() =>
      providerAuthenticationMethods(token(['password', 'totp'], uuid(99)), uuid(1)),
    ).toThrow();
  });
  it.each([
    [['password']],
    [['password', 'totp', 'recovery']],
    [['password', 'totp', 'totp']],
    [['totp', 'password']],
  ])('rejects audit methods differing from the independently captured token: %j', (methods) => {
    const v = fixture();
    v.after.events[1].metadata.authenticationMethods = methods;
    const stages = [];
    v.context.checkpoint = (stage) => stages.push(stage);
    expect(() => assertProviderCompletion(v.before, v.after, v.result, v.context)).toThrow();
    expect(stages.at(-1)).toBe('provider-completion-audit');
  });
  it('accepts one exact completion while preserving previous audit evidence', () => {
    const { before, after, result, context } = fixture();
    expect(() => assertProviderCompletion(before, after, result, context)).not.toThrow();
  });
  it.each([
    [
      'actor',
      (value) => {
        value.after.events[1].actor_subject_id = uuid(99);
      },
    ],
    [
      'tenant',
      (value) => {
        value.after.members[0].organization_id = uuid(99);
      },
    ],
    [
      'role',
      (value) => {
        value.after.roles[0].role_id = uuid(99);
      },
    ],
    [
      'grant owner',
      (value) => {
        value.after.grant.eligible_user_id = uuid(99);
      },
    ],
    [
      'replay key',
      (value) => {
        value.after.grant.completion_idempotency_key_hash = '0'.repeat(64);
      },
    ],
    [
      'correlation',
      (value) => {
        value.after.events[1].correlation_id = uuid(99);
      },
    ],
    [
      'extra event',
      (value) => {
        value.after.events.push({ ...value.after.events[1], id: uuid(99) });
      },
    ],
    [
      'old event mutation',
      (value) => {
        value.after.events[0] = { id: uuid(5), preserved: false };
      },
    ],
    [
      'extra audit field',
      (value) => {
        value.after.events[1].metadata.unapproved = true;
      },
    ],
  ])('rejects incorrect %s evidence', (_name, mutate) => {
    const value = fixture();
    mutate(value);
    expect(() =>
      assertProviderCompletion(value.before, value.after, value.result, value.context),
    ).toThrow();
  });
});
