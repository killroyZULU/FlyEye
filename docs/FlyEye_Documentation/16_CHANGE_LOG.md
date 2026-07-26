# Change Log

This log tracks material documentation/product-decision changes. Code releases should also maintain release notes tied to commits and migrations.

## Unreleased

- Added the documentation-complete FEAT-002 Password Recovery specification and traceability record. The bounded design covers non-enumerating requests, a prefetch-resistant short-lived single-use recovery credential, server-authoritative password policy, global refresh-session revocation, residual access-token risk, provider audit/security evidence, password-change notification, abuse controls, tenant-neutral behavior, complete UI states, synthetic test plans, and explicit unresolved production gates. No application, schema, Supabase environment, deployment, or production change is included.
- Added the founder-approved product and governance decision register and aligned the documentation for capstone-to-commercial direction, intended licensing/IP and customer-data ownership, anonymous pilot planning, multi-school memberships, role separation, universal MFA, minor-student safeguards, PPL-first delivery, synthetic-data gates, unresolved hosting choices, and deferred features.
- Recorded that CI pull request #2 merged into the development `main` branch at `c7627a5`, its post-merge verification-only checks passed, and no deployment occurred.
- Completed the remaining CI guardrail implementation with schema-wide RLS discovery across exposed Data API schemas and a pinned, checksum-verified, fully redacted Gitleaks `8.30.1` full-history scan while retaining the browser-specific Supabase key scan and verification-only/no-deployment boundary.
- Pinned the existing ESLint toolchain's transitive MIT-licensed `brace-expansion` dependency to patched version `5.0.8` after the current high-severity GHSA-mh99-v99m-4gvg advisory caused the dependency-audit gate to fail.
- Refreshed the handoff, DevSecOps guidance, and roadmap to distinguish the implemented FEAT-001 development baseline from production approval; record the verification-only CI state; align the manual Git gate with the current repository plan; reserve the FEAT-002 through FEAT-006 planning sequence; and add the post-identity visual-design checkpoint.
- Added least-privilege GitHub Actions quality gates for frozen dependency installation, formatting, linting, type checking, unit/component/Edge-handler tests, production build, browser secret scanning, Playwright, local migration reset, SQL/RLS tests, real Auth/TOTP/Edge/cross-organization integration, database lint, generated database-type drift, and dependency audit. The workflow uses synthetic local data, enforces repository LF line endings for consistent checks, and performs no deployment.
- Added a pull-request template covering bounded scope, security, tenancy, privacy, database review, automated evidence, human review, and the separate production-approval gate.
- Added the FEAT-001 security/architecture forward fix: real Edge Runtime module resolution, server-enforced AAL2, post-validation audit decisions, durable pseudonymous actor and multi-organization evidence, constrained audit outcomes, actual-byte request limits, stale-operation cancellation guards, post-MFA revalidation, explicit local TOTP/JWT/origin configuration, browser-key rejection, build secret scans, and real local Auth/TOTP/Edge/browser integration tests.
- Preserved the already-applied FEAT-001 migration and added `20260719000200_feat_001_security_forward_fix.sql` rather than rewriting migration history.
- Implemented FEAT-001 login and initial RBAC as the first bounded vertical slice: invitation-only Supabase Auth entry, three initial roles, MFA gates for Instructor/Admin, deny-by-default RLS, protected access bootstrap, audit-gated authentication evidence, responsive UI states, and automated tests.
- Added the FEAT-001 specification and requirements traceability record; management-role operational authority remains pending permission-matrix and aviation-SME approval.
- Completed local FEAT-001 migration, SQL/RLS, cross-tenant, audit-cardinality, and generated-type verification after establishing the Docker/Supabase development stack.
- Moved local Supabase services to ports `55320` through `55328` to avoid Windows-reserved ports and disabled optional local analytics rather than exposing Docker's unauthenticated TCP daemon.
- Pilot school, verified regulatory source register, privacy roles, retention schedules, provider contracts, and exact supported package versions remain to be confirmed.
- Detailed domain ERD, permission matrix beyond portal access, threat model diagrams, and later feature specifications will be created during discovery/slice planning.

## 0.2.0 — 2026-07-19

- Replaced the separate React + ASP.NET Core + Azure MVP stack with a lean React/TypeScript + Supabase architecture.
- Retained PostgreSQL, relational integrity, multi-tenancy, auditable revisions, deterministic calculations, and human aviation authority.
- Established Supabase Auth, deny-by-default RLS, private Storage, Edge Functions, versioned SQL migrations, and generated database types.
- Restricted direct browser writes to approved low-risk draft operations; authoritative transitions and calculations use protected functions.
- Added Supabase service-role, RLS, Storage backup, function, view, and environment safeguards.
- Updated implementation, API, security, QA, privacy, DevSecOps, roadmap, risk, and release guidance.
- Added ADR-0005 and superseded/amended earlier implementation-specific ADRs without erasing decision history.

## 0.1.0 — 2026-07-17

- Created the professional FlyEye documentation package.
- Established web-first responsive PWA direction and deferred native mobile.
- Established React/TypeScript + ASP.NET Core + PostgreSQL modular-monolith baseline.
- Established shared-schema multi-tenancy with defense-in-depth organization isolation.
- Defined Dispatch, Training, Compliance, Platform Core, and Reporting MVP scope.
- Defined human authority and deterministic weight-and-balance safety constraints.
- Defined specification-driven AI development and vertical-slice implementation order.
- Defined DevSecOps, QA, privacy, cybersecurity, pilot, recovery, and roadmap guidance.
- Added accepted ADRs and reusable feature, traceability, and production-release templates.

## Change process

For each future entry record date, author/approver, affected documents/ADRs/requirements, reason, compatibility/migration impact, security/privacy/safety impact, and effective release. Material architecture changes require an ADR; requirement changes require updated traceability and test evidence.
