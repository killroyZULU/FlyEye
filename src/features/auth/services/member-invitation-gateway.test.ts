import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../lib/database.types';
import { AuthGatewayError, SupabaseAuthGateway } from './auth-gateway';

const organizationId = '20000000-0000-4000-8000-000000000001';
const invitationId = '40000000-0000-4000-8000-000000000001';
const correlationId = '50000000-0000-4000-8000-000000000001';
const email = 'invitee@example.test';
const password = 'Synthetic-invitation-password!';
const invitation = { invitationId, expectedVersion: 7 };
const mutation = { decision: 'pending', invitationId, version: 8, replayed: true, correlationId };
const listing = { decision: 'listed', organizationId, invitations: [], roles: [], correlationId };

function fixture() {
  const auth = {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { email, email_confirmed_at: '2026-10-01T00:00:00Z' } },
      error: null,
    }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
  };
  const invoke = vi.fn().mockResolvedValue({ data: mutation, error: null });
  const gateway = new SupabaseAuthGateway({
    auth,
    functions: { invoke },
  } as unknown as SupabaseClient<Database>);
  return { auth, invoke, gateway };
}

function preparation(credentialMode = 'new') {
  return { decision: 'prepared', invitationId, version: 7, credentialMode, correlationId };
}

describe('member invitation gateway compatibility', () => {
  it('does not dispatch provider calls during construction', () => {
    const { auth, invoke } = fixture();
    expect(invoke).not.toHaveBeenCalled();
    for (const method of Object.values(auth)) expect(method).not.toHaveBeenCalled();
  });

  it('forwards exact list scope and accepts an empty protected response', async () => {
    const { gateway, invoke, auth } = fixture();
    invoke.mockResolvedValue({ data: listing, error: null });
    await expect(gateway.loadMemberInvitations(organizationId)).resolves.toEqual(listing);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('member-invitations', {
      body: { action: 'list', organizationId },
    });
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it.each(['create', 'resend', 'revoke', 'accept'] as const)(
    'preserves %s payload, version, idempotency key and replay result',
    async (action) => {
      const { gateway, invoke } = fixture();
      const common = { ...invitation, idempotencyKey: 'synthetic-idempotency-key' };
      const create = {
        organizationId,
        email,
        roleCode: 'student_pilot',
        idempotencyKey: common.idempotencyKey,
      };
      const scoped = { organizationId, ...common };
      const response = {
        ...mutation,
        decision: action === 'accept' ? 'accepted' : action === 'revoke' ? 'revoked' : 'pending',
      };
      invoke.mockResolvedValue({ data: response, error: null });
      const result =
        action === 'create'
          ? gateway.createMemberInvitation(create)
          : action === 'resend'
            ? gateway.resendMemberInvitation(scoped)
            : action === 'revoke'
              ? gateway.revokeMemberInvitation(scoped)
              : gateway.acceptMemberInvitation(common);
      await expect(result).resolves.toEqual(response);
      expect(invoke).toHaveBeenCalledExactlyOnceWith('member-invitations', {
        body: { action, ...(action === 'create' ? create : action === 'accept' ? common : scoped) },
      });
    },
  );

  it.each([null, undefined, 'invalid', 1])('rejects malformed invocation %s', async (value) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue(value);
    await expect(gateway.loadMemberInvitations(organizationId)).rejects.toMatchObject({
      code: 'member_invitation_unavailable',
    });
  });

  it.each(['list', 'mutation'] as const)('rejects invalid %s response data', async (kind) => {
    const { gateway, invoke } = fixture();
    invoke.mockResolvedValue({ data: { ...mutation, version: 0 }, error: null });
    const result =
      kind === 'list'
        ? gateway.loadMemberInvitations(organizationId)
        : gateway.acceptMemberInvitation({ ...invitation, idempotencyKey: 'synthetic-key' });
    await expect(result).rejects.toMatchObject({ code: 'member_invitation_conflict' });
  });

  it.each([
    ['not_available', 'member_invitation_not_available'],
    ['conflict', 'member_invitation_conflict'],
    ['recent_authentication_required', 'member_invitation_recent_authentication_required'],
    ['delivery_failed', 'member_invitation_delivery_failed'],
    ['delivery_uncertain', 'member_invitation_delivery_uncertain'],
    ['unauthorized', 'member_invitation_unavailable'],
  ])('maps %s to safe guidance without provider details or retries', async (code, expectedCode) => {
    const { gateway, invoke } = fixture();
    const context = new Response(
      JSON.stringify({
        error: { code: `member_invitation.${code}`, message: 'restricted synthetic detail' },
      }),
      { status: 403 },
    );
    invoke.mockResolvedValue({ data: mutation, error: { context } });
    const failure: unknown = await gateway
      .acceptMemberInvitation({ ...invitation, idempotencyKey: 'synthetic-key' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AuthGatewayError);
    expect(failure).toMatchObject({ code: expectedCode });
    expect((failure as Error).message).not.toContain('restricted synthetic detail');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(context.bodyUsed).toBe(false);
  });

  it.each([
    ['15', 'Wait 15 seconds before trying again.'],
    ['0', 'Too many invitation attempts. Wait before trying again.'],
    ['1.5', 'Too many invitation attempts. Wait before trying again.'],
    [undefined, 'Too many invitation attempts. Wait before trying again.'],
  ])('preserves retry-after parsing for %s', async (retry, message) => {
    const { gateway, invoke } = fixture();
    const context = new Response(
      JSON.stringify({ error: { code: 'member_invitation.rate_limited' } }),
      {
        status: 429,
        headers: retry ? { 'retry-after': retry } : undefined,
      },
    );
    invoke.mockResolvedValue({ error: { context } });
    await expect(gateway.loadMemberInvitations(organizationId)).rejects.toMatchObject({
      code: 'rate_limited',
      message,
    });
    expect(context.bodyUsed).toBe(false);
  });

  it.each(['not-json', 'null', '[]', '{"error":{"code":7}}'])(
    'safely falls back for response body %s',
    async (body) => {
      const { gateway, invoke } = fixture();
      invoke.mockResolvedValue({ error: { context: new Response(body, { status: 429 }) } });
      await expect(gateway.loadMemberInvitations(organizationId)).rejects.toMatchObject({
        code: 'member_invitation_unavailable',
      });
    },
  );

  it('preserves rejected invocation errors without retrying', async () => {
    const { gateway, invoke } = fixture();
    const failure = new TypeError('synthetic transport failure');
    invoke.mockRejectedValue(failure);
    await expect(gateway.loadMemberInvitations(organizationId)).rejects.toBe(failure);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('invitation credential preparation compatibility', () => {
  it.each(['new', 'existing'])(
    'uses the protected %s credential path in provider order',
    async (mode) => {
      const { gateway, invoke, auth } = fixture();
      invoke.mockResolvedValue({ data: preparation(mode), error: null });
      await gateway.prepareInvitationCredential(password, invitation);
      expect(auth.getUser).toHaveBeenCalledExactlyOnceWith();
      expect(invoke).toHaveBeenCalledExactlyOnceWith('member-invitations', {
        body: { action: 'prepare', ...invitation },
      });
      expect(auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email, password });
      expect(auth.getUser.mock.invocationCallOrder[0]!).toBeLessThan(
        invoke.mock.invocationCallOrder[0]!,
      );
      expect(invoke.mock.invocationCallOrder[0]!).toBeLessThan(
        auth.signInWithPassword.mock.invocationCallOrder[0]!,
      );
      if (mode === 'new') {
        expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password });
        expect(invoke.mock.invocationCallOrder[0]!).toBeLessThan(
          auth.updateUser.mock.invocationCallOrder[0]!,
        );
        expect(auth.updateUser.mock.invocationCallOrder[0]!).toBeLessThan(
          auth.signInWithPassword.mock.invocationCallOrder[0]!,
        );
      } else expect(auth.updateUser).not.toHaveBeenCalled();
    },
  );

  it.each(['provider-error', 'missing-email', 'unconfirmed'])(
    'stops before preparation for %s',
    async (kind) => {
      const { gateway, invoke, auth } = fixture();
      auth.getUser.mockResolvedValue({
        data: {
          user: {
            email: kind === 'missing-email' ? '' : email,
            email_confirmed_at: kind === 'unconfirmed' ? '' : '2026-10-01',
          },
        },
        error: kind === 'provider-error' ? {} : null,
      });
      await expect(gateway.prepareInvitationCredential(password, invitation)).rejects.toMatchObject(
        { code: 'member_invitation_not_available' },
      );
      expect(invoke).not.toHaveBeenCalled();
      expect(auth.updateUser).not.toHaveBeenCalled();
      expect(auth.signInWithPassword).not.toHaveBeenCalled();
    },
  );

  it.each(['malformed', 'denied', 'rejected'])(
    'does not touch credentials after %s protected preparation',
    async (kind) => {
      const { gateway, invoke, auth } = fixture();
      if (kind === 'rejected')
        invoke.mockRejectedValue(new TypeError('synthetic transport failure'));
      else
        invoke.mockResolvedValue(
          kind === 'malformed'
            ? { data: preparation('untrusted'), error: null }
            : { error: { context: new Response('{}', { status: 403 }) } },
        );
      await expect(
        gateway.prepareInvitationCredential(password, invitation),
      ).rejects.toBeInstanceOf(Error);
      expect(auth.updateUser).not.toHaveBeenCalled();
      expect(auth.signInWithPassword).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [{ code: 'weak_password' }, 'weak_password'],
    [{ status: 429 }, 'rate_limited'],
    [new TypeError('synthetic network failure'), 'network_error'],
    [{ code: 'unrecognized' }, 'unknown'],
  ])('maps returned password-update failures and stops sign-in (%s)', async (failure, code) => {
    const { gateway, invoke, auth } = fixture();
    invoke.mockResolvedValue({ data: preparation(), error: null });
    auth.updateUser.mockResolvedValue({ error: failure });
    await expect(gateway.prepareInvitationCredential(password, invitation)).rejects.toMatchObject({
      code,
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each(['getUser', 'updateUser', 'signInWithPassword'] as const)(
    'preserves thrown %s failure identity',
    async (method) => {
      const { gateway, invoke, auth } = fixture();
      const failure = new Error('synthetic provider rejection');
      invoke.mockResolvedValue({ data: preparation(), error: null });
      auth[method].mockRejectedValue(failure);
      await expect(gateway.prepareInvitationCredential(password, invitation)).rejects.toBe(failure);
      expect(auth[method]).toHaveBeenCalledTimes(1);
      if (method === 'getUser') expect(invoke).not.toHaveBeenCalled();
      if (method !== 'signInWithPassword') expect(auth.signInWithPassword).not.toHaveBeenCalled();
    },
  );

  it('maps returned sign-in failure without accepting the invitation', async () => {
    const { gateway, invoke, auth } = fixture();
    invoke.mockResolvedValue({ data: preparation('existing'), error: null });
    auth.signInWithPassword.mockResolvedValue({ error: { status: 429 } });
    await expect(gateway.prepareInvitationCredential(password, invitation)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
