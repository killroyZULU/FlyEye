import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../lib/database.types';
import { AuthGatewayError, SupabaseAuthGateway } from './auth-gateway';

const organizationId = '20000000-0000-4000-8000-000000000001';
const membershipId = '30000000-0000-4000-8000-000000000001';
const correlationId = '40000000-0000-4000-8000-000000000001';
const summary = {
  membershipId,
  displayName: 'Synthetic Member',
  email: 'member@example.test',
  roleCode: 'student_pilot',
  roleLabel: 'Student Pilot',
  status: 'active',
  membershipVersion: 7,
  profileVersion: 3,
  profileComplete: true,
  createdAt: '2026-10-01',
};
const detail = {
  ...summary,
  contactNumber: null,
  statusReasonOptions: [],
  roleOptions: [],
  roleReasonOptions: [],
  updatedAt: '2026-10-01',
};
const profile = {
  organizationId,
  organizationName: 'Synthetic School',
  membershipId,
  displayName: 'Synthetic Member',
  contactNumber: null,
  email: 'member@example.test',
  roleCode: 'student_pilot',
  roleLabel: 'Student Pilot',
  status: 'active',
  version: 3,
  complete: true,
};
const common = {
  organizationId,
  membershipId,
  expectedVersion: 7,
  idempotencyKey: 'synthetic-key',
};
const roleRequest = {
  ...common,
  roleCode: 'instructor_pilot',
  reasonCode: 'responsibility_changed' as const,
};
const profileRequest = {
  membershipId,
  displayName: 'Updated Member',
  contactNumber: '',
  expectedVersion: 3,
};
const statusResult = {
  decision: 'suspended',
  status: 'suspended',
  organizationId,
  membershipId,
  version: 8,
  replayed: true,
  correlationId,
};
const roleResult = {
  decision: 'changed',
  organizationId,
  membershipId,
  roleCode: 'instructor_pilot',
  roleLabel: 'Instructor Pilot',
  version: 8,
  replayed: true,
  correlationId,
};

function fixture() {
  const invoke = vi.fn();
  const auth = { getUser: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() };
  const gateway = new SupabaseAuthGateway({
    auth,
    functions: { invoke },
  } as unknown as SupabaseClient<Database>);
  return { gateway, invoke, auth };
}

const operations = [
  'list',
  'detail',
  'get_profile',
  'update_profile',
  'suspend',
  'assign_role',
] as const;
type Operation = (typeof operations)[number];

function dispatch(gateway: SupabaseAuthGateway, operation: Operation) {
  switch (operation) {
    case 'list':
      return gateway.loadOrganizationMembers({ organizationId });
    case 'detail':
      return gateway.loadOrganizationMember(organizationId, membershipId);
    case 'get_profile':
      return gateway.loadMyMemberProfile(membershipId);
    case 'update_profile':
      return gateway.updateMyMemberProfile(profileRequest);
    case 'suspend':
      return gateway.changeOrganizationMemberStatus({
        ...common,
        action: 'suspend',
        reasonCode: 'access_review',
      });
    case 'assign_role':
      return gateway.changeOrganizationMemberRole(roleRequest);
  }
}

describe('member administration gateway compatibility', () => {
  it('does not invoke providers during construction', () => {
    const { invoke, auth } = fixture();
    expect(invoke).not.toHaveBeenCalled();
    for (const method of Object.values(auth)) expect(method).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves optional list filters and paginated results (filtered=%s)',
    async (filtered) => {
      const { gateway, invoke } = fixture();
      const filters = {
        status: 'active' as const,
        search: ' Synthetic ',
        cursor: 'synthetic-cursor-'.repeat(3),
      };
      const request = { organizationId, ...(filtered ? filters : {}) };
      const response = {
        decision: 'listed',
        organizationId,
        members: filtered ? [summary] : [],
        ...(filtered ? { nextCursor: filters.cursor } : {}),
        correlationId,
      };
      invoke.mockResolvedValue({ data: response, error: null });
      await expect(gateway.loadOrganizationMembers(request)).resolves.toEqual(response);
      expect(invoke).toHaveBeenCalledExactlyOnceWith('member-administration', {
        body: { action: 'list', ...request },
      });
    },
  );

  it('unwraps member detail without changing its content or request scope', async () => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({
      data: { decision: 'found', organizationId, member: detail, correlationId },
      error: null,
    });
    await expect(gateway.loadOrganizationMember(organizationId, membershipId)).resolves.toEqual(
      detail,
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith('member-administration', {
      body: { action: 'detail', organizationId, membershipId },
    });
  });

  it.each(['get_profile', 'update_profile'] as const)(
    'preserves %s request and unwraps the profile',
    async (action) => {
      const { gateway, invoke, auth } = fixture();
      invoke.mockResolvedValue({
        data: { decision: action === 'get_profile' ? 'found' : 'updated', profile, correlationId },
        error: null,
      });
      await expect(dispatch(gateway, action)).resolves.toEqual(profile);
      expect(invoke).toHaveBeenCalledExactlyOnceWith('member-administration', {
        body: { action, ...(action === 'get_profile' ? { membershipId } : profileRequest) },
      });
      for (const method of Object.values(auth)) expect(method).not.toHaveBeenCalled();
    },
  );

  it.each(['suspend', 'reactivate', 'revoke'] as const)(
    'forwards %s version/idempotency and returns replay evidence',
    async (action) => {
      const { gateway, invoke } = fixture();
      const request = { ...common, action, reasonCode: 'access_review' };
      const state =
        action === 'reactivate' ? 'active' : action === 'revoke' ? 'revoked' : 'suspended';
      const response = { ...statusResult, status: state, decision: state };
      invoke.mockResolvedValue({ data: response, error: null });
      await expect(gateway.changeOrganizationMemberStatus(request)).resolves.toEqual(response);
      expect(invoke).toHaveBeenCalledExactlyOnceWith('member-administration', { body: request });
    },
  );

  it('forwards role assignment and preserves returned version and replay status', async () => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({ data: roleResult, error: null });
    await expect(gateway.changeOrganizationMemberRole(roleRequest)).resolves.toEqual(roleResult);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('member-administration', {
      body: { action: 'assign_role', ...roleRequest },
    });
  });

  it.each(operations)('rejects malformed successful %s response', async (operation) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({ data: {}, error: null });
    await expect(dispatch(gateway, operation)).rejects.toMatchObject({
      code: 'member_administration_state_conflict',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('rejects a found profile response for an update instead of claiming success', async () => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({ data: { decision: 'found', profile, correlationId }, error: null });
    await expect(gateway.updateMyMemberProfile(profileRequest)).rejects.toMatchObject({
      code: 'member_administration_state_conflict',
    });
  });

  it.each([null, undefined, 'invalid', 1])('rejects malformed invocation %s', async (value) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue(value);
    await expect(gateway.loadOrganizationMembers({ organizationId })).rejects.toMatchObject({
      code: 'member_administration_unavailable',
    });
  });

  it.each([
    ['not_found', 'not_found'],
    ['validation_failed', 'validation_failed'],
    ['invalid_request', 'validation_failed'],
    ['state_conflict', 'state_conflict'],
    ['last_administrator', 'last_administrator'],
    ['self_action', 'self_action'],
    ['target_mfa_not_ready', 'target_mfa_not_ready'],
    ['recent_authentication_required', 'recent_authentication_required'],
    ['authentication_assurance_required', 'assurance_required'],
    ['unauthorized', 'unavailable'],
  ])(
    'preserves protected %s error mapping without leaking provider details',
    async (providerCode, code) => {
      const { gateway, invoke } = fixture();
      const context = new Response(
        JSON.stringify({
          error: {
            code: `member_administration.${providerCode}`,
            message: 'restricted synthetic detail',
          },
        }),
        { status: 403 },
      );
      invoke.mockResolvedValue({ data: roleResult, error: { context } });
      const failure: unknown = await gateway
        .changeOrganizationMemberRole(roleRequest)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AuthGatewayError);
      expect(failure).toMatchObject({ code: `member_administration_${code}` });
      expect((failure as Error).message).not.toContain('restricted synthetic detail');
      expect(context.bodyUsed).toBe(false);
      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['12', 'Wait 12 seconds before trying again.'],
    ['0', 'Too many member requests. Wait before trying again.'],
    ['invalid', 'Too many member requests. Wait before trying again.'],
    [undefined, 'Too many member requests. Wait before trying again.'],
  ])('preserves rate-limit guidance for retry-after %s', async (retry, message) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({
      error: {
        context: new Response(
          JSON.stringify({ error: { code: 'member_administration.rate_limited' } }),
          { status: 429, headers: retry ? { 'retry-after': retry } : undefined },
        ),
      },
    });
    await expect(gateway.loadMyMemberProfile(membershipId)).rejects.toMatchObject({
      code: 'rate_limited',
      message,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each(['not-json', 'null', '{"error":{"code":7}}'])(
    'falls back safely for malformed error body %s',
    async (body) => {
      const { gateway, invoke } = fixture();
      invoke.mockResolvedValue({ error: { context: new Response(body, { status: 429 }) } });
      await expect(gateway.loadMyMemberProfile(membershipId)).rejects.toMatchObject({
        code: 'member_administration_unavailable',
      });
    },
  );

  it.each(operations)('preserves thrown %s error identity without retries', async (operation) => {
    const { gateway, invoke } = fixture();
    const failure = new TypeError('synthetic transport failure');
    invoke.mockRejectedValue(failure);
    await expect(dispatch(gateway, operation)).rejects.toBe(failure);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
