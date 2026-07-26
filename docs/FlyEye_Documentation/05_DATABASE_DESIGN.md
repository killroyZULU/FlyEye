# Database Design

## 1. Principles

Supabase PostgreSQL is the source of truth for relational operational records. The design prioritizes organization isolation, Row-Level Security, referential integrity, reproducible history, explicit state, auditability, safe migrations, and reporting. Uploaded/generated binary files live in private Supabase Storage with metadata in PostgreSQL.

## 2. Core entity groups

### Platform and identity

- `Organizations`
- `Users`
- `OrganizationMemberships`
- `Roles`, `Permissions`, `RolePermissions`, `MembershipRoles`
- `Invitations`, `AuthenticationEvents`, `SupportAccessGrants`

### People and compliance

- `PersonProfiles`
- `StudentProfiles`, `InstructorProfiles`
- `PersonnelDocuments`, `Qualifications`, `Currencies`

### Aircraft and files

- `Aircraft`, `AircraftTypes`, `AircraftStatuses`
- `AircraftDocuments`
- `StoredFiles`, `FileScanResults`
- `WeightBalanceConfigurations`, `Stations`, `EnvelopePoints`

### Dispatch

- `DispatchRecords`, `DispatchRevisions`, `DispatchParticipants`
- `DispatchReviews`, `DispatchTransitions`
- `WeatherRecords`, `NotamRecords`
- `WeightBalanceCalculations`, `WeightBalanceEntries`
- `PostFlightRecords`, `SquawkReports`

### Training

- `Courses`, `Stages`, `Lessons`
- `Competencies`, `ObservableBehaviors`, `GradingScales`
- `Enrollments`, `TrainingSessions`
- `Assessments`, `AssessmentResults`, `RemedialActions`, `Acknowledgements`

### Cross-cutting

- `AuditEntries`, `Notifications`, `BackgroundJobs`
- `GeneratedDocuments`, `Exports`, `AiAssistanceEvents`

## 3. Relationship sketch

```text
Organization
  |-- Membership -- User
  |-- Aircraft -- AircraftDocument
  |      |-- WeightBalanceConfiguration -- Station / EnvelopePoint
  |-- PersonProfile -- PersonnelDocument / Qualification
  |-- DispatchRecord -- Revision -- Review / Transition
  |      |-- WeatherRecord / NotamRecord / W&B Calculation / PostFlight
  |-- Course -- Stage -- Lesson -- Competency / ObservableBehavior
  |      |-- Enrollment -- TrainingSession -- Assessment -- Result / Remediation
  |-- StoredFile / AuditEntry / Notification / Export
```

## 4. Standard fields

Tenant-owned operational entities should normally include:

```text
id (UUID/opaque public identifier)
organization_id
status
version / concurrency token
created_at / created_by
updated_at / updated_by
archived_at / archived_by (when applicable)
```

Use separate immutable audit entries instead of embedding unbounded change histories in each row.

## 5. Tenant isolation

- Foreign keys between tenant-owned tables should include or validate matching `organization_id` where practical.
- Unique keys such as aircraft registration, course code, or role name should be scoped by organization when business-appropriate.
- Every client-exposed tenant table has RLS enabled, with separate deny-by-default policies and explicit `WITH CHECK` conditions.
- User-editable JWT/profile metadata is not trusted for organization membership or authorization.
- A user may have memberships in multiple organizations, but each membership keeps an independent tenant and role context. Organization selection is a revalidated hint, never authorization.
- One role per membership remains the initial default. Multiple-role support requires an approved permission and separation-of-duties matrix.
- Organization administration never implies operational, training, safety, quality, dispatch, assessment, or approval authority.
- Protected Edge/PostgreSQL functions validate organization context and do not trust request-body tenant IDs as authority.
- Background jobs, reports, exports, file paths, and cache identifiers require `organization_id`.
- Cross-tenant referential links are invalid and must be tested at both API and persistence boundaries.

## 6. Record versioning

Drafts can be edited with optimistic concurrency. Submission creates a preserved revision snapshot. Return for correction creates the next editable revision. Approval/finalization freezes a revision and its relevant configuration/source snapshots. Reopening is a new controlled amendment, never an overwrite of the original evidence.

Store status transitions with actor, prior/new state, reason, time, correlation ID, and revision.

## 7. Weight-and-balance data

Configuration records include aircraft, revision/effective dates, approved source reference, basic empty weight/moment where appropriate, stations, limits/envelope, owner, reviewer, and status. Calculation records include configuration version, all loading inputs, decimals at defined precision, output, validation result, formula/engine version, and timestamp.

Never use binary floating point for authoritative values. Rounding and unit conversions must be explicit, documented, and tested.

## 8. Files

`StoredFiles` contains tenant, private bucket/object key, original display name, generated safe name, media type, size, cryptographic hash, uploader, upload time, scan status, classification, retention state, and related entity. Storage RLS must match record access. Do not store executable content or public bucket URLs. Use short-lived authorized downloads.

## 9. Audit design

`AuditEntries` should capture organization, actor/user type, event name, target type/id, timestamp, request/correlation ID, outcome, reason where appropriate, client/security context at an approved level, and non-sensitive structured metadata. Do not log passwords, cookies, full medical documents, secrets, or full AI prompts.

Ordinary users cannot update/delete audit events. Consider tamper-evident export/retention measures for higher maturity.

## 10. Indexing and query patterns

Index tenant first for tenant-owned query patterns, then common filters: status, date/time, aircraft, person, course, expiry, and updated time. Use bounded pagination for searches and exports. Verify indexes against real query plans and representative data rather than adding speculative indexes.

## 11. Deletion, archival, and retention

Use lifecycle states: active, archived, retention hold, eligible for deletion/anonymization, deleted. Operational records are not cascaded blindly. Retention comes from verified school/legal requirements and the [Privacy Plan](12_PRIVACY_DATA_PROTECTION.md). End-of-contract export/deletion must be documented and auditable.

## 12. Migrations and seed data

- Every schema, RLS, function, trigger, index, and seed change uses a reviewed Supabase CLI SQL migration.
- Destructive or long-running operations require a rollout/backfill plan and tested recovery.
- Seed only global reference data and synthetic development/test tenants; never real production records.
- Migrations run in staging against representative volume before production.
- Generate version-controlled TypeScript database types after schema changes and fail CI when committed types drift.
- Avoid dashboard-only production schema changes and uncontrolled migrations during application startup.

## 13. RLS and function design

- Enable RLS explicitly on every table exposed through the Supabase Data API.
- Begin with no policies, then add the smallest role/action-specific policy.
- Use indexed membership and `organization_id` columns in policies.
- Keep low-risk reads/draft writes direct only when policies are straightforward and fully tested.
- Revoke direct status/finalization/role changes from client roles; expose protected Edge Functions or PostgreSQL RPCs instead.
- Functions that bypass RLS require explicit justification, fixed `search_path`, minimal grants, tenant validation, audit emission, and adversarial tests.
- Views exposed to clients must use safe invoker behavior and inherit the intended policies.
- The Supabase service-role key is never present in browser code, logs, screenshots, or AI prompts.

## 14. Backup and storage reconciliation

Database backups do not automatically constitute backups of Storage objects. Define and test a separate process for exporting/versioning restricted uploads and generated PDFs. A restore drill must reconcile `stored_files` metadata, hashes, scan state, and actual objects.

## 15. Initial ERD deliverable

Before Slice 1, create a detailed ERD and domain glossary. Before each slice, update the relevant aggregate, constraints, tenancy, privacy classification, retention, and migration notes. The SRS—not this conceptual list—determines whether an entity is required.
