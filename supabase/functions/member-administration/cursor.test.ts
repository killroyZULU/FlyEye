import { describe, expect, it } from 'vitest';

import { createMemberCursorCodec } from './cursor.ts';

const boundary = {
  createdAt: '2026-08-11T00:00:00Z',
  membershipId: '40000000-0000-4000-8000-000000000001',
};

describe('FEAT-005 signed member cursor', () => {
  it('round-trips the immutable tuple only for the bound query', async () => {
    const codec = await createMemberCursorCodec('a'.repeat(64));
    const cursor = await codec.encode(boundary, 'active', 'synthetic');
    await expect(codec.decode(cursor, 'active', 'synthetic')).resolves.toEqual(boundary);
    await expect(codec.decode(cursor, 'suspended', 'synthetic')).rejects.toThrow(
      'Mismatched cursor.',
    );
    await expect(codec.decode(cursor, 'active', 'different')).rejects.toThrow('Mismatched cursor.');
  });

  it('rejects a tampered server-issued cursor', async () => {
    const codec = await createMemberCursorCodec('b'.repeat(64));
    const cursor = await codec.encode(boundary, null, null);
    const [payload, signature] = cursor.split('.');
    const tampered = `${payload}x.${signature}`;
    await expect(codec.decode(tampered, null, null)).rejects.toThrow('Invalid cursor.');
  });
});
