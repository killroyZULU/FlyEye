import { z } from 'zod';

export const roles = Object.freeze(['student_pilot', 'instructor_pilot', 'admin']);
const role = z.enum(roles);
const id = z.uuid().refine((value) => value === value.toLowerCase());
const optionalId = id.nullable();
const journalId = z.uuidv4().refine((value) => value === value.toLowerCase());
const email = z
  .email()
  .max(254)
  .regex(/^[a-z0-9._+-]+@[a-z0-9.-]+\.invalid$/);
const object = z.strictObject;
const triple = (schema) => z.array(schema).length(3);

export const ledgerSchema = object({
  projectRef: z.string(),
  schoolId: id,
  slots: triple(
    object({
      role,
      email,
      operationId: journalId,
      grantId: optionalId,
      authIntentRecorded: z.boolean(),
      plannedAuthId: journalId.nullable(),
      authId: optionalId,
      databaseAttempt: z.enum(['none', 'unacknowledged', 'rolled-back', 'committed']),
      // A fresh ID must be journalled before each database write, including retry after rollback.
      databaseAttemptId: optionalId,
      membershipId: optionalId,
      profileId: optionalId,
      factorId: optionalId,
      // Existing journals have no assignment acknowledgement. Never infer it from a role.
      assignmentKeyHash: z.hash('sha256').optional(),
      complete: z.boolean(),
    }),
  ),
});

// Each slot covers the union of matches by login, retained IDs and operation,
// including foreign memberships. A partial/failed lookup is never an empty list.
// user.operationId requires trusted creation evidence, never editable metadata.
// Membership/profile and auditedOperationId describe the joined, committed rows.
// A bound or resumable factor requires the existing protected workflow's evidence.
const observedSlot = object({
  role,
  operationId: id,
  confirmedRollback: object({ operationId: id, attemptId: id }).nullable(),
  assignmentPermit: object({
    id,
    schoolId: id,
    adminId: id,
    candidateId: id,
    membershipId: id,
    factorId: id,
    keyHash: z.hash('sha256'),
    usable: z.boolean(),
  })
    .nullable()
    .optional(),
  users: z.array(object({ id, email, operationId: optionalId, eligible: z.boolean() })),
  memberships: z.array(
    object({
      id,
      authId: id,
      schoolId: id,
      role,
      active: z.boolean(),
      profileId: optionalId,
      auditedOperationId: optionalId,
      databaseAttemptId: journalId.optional(),
    }),
  ),
  grant: object({
    id,
    authId: id,
    schoolId: id,
    auditedOperationId: optionalId,
    issuanceAttemptId: journalId.optional(),
    // Joined grant and immutable issuance audit; issuanceAttemptId is their source-instance ID.
    provenance: object({
      source: z.literal('staging_fixture'),
      sourceCode: z.literal('feat-003-staging-synthetic-cli'),
      actorKind: z.literal('staging_fixture'),
      actorId: z.null(),
      actorSubjectId: z.null(),
      authorizedBySubjectId: z.null(),
      correlationId: journalId,
    }).optional(),
    status: z.enum(['live', 'completed', 'expired', 'conflict']),
  }).nullable(),
  factor: object({
    id,
    authId: id,
    slotOperationId: id,
    state: z.enum(['verified-bound', 'protected-resumable', 'conflict']),
  }).nullable(),
  // The inventory reader selects all member_role.changed events for this membership.
  assignments: z
    .array(
      object({
        event: z.literal('member_role.changed'),
        outcome: z.literal('success'),
        schoolId: id,
        actorId: id,
        membershipId: id,
        priorRole: z.literal('student_pilot'),
        newRole: z.literal('instructor_pilot'),
        priorVersion: z.literal(1),
        newVersion: z.literal(2),
        reason: z.literal('responsibility_changed'),
        mfaReadinessVerified: z.literal(true),
        keyHash: z.hash('sha256'),
        correlationId: id,
      }),
    )
    .max(1)
    .optional(),
});

export const observationSchema = object({
  projectRef: z.string(),
  schools: z.array(object({ id, active: z.boolean() })),
  inventoryComplete: z.boolean(),
  noSendVerified: z.boolean(),
  // Attestation from a future locked reader; concurrent readers must not infer this.
  exclusiveRun: z.boolean(),
  // Includes unowned administrators and competing live grants in this school.
  otherAdminOrLiveGrant: z.boolean(),
  slots: triple(observedSlot),
});
