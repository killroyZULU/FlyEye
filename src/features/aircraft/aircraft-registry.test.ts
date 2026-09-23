import { describe, expect, it, vi } from 'vitest';

import {
  aircraftRecordSchema,
  createAircraftIdempotencyKey,
  validateAircraftForm,
} from './aircraft-registry';

describe('aircraft registry browser contract', () => {
  it('normalizes valid form values without inventing a registration format', () => {
    expect(
      validateAircraftForm({
        registrationMark: ' test registration ',
        manufacturer: ' Synthetic Maker ',
        model: ' Model 1 ',
      }),
    ).toEqual({
      success: true,
      data: {
        registrationMark: 'TEST REGISTRATION',
        manufacturer: 'Synthetic Maker',
        model: 'Model 1',
      },
    });
  });

  it('returns field-specific messages for invalid text', () => {
    const result = validateAircraftForm({
      registrationMark: 'RP—1',
      manufacturer: '',
      model: 'M\t1',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.messages).toHaveLength(3);
  });

  it('validates response lengths by Unicode code point rather than UTF-16 unit', () => {
    expect(
      aircraftRecordSchema.safeParse({
        id: '50000000-0000-4000-8000-000000000001',
        registrationMark: 'RP-C123',
        manufacturer: '😀'.repeat(100),
        model: '𐐀'.repeat(100),
        registryState: 'tracked',
        version: 1,
        updatedAt: '2026-08-29T00:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('creates an opaque 128-bit hexadecimal retry key', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((value) => {
      (value as Uint8Array).fill(15);
      return value;
    });
    expect(createAircraftIdempotencyKey()).toBe('0f'.repeat(16));
  });
});
