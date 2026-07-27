import { describe, expect, it, vi } from 'vitest';

import {
  RECOVERY_COMPLETE_PATH,
  approvedRecoveryRedirect,
  recoveredPasswordSchema,
  recoveryCredentialFromUrl,
  recoveryRequestSchema,
  scrubRecoveryCredential,
} from './recovery';

describe('FEAT-002 recovery contracts', () => {
  it('normalizes email and permits only the exact local recovery callbacks', () => {
    expect(recoveryRequestSchema.parse({ email: '  USER@EXAMPLE.TEST ' }).email).toBe(
      'user@example.test',
    );
    expect(approvedRecoveryRedirect('http://127.0.0.1:5173')).toBe(
      'http://127.0.0.1:5173/auth/recovery',
    );
    expect(approvedRecoveryRedirect('http://127.0.0.1:4173')).toBe(
      'http://127.0.0.1:4173/auth/recovery',
    );
    expect(() => approvedRecoveryRedirect('https://tenant.example')).toThrow(
      'Password recovery is not configured',
    );
  });

  it('reads only one token hash from the fixed route and rejects supplied workflow authority', () => {
    const credential = 'synthetic-token-hash-value-1234567890';

    expect(
      recoveryCredentialFromUrl(
        new URL(`http://127.0.0.1:5173${RECOVERY_COMPLETE_PATH}?token_hash=${credential}`),
      ),
    ).toBe(credential);
    expect(
      recoveryCredentialFromUrl(
        new URL(
          `http://127.0.0.1:5173${RECOVERY_COMPLETE_PATH}?token_hash=${credential}&type=recovery`,
        ),
      ),
    ).toBeNull();
    expect(
      recoveryCredentialFromUrl(
        new URL(
          `http://127.0.0.1:5173${RECOVERY_COMPLETE_PATH}?token_hash=${credential}&next=/admin`,
        ),
      ),
    ).toBeNull();
    expect(
      recoveryCredentialFromUrl(new URL(`http://127.0.0.1:5173/?token_hash=${credential}`)),
    ).toBeNull();
  });

  it('scrubs credential material from browser history', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');

    scrubRecoveryCredential(window.history);

    expect(replaceState).toHaveBeenCalledWith(null, '', RECOVERY_COMPLETE_PATH);
  });

  it('applies the approved password baseline without composition rules', () => {
    expect(
      recoveredPasswordSchema.safeParse({
        password: 'fifteen spaces  ',
        confirmation: 'fifteen spaces  ',
      }).success,
    ).toBe(true);
    expect(
      recoveredPasswordSchema.safeParse({
        password: 'x'.repeat(64),
        confirmation: 'x'.repeat(64),
      }).success,
    ).toBe(true);
    expect(
      recoveredPasswordSchema.safeParse({
        password: 'too short',
        confirmation: 'too short',
      }).success,
    ).toBe(false);
    expect(
      recoveredPasswordSchema.safeParse({
        password: 'long-enough-password',
        confirmation: 'different-password',
      }).success,
    ).toBe(false);
  });
});
