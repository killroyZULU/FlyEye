import { z } from 'zod';
import type { RuntimeProfile } from './staging-runtime-policy.ts';

const binding = z
  .strictObject({
    version: z.literal('retained-instructor-once-v1'),
    authorizationId: z.uuidv4(),
    packageSha256: z.hash('sha256'),
    schoolId: z.uuid(),
    adminId: z.uuid(),
    candidateId: z.uuid(),
    membershipId: z.uuid(),
    keyHash: z.hash('sha256'),
    expiresAt: z.iso.datetime(),
  })
  .refine((p) => p.adminId !== p.candidateId);
export type RetainedInstructorPolicy = z.infer<typeof binding>;

export function readRetainedInstructorPolicy(profile: RuntimeProfile, value?: string) {
  if (value === undefined) return undefined;
  try {
    if (profile === 'staging-synthetic-v1' && value.length <= 2048)
      return binding.parse(JSON.parse(value));
  } catch {
    /* Keep operator configuration out of diagnostics. */
  }
  throw new Error('Invalid retained Instructor policy.');
}
