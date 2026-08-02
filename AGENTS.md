# FlyEye AI Development Instructions

FlyEye is a multi-tenant Philippine flight-school operations and training PWA.

## Required context

Before making changes, read:

- `docs/FlyEye_Documentation/README.md`
- `docs/FlyEye_Documentation/01_MASTER_HANDOFF.md`
- `docs/FlyEye_Documentation/03_PRODUCT_REQUIREMENTS_SRS.md`
- `docs/FlyEye_Documentation/04_SYSTEM_ARCHITECTURE.md`
- `docs/FlyEye_Documentation/08_SECURITY_REQUIREMENTS.md`
- `docs/FlyEye_Documentation/09_AI_DEVELOPMENT_GUIDE.md`
- `docs/FlyEye_Documentation/adr/ADR-0005-LEAN-SUPABASE-STACK.md`
- The approved feature specification for the current task

Repository documentation is authoritative over chat history.

## Architecture

Use:

- React
- TypeScript
- Vite
- Supabase PostgreSQL
- Supabase Auth
- Supabase private Storage
- Supabase Row-Level Security
- Supabase Edge Functions
- Version-controlled SQL migrations

Do not introduce a separate backend framework, Firebase, microservices, native applications, or a new cloud platform without an approved ADR.

## Mandatory rules

1. Work on one bounded feature outcome at a time.
2. Do not invent CAAP, aircraft, training, or operational rules.
3. Mark unverified aviation requirements as unresolved.
4. Enable deny-by-default RLS on every exposed tenant table.
5. Every tenant-owned row must have `organization_id`.
6. Never use user-editable metadata as authorization.
7. Never expose the Supabase service-role key to the browser.
8. Protected operations must use Edge Functions or reviewed PostgreSQL functions.
9. Normal browser users cannot directly modify status, approvals, finalization, roles, tenant ownership, or audit fields.
10. Weight-and-balance must use deterministic server-side decimal or PostgreSQL numeric calculations. Never use an LLM for authoritative calculations.
11. AI cannot approve dispatch, release aircraft, or mark students competent.
12. All significant state transitions must create audit evidence atomically.
13. Use SQL migrations for schema, RLS, policies, functions, triggers, grants, and indexes.
14. Do not make undocumented production database changes.
15. Do not add a package without explaining its necessity, maintenance status, license, and existing alternative.
16. Never use production data in development, tests, logs, screenshots, or AI prompts.
17. Do not deploy to production unless explicitly authorized.

## Required workflow

Before coding:

1. Inspect the existing implementation.
2. List assumptions and unresolved questions.
3. Identify schema, RLS, protected-function, frontend, audit, test, and documentation changes.
4. Identify files that will and will not change.
5. Identify security, tenancy, privacy, and aviation risks.

During implementation:

1. Keep changes within the approved feature.
2. Reuse existing patterns and components.
3. Add automated tests with the implementation.
4. Include negative authorization and cross-tenant tests.
5. Handle loading, error, empty, unauthorized, conflict, and success states.

Before declaring completion:

1. Run formatting, linting, type checking, tests, and production build.
2. Test RLS as authorized and unauthorized users from at least two organizations.
3. Inspect migrations, grants, policies, views, triggers, and privileged functions.
4. Confirm the service-role key is absent from browser code.
5. Update relevant documentation and traceability.
6. Report changed files, commands executed, results, assumptions, and known limitations.

Do not claim completion when required checks fail.

## Standard feature-delivery authorization envelope

FlyEye uses autonomous feature delivery by default. A direct request to build,
fix, or continue a bounded feature authorizes the complete engineering loop
through a green review-ready pull request:

1. inspect the repository and define or refine the smallest coherent
   specification;
2. select safe, reversible product and technical defaults from repository
   evidence;
3. create or continue the feature branch;
4. implement the vertical slice using local synthetic data;
5. diagnose and correct in-scope failures;
6. run focused checks, one final verification matrix, secret/scope checks, and a
   separate agent review;
7. update documentation and traceability;
8. inspect and stage only the feature files, create reviewed commit(s), push the
   feature branch, open a review-ready pull request, and follow CI through green.

Do not ask the Founder/Product Owner to approve the specification,
implementation start, routine values, local verification, product acceptance,
commit, push, or pull-request creation separately. The normal human decision is
whether to merge the green pull request.

Explicit narrower user boundaries always override this standing envelope. A
read-only, local-only, no-commit, no-push, no-PR, draft-only, or otherwise
restricted request stops before the prohibited action.

Continue autonomously until the authorized outcome is complete or a genuine
hard stop occurs. A hard stop is:

- an unresolved material conflict with the product boundary or approved
  architecture that cannot be resolved safely from repository evidence;
- a change that would create aviation-authoritative rules, approvals,
  competency decisions, operational release authority, or an unsafe legal or
  privacy claim without an authoritative source;
- credential or restricted-data exposure, cross-tenant behavior, fail-open
  authority, missing mandatory audit, destructive-data risk, or uncertain
  cleanup;
- a new paid provider, material recurring cost, hosted application/provider/
  infrastructure/data-service mutation (excluding the scoped repository
  branch/PR/CI publication workflow),
  external message to real recipients, real-data use, production deployment,
  merge, destructive Git/data action, or branch deletion; or
- the same environmental blocker remaining after bounded safe diagnosis and
  reasonable recovery attempts.

Routine failures are evidence to diagnose, not automatic reasons to hand the
task back. Keep credential-bearing commands behind output suppression or a
reviewed allowlist sanitizer, never emit raw provider/container payloads, and
record detailed evidence once. If a material incident occurs, stop the affected
operation, contain it, preserve the working tree, and request only the smallest
new authority genuinely required.

This standing envelope never includes merging into `main`, production
deployment, real-data use, destructive Git/data operations, or branch deletion.
If merging automatically deploys to production, the merge decision is also the
production decision and must say so explicitly.

## Founder/Product Owner interaction model

The agent owns routine product shaping and engineering decisions needed to
deliver the requested bounded outcome safely. Use repository requirements,
existing patterns, tests, secure defaults, and reversible choices. Explain
important choices in the handoff; do not turn them into forms or approval
requests.

Interrupt the Founder/Product Owner only for:

- the final merge decision;
- a hard-stop condition from the delivery envelope;
- an irreducible product ambiguity where realistic options produce materially
  different user outcomes and repository evidence cannot select safely; or
- a production, real-data, legal, regulatory, aviation-authority, or material
  provider/cost decision.

When interruption is necessary, recommend one choice in plain language and ask
one concise question. Qualified-human review is risk-triggered, not a routine
feature gate. It is required only when the agent cannot establish a safe result
with authoritative sources, automated evidence, and separate agent review, or
when a legal, aviation, production, penetration-test, or formal accessibility
compliance claim inherently requires a qualified person.

## Delivery status reporting

Every substantive FlyEye response must include a compact `SDLC progress`
section. Include it in significant commentary updates while work is running and
in every final response. This is orientation, not a new approval gate.

Use this fixed phase bar:

`Discovery → Specification → Design → Implementation → Verification → Review → PR/CI → Merge → Release`

Mark each phase with exactly one symbol:

- `✓` evidence complete;
- `▶` current work;
- `○` not started or later;
- `!` blocked by a documented hard stop; or
- `—` not applicable to the bounded task.

Immediately below the bar, state `Current:` and `Next:` in plain language. Keep
the section to two or three lines unless the user asks for detail. Base every
mark on repository/runtime evidence, and move a completed phase back to current
when later findings reopen it. Do not use a percentage unless a defined
checklist and denominator exist.

Example:

```text
SDLC progress
Discovery ✓ → Specification ✓ → Design ✓ → Implementation ▶ → Verification ○ → Review ○ → PR/CI ○ → Merge ○ → Release ○
Current: Implementing the bounded feature. Next: Run focused and complete local verification.
```

Keep the remainder of final reports short and practical. Report:

1. the delivered outcome;
2. the checks and review result;
3. the branch and pull-request state;
4. material limitations; and
5. the next human action, normally `Review and merge the pull request`.

Use the stage vocabulary below only when a more formal release-gate label adds
useful detail beyond the required SDLC progress strip. Do not require an
upcoming-feature outlook in every response.

Use these stages consistently:

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

Do not use an implementation percentage unless a defined checklist and its
denominator are identified. Never use a proximity label to imply that a later
gate is complete.

Report upcoming features only when asked or when a dependency materially affects
the current task. Do not invent dates, effort estimates, specifications,
authorization, or completion.

## Git and version-control policy

Use a simple feature-branch workflow.

### Protected branch

- `main` is the protected, stable branch.
- Never make feature changes directly on `main`.
- Never push directly to `main`.
- Never merge into `main` without explicit user authorization.
- Never force-push, rewrite, or delete `main`.

### Branch naming

Create a separate branch for each bounded task:

- `feat/FEAT-XXX-short-description` for new features
- `fix/FIX-XXX-short-description` for defect corrections
- `docs/short-description` for documentation-only changes
- `chore/short-description` for tooling and maintenance
- `security/SEC-XXX-short-description` for security corrections

Use lowercase kebab-case after the identifier.

Do not create permanent development, staging, or release branches unless an approved architecture or delivery decision introduces them.

### Before creating a branch

1. Inspect the current branch and working tree.
2. Report any existing uncommitted or untracked changes.
3. Do not discard, overwrite, move, or include unrelated user changes.
4. If unrelated changes conflict with the task, stop and request direction.
5. Create the task branch from the latest locally available `main`.
6. Fetch by default when remote freshness is needed. Use `git pull --ff-only`
   only on a verified clean base branch; never pull a feature branch containing
   preserved work. Do not overwrite or discard local work.

### Commit policy

Do not create a commit unless:

1. The requested feature or fix is complete.
2. The final diff has been inspected.
3. Changes are limited to the approved task.
4. Formatting and linting pass.
5. Type checking passes.
6. Required automated tests pass.
7. The production build passes.
8. Relevant SQL migrations, RLS policies, protected functions, generated types, tests, and documentation are included.
9. No credentials, `.env` files, production data, service-role keys, generated secrets, or sensitive records are present.
10. The change was requested as a bounded feature, fix, documentation task, or
    chore and therefore falls within the standing delivery envelope.

Do not use `git add .` without first inspecting the complete working tree. Stage only files belonging to the approved task.

### Commit messages

Use Conventional Commit style:

- `feat: add organization invitation workflow`
- `fix: prevent cross-organization aircraft access`
- `docs: update Supabase security guidance`
- `test: add dispatch RLS isolation cases`
- `chore: configure frontend linting`
- `security: restrict dispatch approval function`

Include the feature or issue identifier where practical:

`feat(FEAT-002): add organization invitation workflow`

### Commit structure

Prefer one verified commit for a small bounded feature.

Use multiple commits only when they represent independently understandable changes, such as:

1. Database migration and RLS
2. Protected function
3. Frontend workflow
4. Tests and documentation

Do not create checkpoint commits containing broken builds, disabled tests, temporary secrets, or incomplete migrations.

### Push policy

- Push the verified current task branch as part of autonomous delivery.
- Before pushing, confirm the branch, commit list, test results, and remote
  destination internally and include them in the final report.
- Push only the current feature branch.
- Never use `--force` or `--force-with-lease` without explicit authorization.
- Never push credentials, production data, local environment files, or unrelated work.

### Pull-request policy

After the bounded feature passes its required local gates:

1. Confirm the current branch and intended remote.
2. Confirm that all required checks pass.
3. Push the feature branch.
4. Open a review-ready pull request and follow its checks through green.
5. Summarize the user outcome, schema changes, RLS policies, protected functions, tests, security considerations, migration instructions, and known limitations.
6. Stop for the human merge decision; do not merge the pull request.
7. Do not delete the branch.

### Destructive Git operations

Do not run any of the following without explicit user authorization:

- `git reset --hard`
- `git clean`
- force push
- interactive rebase
- rewriting published commits
- deleting local or remote branches
- discarding working-tree changes
- removing untracked files
- changing Git remotes

Prefer reversible operations and preserve existing user work.

### Completion report

At the end of a task, report:

- Current branch
- Changed files
- Untracked files
- Commits created, if any
- Checks and tests executed
- Whether anything was pushed
- Remaining limitations
- Pull-request URL/state when published
- Recommended next action, normally review and merge

### Follow-up requests

Do not require the user to paste authorization templates to continue routine
feature delivery. Ask one concise question only for the merge decision or a
genuine hard stop. Preserve the exact branch, PR, evidence, limitation, and
closed production/real-data boundaries in that question.
