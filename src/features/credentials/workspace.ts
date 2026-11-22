import { z } from 'zod';
const applicabilitySchema = z.enum(['trainee', 'instructor', 'both']);
export type CredentialRequest = { organizationId: string } & (
  | { action: 'my_credentials'; membershipId: string }
  | { action: 'personnel_credentials'; after?: string }
  | {
      action: 'set_credential_applicability';
      membershipId: string;
      applicability: z.infer<typeof applicabilitySchema>;
      expectedVersion: number;
    }
);
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
