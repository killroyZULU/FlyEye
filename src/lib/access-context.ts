import { z } from 'zod';
import type { AccessMembership, RoleCode } from '../../supabase/functions/_shared/access-context';

export {
  accessContextResponseSchema,
  accessMembershipSchema,
  accessStatusSchema,
  assuranceLevelSchema,
  roleCodeSchema,
  type AccessContextResponse,
  type AccessMembership,
  type AccessStatus,
  type AssuranceLevel,
  type RoleCode,
} from '../../supabase/functions/_shared/access-context';

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(1024),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export function requiresMfa(membership: Pick<AccessMembership, 'requiredAssuranceLevel'>): boolean {
  return membership.requiredAssuranceLevel === 'aal2';
}

export function landingLabel(role: RoleCode, roleLabel?: string): string {
  switch (role) {
    case 'student_pilot':
      return 'Student workspace';
    case 'instructor_pilot':
      return 'Instructor workspace';
    case 'admin':
      return 'Administration workspace';
    default:
      return roleLabel ? `${roleLabel} workspace` : 'FlyEye workspace';
  }
}
