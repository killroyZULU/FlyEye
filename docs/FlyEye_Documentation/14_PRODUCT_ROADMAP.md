# Product Roadmap

## Roadmap principle

Progress is evidence-gated, not feature-count driven. Dates are indicative. Each stage must meet the [Project Charter](02_PROJECT_CHARTER.md) gate and [QA Plan](11_QA_TEST_PLAN.md) before expansion.

## Stage 0: Discovery and design

- Partner outreach and stakeholder interviews
- Current/future workflow and baseline measures
- Verified regulatory/source register
- Personas, prototype, critical-task testing
- MVP, permission, state, data, privacy, threat, and architecture baselines

Exit: problem and requirements accepted by a pilot candidate and aviation SME.

## Stage 1: Lean engineering foundation

- React/Vite PWA shell and Supabase project structure
- Versioned SQL migrations, generated database types, focused tests/CI, and separate staging
- Supabase Auth, invitations, organizations, permissions, deny-by-default RLS, and Storage policies
- Protected Edge Function pattern, audit, error handling, secrets, monitoring, database-and-object backup foundation

Exit: invited user securely performs an authorized tenant-scoped action with complete audit evidence.

### Current Stage 1 sequence

1. FEAT-001 login and initial RBAC is implemented on the development baseline and locally demonstrated with synthetic two-organization security tests; human security/privacy review and production approval remain pending.
2. The verification-only CI quality-gate pull request is merged into `main`, including schema-wide RLS regression coverage and a pinned general repository secret scanner. It performed no deployment.
3. Record and review the founder-approved product and governance decisions, including universal MFA, tenant-membership isolation, role separation, minor-student safeguards, the anonymous PPL-first pilot, synthetic-data gates, and unresolved hosting choices.
4. FEAT-002 Password Recovery was normally merged into development `main` through PR #5 at merge commit `4f993f0d0dc40f8a5783ae5176ffe2ef6000ca94`; retained feature branch commit `fd1bd2f9aef9bce159b93ce76dd7530371f2d897`, pre-merge CI run `30237389881`, and post-merge `main` CI run `30237614093` are recorded in its traceability file. Its completed Codex review and automated matrix are bounded-local technical code-review evidence, not qualified independent human technical or security/privacy review. The accepted residual local accessibility limitations remain unchanged. No hosted validation, deployment, real-data use, or production approval occurred.
5. Do not begin FEAT-003 without separate Founder/Product Owner direction. Do not repeat the full FEAT-002 matrix while its review target, implementation-content hashes, dependencies, configuration, and evidence remain unchanged. After separate authorization, deliver approved slices for FEAT-003 Organization Admin and MFA Onboarding, FEAT-004 Member Invitations, FEAT-005 User Management and Basic Profiles, and FEAT-006 Role Assignment.
6. Hold a visual-identity checkpoint after the identity/user-management foundation. Establish FlyEye-specific design tokens, reusable components, responsive patterns, and a non-generic reference screen while preserving accessibility and tested workflow behavior.
7. Move into aircraft, personnel compliance, and dispatch only after the foundation, applicable risk-based human escalations, and Founder/Product Owner gates are complete.

FEAT-002 has an approved specification and traceability record for its bounded local implementation. The remaining feature numbers reserve planning order only; each later slice still requires its own approved scope, authority, data, RLS, audit, privacy, abuse, UI-state, and test contracts.

## Stage 2: Dispatch MVP

- Aircraft and personnel compliance records
- Private documents and expiry notifications
- Draft and state workflow
- Deterministic W&B
- Weather/NOTAM source/freshness capture
- Final snapshots/PDF and post-flight basics

Exit: full student-to-authorized-review workflow validated and traceable.

## Stage 3: Training MVP

- Validate the PPL-first pilot workflow before separately specifying CPL, IR, MER, or other training stages
- Courses, stages, lessons, competencies, behaviors, grading
- Assessment, remarks, strengths/weaknesses, remediation
- Acknowledgement, progression, training reports

Exit: approved course pilot scenarios and Head of Training reporting pass UAT.

## Stage 4: Pilot hardening

- Accessibility and usability corrections
- Offline drafts/conflict handling
- Load/performance, recovery, security and privacy readiness
- Training/support/runbooks and controlled eight-week pilot

Exit: pilot success or approved corrective plan.

## Stage 5: Early commercial release

- Onboarding/configuration tooling
- Customer export/offboarding, billing administration (not full accounting)
- Appropriate frontend/edge protection, independent penetration test, support/SLA maturity
- Configurable reports/forms/workflows without customer forks
- First optional Instructor Comment Assistant after AI/privacy approval

Exit: repeatable onboarding, stable paid customer, verified service operation.

## Later modules (evidence-prioritized)

1. Safety reporting and corrective-action analytics
2. Smart scheduling and utilization
3. Enhanced compliance and maintenance coordination
4. Manual/SOP controlled-answer assistant
5. Student delay indicators after sufficient standardized data
6. Native Flutter companion when device/background needs justify it
7. Flight-data debrief and maneuver analytics after reliable data acquisition

## Architecture growth trigger

Do not add a separate custom API merely because the product becomes commercial. Introduce one only when measured protected-function complexity, long-running work, integration needs, team ownership, or performance requires it. Preserve the PostgreSQL schema and command contracts so the change can be incremental.

## Explicit non-roadmap promises

No autonomous flight approval, airworthiness release, competency determination, or direct CAAP integration is promised. No AI prediction is scheduled until data quality, fairness, explainability, human review, privacy, and operational value are demonstrated.

## Prioritization criteria

Score requests by verified user pain, safety/compliance value, cross-customer reuse, measurable operational/commercial benefit, data readiness, implementation/support cost, security/privacy exposure, and roadmap dependency. Classify as configuration, core product, paid customization, regulatory correction, or out of scope.
