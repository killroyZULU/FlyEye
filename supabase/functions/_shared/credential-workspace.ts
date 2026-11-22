import { z } from 'zod';

export const applicabilitySchema = z.enum(['trainee', 'instructor', 'both']);
export const credentialRequests = [
  z
    .object({
      action: z.literal('my_credentials'),
      organizationId: z.uuid(),
      membershipId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal('personnel_credentials'),
      organizationId: z.uuid(),
      after: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_credential_applicability'),
      organizationId: z.uuid(),
      membershipId: z.uuid(),
      applicability: applicabilitySchema,
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
] as const;
export type CredentialRequest = z.infer<(typeof credentialRequests)[number]>;
export const credentialResult = z
  .object({
    decision: z.literal('credential_workspace'),
    organizationId: z.uuid(),
    correlationId: z.uuid(),
    members: z
      .array(
        z
          .object({
            membershipId: z.uuid(),
            displayName: z.string().nullable(),
            applicability: applicabilitySchema.nullable(),
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .max(50),
    hasMore: z.boolean(),
  })
  .strict();
export type CredentialResult = z.infer<typeof credentialResult>;
export function matchesCredentialRequest(result: CredentialResult, request: CredentialRequest) {
  return (
    result.organizationId === request.organizationId &&
    (request.action === 'personnel_credentials' ||
      (!result.hasMore &&
        result.members.length === 1 &&
        result.members[0]?.membershipId === request.membershipId))
  );
}
