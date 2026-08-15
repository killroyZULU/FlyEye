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

1. FEAT-001 Login and initial RBAC — merged
2. FEAT-002 Password Recovery — merged
3. FEAT-003 Organization Admin and MFA Onboarding — merged
4. FEAT-003 Hosted Synthetic Hardening — merged; hosted-readiness planning and activation are deferred under the active governance decision
5. FEAT-004 Member Invitations — merged
6. FEAT-005 User Management and Basic Profiles — merged through PR #15; correction PR #16 and single-school FIX-006 PR #17 merged
7. FEAT-006 Member MFA Readiness and Role Assignment — Slice A is merged through PR #25; Slice B protected role assignment is locally verified and independently reviewed in PR #27 with required CI green
8. Visual-identity checkpoint before larger operational modules

This roadmap records sequence, not live evidence or authorization. See [Current State](CURRENT_STATE.md) for status, dependencies, and later gates. Each requested slice follows the bounded delivery policy in `AGENTS.md`.

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
