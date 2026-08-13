# FEAT-006 Traceability

## Evidence boundary

- Reviewed target: Local verified working tree on
  `feat/FEAT-006-member-totp-enrollment`
- Slice A target: Issue #24; independent technical review clear; PR #25 open
- Slice B target: Pending Slice A stable pull-request boundary
- Verification date: 2026-08-13
- Local/hosted/data boundary: Local synthetic verification only
- Pull requests and CI: PR #25 open; CI pending
- Known limitations: Slice A has no hosted validation, real-data authority,
  factor recovery/replacement, formal accessibility review, deployment, or
  production approval. Slice B is not implemented.

This record separates the two sequential delivery slices. Local Slice A results
do not establish hosted, production, or Slice B readiness.

## Slice A requirements and results

| Requirement/AC ID | Design or control | Test/evidence ID | Result | Limitation or later gate |
|---|---|---|---|---|
| `IAM-002/003/010`, `FEAT-006A-AC-01/07` | Server-derived sole active membership; self-only protected flow; no client school selector | `FEAT-006A-EDGE-01`, `TENANT-01` | Local pass | Hosted validation remains later |
| `IAM-005/006`, `FEAT-006A-AC-01/04` | Recent password start/completion; verified TOTP and AAL2 completion | `FEAT-006A-EDGE-01`; positive local `AUTH-01`; mocked existing-factor/resume cases | Layered local pass | Existing-factor and interrupted-operation hosted runtime evidence remains later |
| `IAM-007`, `REC-001/002/003`, `FEAT-006A-AC-05/07` | Start intent plus atomic readiness/operation/completion audit; no authority on failure | `FEAT-006A-SQL-01`, `EDGE-01`, `SEC-01` | Local pass | Hosted alert routing and retention remain later |
| `IAM-008/009`, `FEAT-006A-AC-05/07` | Deny-by-default operation/readiness tables; service-role-only functions | `FEAT-006A-SQL-01`, `TENANT-01`, `SEC-01` | Local pass | No hosted RLS evidence |
| `FEAT-006A-AC-02/03/06` | Strict one-factor inventory, memory-only secrets, unbound cancellation, and bound-operation resume without automatic factor deletion | `FEAT-006A-UNIT-01`, `FEAT-006A-COMP-01`; positive local `AUTH-01` | Layered local pass | Provider failure/reconciliation cases are mocked; factor removal and replacement are excluded |
| `NFR-004`, `FEAT-006A-AC-08` | Keyboard/focus/announcement and QR/manual component behavior; already-ready and privileged missing-factor entry at desktop/mobile sizes | `FEAT-006A-COMP-01`; bounded `E2E-01` | Partial local evidence | Full provider-backed enrollment browser flow, 200% reflow, and formal accessibility review remain later |
| `NFR-008/010`, `FEAT-006A-AC-09/10` | Secret-safe app/database/runtime matrices and unconditional fixture cleanup | `FEAT-006A-REG-01`, CI | Local pass; CI pending | PR and CI evidence pending |

## Slice B requirements and results

| Requirement/AC ID | Design or control | Test/evidence ID | Result | Limitation or later gate |
|---|---|---|---|---|
| `IAM-002/003/008/010`, `FEAT-006B-AC-01/06` | Server-derived actor/target, same-school protected command, self denial | `FEAT-006B-EDGE-01`, `TENANT-01` | Pending | Slice B depends on merged Slice A contract |
| `IAM-005/006`, `FEAT-006B-AC-01/03` | Actor AAL2/recent password and live target factor/readiness match | `FEAT-006B-EDGE-01`, runtime Auth evidence | Pending | Recovery/replacement and hosted evidence remain later |
| `IAM-007`, `REC-001/002/003`, `FEAT-006B-AC-05/06` | Atomic minimized role audit and fail-closed mutation | `FEAT-006B-RPC-01`, `EDGE-01` | Pending | Hosted alert routing and retention remain later |
| `IAM-011`, `FEAT-006B-AC-02/03/07` | Three explicit portal roles; no operational or aviation authority | `FEAT-006B-RPC-01`, `REG-01` | Pending | Qualified permission matrix remains later |
| `IAM-012`, `FEAT-006B-AC-04` | Shared deterministic admin locks and last-active-admin rule | `FEAT-006B-RPC-01`, `RACE-01` | Pending | Implementation and race evidence required |
| `NFR-004`, `FEAT-006B-AC-08` | Responsive and accessible role confirmation/failure states | `FEAT-006B-E2E-01` | Pending | Formal accessibility review remains later |
| `NFR-008/010`, `FEAT-006B-AC-08` | Complete quality/security matrices with generated types and cleanup | `FEAT-006B-REG-01`, CI | Pending | Implementation and CI required |

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
