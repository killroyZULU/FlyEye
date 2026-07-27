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

Most implementation may be created through “vibe coding,” but FlyEye uses **specification-driven vibe coding**:

1. Establish the operational need and verified source material.
2. Approve a bounded feature specification.
3. Define workflow, state, data contract, RLS policies, protected-function contract, permissions, audit event, edge cases, and tests.
4. Ask AI to analyze and plan before editing.
5. Implement a complete vertical slice rather than an entire layer.
6. Run automated checks and inspect the diff.
7. Perform a separate risk-based agent review and escalate the defined high-risk changes or findings to qualified humans.
8. Deploy to staging and test realistic synthetic scenarios.
9. Obtain human and aviation-SME approval where applicable.
10. Record test evidence, decisions, limitations, and release notes.

The recommended sequence is identity and organization access; aircraft and documents; personnel compliance; basic dispatch draft; dispatch state workflow; weight and balance; weather/NOTAM records; final PDF; training structures; assessments; progression; offline drafts; then the first AI assistant.

See [AI Development Guide](09_AI_DEVELOPMENT_GUIDE.md) and the [Feature Specification template](templates/FEATURE_SPECIFICATION_TEMPLATE.md).

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

As of 2026-07-27:

- FEAT-001 login and initial RBAC is merged into the development `main` branch. It proves local Supabase Auth, server-derived organization membership, initial role routing, privileged-role MFA enforcement, deny-by-default RLS, protected access bootstrap, audit evidence, and cross-organization isolation using synthetic data.
- The product-owner decision requires MFA for every user before real-data pilot or production access. FEAT-001 does not yet enforce MFA for Student users; universal MFA enrollment, factor recovery/replacement, support, and enforcement require later approved identity specifications.
- FEAT-001 is not production-approved. Independent human security/privacy review, account invitations, MFA enrollment and recovery, user administration, deployment configuration, monitoring, and recovery evidence remain pending.
- FEAT-002 Password Recovery was published from retained branch `feat/FEAT-002-password-recovery` at feature commit `fd1bd2f9aef9bce159b93ce76dd7530371f2d897` and normally merged into development `main` through PR #5 at merge commit `4f993f0d0dc40f8a5783ae5176ffe2ef6000ca94`. Pre-merge CI run `30237389881` and post-merge `main` CI run `30237614093` both passed Application quality and Local Supabase security. The merge and CI performed no deployment.
- FEAT-002's completed Codex review and automated verification are the bounded-local technical code-review evidence under the approved risk-based model. They are not qualified independent human technical or security/privacy review. The implementation-content fingerprint remained unchanged after the Founder/Product Owner walkthrough, so the full matrix was not repeated before publication. The Founder/Product Owner's accepted residual local accessibility limitations remain unchanged: mobile and 200% zoom/reflow were not separately recorded as human observations, and assistive-technology live-region behavior, password-manager/autofill behavior, measured contrast and target sizes, injected invalid/offline/fail-closed states, and active CAPTCHA-provider accessibility remain unverified through a separate human walkthrough. No hosted Supabase environment or real data was accessed, and hosted validation, deployment, production approval, and FEAT-003 remain unauthorized.
- Pull request #2 merged the verification-only GitHub Actions quality gates and pull-request checklist into the development `main` branch at merge commit `c7627a5`. It performed no deployment.
- The CI baseline covers frozen dependency installation, formatting, ESLint, TypeScript, unit/component/handler tests, production build, the browser-specific Supabase key scan, a pinned and fully redacted general Gitleaks scan of Git history, Playwright, local Supabase migration reset, schema-wide and feature-specific SQL/RLS tests, real Auth/TOTP/Edge/cross-organization integration, database lint, generated-type drift, and dependency audit.
- The schema-wide RLS regression discovers ordinary and partitioned tables in the exposed `public` and `graphql_public` Data API schemas and fails when any lacks enabled RLS. The Gitleaks CLI and Linux archive checksum are pinned; the separately licensed Gitleaks Action is not used.
- No staging or production environment has been deployed, and no production data or credentials are authorized for development or CI.

## Immediate next actions

1. Complete and review the documentation-only FEAT-002 post-merge handoff; do not merge its documentation pull request without a separate Founder/Product Owner decision.
2. Keep hosted validation, deployment, real-data use, and production approval as separate Founder/Product Owner gates. Do not rerun the complete FEAT-002 verification matrix unless the implementation-content hashes, dependencies, configuration, or evidence change.
3. Do not begin FEAT-003 without separate Founder/Product Owner authorization and an approved specification. When authorized, draft, review, and approve one specification at a time for FEAT-003 Organization Admin and MFA Onboarding, FEAT-004 Member Invitations, FEAT-005 User Management and Basic Profiles, and FEAT-006 Role Assignment.
4. Implement, agent-review, locally demonstrate, and explicitly authorize each later bounded feature before moving to the next one. Escalate the human-review triggers in [Product and Governance Decisions](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md), use synthetic accounts from at least two organizations, and test denial, conflict, and cross-organization paths.
5. After FEAT-002 through FEAT-006 are complete, hold a UI design checkpoint to establish FlyEye's visual identity, design tokens, reusable components, and non-generic responsive direction before building the larger operational modules.
6. Continue product discovery in parallel: formally engage the anonymous pilot candidate and qualified reviewers; obtain current authoritative CAAP/PCAR materials; collect and verify authorized forms and workflow examples; and finalize the permission matrix, minor-student safeguards, retention decisions, pilot agreement, and critical-workflow prototypes.

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

> You are working on FlyEye, a Philippine flight-school operations and training PWA using React, TypeScript, and Supabase. Read README.md, 01_MASTER_HANDOFF.md, the approved ADRs, 03_PRODUCT_REQUIREMENTS_SRS.md, 08_SECURITY_REQUIREMENTS.md, and the assigned feature specification. Treat repository documents as authoritative over chat. Do not invent aviation rules. Do not implement autonomous dispatch, airworthiness, or competency decisions. Work in one vertical slice with deny-by-default RLS, organization isolation, protected Edge Functions for authoritative commands, audit events, deterministic validation, tests, and documentation. Never expose the Supabase service-role key or bypass RLS from the browser. First analyze the feature, list assumptions and conflicts, propose data/function/security/test changes, and stop for approval before coding unless explicitly told to proceed. Do not change files outside the allowed scope or add dependencies without justification.
