# DevSecOps Guide

## 1. Objective

DevSecOps integrates build, test, security, deployment, monitoring, recovery, and evidence into normal delivery. It is mandatory because AI-generated code, isolated school data, and aviation-adjacent workflows make late security testing inadequate.

## 2. Source-control model

Use one repository containing the React app, `supabase/` migrations/functions/tests, end-to-end tests, and docs. Use one bounded `feat/*`, `fix/*`, `docs/*`, `chore/*`, or `security/*` branch per task. A requested bounded task carries standing authority to commit, push that task branch, and open a review-ready pull request after local verification and separate-agent review. Merge into stable `main` only through an explicit human merge decision. Never push or force-push feature work directly to `main`.

Verify repository protection settings rather than assuming plan restrictions. Where GitHub-enforced protection is not configured, apply the manual gate: use a pull request and checklist, require green CI, inspect the final diff and unresolved conversations, keep deployment separate, and obtain explicit authorization before every merge. Add required reviews/CODEOWNERS when additional qualified collaborators join and the repository plan supports the controls.

Before committing, stage only reviewed files and run `pnpm check:secrets`; rerun it after the final commit and before every push. It scans committed history, staged changes, and unstaged tracked changes using Gitleaks `8.30.1`, with complete value redaction and failure if the scanner is unavailable or mismatched. Install the official release after verifying its published checksum; expose the executable through `PATH` or `GITLEAKS_PATH`. Untracked files must be staged before this gate can cover them. Review exact-fingerprint or inline suppressions; never add a blanket exception to publish a credential.

CI detects leaks after publication. Enable repository secret scanning and push protection through an authorized settings change to block supported credential patterns before GitHub accepts them. These controls supplement local scans and do not prove that arbitrary passwords, private documents, or every secret format are absent. If a real secret is exposed, stop publication and obtain authorization for revocation/rotation and coordinated cleanup; deleting the current file alone is insufficient.

The Gitleaks configuration retains default rules and exempts only complete `sb_publishable_` values from its generic API-key rule because these are public client identifiers. It does not exempt a file, environment-variable name, or server-key format. Authorization still depends on the server controls in [Security Requirements](08_SECURITY_REQUIREMENTS.md#4-authorization-and-tenant-isolation).

## 3. Pull-request pipeline

Run the verification pipeline for pull requests targeting any branch, including
stacked feature PRs. Push-triggered runs remain limited to `main`. A manually
dispatched run is evidence for its recorded head, not an attached PR check;
verify the current head and required results before delivery claims.

The current CI baseline is verification-only. It runs frozen installation,
formatting, documentation and code-maintainability architecture checks, ESLint,
TypeScript, coverage-gated unit/component/handler tests, production build, a
browser-specific Supabase key scan, a general Git-history secret scan,
Playwright tests, dependency audit, local Supabase reset, schema-wide and
feature-specific SQL/RLS tests, real Auth/TOTP/Edge/browser/cross-organization
integration, database lint, and generated database-type drift. It uses
synthetic local data, least-privilege read-only repository permissions, and no
deployment credentials.

Select local groups using [QA verification applicability](11_QA_TEST_PLAN.md#verification-applicability).
The following commands expose the checks; `package.json` and the workflow own
their executable definitions. Do not assume exact local/CI parity without
comparing them.

- `pnpm verify:app` runs the complete application-side quality group;
- `pnpm check:secrets` is the redacted general prepublication gate;
- `pnpm check:code` enforces production TypeScript file budgets, feature and
  Edge Function import boundaries, and acyclic production imports;
- `pnpm check:docs` validates active-document size budgets, local links,
  required entry points, prohibited historical/prompt structure, and duplicate
  long paragraphs;
- `pnpm verify:database:running` runs reset, SQL/RLS, every automatically
  discovered `scripts/test-*-runtime.mjs` fixture through a body/output-suppressed
  runner, database lint, and a non-mutating generated-type comparison against an
  already running local stack. **It starts with `db:reset` and is destructive**;
  apply [database safety](#local-setup-and-database-safety) first; and
- GitHub Actions publishes one aggregate `Required quality gate` result after
  the parallel application and database jobs finish.

### Local setup and database safety

Use the Node version pinned in [CI](../../.github/workflows/ci.yml) and pnpm from
[`package.json`](../../package.json). Install with `pnpm install --frozen-lockfile`;
on Windows, use `pnpm.cmd` if PowerShell blocks the script shim. Install the
Playwright Chromium browser when required by the selected checks. The general
secret scanner setup is in [Source-control model](#2-source-control-model).

Before any local Supabase start, stop, restart, reset or fixture run, establish
the exact repository/project, ports, containers/volumes, data and service users
through non-sensitive inspection. A loopback URL, synthetic data or running
container does not establish disposability or permission to interrupt it.

Local Supabase development services may bind to `0.0.0.0` and use shared
development credentials. Keep this stack synthetic-only and network-restricted;
never copy its credentials or startup output into source, prompts, screenshots,
logs, staging or production.

- Reset only a verified disposable synthetic target whose disposal is authorized
  for the task, including an already approved disposable fixture lifecycle.
- Never reset, stop, reconfigure or run mutating fixtures against a stack occupied
  by other work, shared, unknown or valuable. Use the existing disposable CI job or
  an authorized isolated environment. A Git worktree alone does not isolate
  Supabase resources; a backup alone does not authorize their destruction.
- Keep hosted targets, real data, destructive operations and uncertain cleanup
  under the hard stops in [AGENTS.md](../../AGENTS.md). Do not repeatedly ask to
  reset an occupied stack when disposable CI can supply the required evidence.

For an authorized disposable local target, configure ignored environment files
from the checked-in examples only when absent; preserve existing values. Keep
frontend values browser-safe and the Edge origin exact and loopback-only. See
[`.env.example`](../../.env.example) and [Edge environment example](../../supabase/functions/.env.example).
Do not print credentials from environment files or Supabase startup/status.

Start the target with `pnpm db:start` using suppressed credential-bearing output,
then run the selected checks. The complete `pnpm verify:database:running` group
resets and rebuilds it; `pnpm test:runtime` creates/deletes synthetic records and
restarts the stack for fixture isolation and readiness recovery; it is not
read-only. `pnpm db:types:check` compares generated types;
`pnpm db:types` writes them and is an implementation action. Stop only services
owned by the task and verify fixture cleanup even after failure. Use reviewed
fixed-stage diagnostics, not raw provider output. FEAT-001-specific Auth/TOTP
controls and assertions remain in [local security testing](features/FEAT-001_LOCAL_SECURITY_TESTING.md).

### Gate implementation and diagnostics

Application tests enforce repository-level statement, branch, function, and
line coverage floors in `vite.config.ts`. ESLint owns function complexity,
nesting, parameter, and length limits. Existing hotspots are named in the code
checker with exact no-growth ceilings; exceptions do not establish acceptable
patterns for new modules. Threshold changes require a reviewed explanation and
must not hide untested authority, tenancy, audit, calculation, or workflow
logic.

Feature runtime fixtures are registered by filename rather than by repeatedly
editing the workflow. The runtime-matrix runner emits only the fixed fixture
identifier, pass/fail result and allowlisted fixed-stage diagnostics; other child output is discarded to keep
credentials, provider payloads, messages, links, QR material, and local stack
output out of CI logs. Diagnose failures locally with reviewed sanitizers or
fixed-stage diagnostics in disposable CI when the local stack is occupied.
Never print raw child errors or payloads to diagnose a failure.

The schema-wide pgTAP guard discovers ordinary and partitioned tables in the exposed `public` and `graphql_public` Data API schemas and fails if any lacks enabled RLS. The general scanner uses the MIT-licensed Gitleaks CLI `8.30.1`, pinned by version and official Linux archive SHA-256, on a full Git-history checkout with 100% finding redaction. Gitleaks is feature-complete and receives security-maintenance releases. The separately licensed Gitleaks Action is not used. The browser-specific scan separately rejects Supabase secret-key values, service-role JWTs, and forbidden browser environment names in source, HTML, and compiled output. `pnpm check:browser-secrets` also runs synthetic scanner regressions and a redacted general scan of `dist` to cover other recognized provider keys injected during builds.

SAST/CodeQL, broader license review, SBOM generation, configuration scanning, staging smoke/DAST, artifact promotion, and deployment remain later pre-pilot gates. They must not be described as passing until implemented and evidenced.

CI optimization must preserve useful parallelism and a stable required-check
name rather than collapsing all verification into one opaque shell command.
Application and database jobs may run independently; the aggregate gate fails
unless both succeed or are explicitly replaced by a reviewed equivalent. Green
CI plus the local evidence and separate-agent review permits the agent to mark
the PR ready for merge review. CI cannot merge, deploy, or approve production.

The target release pipeline is:

```text
Formatting/documentation/lint/type checks
 -> React/Vite build
 -> unit/component tests
 -> SQL, RLS, Edge Function, integration and tenant-isolation tests
 -> generated database type drift check
 -> migration safety check
 -> SAST/CodeQL and secret scan
 -> dependency/license review and SBOM
 -> infrastructure/configuration scan
 -> package artifact
 -> staging deployment
 -> smoke/E2E/DAST
 -> human approval
 -> production promotion
 -> smoke/metrics/rollback watch
```

Use OIDC/short-lived federation for CI-to-cloud authentication, not permanent publish credentials.

## 4. Environments

| Environment | Purpose | Data |
|---|---|---|
| Development | Local Vite plus local Supabase CLI or isolated dev project | Synthetic only |
| Staging | Separate frontend deployment and Supabase project for release/security/UAT | Realistic synthetic or approved anonymized pilot-like data; never unapproved customer data |
| Production | Separate frontend deployment and Supabase project | Approved real customer data |

Separate credentials, databases, storage, keys, monitoring, and AI configuration. Production access is least-privileged, time-limited where possible, and audited.

## 5. Infrastructure and configuration

Manage schema, RLS, functions, triggers, Storage policy, and security-relevant configuration as reviewed migrations/code. Keep service-role and external-provider secrets only in protected Supabase/CI secret stores. Use private buckets, least-privilege policies, approved frontend exposure, rate/WAF controls where warranted, database and object-backup procedures, retention, and alerts. Detect dashboard/configuration drift.

## 6. Database delivery

- Explicit reviewed Supabase CLI SQL migrations
- Staging rehearsal on representative volume
- Backup/restore status checked before risky change
- Expand/migrate/contract pattern for breaking changes
- Document data backfill, lock/time impact, rollback/forward-fix plan
- Regenerate and review TypeScript database types after schema changes
- Do not make untracked production schema or RLS edits only through the dashboard

## 7. Supabase project controls

- Separate staging and production project ownership, keys, buckets, Auth settings, email templates, redirect URLs, Edge Function secrets, and providers.
- Keep publishable keys environment-specific; remember that secrecy of a publishable key is not a security boundary.
- Treat service-role possession as privileged production access and rotate immediately on suspected exposure.
- Review migrations for RLS enablement, grants, function `search_path`, security-definer use, views, triggers, and unsafe policy widening.
- Back up Storage objects separately and test reconciliation with database metadata.

## 8. Dependency and supply chain

Pin supported versions, use lockfiles, review new packages and licenses, run vulnerability alerts, generate an SBOM per release, protect workflows from untrusted PR execution, pin third-party actions appropriately, and define update SLAs based on severity/exposure.

The development toolchain pins the transitive MIT-licensed `brace-expansion`
package to `5.0.9`, `undici` package to `7.29.0`, and `postcss` package to
`8.5.23` through pnpm overrides. These patched resolutions remediate
GHSA-rgw5-rvv9-x895, GHSA-4cwx-7wf7-3272, and GHSA-fxqj-rqcc-2cmp without
adding direct application dependencies. They affect lint, test, and build
tooling only; the direct production dependency surface is unchanged.

## 9. Release process

Each release has a version, commit, artifacts/SBOM, migration, change log, risk/known limitations, test evidence, approvals, deployment time, rollback/forward-fix steps, and monitoring owner. Use the [Production Release Checklist](templates/PRODUCTION_RELEASE_CHECKLIST.md).

## 10. Observability

Capture structured application logs, metrics, distributed correlation, background-job status, database/storage health, availability tests, security signals, and business process failures. Redact secrets and restricted content. Establish dashboards and actionable alert owners before pilot.

## 11. Rollback and recovery

Frontend and Edge Function artifacts must be redeployable. Database changes need compatible rollback or a rehearsed forward-fix path. Restore drills must cover both PostgreSQL and Storage objects. A rollback is not complete until authentication, RLS, critical workflows, audit, files, and data state are verified.

## 12. Vulnerability management

Record finding, asset, severity, exploitability, tenant/data impact, owner, target date, mitigation, evidence, and closure. Critical/exploitable high issues block release. Independent penetration testing is required before unrestricted commercial availability and repeated after major security/architecture change.

## 13. Operational readiness

Before production: support rota/escalation, status/incident communications, backup and alert tests, access review, runbooks, capacity limits, provider contacts, privacy/DPA readiness, and customer onboarding/offboarding procedures must exist.
