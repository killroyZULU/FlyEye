import { describe, expect, it, vi } from 'vitest';
import { quiesce } from './h002-registry-implicit-cleanup.mjs';

describe('registry fixture quiescence before data cleanup', () => {
  it('settles every child and checks absence despite a close failure', async () => {
    const second = vi.fn().mockResolvedValue();
    const query = vi.fn().mockResolvedValue('1');
    const deletion = vi.fn();
    await expect(
      quiesce(
        [
          {
            close: async () => {
              throw new Error('close');
            },
          },
          { close: second },
        ],
        [{ result: Promise.resolve({ value: {} }) }],
        query,
        'absence',
      ).then(deletion),
    ).rejects.toThrow();
    expect(second).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith('absence');
    expect(deletion).not.toHaveBeenCalled();
  });
  it('does not permit data cleanup if the absence query fails', async () => {
    const deletion = vi.fn();
    await expect(
      quiesce(
        [{ close: async () => {} }],
        [],
        async () => {
          throw new Error('observer');
        },
        'absence',
      ).then(deletion),
    ).rejects.toThrow();
    expect(deletion).not.toHaveBeenCalled();
  });
  it('permits cleanup only after successful settlement and verified absence', async () => {
    const deletion = vi.fn();
    await quiesce(
      [{ close: async () => {} }],
      [{ result: Promise.resolve({ value: {} }) }],
      async () => '0',
      'absence',
    ).then(deletion);
    expect(deletion).toHaveBeenCalledOnce();
  });
  it('stops further cases when a worker settles with an error', async () => {
    const nextCase = vi.fn();
    await expect(
      quiesce(
        [],
        [{ result: Promise.resolve({ error: new Error('worker') }) }],
        async () => '0',
        'absence',
      ).then(nextCase),
    ).rejects.toThrow();
    expect(nextCase).not.toHaveBeenCalled();
  });
});
