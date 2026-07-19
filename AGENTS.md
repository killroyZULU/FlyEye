# FlyEye AI Development Instructions

FlyEye is a multi-tenant Philippine flight-school operations and training PWA.

## Required context

Before making changes, read:

- `docs/FlyEye_Documentation/README.md`
- `docs/FlyEye_Documentation/01_MASTER_HANDOFF.md`
- `docs/FlyEye_Documentation/03_PRODUCT_REQUIREMENTS_SRS.md`
- `docs/FlyEye_Documentation/04_SYSTEM_ARCHITECTURE.md`
- `docs/FlyEye_Documentation/08_SECURITY_REQUIREMENTS.md`
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
6. Do not pull from a remote unless explicitly authorized.

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
10. The user has explicitly requested or authorized the commit.

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

- Never push automatically.
- Push only after the user explicitly requests it.
- Before pushing, report the branch name, commit list, test results, and remote destination.
- Push only the current feature branch.
- Never use `--force` or `--force-with-lease` without explicit authorization.
- Never push credentials, production data, local environment files, or unrelated work.

### Pull-request policy

When explicitly requested to publish the work:

1. Confirm the current branch and intended remote.
2. Confirm that all required checks pass.
3. Push the feature branch.
4. Open a draft pull request unless the user explicitly requests a ready-for-review pull request.
5. Summarize the user outcome, schema changes, RLS policies, protected functions, tests, security considerations, migration instructions, and known limitations.
6. Do not merge the pull request.
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
- Recommended next action
