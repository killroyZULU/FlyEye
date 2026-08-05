# Master Handoff

## How to use this file

This is the fastest complete orientation for a new project manager, architect, developer, security reviewer, aviation SME, or LLM. Read it with the [README](README.md), then consult the linked specialist documents before changing the product.

## Context and opportunity

FlyEye began as an idea for a commercially viable digital aviation solution for Philippine general aviation and flight schools. The opportunity is not “AI for aviation” in the abstract. It is the modernization of fragmented, manual, audit-heavy training and operations workflows, with AI used only where it adds controlled assistance.

The product is intended to support ATO preparation for structured training-data collection and competency-oriented assessment. Exact CAAP and PCAR requirements must be checked against current official sources during discovery and before each regulated claim or workflow is approved.

## Confirmed product direction

FlyEye is a web-first, multi-tenant SaaS product delivered as a responsive PWA. A normal browser supports desktop-heavy administration and reporting; phones and tablets support students and instructors. Offline capability is limited to draft capture and cached reference information. Final submissions, approvals, current compliance checks, official PDFs, and safety-relevant state changes require server revalidation and connectivity.

The first release focuses on:

1. Platform core: organizations, invitation-based accounts, permissions, audit, files, notifications.
2. Compliance records: aircraft/personnel profiles, documents, qualifications, and expiry monitoring.
3. Dispatch: draft, validation, submission, review, return, resubmission, approval/rejection/cancellation, final snapshot, PDF, and post-flight entry.
4. Training: courses, stages, lessons, competencies, assessments, strengths, weaknesses, remediation, acknowledgement, and progression.
5. Basic reporting: training progress, repeated items, incomplete/returned records, utilization, expiries, and audit history.

Deferred items include intelligent scheduling, billing, full maintenance work orders, safety management, predictive performance, maneuver recognition, native mobile, direct regulatory integration, and training stages beyond the separately validated PPL-first pilot.

FlyEye began as a capstone and is intended to mature into a commercial product for Philippine flight schools. The documentation identifies the product owner as the Founder/Product Owner without naming the person or the potential pilot school. See [Product and Governance Decisions](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md).

## Architecture summary

| Concern | Decision |
|---|---|
| Client | React + TypeScript responsive PWA built with Vite |
| Managed platform | Supabase PostgreSQL, Auth, private Storage, Row-Level Security, and Edge Functions |
| Server authority | Edge Functions and reviewed PostgreSQL functions for protected commands and calculations |
| Structure | One TypeScript-oriented repository with bounded product modules and versioned SQL migrations |
| Auth | Supabase Auth; invitation-only membership; MFA required for every user before real-data pilot or production access |
| Authorization | Database RLS plus explicit permission, organization, record, and state checks in protected functions |
| Tenancy | Shared PostgreSQL schema with `organization_id` and deny-by-default RLS on every exposed tenant table |
| Hosting | Managed static frontend host plus separate Supabase staging and production projects |
| Delivery | GitHub, protected branches, focused GitHub Actions, staging, manual production promotion |
| Testing | Vitest/component tests, SQL/RLS tests, Edge Function integration tests, Playwright E2E, security and recovery tests |
| AI | Provider-independent Edge Function adapter; redacted, structured, logged, human-reviewed outputs |

See [System Architecture](04_SYSTEM_ARCHITECTURE.md), [Database Design](05_DATABASE_DESIGN.md), and [API Specification](06_API_SPECIFICATION.md).

## Safety boundary

FlyEye provides information support and record control. It cannot independently:

- approve or dispatch a flight;
- release an aircraft as airworthy;
- mark a student competent;
- alter an authoritative calculation or approved source;
- override an authorized person;
- treat an AI summary as the original weather, NOTAM, manual, or record.

Weight-and-balance is deterministic decimal-based domain logic, independently tested and reviewed against approved aircraft information. Every finalized calculation retains the exact input and configuration version used.

## AI-assisted development model

Most implementation may be created through “vibe coding,” but FlyEye uses
**autonomous specification-driven vibe coding**:

1. Establish the operational need and verified source material.
2. Let the delivery agent define or refine the bounded feature specification
   from repository evidence and safe reversible defaults.
3. Define workflow, state, data contract, RLS policies, protected-function contract, permissions, audit event, edge cases, and tests.
4. Ask AI to analyze and plan before editing.
5. Implement a complete vertical slice rather than an entire layer.
6. Run automated checks and inspect the diff.
7. Perform a separate risk-based agent review, correct its in-scope findings,
   and escalate only the defined hard-stop risks.
8. Deploy to staging and test realistic synthetic scenarios.
9. Obtain human or aviation-SME input only where a regulated, production,
   real-data, or inherently human judgment requires it.
10. Record test evidence, decisions, limitations, and release notes.

These are lifecycle activities, not Founder/Product Owner forms. A direct
feature request authorizes the complete bounded workflow through a green
review-ready pull request: specification, implementation, safe diagnosis, local
synthetic lifecycle, in-scope corrections, focused reruns, final matrix,
evidence updates, separate agent review, scoped staging/commit, branch push, PR
creation, and CI follow-up. The normal human decision is whether to merge.
Only hard-stop security/data incidents, irreducible product/architecture
conflicts, unsupported regulated authority, real data, hosted mutation, material
provider/cost commitments, destructive actions, merge, or production return to
the Founder/Product Owner.

The recommended sequence is identity and organization access; aircraft and documents; personnel compliance; basic dispatch draft; dispatch state workflow; weight and balance; weather/NOTAM records; final PDF; training structures; assessments; progression; offline drafts; then the first AI assistant.

See [AI Development Guide](09_AI_DEVELOPMENT_GUIDE.md), the [Feature Specification template](templates/FEATURE_SPECIFICATION_TEMPLATE.md), and the [Portable AI Feature Delivery Playbook](templates/AI_FEATURE_DELIVERY_PLAYBOOK.md).

## DevSecOps and security posture

Security is part of every slice. The production branch requires reviewed pull requests and passing tests. The focused pipeline should build, lint, type-check, run frontend, SQL/RLS, Edge Function, tenant-isolation, and E2E tests, scan code, secrets, dependencies, migrations, and configuration, deploy to staging, then require human production approval.

Key controls include:

- invitation-only accounts and least privilege;
- MFA for every user before real-data pilot or production access;
- deny-by-default RLS and server-side authorization for protected commands;
- automated cross-tenant negative tests;
- encryption in transit and at rest;
- private object storage, file-signature validation, malware scanning, and authorized download;
- Supabase service-role secrets restricted to server-side functions and protected CI environments;
- WAF/rate limiting for public commercial production;
- immutable operational audit evidence and separate security logs;
- monitored backups and proven restore procedures;
- incident response and customer notification procedures;
- independent security review before public commercial release.

See [Security Requirements](08_SECURITY_REQUIREMENTS.md) and [DevSecOps Guide](10_DEVSECOPS_GUIDE.md).

## Privacy posture

The likely arrangement is that each flight school acts as Personal Information Controller and FlyEye as Personal Information Processor, with cloud/AI providers as approved subprocessors. This must be established contractually and reviewed by qualified privacy counsel or the responsible DPO.

Collect only necessary information. Restrict medical, licensing, government identifier, training, and safety records. Production data is never copied casually into development. AI receives the smallest necessary redacted context and customer data is not used to train general models by default.

The pilot may include minors only after the school and qualified privacy/legal reviewers establish guardian authority or consent, notices, safeguarding, access, retention, correction, and rights procedures. FlyEye records approved evidence but does not decide legal sufficiency.

See [Privacy and Data Protection](12_PRIVACY_DATA_PROTECTION.md).

## Delivery method and gates

The lifecycle is Hybrid Stage-Gated Agile with human-centered discovery and two-week development sprints. Major gates are:

1. Problem validated by at least one potential pilot school.
2. Requirements approved by aviation SME and pilot-school representative.
3. Prototype achieves at least 85% critical-task success.
4. Critical MVP requirements are feature-complete and traceable.
5. Pilot readiness: no critical defects; access, audit, backup, safety logic, and recovery tests pass.
6. Pilot success: agreed operational, adoption, usability, and reliability targets achieved or corrective plan accepted.
7. Commercial readiness: stable release, support model, pricing, privacy/security documentation, and customer evidence exist.

## Pilot assumptions

The initial pilot is one anonymous candidate school, eight weeks, at least 10 students, 3 instructors, 1 operations user, 1 Head of Training/administrator, 2 aircraft, a PPL-first course, and 75 completed records. Later CPL, IR, MER, and other stages require separate validation. The first two to four weeks run in parallel with the school’s approved process. FlyEye does not become the official record or operational authority until the school completes its own approvals and change procedures.

See [Pilot Implementation Plan](13_PILOT_IMPLEMENTATION_PLAN.md).

## Current implementation status

The detailed pre-2026-08-02 authorization chronology below is retained as
historical provenance. Its former separate-prompt and
human-before-publication requirements are superseded for local delivery and Git
publication by the autonomous-delivery directive.

As of 2026-07-28:

- FEAT-001 login and initial RBAC is merged into the development `main` branch. It proves local Supabase Auth, server-derived organization membership, initial role routing, privileged-role MFA enforcement, deny-by-default RLS, protected access bootstrap, audit evidence, and cross-organization isolation using synthetic data.
- The product-owner decision requires MFA for every user before real-data pilot or production access. FEAT-001 does not yet enforce MFA for Student users; universal MFA enrollment, factor recovery/replacement, support, and enforcement require later approved identity specifications.
- FEAT-001 is not production-approved. Independent human security/privacy review, account invitations, MFA enrollment and recovery, user administration, deployment configuration, monitoring, and recovery evidence remain pending.
- FEAT-002 Password Recovery was published from retained branch `feat/FEAT-002-password-recovery` at feature commit `fd1bd2f9aef9bce159b93ce76dd7530371f2d897` and normally merged into development `main` through PR #5 at merge commit `4f993f0d0dc40f8a5783ae5176ffe2ef6000ca94`. Pre-merge CI run `30237389881` and post-merge `main` CI run `30237614093` both passed Application quality and Local Supabase security. The merge and CI performed no deployment.
- FEAT-002's completed Codex review and automated verification are the bounded-local technical code-review evidence under the approved risk-based model. They are not qualified independent human technical or security/privacy review. The implementation-content fingerprint remained unchanged after the Founder/Product Owner walkthrough, so the full matrix was not repeated before publication. The Founder/Product Owner's accepted residual local accessibility limitations remain unchanged: mobile and 200% zoom/reflow were not separately recorded as human observations, and assistive-technology live-region behavior, password-manager/autofill behavior, measured contrast and target sizes, injected invalid/offline/fail-closed states, and active CAPTCHA-provider accessibility remain unverified through a separate human walkthrough.
- PR #6 normally merged the FEAT-002 post-merge documentation into development `main` at `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66`. Post-merge `main` CI run `30238931694` passed Application quality and Local Supabase security. No hosted Supabase environment, real data, deployment, or production system was accessed or approved.
- The Founder/Product Owner authorized the FEAT-003 documentation phase from exact `origin/main` commit `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66` and, on 2026-07-27, approved the [FEAT-003 specification](features/FEAT-003_ORGANIZATION_ADMIN_AND_MFA_ONBOARDING.md), [traceability record](features/FEAT-003_TRACEABILITY.md), bounded first-Organization-Admin-only scope, server-only local synthetic grant path, 10-minute recent-password window, finite-expiry requirement, and fail-closed duplicate-factor behavior exactly as written. The Founder/Product Owner later set the exact local grant lifetime to 30 minutes from server-recorded issuance, named `scripts/test-feat-003-runtime.mjs` as the future CLI-only ephemeral local issuer/test fixture, and authorized the documentation-only amendment resolving the independent design-review findings for audit-source attribution, AMR/internal evidence, database time/locking/idempotency, privileges/action contracts, factor consistency, and fixture hardening. On 2026-07-28, the Founder/Product Owner authorized the documentation-only limiter-monitoring evidence correction requiring privacy-minimized implementation-acceptance monitoring and recovery evidence for each protected `status`, `start`, `complete`, and `cancel` action. The final strictly read-only post-amendment verification completed on 2026-07-28, resolved `DOC-STATUS-01`, confirmed the substantive documentation requirements, and found no remaining documentation conflict. The Founder/Product Owner then authorized the documentation-only staged-review-gate amendment on 2026-07-28: a separately authorized bounded local synthetic implementation may use separate agent review plus required automation before competent review completes, but material findings stop work immediately and attributable database/RLS/privileged-function, security/privacy, accessibility, and operations review plus correction/reverification must complete before local product acceptance or any Git staging, commit, or publication. The strictly read-only verification of this gate amendment completed on 2026-07-28 as documentation-consistency evidence only; all fourteen requirements passed and no documentation conflict remained. The Founder/Product Owner subsequently approved the AI-recommended provisional local-only limiter and operations choices for documentation-only recording on 2026-07-28. The strictly read-only verification of that recording completed on 2026-07-28 against tracked fingerprint `27014d8b60c17c129dfd29513fea79abe89f9483`; all fourteen requirements passed and no documentation conflict remained. At those documentation checkpoints, none of the records was implementation/runtime evidence, qualified human review, product acceptance, implementation authorization, Git publication, hosted validation, deployment, production approval, or FEAT-004 authority. The later bounded local synthetic implementation authorization and its current limits are recorded separately below.
- The version-controlled local Supabase Auth configuration declares 30 sign-in/sign-up requests and 30 token verifications per five minutes per IP, 150 token refreshes per five minutes per IP, and 30 email sends per hour. These declarations are local-only and do not prove hosted or production settings. The existing `auth-bootstrap` Edge Function has no separate FlyEye application-level limiter at this baseline. The FEAT-003 implementation uses PostgreSQL-authoritative atomic token buckets: `status` 12 per 60 seconds with burst 4, `start` 4 per 60 seconds with burst 2, `complete` 3 per 60 seconds with burst 1, and `cancel` 6 per 60 seconds with burst 2. It uses a dedicated ephemeral local HMAC secret for authenticated-subject-plus-action keys, trusts no local IP or forwarded header, retains inactive limiter state for 15 minutes with fixture cleanup, fails closed for unavailable `status`, `start`, and `complete`, performs safe local cleanup/sign-out with uncertain server confirmation for unavailable `cancel`, stops on material monitoring invariant failure, and provides no override or bypass. These local/synthetic values passed automated concurrency, failure, recovery, privacy, and cleanup evidence plus corrected separate-agent review and are eligible for Git publication under the autonomous-delivery directive. Hosted and production thresholds, trusted network-source rules, retention, monitoring, alerting, ownership, incidents, emergency behavior, capacity, cost, and overrides remain unresolved and may not be inferred from local declarations or local values.
- The Founder/Product Owner subsequently authorized the bounded local synthetic FEAT-003 implementation on `feat/FEAT-003-organization-admin-mfa-onboarding` from baseline `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66`. The preserved uncommitted working tree now contains the migration, deny-by-default RLS and protected functions, shared authentication-evidence handling, frontend onboarding flow, generated types, SQL/component/handler tests, and sanitized runtime fixture. On 2026-08-02 the stabilized target passed the complete application and database matrix, all three sanitized runtime fixtures, repository/history secret scans, and exact zero-residue cleanup after bounded local Auth-template readiness recovery. A fresh independent read-only agent review then found one non-bypass mandatory-audit error-classification defect plus one stale review-package gate; both were corrected within scope. The focused regression and complete application/database matrix passed again with 103 automated application tests, and exact zero-residue cleanup and container removal were reconfirmed. Under the 2026-08-02 autonomous-delivery directive, this local/synthetic fail-closed evidence plus corrected separate-agent review satisfies the technical publication gate. FEAT-003 is `Locally verified; publication pending`. Contaminated diagnostic transcripts are excluded from evidence. Formal specialist review is optional input for the local feature and remains mandatory only for later regulated, real-data, hosted, formal-compliance, or production claims. No merge, hosted access, real-data use, deployment, production approval, branch deletion, or FEAT-004 authority exists.
- Transition exception: the already-open FEAT-003 task originally prohibited staging, commit, push, and pull-request creation. That narrower instruction remains effective until one clear Founder/Product Owner override authorizes publication through the new workflow. Future direct feature requests do not need this extra transition prompt.
- Current status superseding the two historical bullets above: the Founder/Product Owner supplied the one-time publication override, PR #7 merged FEAT-003 into `main` at `00dcfd2239de45b33890bc805ff27a667defabd1`, and post-merge CI run `30752548762` passed all three required jobs. FEAT-003 is `Merged; hosted validation pending`. Before FEAT-004 planning, the bounded `feat/FEAT-003-hosted-staging-hardening` slice adds a disabled-by-default target manifest, local-only fail-closed Edge runtime configuration, explicit protected-function JWT settings, dormant non-human staging provenance, distinct key roles, and versioned limiter drift detection. Its local application/database/runtime matrices, secret scans, exact cleanup, corrected independent review, and final re-review passed on 2026-08-05; publication is pending. It adds no executable hosted issuer or provider activation; hosted mutation, real data, deployment, production, destructive hosted cleanup, branch deletion, and FEAT-004 remain closed.
- Pull request #2 merged the verification-only GitHub Actions quality gates and pull-request checklist into the development `main` branch at merge commit `c7627a5`. It performed no deployment.
- The CI baseline covers frozen dependency installation, formatting, ESLint, TypeScript, unit/component/handler tests, production build, the browser-specific Supabase key scan, a pinned and fully redacted general Gitleaks scan of Git history, Playwright, local Supabase migration reset, schema-wide and feature-specific SQL/RLS tests, real Auth/TOTP/Edge/cross-organization integration, database lint, generated-type drift, and dependency audit.
- The schema-wide RLS regression discovers ordinary and partitioned tables in the exposed `public` and `graphql_public` Data API schemas and fails when any lacks enabled RLS. The Gitleaks CLI and Linux archive checksum are pinned; the separately licensed Gitleaks Action is not used.
- No staging or production environment has been deployed, and no production data or credentials are authorized for development or CI.

## Immediate next actions

1. Complete the FEAT-003 hosted-synthetic hardening pull request and stop for its merge decision. The committed staging manifest remains disabled and target-free.
2. After hardening merges, separately decide the exact staging provider/project, region, plan and cost ceiling, fixed frontend origin, credential path, monitoring owner, retention/cleanup plan, and qualified review needed before one bounded hosted synthetic execution.
3. Do not begin FEAT-004 Member Invitations, FEAT-005 User Management and Basic Profiles, or FEAT-006 Role Assignment while this FEAT-003 risk-reduction and hosted-readiness sequence remains open.
4. After FEAT-002 through FEAT-006 are complete, hold a UI design checkpoint to establish FlyEye's visual identity, design tokens, reusable components, and non-generic responsive direction before building the larger operational modules.
5. Continue product discovery in parallel: formally engage the anonymous pilot candidate and qualified reviewers for regulated/production gates; obtain current authoritative CAAP/PCAR materials; collect and verify authorized forms and workflow examples; and finalize the permission matrix, minor-student safeguards, retention decisions, pilot agreement, and critical-workflow prototypes.

The planned feature identifiers and sequence are roadmap intent, not approved implementation specifications. Each feature requires its own repository specification and traceability record before coding.

## Open decisions requiring evidence

- Verified current regulatory and retention requirements
- Pilot school, approved process, and exact baseline metrics
- Exact Supabase Auth invitation, TOTP enrollment/recovery, recovery-code, email-delivery, redirect, throttling, and support procedures
- Supabase region/plan, frontend host, cost envelope, and recovery commitments
- E-signature/acknowledgement legal and operational form
- Weather/NOTAM provider, licensing, provenance, and freshness rules
- Customer-specific data export, deletion, and end-of-contract procedures
- Detailed role/permission and separation-of-duties matrix, privileged-role change safeguards, and future personnel qualification/profile boundaries
- Minor-student consent or authority, safeguarding, access, retention, and rights procedures
- When native mobile, scheduling, safety, and AI features earn priority

## Prompt for another implementation LLM

> You are working on FlyEye, a Philippine flight-school operations and training PWA using React, TypeScript, and Supabase. Read README.md, 01_MASTER_HANDOFF.md, the approved ADRs, 03_PRODUCT_REQUIREMENTS_SRS.md, 08_SECURITY_REQUIREMENTS.md, 09_AI_DEVELOPMENT_GUIDE.md, and the assigned feature specification. Treat repository documents as authoritative over chat. Do not invent aviation rules. Do not implement autonomous dispatch, airworthiness, or competency decisions. Work in one vertical slice with deny-by-default RLS, organization isolation, protected Edge Functions for authoritative commands, audit events, deterministic validation, tests, and documentation. Never expose the Supabase service-role key or bypass RLS from the browser. First analyze the feature, list assumptions and conflicts, and identify data/function/security/test changes. If the bounded local-delivery envelope is already approved, continue through implementation, routine diagnosis, in-scope corrections, focused reruns, one final matrix, evidence updates, and separate agent review without requesting micro-approvals. Stop only for a material boundary or separately gated action. Do not change files outside the allowed scope or add dependencies without justification.
