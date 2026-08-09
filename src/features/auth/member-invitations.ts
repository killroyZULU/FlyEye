import { z } from 'zod';

export const INVITATION_PATH = '/auth/invitation';
export const invitationStatusSchema = z.enum([
  'issuing',
  'pending',
  'delivery_failed',
  'delivery_uncertain',
  'accepted',
  'expired',
  'superseded',
  'revoked',
]);
export const invitationRoleSchema = z
  .object({ code: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/), label: z.string().min(2).max(80) })
  .strict();
export const memberInvitationSchema = z
  .object({
    invitationId: z.uuid(),
    email: z.string().min(3).max(254),
    roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    roleLabel: z.string().min(2).max(80),
    status: invitationStatusSchema,
    version: z.number().int().positive(),
    issuedAt: z.string().min(1).max(80),
    expiresAt: z.string().min(1).max(80),
  })
  .strict();
export const memberInvitationListSchema = z
  .object({
    decision: z.literal('listed'),
    organizationId: z.uuid(),
    invitations: z.array(memberInvitationSchema).max(100),
    roles: z.array(invitationRoleSchema).max(64),
    correlationId: z.uuid(),
  })
  .strict();
export const invitationMutationSchema = z
  .object({
    decision: z.enum(['pending', 'revoked', 'accepted']),
    invitationId: z.uuid(),
    organizationId: z.uuid().optional(),
    membershipId: z.uuid().optional(),
    version: z.number().int().positive(),
    replayed: z.boolean().optional(),
    correlationId: z.uuid(),
  })
  .strict();
export const invitationPreparationSchema = z
  .object({
    decision: z.literal('prepared'),
    invitationId: z.uuid(),
    credentialMode: z.enum(['new', 'existing']),
    version: z.number().int().positive(),
    correlationId: z.uuid(),
  })
  .strict();
export const invitationFormSchema = z.object({
  email: z
    .string()
    .max(254)
    .refine((value) =>
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code <= 126;
      }),
    )
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.email().max(254)),
  roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
});
export const invitationCredentialSchema = z.string().min(15).max(1024);

export type InvitationRole = z.infer<typeof invitationRoleSchema>;
export type MemberInvitation = z.infer<typeof memberInvitationSchema>;
export type MemberInvitationList = z.infer<typeof memberInvitationListSchema>;
export type InvitationMutation = z.infer<typeof invitationMutationSchema>;

export function invitationHintFromUrl(url: URL): {
  invitationId: string;
  version: number;
} | null {
  if (url.pathname !== INVITATION_PATH) return null;
  if ([...url.searchParams.keys()].some((key) => !['invitation', 'version'].includes(key))) {
    return null;
  }
  const invitations = url.searchParams.getAll('invitation');
  const versions = url.searchParams.getAll('version');
  if (invitations.length !== 1 || versions.length !== 1) return null;
  const invitationId = z.uuid().safeParse(invitations[0]);
  const version = z.coerce.number().int().positive().safeParse(versions[0]);
  return invitationId.success && version.success
    ? { invitationId: invitationId.data, version: version.data }
    : null;
}

export function scrubInvitationHint(history: History): void {
  history.replaceState(null, '', INVITATION_PATH);
}

export function createIdempotencyKey(): string {
  return crypto
    .getRandomValues(new Uint8Array(16))
    .reduce((value, byte) => `${value}${byte.toString(16).padStart(2, '0')}`, '');
}
