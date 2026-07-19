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

Deferred items include intelligent scheduling, billing, full maintenance work orders, safety management, predictive performance, maneuver recognition, native mobile, and direct regulatory integration.

## Architecture summary

| Concern | Decision |
|---|---|
| Client | React + TypeScript responsive PWA built with Vite |
| Managed platform | Supabase PostgreSQL, Auth, private Storage, Row-Level Security, and Edge Functions |
| Server authority | Edge Functions and reviewed PostgreSQL functions for protected commands and calculations |
| Structure | One TypeScript-oriented repository with bounded product modules and versioned SQL migrations |
| Auth | Supabase Auth; invitation-only membership; MFA for privileged and operational roles |
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
7. Perform a separate security/architecture review.
8. Deploy to staging and test realistic synthetic scenarios.
9. Obtain human and aviation-SME approval where applicable.
10. Record test evidence, decisions, limitations, and release notes.

The recommended sequence is identity and organization access; aircraft and documents; personnel compliance; basic dispatch draft; dispatch state workflow; weight and balance; weather/NOTAM records; final PDF; training structures; assessments; progression; offline drafts; then the first AI assistant.

See [AI Development Guide](09_AI_DEVELOPMENT_GUIDE.md) and the [Feature Specification template](templates/FEATURE_SPECIFICATION_TEMPLATE.md).

## DevSecOps and security posture

Security is part of every slice. The production branch requires reviewed pull requests and passing tests. The focused pipeline should build, lint, type-check, run frontend, SQL/RLS, Edge Function, tenant-isolation, and E2E tests, scan code, secrets, dependencies, migrations, and configuration, deploy to staging, then require human production approval.

Key controls include:

- invitation-only accounts and least privilege;
- MFA for privileged and operational roles;
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

The initial pilot is one school, eight weeks, at least 10 students, 3 instructors, 1 operations user, 1 Head of Training/administrator, 2 aircraft, 1 course, and 75 completed records. The first two to four weeks run in parallel with the school’s approved process. FlyEye does not become the official record or operational authority until the school completes its own approvals and change procedures.

See [Pilot Implementation Plan](13_PILOT_IMPLEMENTATION_PLAN.md).

## Immediate next actions

1. Obtain current authoritative CAAP/PCAR materials and qualified ATO review.
2. Interview at least 12 stakeholders across ideally three Philippine schools.
3. Collect authorized blank forms, workflow examples, syllabi, and baseline measures.
4. Finalize the MVP boundary, domain glossary, permission matrix, state diagrams, data retention, and pilot agreement.
5. Prototype critical workflows and test them before full implementation.
6. Create the project shell and prove frontend → Supabase Auth/RLS/PostgreSQL → protected Edge Function → staging.
7. Implement one bounded vertical slice at a time, beginning with invitation-based organization access.

## Open decisions requiring evidence

- Verified current regulatory and retention requirements
- Pilot school, approved process, and exact baseline metrics
- Exact Supabase Auth/MFA invitation and support process
- Supabase region/plan, frontend host, cost envelope, and recovery commitments
- E-signature/acknowledgement legal and operational form
- Weather/NOTAM provider, licensing, provenance, and freshness rules
- Customer-specific data export, deletion, and end-of-contract procedures
- Whether row-level security is required in the initial release
- When native mobile, scheduling, safety, and AI features earn priority

## Prompt for another implementation LLM

> You are working on FlyEye, a Philippine flight-school operations and training PWA using React, TypeScript, and Supabase. Read README.md, 01_MASTER_HANDOFF.md, the approved ADRs, 03_PRODUCT_REQUIREMENTS_SRS.md, 08_SECURITY_REQUIREMENTS.md, and the assigned feature specification. Treat repository documents as authoritative over chat. Do not invent aviation rules. Do not implement autonomous dispatch, airworthiness, or competency decisions. Work in one vertical slice with deny-by-default RLS, organization isolation, protected Edge Functions for authoritative commands, audit events, deterministic validation, tests, and documentation. Never expose the Supabase service-role key or bypass RLS from the browser. First analyze the feature, list assumptions and conflicts, propose data/function/security/test changes, and stop for approval before coding unless explicitly told to proceed. Do not change files outside the allowed scope or add dependencies without justification.
