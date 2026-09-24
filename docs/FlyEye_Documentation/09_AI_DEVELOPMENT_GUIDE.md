# AI-Assisted Development Guide

## Operating model

FlyEye uses contract-first vertical slices. For one user outcome, implement only the required data, protected server behavior, frontend, authorization, audit, tests, observability, and documentation.

A direct bounded feature, fix, documentation, or maintenance request authorizes routine delivery through a green review-ready pull request. The agent selects safe, reversible defaults from repository evidence and does not ask for approval of every value, file, command, correction, local check, commit, push, or pull-request action.

Explicit narrower instructions override this default. The hard stops and excluded actions are defined once in the root `AGENTS.md`.

## Required context

Read the baseline required by [AGENTS.md](../../AGENTS.md), then use the
[task routing table](README.md#task-routing) to select relevant sections and
feature contracts/evidence. Inspect the affected implementation and tests.
Repository authority cannot be silently overridden by chat.

## Planning and tracking

GitHub Issues and the [FlyEye Delivery project](https://github.com/users/killroyZULU/projects/1) coordinate active work. Create one issue for each bounded feature, fix, security task, documentation task, or chore; add it to the project; and link the implementing pull request with `Closes #<issue>`. Use issue dependencies for real blockers and keep only near-term work active.

Issues and project fields are operational views, not new requirement or status authorities. They link to the applicable specification, [Current State](CURRENT_STATE.md), roadmap, decision, or evidence record instead of duplicating those documents. Closed issues and pull requests provide history; they do not replace traceability evidence.

### Integration checkpoint

Before starting another delivery slice, refresh `main` and inspect open PRs, their bases, dependencies, linked issues, review findings, and CI. Identify which are in progress, blocked, ready for a merge decision, or intentionally deferred. Open discovery and audit issues alone do not block unrelated delivery.

Keep one active delivery slice by default. Finish its corrections and review before starting another. Once its PR is green, surface the merge decision instead of silently starting new work. An explicit instruction to defer it or proceed with another task permits that work; record the disposition in the affected PR. Never infer merge authorization from green CI or a request for the next task.

Use stacked or parallel delivery only when explicitly directed. For a stack, record each parent PR, base branch, merge order, and eventual `main` target in the PR descriptions. Do not build on an unmerged prerequisite without that direction. For parallel work, identify overlapping files or contracts and the integration order. Recheck these relationships as branches change.

## Feature workflow

### 1. Discover and specify

Identify the user outcome, scope, non-goals, assumptions, verified and unresolved rules, workflow/state, data changes, permissions, tenant boundary, privacy classification, abuse cases, audit events, edge cases, migration risk, tests, and affected files.

Use existing requirement and decision IDs. A material architecture change requires an ADR. Unsupported aviation or legal authority remains unresolved.

### 2. Design the vertical slice

Choose the smallest design that satisfies the approved outcome and existing architecture. Show database/RLS, protected-function, frontend, test, documentation, rollback/forward-fix, and observability impact. Prefer existing patterns and dependencies.

### 3. Implement

Use versioned SQL migrations, generated database types, existing Edge Function patterns, shared schemas, and synthetic fixtures. Ordinary browser roles receive only explicitly approved low-risk operations under tested RLS.

For a new dependency, record its purpose, maintenance, vulnerability posture, license, operational or bundle impact, and why an existing dependency is insufficient.

### 4. Verify

Use [QA applicability, tiers and evidence reuse](11_QA_TEST_PLAN.md#verification-applicability)
to select the matrix and record the environment supplying each result. Use
[DevSecOps setup and database safety](10_DEVSECOPS_GUIDE.md#local-setup-and-database-safety)
before executing commands. A missing local database result may be supplied by
disposable CI under that policy; it cannot be marked passed before execution.

### 5. Review

A separate agent reviews the stable diff for scope, requirements, security, tenancy, privacy, aviation assumptions, authority, audit, migration safety, test gaps, accessibility, dependency risk, and documentation quality. Correct in-scope findings and reverify affected behavior.

Agent review is technical evidence, not qualified independent human review or risk acceptance. Qualified people remain necessary for legal, aviation, real-data, production, penetration-test, or formal-compliance claims that inherently require their judgment or evidence.

### 6. Publish

Inspect the complete diff and worktree, stage only scoped files, commit, push the task branch, open a review-ready pull request linked to the bounded issue, and follow required CI through green. Publication ends at the merge decision unless merge authorization is already explicit.

The handoff reports only the outcome, checks and review, branch/commit/PR, material limitations, and next human action. State whether the outcome is review-ready on a branch or integrated into `main`; publication alone does not complete integration.

### 7. Integrate when authorized

Before each authorized merge, verify the current head and base, final diff, resolved blocking review findings, mergeability, and required CI for the resulting integration. Resolve drift and reverify affected behavior before merging. Follow any specified merge order and stop the sequence on failure.

After each merge, verify the resulting `main` commit and required post-merge CI before merging the next PR or starting dependent work. Retarget stacked children as needed, reconcile them with updated `main`, and obtain fresh checks and review for changed integration behavior. Verify linked issue closure only when its acceptance criteria are fulfilled; an intermediate stack merge or partial umbrella fix does not close the overall outcome.

Update stale canonical status, confirm the final remote state, and refresh a clean local `main` without disturbing unrelated work. Report any remaining PRs and their disposition. Branch deletion and release remain outside integration authorization under `AGENTS.md`.

## Documentation behavior

Follow [Documentation Standard](DOCUMENTATION_STANDARD.md) for canonical homes,
stable IDs, prospective contracts, retrospective evidence, budgets and checks.
Make the smallest required update. Active work disposition belongs in the linked
issue/PR; avoid a pending-review or pending-merge sentence in a specification or
checkpoint that becomes false as soon as its own PR progresses. Current State
should identify the work and link its live disposition, then record completed
integration when next changed for a bounded outcome.

## Status reporting

Every substantive FlyEye update uses the compact phase bar defined in `AGENTS.md`. Marks are evidence-based and reopen when later findings invalidate a phase. Do not add a second proximity report, decision form, upcoming-feature list, or percentage unless it materially helps the requested task.

## Implementation order

The sequence lives in [Product Roadmap](14_PRODUCT_ROADMAP.md); current work and
blockers live in [Current State](CURRENT_STATE.md) and linked issues. Do not
maintain a second ordered backlog in this guide.

## Prohibited patterns

- Whole-application or whole-module generation without a bounded contract
- Frontend-only authorization or authoritative validation
- AI-invented aviation, aircraft, legal, privacy, or operational rules
- LLM-based authoritative calculations or approvals
- Production/customer data in development or prompts
- Manual undocumented production database changes
- Service-role credentials in browser code
- Massive unrelated refactors inside a feature
- Microservices, Kubernetes, native applications, or new platforms without evidence and an ADR
- AI self-approval of merge, deployment, production, or regulated risk
- Documentation that repeats global rules or stores a conversation history
