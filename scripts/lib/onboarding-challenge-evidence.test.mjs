import { describe, expect, it } from 'vitest';
import {
  assertPasswordOnly,
  assertForeignFactorDenied,
  assertChallengeRequests,
} from './onboarding-challenge-evidence.mjs';
import { assertStaleTransition } from './onboarding-stale-evidence.mjs';
import { createHash } from 'node:crypto';
import { createFixtureDiagnostics, fixtureDiagnostic } from './fixture-diagnostics.mjs';

const uuid = (i) => `e4000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const token = (claims) =>
  `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`;
describe('R3 foreign factor denial evidence', () => {
  const before = {
    domain: [
      {
        grant: { status: 'pending', version: 1 },
        members: [],
        profiles: [],
        roles: [],
        events: [],
      },
      { grant: null, members: [], profiles: [], roles: [], events: [] },
    ],
    factors: [[{ id: uuid(1), status: 'verified' }], [{ id: uuid(2), status: 'verified' }]],
    challenges: [{ id: uuid(3), factor_id: uuid(2), verified_at: null }],
    assurance: {
      sessions: [{ id: uuid(8), user_id: uuid(1), aal: 'aal1', factor_id: null }],
      amr: [{ id: uuid(9), session_id: uuid(8), authentication_method: 'password' }],
    },
  };
  const result = { data: null, error: { status: 404, code: 'mfa_factor_not_found' } };
  it('accepts only ownership denial with both actors unchanged', () => {
    expect(() => assertForeignFactorDenied(before, structuredClone(before), result)).not.toThrow();
  });
  it('preserves sanitized SDK transport failure without treating it as denial', () => {
    const lines = [];
    const diagnostics = createFixtureDiagnostics('FEAT-003', {
      enabled: true,
      write: (line) => lines.push(line),
    });
    const error = Object.assign(new Error('private provider payload'), {
      name: 'AuthRetryableFetchError',
      status: 0,
    });
    try {
      assertForeignFactorDenied(before, before, { data: null, error }, diagnostics.enter);
      throw new Error('Unexpected successful denial assertion');
    } catch (caught) {
      expect(caught).toBe(error);
      diagnostics.fail(caught);
    }
    expect(lines.at(-1)).toBe(
      'FEAT-003 runtime diagnostic: stage=foreign-denial-status event=failed detail=transport-failed.',
    );
    expect(lines.join('\n')).not.toContain('private');
  });
  it('localizes a failed assertion using only fixed sanitized checkpoints', () => {
    const stages = [];
    expect(() =>
      assertForeignFactorDenied(
        before,
        before,
        {
          ...result,
          error: { status: 404, code: 'unexpected-private-provider-value' },
        },
        (stage) => stages.push(fixtureDiagnostic('FEAT-003', stage, 'enter')),
      ),
    ).toThrow();
    expect(stages).toEqual([
      'FEAT-003 runtime diagnostic: stage=foreign-denial-status event=enter.',
      'FEAT-003 runtime diagnostic: stage=foreign-denial-code event=enter.',
    ]);
  });
  it.each([429, 500, 503, 200])('rejects HTTP %s as denial evidence', (status) => {
    expect(() =>
      assertForeignFactorDenied(before, before, { ...result, error: { ...result.error, status } }),
    ).toThrow();
  });
  it('rejects an unrelated provider error', () => {
    expect(() =>
      assertForeignFactorDenied(before, before, {
        ...result,
        error: { status: 404, code: 'unexpected' },
      }),
    ).toThrow();
  });
  it.each([
    ['membership', (v) => v.domain[0].members.push({ id: uuid(4) })],
    ['foreign role', (v) => v.domain[1].roles.push({ role_id: uuid(4) })],
    ['audit', (v) => v.domain[0].events.push({ id: uuid(4) })],
    ['grant', (v) => v.domain[0].grant.version++],
    [
      'factor',
      (v) => {
        v.factors[1][0].status = 'unverified';
      },
    ],
    [
      'challenge consumption',
      (v) => {
        v.challenges[0].verified_at = '2026-10-13';
      },
    ],
    ['challenge creation', (v) => v.challenges.push({ id: uuid(4) })],
    [
      'server assurance',
      (v) => {
        v.assurance.sessions[0].aal = 'aal2';
      },
    ],
    [
      'server factor binding',
      (v) => {
        v.assurance.sessions[0].factor_id = uuid(2);
      },
    ],
    [
      'server AMR',
      (v) => {
        v.assurance.amr[0].authentication_method = 'totp';
      },
    ],
  ])('rejects %s mutation', (_name, mutate) => {
    const after = structuredClone(before);
    mutate(after);
    expect(() => assertForeignFactorDenied(before, after, result)).toThrow();
  });
});
describe('R3 assurance and request evidence', () => {
  const claims = { sub: uuid(1), aal: 'aal1', amr: [{ method: 'password' }] };
  it('accepts password-only AAL1', () =>
    expect(() => assertPasswordOnly(token(claims), uuid(1))).not.toThrow());
  it.each([
    { ...claims, sub: uuid(2) },
    { ...claims, aal: 'aal2' },
    { ...claims, amr: [{ method: 'totp' }] },
  ])('rejects changed assurance', (changed) => {
    expect(() => assertPasswordOnly(token(changed), uuid(1))).toThrow();
  });
  const requests = ['challenge', 'verify'].map((action) => ({
    method: 'POST',
    path: `/auth/v1/factors/${uuid(1)}/${action}`,
  }));
  it('accepts the exact own-factor request pair', () =>
    expect(() => assertChallengeRequests(requests, uuid(1))).not.toThrow());
  it('rejects another factor', () =>
    expect(() => assertChallengeRequests(requests, uuid(2))).toThrow());
  it('rejects duplicate challenges', () =>
    expect(() => assertChallengeRequests([requests[0], ...requests], uuid(1))).toThrow());
  it('rejects enrollment', () =>
    expect(() =>
      assertChallengeRequests([{ method: 'POST', path: '/auth/v1/factors' }, ...requests], uuid(1)),
    ).toThrow());
});
it('requires challenge_required when a verified factor is reused', () => {
  const context = {
    userId: uuid(1),
    organizationId: uuid(2),
    grantId: uuid(3),
    key: 'synthetic-key',
    factorState: 'challenge_required',
  };
  const before = { grant: { version: 1 }, members: [], profiles: [], roles: [], events: [] };
  const result = {
    status: 200,
    payload: {
      decision: 'ready',
      bootstrapGrantId: context.grantId,
      organizationId: context.organizationId,
      organizationName: 'FEAT-003 Synthetic Flight School',
      grantVersion: 1,
      replayed: false,
      correlationId: uuid(4),
      factorState: 'challenge_required',
    },
  };
  const after = {
    ...before,
    events: [
      {
        id: uuid(5),
        occurred_at: '2026-10-13T00:00:00Z',
        organization_id: context.organizationId,
        organization_ids: [context.organizationId],
        actor_user_id: context.userId,
        actor_subject_id: context.userId,
        actor_kind: 'authenticated_subject',
        event_name: 'admin_onboarding.started',
        outcome: 'success',
        correlation_id: uuid(4),
        reason_code: 'onboarding_started',
        source_code: null,
        source_instance_id: null,
        target_kind: 'organization_admin_bootstrap_grant',
        target_id: context.grantId,
        idempotency_key_hash: createHash('sha256').update(context.key).digest('hex'),
        metadata: { grantVersion: 1 },
      },
    ],
  };
  expect(() => assertStaleTransition('start', before, after, result, context)).not.toThrow();
  result.payload.factorState = 'enrollment_required';
  expect(() => assertStaleTransition('start', before, after, result, context)).toThrow();
});
