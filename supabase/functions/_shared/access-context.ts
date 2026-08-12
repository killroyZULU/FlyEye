import { z } from 'zod';

export const roleCodeSchema = z.enum(['student_pilot', 'instructor_pilot', 'admin']);
export const assuranceLevelSchema = z.enum(['aal1', 'aal2']);
export const accessStatusSchema = z.enum(['granted', 'mfa_required', 'denied']);

export type RoleCode = z.infer<typeof roleCodeSchema>;
export type AssuranceLevel = z.infer<typeof assuranceLevelSchema>;
export type AccessStatus = z.infer<typeof accessStatusSchema>;

export const accessMembershipSchema = z
  .object({
    membershipId: z.uuid(),
    organizationId: z.uuid(),
    organizationName: z.string().trim().min(2).max(160),
    role: roleCodeSchema,
    permissions: z.array(z.string().regex(/^[a-z][a-z0-9_.]{2,127}$/)),
    membershipVersion: z.number().int().positive(),
    requiredAssuranceLevel: assuranceLevelSchema,
    accessStatus: accessStatusSchema,
  })
  .strict();

export type AccessMembership = z.infer<typeof accessMembershipSchema>;

export const accessContextResponseSchema = z
  .object({
    memberships: z.array(accessMembershipSchema).max(1),
    correlationId: z.uuid(),
    decision: accessStatusSchema,
    currentAssuranceLevel: assuranceLevelSchema,
    selectedOrganizationId: z.null(),
    organizationIds: z.array(z.uuid()).max(1),
  })
  .strict()
  .superRefine((context, refinement) => {
    const membershipOrganizationIds = context.memberships.map(
      (membership) => membership.organizationId,
    );
    const uniqueMembershipOrganizations = new Set(membershipOrganizationIds);
    const uniqueOrganizationIds = new Set(context.organizationIds);

    if (
      uniqueMembershipOrganizations.size !== membershipOrganizationIds.length ||
      uniqueOrganizationIds.size !== context.organizationIds.length ||
      uniqueMembershipOrganizations.size !== uniqueOrganizationIds.size ||
      [...uniqueMembershipOrganizations].some((id) => !uniqueOrganizationIds.has(id))
    ) {
      refinement.addIssue({
        code: 'custom',
        message: 'Organization context must exactly match unique memberships.',
        path: ['organizationIds'],
      });
    }

    for (const [index, membership] of context.memberships.entries()) {
      const privileged = membership.role === 'instructor_pilot' || membership.role === 'admin';
      const expectedAssurance = privileged ? 'aal2' : 'aal1';
      if (membership.requiredAssuranceLevel !== expectedAssurance) {
        refinement.addIssue({
          code: 'custom',
          message: 'Role and required assurance level conflict.',
          path: ['memberships', index, 'requiredAssuranceLevel'],
        });
      }
      if (
        privileged &&
        context.currentAssuranceLevel !== 'aal2' &&
        membership.accessStatus === 'granted'
      ) {
        refinement.addIssue({
          code: 'custom',
          message: 'Privileged access cannot be granted below AAL2.',
          path: ['memberships', index, 'accessStatus'],
        });
      }
    }

    const expectedDecision = context.memberships.some(
      (membership) => membership.accessStatus === 'granted',
    )
      ? 'granted'
      : context.memberships.some((membership) => membership.accessStatus === 'mfa_required')
        ? 'mfa_required'
        : 'denied';
    if (context.decision !== expectedDecision) {
      refinement.addIssue({
        code: 'custom',
        message: 'The final decision conflicts with membership decisions.',
        path: ['decision'],
      });
    }
  });

export type AccessContextResponse = z.infer<typeof accessContextResponseSchema>;
