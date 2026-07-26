# DevSecOps Guide

## 1. Objective

DevSecOps integrates build, test, security, deployment, monitoring, recovery, and evidence into normal delivery. It is mandatory because AI-generated code, multi-tenant sensitive data, and aviation-adjacent workflows make late security testing inadequate.

## 2. Source-control model

Use one repository containing the React app, `supabase/` migrations/functions/tests, end-to-end tests, and docs. Use one bounded `feat/*`, `fix/*`, `docs/*`, `chore/*`, or `security/*` branch per task and merge it into stable `main` only through an explicitly authorized pull request. Never push or force-push feature work directly to `main`.

GitHub-enforced branch protection is not available under the current repository plan. Until that changes, the project owner and implementation agent must apply the equivalent manual gate: use a pull request and checklist, require green CI, inspect the final diff and unresolved conversations, keep deployment separate, and obtain explicit authorization before every merge. Add required reviews/CODEOWNERS when additional qualified collaborators join and the repository plan supports the controls.

## 3. Pull-request pipeline

The current CI baseline is verification-only. It runs frozen installation, formatting, ESLint, TypeScript, unit/component/handler tests, production build, a browser-specific Supabase key scan, a general Git-history secret scan, Playwright tests, dependency audit, local Supabase reset, schema-wide and feature-specific SQL/RLS tests, real Auth/TOTP/Edge/browser/cross-organization integration, database lint, and generated database-type drift. It uses synthetic local data, least-privilege read-only repository permissions, and no deployment credentials.

The schema-wide pgTAP guard discovers ordinary and partitioned tables in the exposed `public` and `graphql_public` Data API schemas and fails if any lacks enabled RLS. The general scanner uses the MIT-licensed Gitleaks CLI `8.30.1`, pinned by version and official Linux archive SHA-256, on a full Git-history checkout with 100% finding redaction. Gitleaks is feature-complete and receives security-maintenance releases. The separately licensed Gitleaks Action is not used, and the existing browser-specific Supabase key scan remains a distinct defense.

SAST/CodeQL, broader license review, SBOM generation, configuration scanning, staging smoke/DAST, artifact promotion, and deployment remain later pre-pilot gates. They must not be described as passing until implemented and evidenced.

The target release pipeline is:

```text
Formatting/lint/type checks
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

The development toolchain pins the transitive MIT-licensed `brace-expansion` package to `5.0.8` through a pnpm override. This remains within `minimatch`'s declared `^5.0.5` range and remediates GHSA-mh99-v99m-4gvg without adding a direct application dependency.

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
