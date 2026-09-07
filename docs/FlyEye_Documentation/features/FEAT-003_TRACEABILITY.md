# FEAT-003 Traceability

## Evidence boundary

- FEAT-003 merge: PR #7 at `00dcfd2239de45b33890bc805ff27a667defabd1`
- Post-merge CI: run `30752548762` passed all required jobs
- Hosted-hardening merge: PR #8 at `48ba984`
- Environment: Local Supabase, Edge runtime, and local browser only
- Data: Historical evidence used multiple synthetic organizations; FIX-006 runtime evidence uses one synthetic school and rollback-only cross-school fixtures
- Review: Automated verification plus separate agent review and correction; no hosted, real-data, production, or qualified-regulated claim

Detailed output and chronology remain in Git, PR #7, PR #8, CI, and reviewed scripts.

## Requirements and results

| Requirement ID | Outcome/control | Evidence | Result and boundary |
|---|---|---|---|
| `FEAT-003-01` | Controlled first administrator before invitations | `DEC-02/04`, `AMD-01`, `AC-01/02/11/13/23/24/25`, SQL/RPC/Edge/fixture | Pass locally; production issuance unresolved |
| `FEAT-003-02` | First-admin privileged MFA | `DEC-01`, `AC-20/21/22`, `REG-01` | Pass for bounded scope; recovery gates remain |
| `FEAT-003-03` | TOTP possession without secret leakage | `AC-04/05/19`, `UNIT-05`, `AUTH-01`, `SCAN-01` | Pass locally; hosted/formal review not claimed |
| `FEAT-003-04` | No silent duplicate-factor enrollment | `DEC-05`, `AC-07/08`, `UNIT-04`, `AUTH-03`, `COMP-04` | Pass locally; conflict fails closed |
| `FEAT-003-05` | Invalid/cancelled/stale/failed flow creates no authority | `AMD-01`, `AC-06/09/10/18/29/30`, component/Auth/security tests | Pass locally; no unproven factor deletion |
| `FEAT-003-06` | Fresh password plus current TOTP evidence | `DEC-03`, `AMD-01`, `AC-02/05/11/14/26/30`, `UNIT-03`, `EDGE-01`, security runtime | Pass locally at exact 600-second boundary |
| `FEAT-003-07` | Forged school context cannot widen access | `AC-03`, `COMP-03`, `RLS-02`, `TENANT-01`, `E2E-02`, FIX-006 | Historical and amended local evidence pass |
| `FEAT-003-08` | Organization Admin remains administrative only | `AC-15`, scope review, `REG-01` | Pass; no operational or aviation authority |
| `FEAT-003-09` | Atomic attributable completion | `AMD-01`, `AC-11/13/25`, `RPC-01/03`, `AUDIT-01` | Pass locally; audit failure rolls back |
| `FEAT-003-10` | Concurrent attempts create at most one first admin | `AC-12/27`, `RPC-04`, `SEC-02` | Pass locally for same/different grants and replay |
| `FEAT-003-11` | Existing and last-active admins remain protected | `AC-16`, `RPC-02`, scope review | Pass; no removal/demotion path exists |
| `FEAT-003-12` | Browser roles cannot mutate tenant authority | `AMD-01`, `AC-01/02/19/28`, `RLS-01/02`, `EDGE-01`, `SCAN-01` | Pass locally; server-only execution retained |
| `FEAT-003-13` | Keep invitations outside FEAT-003 | Scope review, `AC-21`, `REG-01` | Pass; invitations remained outside FEAT-003 and are owned by FEAT-004 |
| `FEAT-003-14` | Keep user/profile management outside FEAT-003 | Scope review, `AC-21`, `REG-01` | Pass; separate contract in [FEAT-005](FEAT-005_USER_MANAGEMENT_AND_BASIC_PROFILES.md) |
| `FEAT-003-15` | First-admin assignment is not general role assignment | `AC-11/15/16`, `RPC-01/02`, `REG-01` | Pass; separate contract in [FEAT-006](FEAT-006_ROLE_ASSIGNMENT.md) |
| `FEAT-003-16` | Complete safe states on weak connectivity/failure | `AC-06/10/18`, `COMP-01/02`, `E2E-03` | Pass for automated/local scope |
| `FEAT-003-17` | Accessible MFA onboarding | `AC-17`, component/E2E/A11Y/CAPTCHA families | Automated/local scope pass; formal and active-provider evidence pending |
| `FEAT-003-18` | Lost-device/replacement uncertainty creates no bypass | `AC-08/22`, `COMP-04`, `AUTH-03` | Deferred behavior explicitly blocks real-data/production readiness |
| `FEAT-003-19` | Provider behavior is evidenced, not assumed | `AMD-01`, `AC-29/30`, Auth/audit/config/security runtime | Pass locally; reverify for exact hosted target |
| `FEAT-003-20` | Preserve FEAT-001/002 Auth, RLS, recovery, audit, and tenancy | `AC-20`, `REG-01`, final matrix | Pass on recorded target |
| `FEAT-003-21` | Keep local/hosted/real-data/deployment/production gates distinct | `AC-21`, PR #7, CI, scope review | Local feature merged; later lifecycle gates remain open |
| `FEAT-003-22` | Provider limits do not replace endpoint abuse control | `AMD-02/04`, `AC-06/19/31`, `EDGE-02`, `MON-01`, `SEC-02`, `CONFIG-01` | Pass for local token buckets; hosted values unresolved |
| `FEAT-003-23` | Hosted validation cannot target production or reuse local provenance | `AMD-05`, `HS-AC-01`–`HS-AC-08`, manifest/config/SQL checks, final matrix | Hardening merged but disabled/target-free; hosted activation unresolved |

## Final local matrix

The stabilized hosted-hardening target passed:

- formatting, ESLint, TypeScript, production build, browser-secret scan, and dependency audit;
- 143 application tests and 10 desktop/mobile Playwright scenarios;
- clean migration reset, 107 SQL/RLS tests, database lint, and generated-type drift;
- all three sanitized runtime fixtures;
- pinned history/worktree secret scans;
- exact zero-residue checks across Auth users, organizations, memberships, roles, grants, authentication events, limiter state, and limiter events; and
- separate review, correction, and final re-review.

This proves only the recorded local synthetic target.

## Stable automated identifiers

Retained IDs are `FEAT-003-UNIT-01`, `FEAT-003-UNIT-02`, `FEAT-003-UNIT-03`, `FEAT-003-UNIT-04`, `FEAT-003-UNIT-05`, `FEAT-003-COMP-01`, `FEAT-003-COMP-02`, `FEAT-003-COMP-03`, `FEAT-003-COMP-04`, `FEAT-003-SQL-01`, `FEAT-003-RLS-01`, `FEAT-003-RLS-02`, `FEAT-003-RPC-01`, `FEAT-003-RPC-02`, `FEAT-003-RPC-03`, `FEAT-003-RPC-04`, `FEAT-003-EDGE-01`, `FEAT-003-EDGE-02`, `FEAT-003-MON-01`, `FEAT-003-AUTH-01`, `FEAT-003-AUTH-02`, `FEAT-003-AUTH-03`, `FEAT-003-TENANT-01`, `FEAT-003-SEC-01`, `FEAT-003-SEC-02`, `FEAT-003-AUDIT-01`, `FEAT-003-E2E-01`, `FEAT-003-E2E-02`, `FEAT-003-E2E-03`, `FEAT-003-A11Y-01`, `FEAT-003-CAPTCHA-01`, `FEAT-003-SCAN-01`, `FEAT-003-REG-01`, `FEAT-003-CONFIG-01`, `FEAT-003-FIXTURE-01`, and `FEAT-003-FIXTURE-02`.

## Security invariants evidenced

- Exact 30-minute PostgreSQL grant expiry is non-sliding and terminal.
- `PUBLIC`, `anon`, and `authenticated` cannot access grant data or protected completion.
- Strict JWT/subject, timestamped AMR, AAL2/TOTP, factor, origin, action, and body checks precede authority.
- Locking, versioning, idempotency, constraints, and atomic audit permit at most one first admin.
- Final provider/bootstrap revalidation prevents workspace access when Auth/database state diverges.
- Local token buckets fail closed as specified; client/provider/platform counters cannot override them.
- Evidence exposes only bounded actions/results/counts/booleans/hashes/safe IDs.

## Review findings resolved

Separate reviews drove corrections for mandatory-audit error classification, stale review-gate wording, arbitrary remote-host acceptance, dormant staging enablement, limiter-key separation, limiter-evidence wording, and JWT-test targeting. Focused checks and the final matrix passed after correction.

Agent review is technical evidence, not qualified independent human review or risk acceptance.

## Remaining gates

No exact staging provider/project, plan, region, origin, credential path, hosted issuer, monitoring owner, retention, cleanup, recovery, support process, or hosted run is approved. Before hosted synthetic, real-data, deployment, or production claims, record the exact target and obtain the applicable provider, security/privacy, accessibility, operations, legal/aviation, penetration-test, recovery, and production evidence.
