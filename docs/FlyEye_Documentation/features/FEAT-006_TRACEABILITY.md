# FEAT-006 Traceability

## Evidence boundary

- Reviewed target: Local verified working tree on
  `feat/FEAT-006-role-assignment`
- Slice A target: Issue #24; merged through PR #25 at `835b9dc`
- Slice B target: Issue #26; independent technical review clear; PR #27 open with required CI green
- Verification date: 2026-08-14
- Local/hosted/data boundary: Local synthetic verification only
- Pull requests and CI: Slice A PR #25 merged; Slice B PR #27 open with required CI green
- Known limitations: No hosted validation, real-data authority, factor
  recovery/replacement, formal accessibility review, qualified aviation role
  matrix, deployment, or production approval

This record separates the two sequential delivery slices. Local results do not
establish hosted, production, qualified aviation, or customer readiness.

## Slice A requirements and results

| Requirement/AC ID | Design or control | Test/evidence ID | Result | Limitation or later gate |
|---|---|---|---|---|
| `IAM-002/003/010`, `FEAT-006A-AC-01/07` | Server-derived sole active membership; self-only protected flow; no client school selector | `FEAT-006A-EDGE-01`, `TENANT-01` | Local pass | Hosted validation remains later |
| `IAM-005/006`, `FEAT-006A-AC-01/04` | Recent password start/completion; verified TOTP and AAL2 completion | `FEAT-006A-EDGE-01`; positive local `AUTH-01`; mocked existing-factor/resume cases | Layered local pass | Existing-factor and interrupted-operation hosted runtime evidence remains later |
| `IAM-007`, `REC-001/002/003`, `FEAT-006A-AC-05/07` | Start intent plus atomic readiness/operation/completion audit; no authority on failure | `FEAT-006A-SQL-01`, `EDGE-01`, `SEC-01` | Local pass | Hosted alert routing and retention remain later |
| `IAM-008/009`, `FEAT-006A-AC-05/07` | Deny-by-default operation/readiness tables; service-role-only functions | `FEAT-006A-SQL-01`, `TENANT-01`, `SEC-01` | Local pass | No hosted RLS evidence |
| `FEAT-006A-AC-02/03/06` | Strict one-factor inventory, memory-only secrets, unbound cancellation, and bound-operation resume without automatic factor deletion | `FEAT-006A-UNIT-01`, `FEAT-006A-COMP-01`; positive local `AUTH-01` | Layered local pass | Provider failure/reconciliation cases are mocked; factor removal and replacement are excluded |
| `NFR-004`, `FEAT-006A-AC-08` | Keyboard/focus/announcement and QR/manual component behavior; already-ready and privileged missing-factor entry at desktop/mobile sizes | `FEAT-006A-COMP-01`; bounded `E2E-01` | Partial local evidence | Full provider-backed enrollment browser flow, 200% reflow, and formal accessibility review remain later |
| `NFR-008/010`, `FEAT-006A-AC-09/10` | Secret-safe app/database/runtime matrices and unconditional fixture cleanup | `FEAT-006A-REG-01`, PR #25 CI | Pass on merged Slice A | Hosted evidence remains later |

## Slice B requirements and results

| Requirement/AC ID | Design or control | Test/evidence ID | Result | Limitation or later gate |
|---|---|---|---|---|
| `IAM-002/003/008/010`, `FEAT-006B-AC-01/06` | Server-derived actor/target, same-school protected command, self denial | Handler tests; 40 SQL assertions; local Auth/Edge runtime | Local pass | Hosted validation remains later |
| `IAM-005/006`, `FEAT-006B-AC-01/03` | Actor AAL2/recent password and live target factor/readiness match | Handler negatives; local target-TOTP runtime | Local pass | Recovery/replacement and hosted evidence remain later |
| `IAM-007`, `REC-001/002/003`, `FEAT-006B-AC-05/06` | Atomic minimized role audit and fail-closed mutation | SQL/RPC assertions; runtime audit and replay checks | Local pass | Hosted alert routing and retention remain later |
| `IAM-011`, `FEAT-006B-AC-02/03/07` | Three explicit portal roles with centralized labels, assurance, and workspace permissions; no operational or aviation authority | SQL metadata/grant assertions; access-context tests | Local pass | Additional roles and qualified permission matrix remain later |
| `IAM-012`, `FEAT-006B-AC-04` | Shared deterministic admin locks and last-active-admin rule | SQL negatives; concurrent live role/status runtime | Local pass | Hosted concurrency evidence remains later |
| `NFR-004`, `FEAT-006B-AC-08` | Responsive keyboard/focus role confirmation, offline, reauthentication, MFA, conflict, last-admin, rate-limit, service-failure, and success states | Component tests; 20 desktop/mobile E2E scenarios | Local supporting pass | 200% reflow and formal accessibility review remain later |
| `NFR-008/010`, `FEAT-006B-AC-08` | Complete quality/security matrices with generated types and cleanup | 253 app tests; 326 SQL tests; seven runtime fixtures; schema lint and type drift | Local pass; independent review clear; PR #27 required CI green | Hosted evidence remains later |

## Evidence rules

- Do not mark `Pass` without reproducible evidence for the reviewed slice target.
- Record detailed output once; later unchanged reports link to it.
- Keep Slice A and Slice B implementation, review, PR, and CI evidence distinct.
- Separate local synthetic, hosted synthetic, real-data, deployment, and
  production evidence.
- Agent review is technical evidence, not qualified independent human review or
  risk acceptance.
- Update this record when a requirement, implementation, test, source, reviewed
  target, or limitation changes.
