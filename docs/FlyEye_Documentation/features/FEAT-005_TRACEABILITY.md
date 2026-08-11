# FEAT-005 Traceability

## Evidence boundary

- Specification: [FEAT-005 User Management and Basic Profiles](FEAT-005_USER_MANAGEMENT_AND_BASIC_PROFILES.md)
- Baseline: `main` at PR #13 merge `4d6bc6cf97710348e6b59790c6e5bc5ce71c8e23`
- Reviewed target: pending implementation
- Verification date: pending
- Local/hosted/data boundary: local synthetic only; no hosted target, real data,
  deployment, or production evidence
- Pull request and CI: pending
- Known limitations: implementation, formal accessibility review, qualified
  privacy/retention review, hosted validation, rejoining after revocation, and
  production readiness remain pending

This record is prospective until implementation evidence exists. Do not mark a
row `Pass` from specification review alone.

## Requirements and planned results

| Requirement/AC ID | Design or control | Planned test/evidence ID | Result | Limitation or later gate |
|---|---|---|---|---|
| `IAM-002/003/008/010`, `AC-01/02/03` | Active-organization and server-derived membership checks, bounded stable list/search, deny-by-default RLS | `EDGE-01`, `RLS-01`, `TENANT-01`, `PAGE-01` | Pending | Local two-organization and suspended-organization evidence required |
| `IAM-004`, `AC-08/10/11` | Protected suspension, reactivation, and organization-only terminal revocation with exact action-specific reason-code allowlists | `UNIT-01`, `RPC-02`, `EDGE-01`, `AUTH-01`, `E2E-01` | Pending | Rejoining after revocation is outside scope |
| `IAM-006`, `AC-08` | Fresh password AMR and AAL2/TOTP for status changes | `EDGE-01`, `AUTH-01`, `SEC-01` | Pending | Hosted authentication behavior later |
| `IAM-007`, `REC-001/002/003`, `AC-01/13/16/17` | Atomic append-only status, profile, directory-access, denial, and conflict evidence with minimized metadata; audit failure returns no directory data | `SQL-01`, `RPC-01/02/04`, `SEC-01` | Pending | Monitoring/retention ownership later |
| `IAM-009`, `AC-15/16` | Service-role authority remains in protected runtime; direct browser writes denied | `RLS-01`, `EDGE-01`, `SEC-01` | Pending | Hosted secret-path evidence later |
| `IAM-010`, `AC-03/04/09/11` | Independent organization profiles and membership effects | `TENANT-01`, `AUTH-01` | Pending | Real-data controller review later |
| `IAM-011`, `AC-07/09/10/11` | Profile/status changes never add or alter role/operational authority | `SQL-01`, `RPC-01/02`, `REG-01` | Pending | FEAT-006 separately gated |
| `IAM-012`, `AC-12` | Self-action denial and transactional last-active-admin protection | `RPC-03`, `TENANT-01`, `SEC-01` | Pending | Permission matrix remains later qualified gate |
| `NFR-004`, `AC-18` | Responsive, keyboard, focus, label, announcement, contrast, and reflow support | `COMP-01/02/03`, `E2E-01`, `A11Y-01` | Pending | Formal accessibility review later |
| `NFR-008`, `AC-02/03/12/14/15/17` | Active-organization, tenant, stable pagination, state, concurrency, replay, rate-limit, audit-failure, and direct-access controls | `RLS-01`, `RPC-02/03/04`, `EDGE-01`, `TENANT-01`, `PAGE-01`, `SEC-01` | Pending | Hosted abuse thresholds later |
| `NFR-009`, `AC-04/05/06/07/16/20` | Minimal fields, no invented identity, value-free audit/logs, synthetic-only evidence | `SQL-01`, `RPC-01`, `SEC-01`, `FIXTURE-01` | Pending | Qualified purpose/retention/correction review before real data |
| `AC-04/05/06/07` | Own-profile completion/update, current read-only email and role, incomplete-profile backfill | `UNIT-01`, `COMP-02`, `SQL-01`, `RPC-01`, `EDGE-01` | Pending | No legal-identity verification claim |
| `AC-08/10/11/12/13/14` | Exact per-action reason-code allowlists, stable locking, expected version, idempotency, atomic audit, and race handling | `UNIT-01`, `RPC-02/03`, `SEC-01` | Pending | Representative concurrent evidence required |
| `AC-19` | FEAT-001 through FEAT-004 behavior remains unchanged | `REG-01` | Pending | Complete final matrix required |
| `AC-20` | Evidence boundary prevents hosted, real-data, retention, deployment, or production claims | `FIXTURE-01`, final diff/evidence review | Pending | Separate lifecycle decisions remain required |

## Planned reproducible evidence

| Evidence | Expected record |
|---|---|
| Focused component/unit checks | Exact command, commit, file/test count, result |
| FEAT-005 SQL/RLS/RPC suite | Migration reset, pgTAP count, active/suspended organization, tenant, directory-audit failure, and concurrency results |
| FEAT-005 Edge handler suite | JWT/origin/schema/AMR/AAL/permission/failure results |
| FEAT-005 local runtime fixture | Real Auth/TOTP, two organizations, state effects, cleanup |
| Desktop/mobile browser suite | Member administration, stable pagination, and own-profile scenarios |
| `pnpm verify:app` | Complete application quality result and dependency audit |
| Database verification matrix | Clean reset, all SQL tests, runtime fixtures, lint, generated-type result |
| Secret and privacy scan | No secrets, tokens, real identities, or prohibited profile values |
| Residue query | Zero unintended FEAT-005 Auth, organization, membership, profile, and event residue |
| Separate-agent review | Stable-target findings and correction outcome |

## Evidence rules

- One row represents one independently testable requirement group.
- `Pass` requires reproducible evidence for the exact reviewed target.
- After a correction, run focused checks, then the affected feature tier, and
  one final matrix only after the target stabilizes.
- Keep local synthetic, hosted synthetic, real-data, deployment, and production
  evidence separate.
- An agent review is not qualified independent human review or risk acceptance.
