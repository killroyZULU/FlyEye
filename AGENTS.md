# FlyEye AI Development Instructions

FlyEye is a multi-tenant Philippine flight-school operations and training PWA.

## Read before changing anything

Read:

- `docs/FlyEye_Documentation/README.md`
- `docs/FlyEye_Documentation/CURRENT_STATE.md`
- the relevant sections of the SRS, architecture, security requirements, and accepted ADRs
- the approved specification and traceability record for the bounded task
- `docs/FlyEye_Documentation/DOCUMENTATION_STANDARD.md` before editing Markdown

Repository documents are authoritative over chat history. When documents conflict, follow the authority order in the documentation README and report the conflict.

## Architecture boundary

Use React, TypeScript, Vite, Supabase PostgreSQL/Auth/private Storage/Row-Level Security/Edge Functions, and version-controlled SQL migrations. Do not introduce another backend framework, Firebase, microservices, native applications, or another cloud platform without an approved ADR.

## Non-negotiable product and security rules

1. Work on one bounded outcome at a time.
2. Do not invent CAAP, aircraft, training, legal, privacy, or operational rules. Mark unverified requirements unresolved.
3. Every tenant-owned row has `organization_id`; every exposed tenant table starts with deny-by-default RLS.
4. Derive membership and authority from server-controlled records, never user-editable metadata.
5. Never expose the Supabase service-role key to the browser.
6. Use Edge Functions or reviewed PostgreSQL functions for authority-bearing operations. Browser roles cannot directly modify status, approvals, finalization, roles, tenant ownership, or audit fields.
7. Create required audit evidence atomically with significant state changes. Audit failure blocks the sensitive action.
8. Use deterministic server-side decimal or PostgreSQL `numeric` calculations for weight and balance. AI cannot approve dispatch, release aircraft, or mark students competent.
9. Use SQL migrations for schema, RLS, policies, functions, triggers, grants, and indexes. Do not make undocumented production database changes.
10. Never use production data in development, tests, logs, screenshots, or prompts.
11. Explain a new package's need, maintenance, license, security posture, and existing alternative before adding it.
12. Do not deploy to production without explicit authorization.

## Delivery workflow

A direct request to build, fix, document, or continue a bounded outcome authorizes delivery through a green review-ready pull request:

1. Inspect the implementation, current branch, and working tree.
2. Define or refine the smallest coherent specification. Record assumptions, unresolved questions, scope, non-goals, risks, affected files, and required data/RLS/function/frontend/audit/test/doc changes.
3. Create or continue the task branch from current `main`; preserve unrelated work.
4. Implement with synthetic data and existing patterns. Cover loading, empty, error, unauthorized, conflict, and success behavior where applicable.
5. Add positive, negative-authorization, and two-organization isolation tests where tenant data or protected commands are involved.
6. Run focused checks during correction, then one final applicable verification matrix. Inspect migrations, grants, policies, views, triggers, privileged functions, generated types, secrets, scope, and cleanup.
7. Obtain a separate agent review of the stable target. Correct in-scope findings and reverify affected behavior.
8. Update only the canonical documentation and evidence required by the task.
9. Inspect and stage only scoped files, commit, push the task branch, open a review-ready pull request, and follow CI through green.

Do not claim completion when required checks fail. The detailed workflow lives in `09_AI_DEVELOPMENT_GUIDE.md` and `10_DEVSECOPS_GUIDE.md`; do not copy it into feature documents.

## Hard stops

Stop and ask one concise question only for:

- an irreducible product or approved-architecture conflict;
- unsupported aviation, legal, privacy, competency, approval, or operational authority;
- credentials or restricted data, cross-tenant behavior, fail-open authority, missing mandatory audit, destructive-data risk, or uncertain cleanup;
- a new paid provider, material recurring cost, hosted application/provider/infrastructure/data-service mutation outside repository branch/PR/CI publication, or a message to real recipients;
- real-data use, merge, production deployment, destructive Git/data action, or branch deletion; or
- the same environmental blocker after bounded safe diagnosis and reasonable recovery attempts.

The standing envelope never includes merging `main`, production deployment, real data, destructive operations, or branch deletion. If merging deploys production, the merge decision is also the production decision.

## Documentation discipline

Follow `DOCUMENTATION_STANDARD.md`:

- one fact or rule has one canonical home;
- link to canonical requirements instead of paraphrasing them;
- keep specifications prospective and evidence records retrospective;
- keep current state out of durable requirements;
- use Git, pull requests, CI, and the concise change log for history;
- do not preserve prompt transcripts, approval chronology, repeated disclaimers, or copy-ready authorization text in active documents;
- make the smallest documentation change needed for the delivered outcome;
- run `pnpm check:docs` and do not bypass its size, link, duplication, or structure checks.

Never weaken a safety, tenancy, privacy, audit, or authority boundary merely to shorten a document. Split the document or improve its references instead.

## Status reporting

Every substantive FlyEye update and final response includes:

```text
SDLC progress
Discovery ○ → Specification ○ → Design ○ → Implementation ○ → Verification ○ → Review ○ → PR/CI ○ → Merge ○ → Release ○
Current: <evidence-based current activity>. Next: <smallest next action>.
```

Use `✓` complete, `▶` current, `○` later/not started, `!` hard-stop blocked, and `—` not applicable. Do not use percentages without a defined checklist and denominator. Report other features only when asked or when they materially block the task.

Final handoffs stay concise: outcome, checks/review, branch/PR, material limitations, and next human action.

## Git policy

- `main` is protected. Never commit or push directly to it, rewrite it, or merge without explicit authorization.
- Branches: `feat/FEAT-XXX-name`, `fix/FIX-XXX-name`, `security/SEC-XXX-name`, `docs/name`, or `chore/name`.
- Before branching, inspect status and refresh remote state when needed. Use `pull --ff-only` only on a verified clean base branch.
- Never discard, move, stage, or commit unrelated user changes. Do not use `git add .` before inspecting the complete tree.
- Commit only after the applicable formatting, lint, type, test, build, security, documentation, and diff checks pass.
- Use Conventional Commits and prefer one verified commit for a small bounded task.
- Push only the current task branch; never force-push without explicit authorization.
- Open a review-ready pull request, follow required checks through green, then stop for the merge decision. Do not delete the branch.
- Never run `git reset --hard`, `git clean`, destructive rebases, branch deletion, remote changes, or destructive data operations without explicit authorization.

At completion report the branch, changed and untracked files, commit(s), checks, push state, PR URL/state, limitations, and recommended next action.
