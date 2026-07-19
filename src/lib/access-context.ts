import { z } from 'zod';
import type { RoleCode } from '../../supabase/functions/_shared/access-context';

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

export function requiresMfa(role: RoleCode): boolean {
  return role === 'instructor_pilot' || role === 'admin';
}

export function landingLabel(role: RoleCode): string {
  switch (role) {
    case 'student_pilot':
      return 'Student workspace';
    case 'instructor_pilot':
      return 'Instructor workspace';
    case 'admin':
      return 'Administration workspace';
  }
}
