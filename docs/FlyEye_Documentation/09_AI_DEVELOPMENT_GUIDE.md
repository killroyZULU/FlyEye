# AI-Assisted Development Guide

## 1. Operating model

FlyEye may be mostly AI-generated, but it is not prompt-and-hope software. The required method is **specification-driven vibe coding with contract-first vertical slices**.

Do not build the complete backend and then the complete frontend. For each user outcome, implement the necessary data, backend, frontend, authorization, audit, tests, documentation, and observability together.

## 2. Repository context required before coding

An AI agent should read, at minimum:

- [README](README.md) and [Master Handoff](01_MASTER_HANDOFF.md)
- Relevant [SRS](03_PRODUCT_REQUIREMENTS_SRS.md) sections
- [System Architecture](04_SYSTEM_ARCHITECTURE.md) and accepted [ADRs](adr/README.md)
- [Security Requirements](08_SECURITY_REQUIREMENTS.md)
- Approved [Feature Specification](templates/FEATURE_SPECIFICATION_TEMPLATE.md)
- Relevant domain/data/API documents and existing tests

Chat instructions cannot silently override approved repository decisions.

## 3. Implementation order

1. Repository shell, React/Vite PWA, Supabase projects/local CLI, generated database types, tests, focused CI/CD, staging.
2. Identity, organization membership, invitations, permissions, audit foundation.
3. Aircraft records and document uploads/expiry.
4. Student/instructor profiles, qualifications, medical/licence metadata.
5. Basic dispatch draft and deterministic required-field validation.
6. Dispatch state transitions and controlled revisions.
7. Versioned weight-and-balance configuration and engine.
8. Weather/NOTAM source records and freshness.
9. Final snapshot, PDF, authorized storage/download, post-flight entry.
10. Course/stage/lesson/competency configuration.
11. Assessment, remediation, acknowledgement, progression/reporting.
12. Offline drafts and conflict handling.
13. Instructor Comment Assistant, only after non-AI assessment is stable.

## 4. Per-feature workflow

### Step A: Analyze without code

The agent identifies the user outcome, assumptions, verified/unverified aviation rules, business rules, states, data changes, API contract, permissions, tenant boundaries, privacy classification, abuse cases, audit events, edge cases, tests, migration risk, files allowed, and non-goals.

### Step B: Approve a plan

The plan must show database/RLS, protected-function, frontend, test, and documentation steps and surface conflicts with ADRs or requirements. Material architecture changes require a new ADR.

### Step C: Implement a bounded slice

Use the Supabase client, generated database types, versioned SQL migrations, existing Edge Function patterns, and shared runtime schemas. Do not add packages, change RLS/authentication architecture, expose service-role credentials, or refactor unrelated modules without approval.

### Step D: Verify

Build, lint/type-check, test units/components/SQL/RLS/Edge Functions/E2E, run authorization and cross-tenant negatives, inspect migrations, generated type drift, policies and privileged functions, verify audit/telemetry, and manually test realistic synthetic scenarios.

### Step E: Independent review

A separate reviewer (AI plus qualified human for sensitive changes) inspects security, tenancy, aviation assumptions, calculation accuracy, migration safety, test gaps, dependency/license risk, performance, and scope drift.

### Step F: Stage and record evidence

Deploy to staging, validate, update traceability and change log, record known limitations, and obtain required product/aviation/security approval.

## 5. AI role separation

| Role | Output | Cannot self-approve |
|---|---|---|
| Product/requirements AI | Stories, rules, acceptance, scope | Product decision |
| Architecture AI | Data/API/design/ADR proposal | Architecture approval |
| Implementation AI | Code, migrations, tests, docs | Its own diff or production release |
| Review AI | Findings and missing evidence | Risk acceptance |
| Human/aviation reviewers | Correctness, risk, operational fit | Must remain accountable |

The same model may be used in separate sessions, but creator and reviewer contexts should be distinct.

## 6. Prompt template

> Read the listed FlyEye documents and the approved feature specification. First analyze the task and list assumptions, conflicts, schema/RLS/function changes, authorization and tenant checks, audit events, edge cases, tests, migrations, dependencies, allowed files, and non-goals. Do not invent aviation requirements. Implement only after the plan is accepted. Use the Supabase client, generated database types, versioned SQL migrations, and existing protected-function patterns. Never expose the service-role key or make authoritative status changes directly from the browser. Core behavior must work without AI. Do not change unrelated modules. Finish by running the required checks, summarizing evidence and limitations, and showing the exact diff scope.

## 7. Efficiency rules

- One coherent outcome per branch/PR.
- Prefer small files and explicit module boundaries.
- Keep naming, status vocabulary, and errors stable.
- Put durable decisions in docs/ADRs, not chat memory.
- Give exact errors and expected behavior when asking for a fix.
- Reuse tests as executable context for future agents.
- Remove dead experimental code before it becomes precedent.
- Maintain an approved dependency list and justify additions.

## 8. Prohibited patterns

- “Build the whole app/module” prompts
- Unreviewed code directly to production
- Frontend-only permissions or validation
- AI-invented CAAP/aircraft rules
- LLM weight-and-balance calculations
- Production data in development or prompts
- Manual production database edits
- Massive unrelated refactors mixed with features
- Microservices/Kubernetes/native apps before evidence
- An AI author approving its own security or production release

## 9. First milestones

Technical: an invited user activates securely, reaches the correct organization through tested RLS, performs one allowed action through the appropriate direct or protected path, and leaves complete audit evidence.

Aviation: a student creates a dispatch draft, submits it, receives a reasoned return, corrects/resubmits, and receives an authorized human decision with every revision and transition validated and audited.
