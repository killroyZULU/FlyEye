import { z } from 'zod';

export const memberStatusSchema = z.enum(['active', 'suspended', 'revoked']);
export const memberStatusActionSchema = z.enum(['suspend', 'reactivate', 'revoke']);
export const statusReasonOptionSchema = z
  .object({
    action: memberStatusActionSchema,
    code: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    label: z.string().min(2).max(80),
  })
  .strict();
export const memberSummarySchema = z
  .object({
    membershipId: z.uuid(),
    displayName: z.string().min(2).max(80).nullable(),
    email: z.email().max(254),
    roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    roleLabel: z.string().min(2).max(80),
    status: memberStatusSchema,
    membershipVersion: z.number().int().positive(),
    profileVersion: z.number().int().positive(),
    profileComplete: z.boolean(),
    createdAt: z.string().min(1).max(80),
  })
  .strict();

export const memberDetailSchema = memberSummarySchema
  .extend({
    contactNumber: z.string().max(32).nullable(),
    statusReasonOptions: z.array(statusReasonOptionSchema).max(4),
    updatedAt: z.string().min(1).max(80),
  })
  .strict();

export const memberListSchema = z
  .object({
    decision: z.literal('listed'),
    organizationId: z.uuid(),
    members: z.array(memberSummarySchema).max(50),
    nextCursor: z.string().min(32).max(1024).optional(),
    correlationId: z.uuid(),
  })
  .strict();

export const memberDetailResultSchema = z
  .object({
    decision: z.literal('found'),
    organizationId: z.uuid(),
    member: memberDetailSchema,
    correlationId: z.uuid(),
  })
  .strict();

export const memberProfileSchema = z
  .object({
    organizationId: z.uuid(),
    organizationName: z.string().min(2).max(160),
    membershipId: z.uuid(),
    displayName: z.string().min(2).max(80).nullable(),
    contactNumber: z.string().max(32).nullable(),
    email: z.email().max(254),
    roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    roleLabel: z.string().min(2).max(80),
    status: z.literal('active'),
    version: z.number().int().positive(),
    complete: z.boolean(),
  })
  .strict();

export const memberProfileResultSchema = z
  .object({
    decision: z.enum(['found', 'updated']),
    profile: memberProfileSchema,
    correlationId: z.uuid(),
  })
  .strict();

export const memberStatusResultSchema = z
  .object({
    decision: memberStatusSchema,
    membershipId: z.uuid(),
    organizationId: z.uuid(),
    status: memberStatusSchema,
    roleCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{2,63}$/)
      .optional(),
    roleLabel: z.string().min(2).max(80).optional(),
    version: z.number().int().positive(),
    replayed: z.boolean(),
    correlationId: z.uuid(),
  })
  .strict();

export const profileFormSchema = z.object({
  displayName: z.string().trim().min(2, 'Enter 2 to 80 characters.').max(80),
  contactNumber: z
    .string()
    .trim()
    .max(32, 'Enter no more than 32 characters.')
    .refine(
      (value) => value === '' || /^[0-9 +().-]+$/.test(value),
      'Use only digits, spaces, +, -, parentheses, and periods.',
    ),
});

export const memberSearchSchema = z.string().trim().min(2).max(80);

export type MemberStatus = z.infer<typeof memberStatusSchema>;
export type MemberSummary = z.infer<typeof memberSummarySchema>;
export type MemberDetail = z.infer<typeof memberDetailSchema>;
export type MemberList = z.infer<typeof memberListSchema>;
export type MemberProfile = z.infer<typeof memberProfileSchema>;
export type MemberStatusAction = z.infer<typeof memberStatusActionSchema>;
export type MemberStatusResult = z.infer<typeof memberStatusResultSchema>;

export function createMemberIdempotencyKey(): string {
  return crypto
    .getRandomValues(new Uint8Array(16))
    .reduce((value, byte) => `${value}${byte.toString(16).padStart(2, '0')}`, '');
}
