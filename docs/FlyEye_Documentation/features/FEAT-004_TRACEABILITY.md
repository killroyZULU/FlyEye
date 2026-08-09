# FEAT-004 Traceability

## Evidence boundary

- Reviewed target: specification branch
  `docs/feat-004-member-invitations-spec`
- Baseline: `main` merge `f1afa5da9008a47c0369f44fb03fde0acf1109b4`
- Verification date: pending stable specification review
- Local/hosted/data boundary: planning evidence only; no implementation,
  provider call, hosted environment, real data, deployment, or production
- Pull request and CI: pending
- Known limitations: future organization roles, hosted SMTP/domain/capacity,
  real-data retention, minor-student procedure, universal MFA recovery, and
  formal accessibility evidence remain later gates

## Requirements and results

| Requirement/AC ID | Design or control | Test/evidence ID | Result | Limitation or later gate |
|---|---|---|---|---|
| `IAM-001`, `AC-05/10/11` | Invitation-only explicit acceptance | `AUTH-01/02`, `E2E-01` | Pending | Hosted email later |
| `IAM-002/003/008/009`, `AC-01/02/11/12/13` | Protected server authority, deny-by-default RLS, atomic acceptance/audit | `RLS-01`, `RPC-01`, `EDGE-01` | Pending | Implementation not started |
| `IAM-004`, `AC-01/02/06/08/09` | Organization Admin invitation lifecycle | `COMP-01`, `RPC-01`, `EDGE-01` | Pending | Suspension/reactivation remain FEAT-005 |
| `IAM-005/006`, `AC-01/11/18` | Fresh password, inviter AAL2/TOTP, role-specific final bootstrap | `EDGE-01`, `AUTH-01/02` | Pending | Universal MFA/recovery later |
| `IAM-007`, `AC-06/12/13/19` | Atomic intent and post-provider audit plus bounded delivery/limiter evidence | `RPC-01`, `SEC-01` | Pending | Inbox delivery and hosted monitoring later |
| `IAM-010`, `AC-14/15/16` | Independent memberships and two-organization isolation | `RPC-02`, `TENANT-01` | Pending | None for local scope |
| `IAM-011`, `AC-03/04/18` | Server-controlled single initial role and permission mapping | `SQL-01`, `EDGE-01`, `SEC-01` | Pending | Future roles separately reviewed |
| `IAM-012`, `AC-09` | Invitation revocation cannot remove an accepted administrator | `RPC-01` | Pending | Member removal remains outside scope |
| `AC-07/08/09/16` | Exact materialized expiry and terminal supersede/revoke states | `UNIT-01`, `SQL-01`, `RPC-03`, `AUTH-03` | Pending | Provider expiry reverified per environment |
| `AC-17` | Exact server/database email canonicalization and uniqueness | `UNIT-01`, `SQL-01`, `TENANT-01` | Pending | Internationalized email remains outside this slice |
| `AC-19/20/21/22/23` | Failure, accessibility, secret, regression, and lifecycle boundaries | `COMP-01/02`, `A11Y-01`, `SEC-01`, `REG-01`, `FIXTURE-01` | Pending | Qualified and hosted evidence later |

## Evidence rules

- Do not mark a row `Pass` until the implementation target and reproducible
  evidence exist.
- Keep local synthetic, hosted synthetic, real-data, deployment, and production
  claims separate.
- Record provider versions, exact callback configuration, sanitized fixture
  outcomes, and zero-residue cleanup for the reviewed implementation.
- Agent review and green CI are technical evidence, not qualified independent
  human review, product acceptance, or production approval.
