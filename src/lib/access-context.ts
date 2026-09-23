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

export function dashboardLabel(role: RoleCode, roleLabel?: string): string {
  switch (role) {
    case 'student_pilot':
      return 'Student dashboard';
    case 'instructor_pilot':
      return 'Instructor dashboard';
    case 'admin':
      return 'Administration dashboard';
    default:
      return roleLabel ? `${roleLabel} dashboard` : 'FlyEye dashboard';
  }
}
