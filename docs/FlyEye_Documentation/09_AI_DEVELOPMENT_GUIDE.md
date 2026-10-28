# AI-Assisted Development Guide

## Operating model

FlyEye uses contract-first vertical slices. For one user outcome, implement only the required data, protected server behavior, frontend, authorization, audit, tests, observability, and documentation.

A direct bounded delivery request authorizes routine work through a green review-ready PR. Choose safe, reversible defaults without repeated permission prompts for in-scope corrections, checks or publication.

Explicit narrower instructions override this default. The hard stops and excluded actions are defined once in the root `AGENTS.md`.

## Required context

Read the baseline required by [AGENTS.md](../../AGENTS.md), then use the
[task routing table](README.md#task-routing) to select relevant sections and
feature contracts/evidence. Inspect the affected implementation and tests.
Repository authority cannot be silently overridden by chat.

## Planning and tracking

Create or reuse one bounded issue in the [FlyEye Delivery project](https://github.com/users/killroyZULU/projects/1), linking the PR with `Closes #<issue>`. Use dependencies for real blockers. Issues link canonical contracts and evidence; they do not duplicate requirements or become another status authority.

Before execution, declare outcome/scope, acceptance criteria, exclusions, assumptions, risks, affected files, dependencies, stopping conditions and the completion boundary. Use the existing feature contract for discovery/design. A bounded correction records only changed behavior, assumptions, risks and verification; do not repeat feature planning or create another specification without a material contract change. New findings require a separate scope decision, not automatic expansion.

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

The handoff reports what changed, checks/review, branch/commit/PR and push state, changed/untracked files, limitations and the next owner decision. Distinguish review-ready publication from integration and separate release/real-data acceptance.

### 7. Integrate when authorized

Before each authorized merge, verify the current head and base, final diff, resolved blocking review findings, mergeability, and required CI for the resulting integration. Resolve drift and reverify affected behavior before merging. Follow any specified merge order and stop the sequence on failure.

After each merge, verify the resulting `main` commit and required post-merge CI before merging the next PR or starting dependent work. Retarget stacked children as needed, reconcile them with updated `main`, and obtain fresh checks and review for changed integration behavior. Verify linked issue closure only when its acceptance criteria are fulfilled; an intermediate stack merge or partial umbrella fix does not close the overall outcome.

Update stale canonical status, confirm the final remote state, and refresh a clean local `main` without disturbing unrelated work. Report any remaining PRs and their disposition. Branch deletion and release remain outside integration authorization under `AGENTS.md`.

## Documentation behavior

Follow [Documentation Standard](DOCUMENTATION_STANDARD.md). Make the smallest canonical update. Active disposition belongs in the issue/PR; Current State links it and records completed integration when next touched. Keep transient review/merge status out of specifications.

## Status reporting

Before execution, fix the boundary, milestone weights and acceptance conditions. Percentages sum completed milestones; they do not estimate time remaining. Define any submilestones and their weights in advance. Use these defaults:

| Milestone and acceptance                                                                          | Integrated |          PR-only |
| ------------------------------------------------------------------------------------------------- | ---------: | ---------------: |
| Scope/plan: bounded contract, dependencies, exclusions and stops fixed                            |        10% |              10% |
| Implementation: scoped changes complete for verification                                          |        30% |              30% |
| Applicable verification: required local/feature evidence valid, including any CI-supplied results |        25% |              30% |
| Independent review: stable target reviewed, blocking findings corrected and reverified            |        15% |              20% |
| PR/final-head CI/handoff: published target green and complete handoff                             |        10% |              10% |
| Separately authorized merge/post-merge verification: exact main gates and cleanup pass            |        10% | Outside boundary |

Read-only assessment ends at a delivered proposal: baseline/handoffs 25%, assessment 35%, proposal/test cases 30%, final handoff 10%. Declare any different task-specific weights and acceptance conditions before starting; never redistribute weights or use arbitrary N/A labels to inflate progress. PR-only completion does not silently convert an integration-tracked task to 100%.

Every substantive update shows the boundary, bar, exact percentage, status, current phase, completed milestones and next step. Fill one of ten bar cells per complete ten percentage points; the numeric value is authoritative. Example for an integration-tracked task:

```text
Boundary: integration through verified main
Progress: [#########-] 90% | AWAITING OWNER
Current: merge decision
Done: plan, implementation, verification, review, PR/handoff
Next: separately authorized merge, then post-merge verification
```

Use RUNNING for work proceeding, BLOCKED for an unmet prerequisite or failed required evidence, AWAITING OWNER for a decision, PR-ONLY COMPLETE for the fulfilled publication boundary, and INTEGRATED COMPLETE only after verified integration. A delivered read-only assessment can be 100% AWAITING OWNER; its boundary excludes implementation. Task 100% never means FlyEye is production-ready.

Credit a milestone only when all its acceptance conditions pass. A merge without successful post-merge checks does not earn the final milestone. Reopen invalidated milestones and subtract their credit when evidence becomes stale or fails. Explain scope changes, affected acceptance and revised planning before proceeding; preserve the original denominator unless the owner explicitly changes the task boundary.

## Policy adoption

After an authorized policy merge and successful exact-main integration checks, each existing FlyEye chat must read that immutable policy commit and its applicable AGENTS hierarchy before resuming under the new rules. Contacting other chats requires owner authorization; dormant chats adopt on resumption. Record a receipt in the task/PR with policy SHA and integration run, files read, task branch/head, conflicts and overlapping ownership, retained checks and invalidated evidence, milestone weights/acceptance/current credit, and existing authorization limits.

Reading policy does not update an old branch's CI workflow. Identify its actual workflow version; reconcile code through the normal explicitly authorized branch workflow. Adoption grants no reset, rebase, merge, retroactive evidence waiver, scope expansion or additional permissions. Resolve conflicts before dependent work; keep prior evidence's original target and limitations.

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
