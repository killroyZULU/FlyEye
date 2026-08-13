# AI-Assisted Development Guide

## Operating model

FlyEye uses contract-first vertical slices. For one user outcome, implement only the required data, protected server behavior, frontend, authorization, audit, tests, observability, and documentation.

A direct bounded feature, fix, documentation, or maintenance request authorizes routine delivery through a green review-ready pull request. The agent selects safe, reversible defaults from repository evidence and does not ask for approval of every value, file, command, correction, local check, commit, push, or pull-request action.

Explicit narrower instructions override this default. The hard stops and excluded actions are defined once in the root `AGENTS.md`.

## Required context

Before changing the repository, read:

- [README](README.md) and [Current State](CURRENT_STATE.md)
- relevant SRS, architecture, security, privacy, data/API, and accepted ADR sections
- the bounded feature specification and traceability record
- existing implementation and tests in the affected area
- [Documentation Standard](DOCUMENTATION_STANDARD.md) before editing Markdown

Repository authority cannot be silently overridden by chat.

## Planning and tracking

GitHub Issues and the [FlyEye Delivery project](https://github.com/users/killroyZULU/projects/1) coordinate active work. Create one issue for each bounded feature, fix, security task, documentation task, or chore; add it to the project; and link the implementing pull request with `Closes #<issue>`. Use issue dependencies for real blockers and keep only near-term work active.

Issues and project fields are operational views, not new requirement or status authorities. They link to the applicable specification, [Current State](CURRENT_STATE.md), roadmap, decision, or evidence record instead of duplicating those documents. Closed issues and pull requests provide history; they do not replace traceability evidence.

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

Run the applicable formatting, documentation, lint, type, unit/component, SQL/RLS, Edge/runtime, browser/E2E, build, dependency, secret, generated-type, and cleanup checks. Include unauthorized and cross-tenant negatives whenever the outcome touches membership, tenant data, protected commands, files, reports, or exports.

Use focused checks while correcting defects. Once the target stabilizes, run one final applicable matrix and record detailed evidence once.

### 5. Review

A separate agent reviews the stable diff for scope, requirements, security, tenancy, privacy, aviation assumptions, authority, audit, migration safety, test gaps, accessibility, dependency risk, and documentation quality. Correct in-scope findings and reverify affected behavior.

Agent review is technical evidence, not qualified independent human review or risk acceptance. Qualified people remain necessary for legal, aviation, real-data, production, penetration-test, or formal-compliance claims that inherently require their judgment or evidence.

### 6. Publish

Inspect the complete diff and worktree, stage only scoped files, commit, push the task branch, open a review-ready pull request linked to the bounded issue, and follow required CI through green. Do not merge.

The handoff reports only the outcome, checks and review, branch/commit/PR, material limitations, and next human action.

## Documentation behavior

AI-generated documentation must read like maintained engineering documentation, not a transcript.

- Put each fact in its canonical home and link to it elsewhere.
- Update stale text instead of appending another paragraph.
- Keep feature specifications about the contract; keep evidence in traceability.
- Keep current status in `CURRENT_STATE.md` and history in Git, pull requests, CI, and a concise change log.
- Preserve stable requirement, decision, acceptance, and test IDs.
- Avoid repeated disclaimers, approval chronology, command diaries, raw output, generic benefits, filler, and copy-ready authorization prompts.
- Do not create a document merely because an AI workflow produced information.
- Use the smallest sufficient update and run `pnpm check:docs`.

If text exceeds a budget in [Documentation Standard](DOCUMENTATION_STANDARD.md), restructure or split it. Never weaken a control to meet a budget.

## Status reporting

Every substantive FlyEye update uses the compact phase bar defined in `AGENTS.md`. Marks are evidence-based and reopen when later findings invalidate a phase. Do not add a second proximity report, decision form, upcoming-feature list, or percentage unless it materially helps the requested task.

## Implementation order

1. Identity, organization membership, invitations, permissions, and audit foundation
2. Aircraft records and compliance documents
3. Personnel profiles and qualifications
4. Dispatch draft and controlled state workflow
5. Deterministic weight and balance
6. Weather/NOTAM source records and final documents
7. Training structures, assessment, progression, and reporting
8. Offline drafts after online workflows stabilize
9. AI assistance only after the corresponding non-AI workflow is stable

The current sequence and blockers live in [Current State](CURRENT_STATE.md) and the [Product Roadmap](14_PRODUCT_ROADMAP.md), not in this guide.

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
