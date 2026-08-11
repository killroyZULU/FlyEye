# FEAT-005 Traceability

## Evidence boundary

- Specification: [FEAT-005 User Management and Basic Profiles](FEAT-005_USER_MANAGEMENT_AND_BASIC_PROFILES.md)
- Baseline: `main` at PR #15 merge `a3a39ca68d86748728e49a2b39c81828bb8bb658`
- Reviewed target: forward correction on `fix/FIX-005-incomplete-profile-list-contract`
- Verification date: 2026-08-11
- Local/hosted/data boundary: local synthetic only; no hosted target, real data,
  deployment, or production evidence
- Pull request and CI: PR #15 merged; correction PR/CI pending publication
- Known limitations: correction merge, formal accessibility review, qualified
  privacy/retention review, hosted validation, rejoining after revocation, and
  production readiness remain pending

This record covers the merged feature and its independently reviewed local
forward correction. Correction PR/CI and merge, hosted, real-data, and
production evidence remain separate gates.

## Requirements and results

| Requirement/AC ID | Design or control | Test/evidence ID | Result | Limitation or later gate |
|---|---|---|---|---|
| `IAM-002/003/008/010`, `AC-01/02/03` | Active-organization and server-derived membership checks, bounded stable list/search, deny-by-default RLS | `EDGE-01`, `RLS-01`, `TENANT-01`, `PAGE-01` | Pass | Local two-organization and suspended-organization evidence passed |
| `IAM-004`, `AC-08/10/11` | Protected suspension, reactivation, and organization-only terminal revocation with exact action-specific reason-code allowlists | `UNIT-01`, `RPC-02`, `EDGE-01`, `AUTH-01`, `E2E-01` | Pass | Rejoining after revocation is outside scope |
| `IAM-006`, `AC-08` | Fresh password AMR and AAL2/TOTP for status changes | `EDGE-01`, `AUTH-01`, `SEC-01` | Pass | Hosted authentication behavior later |
| `IAM-007`, `REC-001/002/003`, `AC-01/13/16/17` | Atomic append-only status, profile, directory-access, denial, and conflict evidence with minimized metadata; audit failure returns no directory data | `SQL-01`, `RPC-01/02/04`, `SEC-01` | Pass | Monitoring/retention ownership later |
| `IAM-009`, `AC-15/16` | Service-role authority remains in protected runtime; direct browser writes denied | `RLS-01`, `EDGE-01`, `SEC-01` | Pass | Hosted secret-path evidence later |
| `IAM-010`, `AC-03/04/09/11` | Independent organization profiles and membership effects | `TENANT-01`, `AUTH-01` | Pass | Real-data controller review later |
| `IAM-011`, `AC-07/09/10/11` | Profile/status changes never add or alter role/operational authority | `SQL-01`, `RPC-01/02`, `REG-01` | Pass | FEAT-006 separately gated |
| `IAM-012`, `AC-12` | Self-action denial and transactional last-active-admin protection | `RPC-03`, `TENANT-01`, `SEC-01` | Pass | Permission matrix remains later qualified gate |
| `NFR-004`, `AC-18` | Responsive, keyboard, focus, label, announcement, contrast, and reflow support | `COMP-01/02/03`, `E2E-01`, `A11Y-01` | Pass for automated local scope | Formal accessibility review later |
| `NFR-008`, `AC-02/03/12/14/15/17` | Active-organization, tenant, stable pagination, state, concurrency, replay, rate-limit, audit-failure, and direct-access controls | `RLS-01`, `RPC-02/03/04`, `EDGE-01`, `TENANT-01`, `PAGE-01`, `SEC-01` | Pass | Hosted abuse thresholds later |
| `NFR-009`, `AC-04/05/06/07/16/20` | Minimal fields, no invented identity, value-free audit/logs, synthetic-only evidence | `SQL-01`, `RPC-01`, `SEC-01`, `FIXTURE-01` | Pass | Qualified purpose/retention/correction review before real data |
| `AC-04/05/06/07` | Own-profile completion/update, current read-only email and role, incomplete-profile backfill | `UNIT-01`, `COMP-02`, `SQL-01`, `RPC-01`, `EDGE-01` | Pass | No legal-identity verification claim |
| `AC-08/10/11/12/13/14` | Exact per-action reason-code allowlists, stable locking, expected version, idempotency, atomic audit, and race handling | `UNIT-01`, `RPC-02/03`, `SEC-01` | Pass | Representative concurrent evidence passed |
| `AC-19` | FEAT-001 through FEAT-004 behavior remains unchanged | `REG-01` | Pass | Complete five-fixture runtime matrix passed |
| `AC-20` | Evidence boundary prevents hosted, real-data, retention, deployment, or production claims | `FIXTURE-01`, final diff/evidence review | Pass | Separate lifecycle decisions remain required |

## Reproducible evidence

| Evidence | Result |
|---|---|
| `pnpm test` | 21 files and 210 unit/component/Edge tests passed |
| `pnpm test:sql` | 5 files and 237 pgTAP tests passed after a clean migration reset |
| `node scripts/test-feat-005-runtime.mjs` | Local Auth/TOTP, two organizations, profile and status effects, race handling, privacy, and zero-residue cleanup passed |
| `pnpm test:e2e` | 16 desktop/mobile scenarios passed, including own profile and member administration |
| `pnpm verify:app` | Formatting, docs, lint, types, tests, build, secret scan, E2E, and dependency audit passed |
| `pnpm test:runtime` | All five runtime fixtures passed with verified local lifecycle isolation |
| Database lint and generated types | No schema warnings; generated types are current |
| Separate-agent review | Pass; PR #15 findings were corrected, and the forward correction review found no actionable findings |

## Evidence rules

- One row represents one independently testable requirement group.
- `Pass` requires reproducible evidence for the exact reviewed target.
- After a correction, run focused checks, then the affected feature tier, and
  one final matrix only after the target stabilizes.
- Keep local synthetic, hosted synthetic, real-data, deployment, and production
  evidence separate.
- An agent review is not qualified independent human review or risk acceptance.
