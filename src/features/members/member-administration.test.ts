import { describe, expect, it } from 'vitest';

import {
  memberSearchSchema,
  profileFormSchema,
  statusReasonOptionSchema,
} from './member-administration';

describe('FEAT-005 member administration contracts', () => {
  it('accepts only bounded profile values', () => {
    expect(
      profileFormSchema.safeParse({
        displayName: 'Synthetic Member',
        contactNumber: '+63 (2) 555-0100',
      }).success,
    ).toBe(true);
    expect(profileFormSchema.safeParse({ displayName: ' ', contactNumber: '' }).success).toBe(
      false,
    );
    expect(
      profileFormSchema.safeParse({ displayName: 'Synthetic Member', contactNumber: '555 ext abc' })
        .success,
    ).toBe(false);
  });

  it('requires bounded search text', () => {
    expect(memberSearchSchema.safeParse('ab').success).toBe(true);
    expect(memberSearchSchema.safeParse('a').success).toBe(false);
  });

  it('validates bounded server-provided reason options', () => {
    expect(
      statusReasonOptionSchema.safeParse({
        action: 'suspend',
        code: 'temporary_access_hold',
        label: 'Temporary access hold',
      }).success,
    ).toBe(true);
    expect(
      statusReasonOptionSchema.safeParse({
        action: 'delete',
        code: 'temporary_access_hold',
        label: 'Temporary access hold',
      }).success,
    ).toBe(false);
  });
});
