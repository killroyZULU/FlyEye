import { describe, expect, it } from 'vitest';

import {
  accessContextResponseSchema,
  landingLabel,
  loginRequestSchema,
  requiresMfa,
} from './access-context';

describe('access context contracts', () => {
  it('accepts the three approved role codes', () => {
    for (const role of ['student_pilot', 'instructor_pilot', 'admin'] as const) {
      const parsed = accessContextResponseSchema.safeParse({
        memberships: [
          {
            membershipId: '10000000-0000-4000-8000-000000000001',
            organizationId: '20000000-0000-4000-8000-000000000001',
            organizationName: 'Synthetic Flight School',
            role,
            roleLabel:
              role === 'student_pilot'
                ? 'Student Pilot'
                : role === 'instructor_pilot'
                  ? 'Instructor Pilot'
                  : 'Organization Admin',
            workspacePermission: `portal.${role.replace('_pilot', '')}.access`,
            permissions: [`portal.${role.replace('_pilot', '')}.access`],
            membershipVersion: 1,
            requiredAssuranceLevel: role === 'student_pilot' ? 'aal1' : 'aal2',
            accessStatus: role === 'student_pilot' ? 'granted' : 'mfa_required',
          },
        ],
        correlationId: '30000000-0000-4000-8000-000000000001',
        decision: role === 'student_pilot' ? 'granted' : 'mfa_required',
        currentAssuranceLevel: 'aal1',
        selectedOrganizationId: null,
        organizationIds: ['20000000-0000-4000-8000-000000000001'],
      });

      expect(parsed.success).toBe(true);
    }
  });

  it('accepts a future validated role code with server-provided permissions', () => {
    const parsed = accessContextResponseSchema.safeParse({
      memberships: [
        {
          membershipId: '10000000-0000-4000-8000-000000000001',
          organizationId: '20000000-0000-4000-8000-000000000001',
          organizationName: 'Synthetic Flight School',
          role: 'cfi',
          roleLabel: 'Chief Flight Instructor',
          workspacePermission: 'portal.instructor.access',
          permissions: ['portal.instructor.access'],
          membershipVersion: 1,
          requiredAssuranceLevel: 'aal1',
          accessStatus: 'granted',
        },
      ],
      correlationId: '30000000-0000-4000-8000-000000000001',
      decision: 'granted',
      currentAssuranceLevel: 'aal1',
      selectedOrganizationId: null,
      organizationIds: ['20000000-0000-4000-8000-000000000001'],
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects malformed future role identifiers', () => {
    const parsed = accessContextResponseSchema.safeParse({
      memberships: [
        {
          membershipId: '10000000-0000-4000-8000-000000000001',
          organizationId: '20000000-0000-4000-8000-000000000001',
          organizationName: 'Synthetic Flight School',
          role: 'chief flight instructor',
          roleLabel: 'Chief Flight Instructor',
          workspacePermission: 'portal.instructor.access',
          permissions: ['portal.instructor.access'],
          membershipVersion: 1,
          requiredAssuranceLevel: 'aal2',
          accessStatus: 'granted',
        },
      ],
      correlationId: '30000000-0000-4000-8000-000000000001',
      decision: 'granted',
      currentAssuranceLevel: 'aal2',
      selectedOrganizationId: null,
      organizationIds: ['20000000-0000-4000-8000-000000000001'],
    });

    expect(parsed.success).toBe(false);
  });

  it('normalizes email without changing the password', () => {
    const parsed = loginRequestSchema.parse({
      email: '  STUDENT@EXAMPLE.TEST ',
      password: '  intentional spaces  ',
    });

    expect(parsed.email).toBe('student@example.test');
    expect(parsed.password).toBe('  intentional spaces  ');
  });

  it('uses server-provided assurance metadata for MFA', () => {
    expect(requiresMfa({ requiredAssuranceLevel: 'aal1' })).toBe(false);
    expect(requiresMfa({ requiredAssuranceLevel: 'aal2' })).toBe(true);
  });

  it('rejects more than one school context', () => {
    const organizationId = '20000000-0000-4000-8000-000000000001';
    const secondOrganizationId = '20000000-0000-4000-8000-000000000002';
    const baseMembership = {
      membershipId: '10000000-0000-4000-8000-000000000001',
      organizationId,
      organizationName: 'Synthetic Flight School',
      role: 'student_pilot',
      roleLabel: 'Student Pilot',
      workspacePermission: 'portal.student.access',
      permissions: ['portal.student.access'],
      membershipVersion: 1,
      requiredAssuranceLevel: 'aal1',
      accessStatus: 'granted',
    } as const;

    const parsed = accessContextResponseSchema.safeParse({
      memberships: [
        baseMembership,
        {
          ...baseMembership,
          membershipId: '10000000-0000-4000-8000-000000000002',
          organizationId: secondOrganizationId,
          organizationName: 'Unexpected Second School',
        },
      ],
      correlationId: '30000000-0000-4000-8000-000000000001',
      decision: 'granted',
      currentAssuranceLevel: 'aal1',
      selectedOrganizationId: null,
      organizationIds: [organizationId, secondOrganizationId],
    });

    expect(parsed.success).toBe(false);
  });

  it('maps approved roles to safe landing labels', () => {
    expect(landingLabel('student_pilot')).toBe('Student workspace');
    expect(landingLabel('instructor_pilot')).toBe('Instructor workspace');
    expect(landingLabel('admin')).toBe('Administration workspace');
    expect(landingLabel('chief_flight_instructor', 'Chief Flight Instructor')).toBe(
      'Chief Flight Instructor workspace',
    );
  });
});
