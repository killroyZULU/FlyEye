import { describe, expect, it } from 'vitest';

import {
  aircraftRequestSchema,
  canonicalMutationPayload,
  defaultCaseFold15_1,
  normalizeAircraftIdentity,
  normalizeAircraftSearch,
} from './domain';

describe('FEAT-007 aircraft registry domain', () => {
  it('implements pinned Unicode 15.1 default case-folding exceptions', () => {
    expect(defaultCaseFold15_1('Straße')).toBe('strasse');
    expect(defaultCaseFold15_1('ΟΣ')).toBe('οσ');
    expect(defaultCaseFold15_1('ﬃ')).toBe('ffi');
    expect(defaultCaseFold15_1('\uAB70')).toBe('\u13A0');
    expect(defaultCaseFold15_1('İ')).toBe('i\u0307');
  });

  it('does not adopt case mappings introduced after Unicode 15.1', () => {
    const garayCapitalA = '\u{10D50}';
    const garaySmallA = '\u{10D70}';
    expect(defaultCaseFold15_1(garayCapitalA)).toBe(garayCapitalA);
    expect(defaultCaseFold15_1(garaySmallA)).toBe(garaySmallA);
    expect(defaultCaseFold15_1(garayCapitalA)).not.toBe(defaultCaseFold15_1(garaySmallA));
  });

  it('normalizes the approved identity fields and derives the duplicate key', () => {
    expect(
      normalizeAircraftIdentity({
        registrationMark: ' rp-c 123 ',
        manufacturer: ' Cessna ',
        model: ' 172S ',
      }),
    ).toEqual({
      registrationMark: 'RP-C 123',
      registrationKey: 'rpc123',
      manufacturer: 'Cessna',
      model: '172S',
    });
  });

  it('rejects ambiguous separators, dash variants, controls, and empty keys', () => {
    for (const registrationMark of ['RP\u00A0C123', 'RP—C123', 'RP\tC123', ' - ']) {
      expect(() =>
        normalizeAircraftIdentity({ registrationMark, manufacturer: 'Cessna', model: '172S' }),
      ).toThrow();
    }
    expect(() => normalizeAircraftSearch('bad\u200Bsearch')).toThrow();
    expect(normalizeAircraftSearch('  172  ')).toBe('172');
    expect(normalizeAircraftSearch('')).toBeNull();
  });

  it('strictly separates versionless create from versioned mutations', () => {
    const validCreate = {
      action: 'create',
      registrationMark: 'RP-C123',
      manufacturer: 'Cessna',
      model: '172S',
      idempotencyKey: 'a'.repeat(32),
    } as const;
    expect(aircraftRequestSchema.safeParse(validCreate).success).toBe(true);
    expect(aircraftRequestSchema.safeParse({ ...validCreate, expectedVersion: 1 }).success).toBe(
      false,
    );
    expect(canonicalMutationPayload(validCreate, normalizeAircraftIdentity(validCreate))).toBe(
      '{"action":"create","registrationMark":"RP-C123","registrationKey":"rpc123","manufacturer":"Cessna","model":"172S"}',
    );
  });
});
