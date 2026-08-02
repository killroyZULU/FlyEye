# Portable AI Feature Delivery Playbook

Use this template in FlyEye or copy it into another repository's `AGENTS.md`
and development guide. Replace bracketed values with that application's real
architecture, commands, risk gates, and data boundary.

## Goal

Deliver one complete user outcome autonomously from request through a green
review-ready pull request. Preserve security and release governance while making
the normal human interaction the final merge decision.

## Normal authorization model

A direct request for a bounded feature, fix, documentation task, or chore is the
standing authorization for:

- specification and safe reversible product/technical defaults;
- implementation inside the approved files and architecture;
- read-only repository/runtime inspection;
- safe local service start, stop, reset, and synthetic fixture lifecycle when
  named by the specification;
- routine diagnosis and corrections inside the approved boundary;
- focused reruns after corrections;
- the complete feature-specific evidence set;
- one final required verification matrix after stabilization;
- privacy-safe traceability, change-log, and handoff updates; and
- separate AI/agent review;
- scoped staging, reviewed commits, task-branch push, a review-ready pull
  request, and CI follow-up through green.

Explicit narrower user boundaries override this standing authorization.
Read-only, local-only, no-commit, no-push, no-PR, draft-only, or otherwise
restricted requests stop before the prohibited action.

Do not return to the product owner for a stopped container, missing local tool,
test failure, flaky startup, formatting issue, or in-scope implementation bug.
Diagnose and correct it within the envelope.

The product owner reviews the resulting green PR and decides whether to merge.
Green CI and AI review cannot merge, authorize real-data use, deploy, or approve
production. If merge automatically deploys production, the merge decision must
explicitly include that effect. Destructive Git/data actions and branch deletion
always require explicit scope.

## Hard-stop rules

Stop and request only the smallest missing decision when work reveals:

- an irreducible product or architecture conflict;
- unsupported aviation, legal, privacy, or operational authority;
- credential/restricted-data exposure;
- cross-tenant access, fail-open authority, missing mandatory audit, unsafe
  calculation, or destructive-data risk;
- a new paid provider or material recurring cost, real data, hosted
  application/provider/infrastructure/data-service mutation other than the
  scoped repository branch/PR/CI publication workflow, external messages to real
  recipients, merge, deployment, or production;
- uncertain cleanup after a sensitive side effect; or
- a repeated environmental blocker that bounded safe recovery cannot resolve.

Do not invent a new gate merely because a command failed.

## Verification model

1. **Focused checks:** smallest proof for the current implementation/correction.
2. **Feature checks:** every acceptance, authorization, tenant, concurrency,
   replay, recovery, accessibility-supporting, privacy, and secret test required
   by the specification.
3. **Final matrix:** one complete repository application/database/security
   matrix after implementation and evidence stabilize.

Fingerprint the review target using branch, HEAD, working-tree content,
dependencies, configuration, and evidence references. Reuse unchanged evidence.
After a correction, run focused affected checks and one final matrix; do not
repeat the final matrix again unless the fingerprint changes.

## CI design for AI-assisted repositories

- Provide stable local commands matching CI groups, such as `verify:app` and
  `verify:database:running`.
- Keep independent application and database/security jobs parallel.
- Provide one stable aggregate required-check name for branch protection.
- Automatically discover feature runtime fixtures or maintain one explicit
  manifest; do not require repeated workflow edits for every feature.
- Suppress credential-bearing child output. Emit only reviewed fixture IDs,
  stages, booleans, counts, and pass/fail results.
- Compare generated artifacts without mutating the working tree during checks.
- Use synthetic data and least-privilege CI permissions.
- Do not add deployment credentials or production actions until staging and
  release architecture are explicitly approved.

## Simple feature request

> Build [FEATURE-ID and outcome] in [REPOSITORY]. Follow the repository's
> autonomous feature-delivery policy and continue through a green review-ready
> pull request. Use synthetic data, preserve unrelated work, and stop only for a
> documented hard-stop condition. Do not merge or deploy to production.

## Agent handoff rule

Every substantive progress update and final response includes:

```text
SDLC progress
Discovery ✓ → Specification ✓ → Design ▶ → Implementation ○ → Verification ○ → Review ○ → PR/CI ○ → Merge ○ → Release ○
Current: Finalizing the bounded design. Next: Implement and run focused checks.
```

Use `✓` for evidence complete, `▶` for current work, `○` for later/not started,
`!` for a documented hard stop, and `—` when not applicable. Do not infer a
percentage from the phase bar. It communicates position only and creates no new
approval gate.

Continue in the current task through the green review-ready pull request. End
with a concise merge recommendation. Ask another question only for merge or a
genuine hard stop.
