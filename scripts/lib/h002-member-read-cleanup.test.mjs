import { describe, expect, it, vi } from 'vitest';
import { finishCleanup, sessionsAbsent } from './h002-member-read-cleanup.mjs';

describe('member read fixture final cleanup hard stop', () => {
  it('does not query or delete after failed settlement or case cleanup', async () => {
    const query = vi.fn().mockResolvedValue('0');
    await expect(finishCleanup({ query }, { owned: true, safe: false })).rejects.toThrow(
      'unverified',
    );
    expect(query).not.toHaveBeenCalled();
  });
  it.each(['1', 'unknown'])('does not delete when session absence is %s', async (value) => {
    const query = vi.fn().mockResolvedValue(value);
    await expect(finishCleanup({ query }, { owned: true, safe: true })).rejects.toThrow();
    expect(query).toHaveBeenCalledExactlyOnceWith(sessionsAbsent);
  });
  it('does not delete after an absence-query failure', async () => {
    const query = vi.fn().mockRejectedValue(new Error('observer'));
    await expect(finishCleanup({ query }, { owned: true, safe: true })).rejects.toThrow();
    expect(query).toHaveBeenCalledOnce();
  });
  it('preserves data when preflight did not establish ownership', async () => {
    const query = vi.fn().mockResolvedValue('0');
    expect(await finishCleanup({ query }, { owned: false, safe: true })).toBe(false);
    expect(query).toHaveBeenCalledExactlyOnceWith(sessionsAbsent);
  });
  it('confirms residue and permission definitions after owned cleanup', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce('0')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('0')
      .mockResolvedValueOnce('permissions');
    expect(
      await finishCleanup(
        { query },
        { owned: true, safe: true, originalPermissions: 'permissions' },
      ),
    ).toBe(true);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[1][0]).toMatch(/^begin;/);
  });
});
