import { describe, expect, it } from 'vitest';

import {
  memberSearchSchema,
  profileFormSchema,
  statusReasonOptions,
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

  it('keeps reason codes exact and action-specific', () => {
    expect(statusReasonOptions.suspend.map((item) => item.code)).toEqual([
      'temporary_access_hold',
      'administrative_review',
    ]);
    expect(statusReasonOptions.reactivate.map((item) => item.code)).not.toContain(
      'temporary_access_hold',
    );
    expect(statusReasonOptions.revoke.map((item) => item.code)).toEqual([
      'membership_ended',
      'membership_created_in_error',
    ]);
  });
});
