# AI-Assisted Development Guide

## 1. Operating model

FlyEye may be mostly AI-generated, but it is not prompt-and-hope software. The required method is **specification-driven vibe coding with contract-first vertical slices**.

Do not build the complete backend and then the complete frontend. For each user outcome, implement the necessary data, backend, frontend, authorization, audit, tests, documentation, and observability together.

### Efficient authorization model

Specification-driven does not mean form-driven. A direct request for a bounded
feature or fix authorizes the agent to analyze, specify, implement, verify,
review, document, commit, push, open a review-ready pull request, and follow CI
through green. The normal Founder/Product Owner decision is whether to merge
that pull request.

The agent owns safe, reversible product and technical choices and reports the
reasoning afterward. It does not ask the Founder/Product Owner to approve each
value, file, command, correction, acceptance step, or Git publication action.
Explicit narrower user boundaries override the standing envelope: read-only,
local-only, no-commit, no-push, no-PR, draft-only, and similar restrictions stop
the agent before the prohibited action.

Routine local blockers include a stopped container, unavailable tool, failed
test, flaky startup, formatting defect, fixture defect, or implementation bug
that can be safely diagnosed and corrected inside the bounded outcome. Material
stops include an irreducible product/architecture conflict; unsupported
aviation, legal, or operational authority; credential or restricted-data
exposure; cross-tenant or fail-open behavior; missing mandatory audit;
destructive or uncertain cleanup; a new paid provider or material recurring
cost; real data; hosted application/provider/infrastructure/data-service
mutation other than the scoped repository branch/PR/CI publication workflow;
external messages to real recipients; merge; and production deployment.
Destructive Git or data actions and branch deletion are also material stops.

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

### Step B: Select and record the plan

The plan must show database/RLS, protected-function, frontend, test, and documentation steps and surface conflicts with ADRs or requirements. Material architecture changes require a new ADR.

The agent selects the safest evidence-based plan that fits the requested user
outcome and existing architecture. Record important assumptions and reversible
choices in the feature documentation. Ask the Founder/Product Owner only when
repository evidence cannot resolve materially different user outcomes or a
hard-stop boundary is reached.

### Step C: Implement a bounded slice

Use the Supabase client, generated database types, versioned SQL migrations,
existing Edge Function patterns, and shared runtime schemas. An ordinary package
may be selected inside the bounded envelope only after documenting its purpose,
maintenance, vulnerability posture, license, bundle/operations impact, and
existing alternatives. Stop for a paid provider, material recurring cost, or
architecture change. Never expose service-role credentials or refactor unrelated
modules.

### Step D: Verify

Build, lint/type-check, test units/components/SQL/RLS/Edge Functions/E2E, run authorization and cross-tenant negatives, inspect migrations, generated type drift, policies and privileged functions, verify audit/telemetry, and manually test realistic synthetic scenarios.

### Step E: Risk-based review

A separate review agent inspects security, tenancy, aviation assumptions, calculation accuracy, migration safety, test gaps, dependency/license risk, performance, and scope drift. This agent review plus the required automated verification is the default technical gate for bounded local changes. Never describe it as qualified independent human review.

Correct material technical findings inside the feature envelope and reverify.
Qualified-human review is not a routine blocker for schema, RLS, protected
functions, security, or accessibility-supporting implementation when the result
is local/synthetic, fail-closed, covered by negative tests, and separately
agent-reviewed. Escalate only when authoritative aviation/legal judgment,
production or real-data risk acceptance, formal compliance certification,
penetration testing, or evidence unavailable to the agent is inherently needed.

### Step F: Publish for merge review

Update traceability and the change log, inspect and stage only in-scope files,
commit, push the task branch, open a review-ready pull request, and follow CI
until green. Do not merge. The concise handoff reports the outcome, checks,
review findings, limitations, branch, commits, PR, and one next action: review
and merge.

### Required SDLC progress strip

Every substantive FlyEye response includes this compact phase bar in significant
work updates and in the final response:

`Discovery → Specification → Design → Implementation → Verification → Review → PR/CI → Merge → Release`

Use `✓` for evidence complete, `▶` for current work, `○` for later/not started,
`!` for a documented hard stop, and `—` when the phase does not apply. Follow
the bar with one `Current:` sentence and one `Next:` sentence. Marks must come
from repository/runtime evidence, not optimism or elapsed time. Reopen a phase
if a later finding invalidates it. The strip is informational and creates no
authorization or acceptance gate.

Use this more formal stage vocabulary only when it materially adds release-gate
detail:

1. `Not specified`
2. `Specification or decisions in progress`
3. `Ready for implementation-authorization decision`
4. `Implementation authorized, not started`
5. `Implementation in progress`
6. `Locally implemented; required verification pending`
7. `Locally verified; publication pending`
8. `Published; merge decision pending`
9. `Merged; hosted validation pending`
10. `Hosted validated; deployment or production approval pending`
11. `Production approved`

Do not require a decision-status section, separate proximity report,
upcoming-feature outlook, or copy-ready authorization prompt in every response.
The compact SDLC progress strip is the required orientation aid; include the
other sections only when they materially help the current task. Do not use a
percentage without a defined checklist and denominator.

## 5. AI role separation

| Role | Output | Cannot self-approve |
|---|---|---|
| Product/requirements AI | Stories, rules, acceptance, scope | Irreversible risk acceptance |
| Architecture AI | Data/API/design/ADR proposal | Unsupported architecture expansion |
| Implementation AI | Code, migrations, tests, docs | Merge or production release |
| Review AI | Findings and missing evidence | Risk acceptance |
| Human/aviation reviewers | Correctness, risk, operational fit | Must remain accountable |

The same model may be used in separate sessions, but creator and reviewer
contexts should be distinct. Human review is requested only for the
risk-triggered cases defined above.

## 6. Prompt template

> Read the listed FlyEye documents and deliver the requested bounded feature
> autonomously through a green review-ready pull request. Analyze and record the
> specification, choose safe reversible defaults, implement the vertical slice,
> run focused checks and one final matrix, correct in-scope findings, obtain a
> separate agent review, update evidence, stage only scoped files, commit, push,
> open the PR, and follow CI. Use synthetic data and existing architecture.
> Never expose service-role material or permit direct browser authority changes.
> Stop only for the repository's hard-stop conditions. Do not merge or deploy to
> production. Finish with a short outcome/checks/PR/limitations handoff.

## 7. Efficiency rules

- One coherent outcome per branch/PR.
- A feature request is the coherent authorization through a green review-ready
  PR; do not fragment specification, implementation, verification, review, or
  publication into separate prompts.
- Continue through recoverable local failures inside the approved envelope.
  Escalate only material stop conditions or scope/authority expansion.
- Fingerprint the review target with branch, HEAD, complete working-tree content hashes, dependencies, configuration, and referenced evidence. Do not repeat review or the full verification matrix when that fingerprint is unchanged.
- After a correction, run focused affected checks and then one final required verification matrix.
- Store or reference detailed evidence once; later unchanged reports summarize the result and point to that evidence.
- Prefer small files and explicit module boundaries.
- Keep naming, status vocabulary, and errors stable.
- Put durable decisions in docs/ADRs, not chat memory.
- Give exact errors and expected behavior when asking for a fix.
- Select and document evidence-based defaults instead of asking open-ended
  design questions.
- Ask the Founder/Product Owner one concise question only for merge or a genuine
  hard stop.
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
- An AI author merging to `main`, accepting unsupported regulated risk, or
  approving production

## 9. First milestones

Technical: an invited user activates securely, reaches the correct organization through tested RLS, performs one allowed action through the appropriate direct or protected path, and leaves complete audit evidence.

Aviation: a student creates a dispatch draft, submits it, receives a reasoned return, corrects/resubmits, and receives an authorized human decision with every revision and transition validated and audited.
