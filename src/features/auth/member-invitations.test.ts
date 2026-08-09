import { describe, expect, it, vi } from 'vitest';

import {
  createIdempotencyKey,
  invitationFormSchema,
  invitationHintFromUrl,
  scrubInvitationHint,
} from './member-invitations';

describe('FEAT-004 invitation browser contracts', () => {
  it('accepts an exact invitation hint without treating it as authority', () => {
    expect(
      invitationHintFromUrl(
        new URL(
          'http://127.0.0.1:5173/auth/invitation?invitation=10000000-0000-4000-8000-000000000001&version=2#access_token=provider-token',
        ),
      ),
    ).toEqual({
      invitationId: '10000000-0000-4000-8000-000000000001',
      version: 2,
    });
  });

  it('rejects extra callback fields and invalid versions', () => {
    expect(
      invitationHintFromUrl(
        new URL(
          'http://127.0.0.1:5173/auth/invitation?invitation=10000000-0000-4000-8000-000000000001&version=0&role=admin',
        ),
      ),
    ).toBeNull();
  });

  it('uses ASCII trim-plus-lowercase without provider alias rewriting', () => {
    expect(
      invitationFormSchema.parse({ email: ' Pilot+Tag@Example.Test ', roleCode: 'student_pilot' }),
    ).toEqual({ email: 'pilot+tag@example.test', roleCode: 'student_pilot' });
    expect(
      invitationFormSchema.safeParse({ email: 'pílot@example.test', roleCode: 'student_pilot' })
        .success,
    ).toBe(false);
  });

  it('scrubs the invitation identifier from browser history', () => {
    const replaceState = vi.fn();
    scrubInvitationHint({ replaceState } as unknown as History);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/auth/invitation');
  });

  it('creates bounded opaque idempotency keys', () => {
    expect(createIdempotencyKey()).toMatch(/^[0-9a-f]{32}$/);
  });
});
