import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../lib/database.types';
import { SupabaseAuthGateway } from './auth-gateway';

function clientWithAuth(
  auth: Record<string, unknown>,
  functions: Record<string, unknown> = {},
): SupabaseClient<Database> {
  return { auth, functions } as unknown as SupabaseClient<Database>;
}

const syntheticProviderSecret = 'A'.repeat(16);
const syntheticProviderUri = (() => {
  const uri = new URL('otpauth://totp/FlyEye:synthetic@example.test');
  uri.searchParams.set('secret', syntheticProviderSecret);
  return uri.toString();
})();

function enrollmentGateway(qrCode: string): SupabaseAuthGateway {
  return new SupabaseAuthGateway(
    clientWithAuth({
      mfa: {
        listFactors: vi.fn().mockResolvedValue({
          data: { all: [], totp: [], phone: [], webauthn: [] },
          error: null,
        }),
        enroll: vi.fn().mockResolvedValue({
          data: {
            id: '60000000-0000-4000-8000-000000000001',
            type: 'totp',
            totp: {
              qr_code: qrCode,
              secret: syntheticProviderSecret,
              uri: syntheticProviderUri,
            },
          },
          error: null,
        }),
      },
    }),
  );
}

describe('FEAT-002 Supabase auth gateway', () => {
  it('uses the exact recovery redirect and keeps provider outcomes generic', async () => {
    const resetPasswordForEmail = vi
      .fn()
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'over_request_rate_limit', status: 429 },
      });
    const gateway = new SupabaseAuthGateway(
      clientWithAuth({ resetPasswordForEmail }),
      () => 'http://127.0.0.1:5173',
    );

    await expect(
      gateway.requestPasswordRecovery('user@example.test', 'synthetic-captcha-token'),
    ).resolves.toBeUndefined();
    await expect(gateway.requestPasswordRecovery('unknown@example.test')).resolves.toBeUndefined();
    expect(resetPasswordForEmail).toHaveBeenNthCalledWith(1, 'user@example.test', {
      redirectTo: 'http://127.0.0.1:5173/auth/recovery',
      captchaToken: 'synthetic-captcha-token',
    });
  });

  it('always verifies token hashes as recovery and maps rejection safely', async () => {
    const verifyOtp = vi
      .fn()
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'otp_expired' } });
    const gateway = new SupabaseAuthGateway(clientWithAuth({ verifyOtp }));

    await gateway.verifyRecoveryCredential('synthetic-token-hash');
    await expect(gateway.verifyRecoveryCredential('used-token-hash')).rejects.toMatchObject({
      code: 'recovery_invalid',
    });
    expect(verifyOtp).toHaveBeenNthCalledWith(1, {
      token_hash: 'synthetic-token-hash',
      type: 'recovery',
    });
  });

  it.each([
    ['weak_password', 'weak_password'],
    ['same_password', 'same_password'],
    ['unexpected_provider_failure', 'password_update_failed'],
  ])('maps %s without exposing provider details', async (providerCode, expectedCode) => {
    const updateUser = vi.fn().mockResolvedValue({
      data: null,
      error: { code: providerCode, message: 'sensitive provider detail' },
    });
    const gateway = new SupabaseAuthGateway(clientWithAuth({ updateUser }));

    await expect(gateway.updateRecoveredPassword('synthetic password')).rejects.toMatchObject({
      code: expectedCode,
    });
  });

  it.each([
    [
      'returns an error',
      vi
        .fn()
        .mockResolvedValueOnce({ error: { code: 'provider_failure' } })
        .mockResolvedValueOnce({ error: null }),
    ],
    [
      'rejects',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('unexpected global sign-out failure'))
        .mockResolvedValueOnce({ error: null }),
    ],
  ])(
    'maps revocation_failed and attempts local cleanup when global logout %s',
    async (_label, signOut) => {
      const gateway = new SupabaseAuthGateway(clientWithAuth({ signOut }));

      await expect(gateway.signOutEverywhere()).rejects.toMatchObject({
        name: 'AuthGatewayError',
        code: 'revocation_failed',
      });
      expect(signOut).toHaveBeenNthCalledWith(1, { scope: 'global' });
      expect(signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    },
  );
});

describe('FEAT-003 Supabase auth gateway', () => {
  it('accepts the pinned raw SVG shape without exposing the provisioning URI', async () => {
    const qrSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="2" height="2">' +
      '<rect x="0" y="0" width="1" height="1" style="fill:rgb(0,0,0);stroke:none"/>' +
      '</svg>';
    const gateway = enrollmentGateway(
      `data:image/svg+xml;utf-8,<?xml version="1.0"?>\n<!-- synthetic generator -->\n${qrSvg}`,
    );

    const prepared = await gateway.prepareAdminTotp('enrollment_required');

    expect(prepared).toEqual({
      kind: 'enrollment',
      factorId: '60000000-0000-4000-8000-000000000001',
      qrSvg,
      manualSecret: syntheticProviderSecret,
    });
    expect(JSON.stringify(prepared)).not.toContain('otpauth://');
  });

  it.each([
    [
      'a percent-encoded wrapper',
      'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%2F%3E%3C%2Fsvg%3E',
    ],
    [
      'a base64 wrapper',
      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0Lz48L3N2Zz4=',
    ],
    [
      'an extra wrapper parameter',
      'data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    ],
    ['an unwrapped raw SVG', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'],
    [
      'script content',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><script/><rect/></svg>',
    ],
    [
      'foreign content',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/><rect/></svg>',
    ],
    [
      'an event handler',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
    ],
    [
      'a link reference',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><rect href="https://example.test/a"/></svg>',
    ],
    [
      'a CSS URL',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://example.test/a)"/></svg>',
    ],
    [
      'a doctype or entity',
      'data:image/svg+xml;utf-8,<!DOCTYPE svg [<!ENTITY x "x">]><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    ],
    [
      'CDATA',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><![CDATA[x]]><rect/></svg>',
    ],
    [
      'an image element',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><image/><rect/></svg>',
    ],
    [
      'a use element',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><use/><rect/></svg>',
    ],
    [
      'a non-QR path',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
    ],
    [
      'an oversized body',
      `data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg">${'<rect x="0" y="0" width="1" height="1"/>'.repeat(14_000)}</svg>`,
    ],
    [
      'an oversized leading comment',
      `data:image/svg+xml;utf-8,<!--${'x'.repeat(513)}--><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`,
    ],
    [
      'an in-document comment',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><!--x--><rect/></svg>',
    ],
    [
      'an unapproved root attribute',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2" focusable="true"><rect x="0" y="0" width="1" height="1" style="fill:black"/></svg>',
    ],
    [
      'an unapproved rectangle attribute',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect x="0" y="0" width="1" height="1" rx="1" style="fill:black"/></svg>',
    ],
    [
      'an unapproved CSS property',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect x="0" y="0" width="1" height="1" style="fill:black;filter:none"/></svg>',
    ],
    [
      'a duplicate CSS property',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect x="0" y="0" width="1" height="1" style="fill:black;fill:white"/></svg>',
    ],
    [
      'an oversized SVG dimension',
      'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="4097" height="2"><rect x="0" y="0" width="1" height="1" style="fill:black"/></svg>',
    ],
  ])('rejects %s from the provider SVG contract', async (_label, qrSvg) => {
    await expect(
      enrollmentGateway(qrSvg).prepareAdminTotp('enrollment_required'),
    ).rejects.toMatchObject({
      code: 'admin_onboarding_provider_unavailable',
      message: 'Authenticator enrollment could not be prepared safely.',
    });
  });

  it('rejects hidden or conflicting provider factor inventory', async () => {
    const factor = {
      id: '60000000-0000-4000-8000-000000000001',
      factor_type: 'totp',
      status: 'verified',
    };
    const gateway = new SupabaseAuthGateway(
      clientWithAuth({
        mfa: {
          listFactors: vi.fn().mockResolvedValue({
            data: { all: [factor], totp: [], phone: [], webauthn: [] },
            error: null,
          }),
        },
      }),
    );

    await expect(gateway.prepareAdminTotp('challenge_required')).rejects.toMatchObject({
      code: 'admin_onboarding_conflict',
    });
  });

  it('maps provider MFA preparation throttling to accessible wait guidance', async () => {
    const gateway = new SupabaseAuthGateway(
      clientWithAuth({
        mfa: {
          listFactors: vi.fn().mockResolvedValue({
            data: null,
            error: { status: 429, message: 'restricted provider detail' },
          }),
        },
      }),
    );

    await expect(gateway.prepareAdminTotp('enrollment_required')).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'Too many attempts. Wait before trying again.',
    });
  });
});

describe('FEAT-006A Supabase auth gateway', () => {
  const start = {
    decision: 'ready' as const,
    operationId: '30000000-0000-4000-8000-000000000001',
    organizationId: '40000000-0000-4000-8000-000000000001',
    organizationName: 'Synthetic Flight School',
    membershipId: '50000000-0000-4000-8000-000000000001',
    operationVersion: 1,
    replayed: false,
    factorState: 'enrollment_required' as const,
    correlationId: '70000000-0000-4000-8000-000000000001',
  };

  function memberEnrollmentGateway(unenrollError: unknown = null) {
    const unenroll = vi.fn().mockResolvedValue({ data: {}, error: unenrollError });
    const invoke = vi.fn().mockResolvedValue({ data: { decision: 'unexpected' }, error: null });
    const gateway = new SupabaseAuthGateway(
      clientWithAuth(
        {
          mfa: {
            listFactors: vi.fn().mockResolvedValue({
              data: { all: [], totp: [], phone: [], webauthn: [] },
              error: null,
            }),
            enroll: vi.fn().mockResolvedValue({
              data: {
                id: '60000000-0000-4000-8000-000000000001',
                type: 'totp',
                totp: {
                  qr_code:
                    'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect x="0" y="0" width="1" height="1" style="fill:black"/></svg>',
                  secret: syntheticProviderSecret,
                  uri: syntheticProviderUri,
                },
              },
              error: null,
            }),
            unenroll,
          },
        },
        { invoke },
      ),
    );
    return { gateway, invoke, unenroll };
  }

  it('retains a newly enrolled factor when a binding outcome cannot be reconciled', async () => {
    const { gateway, unenroll } = memberEnrollmentGateway();

    await expect(
      gateway.prepareMemberTotp({ ...start }, '0123456789abcdef0123456789abcdef'),
    ).rejects.toMatchObject({ code: 'member_mfa_cleanup_uncertain' });
    expect(unenroll).not.toHaveBeenCalled();
  });

  it('accepts a lost bind response only when status proves the same bound operation', async () => {
    const { gateway, invoke, unenroll } = memberEnrollmentGateway();
    invoke.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({
      data: {
        decision: 'available',
        organizationId: start.organizationId,
        organizationName: start.organizationName,
        membershipId: start.membershipId,
        ready: false,
        operationState: 'bound',
        operationId: start.operationId,
        operationVersion: 2,
        factorState: 'resume_required',
        correlationId: start.correlationId,
      },
      error: null,
    });
    const mutableStart = { ...start };

    await expect(
      gateway.prepareMemberTotp(mutableStart, '0123456789abcdef0123456789abcdef'),
    ).resolves.toMatchObject({
      kind: 'enrollment',
      factorId: '60000000-0000-4000-8000-000000000001',
    });
    expect(mutableStart.operationVersion).toBe(2);
    expect(unenroll).not.toHaveBeenCalled();
  });

  it.each(['unverified', 'verified'] as const)(
    'resumes the database-proven bound %s factor without creating or rebinding one',
    async (status) => {
      const boundFactor = {
        id: '60000000-0000-4000-8000-000000000001',
        factor_type: 'totp',
        status,
      };
      const enroll = vi.fn();
      const invoke = vi.fn();
      const gateway = new SupabaseAuthGateway(
        clientWithAuth(
          {
            mfa: {
              listFactors: vi.fn().mockResolvedValue({
                data: { all: [boundFactor], totp: [boundFactor], phone: [], webauthn: [] },
                error: null,
              }),
              enroll,
            },
          },
          { invoke },
        ),
      );

      await expect(
        gateway.prepareMemberTotp(
          { ...start, operationVersion: 2, factorState: 'challenge_required' },
          '0123456789abcdef0123456789abcdef',
        ),
      ).resolves.toEqual({ kind: 'challenge', factorId: boundFactor.id });
      expect(enroll).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    },
  );
});

describe('FEAT-004 Supabase auth gateway', () => {
  it('reauthenticates an existing confirmed invitee without changing the password', async () => {
    const updateUser = vi.fn();
    const signInWithPassword = vi.fn().mockResolvedValue({ data: {}, error: null });
    const gateway = new SupabaseAuthGateway(
      clientWithAuth(
        {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                email: 'existing@example.test',
                email_confirmed_at: '2026-08-09T00:00:00Z',
              },
            },
            error: null,
          }),
          updateUser,
          signInWithPassword,
        },
        {
          invoke: vi.fn().mockResolvedValue({
            data: {
              decision: 'prepared',
              invitationId: '40000000-0000-4000-8000-000000000001',
              credentialMode: 'existing',
              version: 2,
              correlationId: '60000000-0000-4000-8000-000000000001',
            },
            error: null,
          }),
        },
      ),
    );

    await gateway.prepareInvitationCredential('Synthetic-password-004!', {
      invitationId: '40000000-0000-4000-8000-000000000001',
      expectedVersion: 2,
    });

    expect(updateUser).not.toHaveBeenCalled();
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'existing@example.test',
      password: 'Synthetic-password-004!',
    });
  });

  it('establishes a new invited account password before fresh password sign-in', async () => {
    const updateUser = vi.fn().mockResolvedValue({ data: {}, error: null });
    const signInWithPassword = vi.fn().mockResolvedValue({ data: {}, error: null });
    const gateway = new SupabaseAuthGateway(
      clientWithAuth(
        {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                email: 'new@example.test',
                email_confirmed_at: '2026-08-09T00:00:00Z',
                invited_at: '2026-08-09T00:00:00Z',
              },
            },
            error: null,
          }),
          updateUser,
          signInWithPassword,
        },
        {
          invoke: vi.fn().mockResolvedValue({
            data: {
              decision: 'prepared',
              invitationId: '40000000-0000-4000-8000-000000000001',
              credentialMode: 'new',
              version: 2,
              correlationId: '60000000-0000-4000-8000-000000000001',
            },
            error: null,
          }),
        },
      ),
    );

    await gateway.prepareInvitationCredential('Synthetic-password-004!', {
      invitationId: '40000000-0000-4000-8000-000000000001',
      expectedVersion: 2,
    });

    expect(updateUser).toHaveBeenCalledWith({ password: 'Synthetic-password-004!' });
    expect(updateUser.mock.invocationCallOrder[0]).toBeLessThan(
      signInWithPassword.mock.invocationCallOrder[0]!,
    );
  });

  it('validates the protected invitation list response', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        decision: 'listed',
        organizationId: '20000000-0000-4000-8000-000000000001',
        invitations: [],
        roles: [{ code: 'student_pilot', label: 'Student Pilot' }],
        correlationId: '30000000-0000-4000-8000-000000000001',
      },
      error: null,
    });
    const gateway = new SupabaseAuthGateway({
      auth: {},
      functions: { invoke },
    } as unknown as SupabaseClient<Database>);

    await expect(
      gateway.loadMemberInvitations('20000000-0000-4000-8000-000000000001'),
    ).resolves.toMatchObject({ decision: 'listed', invitations: [] });
    expect(invoke).toHaveBeenCalledWith('member-invitations', {
      body: {
        action: 'list',
        organizationId: '20000000-0000-4000-8000-000000000001',
      },
    });
  });
});
