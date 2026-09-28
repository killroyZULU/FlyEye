# FEAT-004 Traceability

## Evidence boundary

- Reviewed target: implementation head `0a108c4`, merged through PR #12 at
  `558e8e6`
- Baseline: `main` at PR #11 merge
  `ed731d429cd5185e5b945c87a13f65987c2d10c7`
- Verification date: 2026-08-09
- Local/hosted/data boundary: local synthetic implementation and local Mailpit
  provider calls only; no hosted environment, real data, deployment, or
  production
- Pull request and CI: [PR #12](https://github.com/killroyZULU/FlyEye/pull/12)
  merged on 2026-08-09 after the required CI quality gate passed
- Known limitations: future organization roles, hosted SMTP/domain/capacity,
  real-data retention, minor-student procedure, privileged MFA recovery, and
  formal accessibility evidence remain later gates

## Requirements and results

| Requirement/AC ID                          | Design or control                                                            | Test/evidence ID                                          | Result                                                                                                                                            | Limitation or later gate                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `IAM-001`, `AC-05/10/11`                   | Invitation-only explicit acceptance                                          | `AUTH-01/02`, `E2E-01`                                    | Pass: protected state selected the new/existing credential path and both local identities required password-confirmed acceptance                  | Hosted email later                                         |
| `IAM-002/003/008/009`, `AC-01/02/11/12/13` | Protected server authority, deny-by-default RLS, atomic acceptance/audit     | `RLS-01`, `RPC-01`, `EDGE-01`                             | Pass: direct browser access denied; injected audit failure rolled back authority                                                                  | None for local scope                                       |
| `IAM-004`, `AC-01/02/06/08/09`             | Organization Admin invitation lifecycle                                      | `COMP-01`, `RPC-01`, `EDGE-01`                            | Pass: create, list, resend, expiry, revoke, and safe provider results covered                                                                     | Suspension/reactivation remain FEAT-005                    |
| `IAM-005/006`, `AC-01/11/18`               | Fresh password, inviter AAL2/TOTP, role-specific final bootstrap             | `EDGE-01`, `AUTH-01/02`                                   | Pass: local inviter reached AAL2/TOTP; acceptance used fresh password AMR                                                                         | Privileged factor recovery and hosted assurance later      |
| `IAM-007`, `AC-06/12/13/19`                | Atomic intent and post-provider audit plus bounded delivery/limiter evidence | `RPC-01`, `SEC-01`                                        | Pass: complete-scope replay conflicts, server-resolved limiter scope, intent, delivery, denial, acceptance, rollback, and replay evidence covered | Inbox delivery and hosted monitoring later                 |
| `IAM-010`, `AC-14/15/16`                   | Single-school membership and forged-school isolation                         | `RPC-02`, `TENANT-01`, FIX-006                            | Pass: forged-school list denied; concurrent acceptance created one membership                                                                     | Separate deployments not provisioned                       |
| `IAM-011`, `AC-03/04/18`                   | Server-controlled single initial role and permission mapping                 | `SQL-01`, `EDGE-01`, `SEC-01`                             | Pass: three approved roles enabled; future roles default disabled                                                                                 | Future roles separately reviewed                           |
| `IAM-012`, `AC-09`                         | Invitation revocation cannot remove an accepted administrator                | `RPC-01`                                                  | Pass: revoke and replay covered; revoked acceptance denied                                                                                        | Member removal remains outside scope                       |
| `AC-07/08/09/16`                           | Exact materialized expiry and terminal supersede/revoke states               | `UNIT-01`, `SQL-01`, `RPC-03`, `AUTH-03`                  | Pass: one-hour equality, audit, resend, revoke, and stable read-back covered                                                                      | Provider expiry reverified per environment                 |
| `AC-17`                                    | Exact server/database email canonicalization and uniqueness                  | `UNIT-01`, `SQL-01`, `TENANT-01`                          | Pass: ASCII trim/lower contract and variant uniqueness covered                                                                                    | Internationalized email remains outside this slice         |
| `AC-19/20/21/22/23`                        | Failure, accessibility, secret, regression, and lifecycle boundaries         | `COMP-01/02`, `A11Y-01`, `SEC-01`, `REG-01`, `FIXTURE-01` | Pass for automated local scope: full matrices and zero-residue scan passed                                                                        | Qualified accessibility and hosted evidence remain pending |

## Reproducible evidence

| Evidence                                 | Result                                                                                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                              | 16 files and 178 tests passed                                                                                                                                                                                    |
| `pnpm test:sql`                          | 4 files and 164 pgTAP tests passed                                                                                                                                                                               |
| `pnpm test:e2e`                          | 12 desktop/mobile scenarios passed                                                                                                                                                                               |
| `node scripts/test-feat-004-runtime.mjs` | New/existing Auth paths, TOTP, Edge, Mailpit, concurrency, forged-school denial, and cleanup passed                                                                                                              |
| Residue query                            | `0:0:0` for FEAT-004 Auth users, organizations, and invitations                                                                                                                                                  |
| `pnpm verify:app`                        | Complete application gate passed; dependency audit found no known vulnerability                                                                                                                                  |
| Database verification matrix             | Clean reset and 164 SQL tests passed; all four runtime fixtures, database lint, and generated-type check passed. One reset-startup Auth failure was cleaned unconditionally before the successful FEAT-004 rerun |

The local stack uses the repository-pinned Supabase JavaScript client `2.110.7`
and CLI `2.109.1`. Separate technical review passed with no remaining actionable
findings.

## Invitation runtime diagnostic evidence

[FIX-008 / #62](https://github.com/killroyZULU/FlyEye/issues/62) records the reviewed
target, final checks and integration outcome for A019 under the structural audit.
[Post-merge CI 36228732729](https://github.com/killroyZULU/FlyEye/actions/runs/36228732729)
failed on `feb16bb` in the invitation fixture without stage or cleanup evidence.
Supabase teardown passed; the fixture's historical cleanup and failure cause
remain unconfirmed. The earlier evidence tables above retain their original scope.

| Concern                             | Exact automated evidence                                                                                                                                                                                                                                                        | Boundary                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Private output and failure location | [Diagnostic tests](../../../scripts/lib/fixture-diagnostics.test.mjs), `sanitized fixture failure evidence`; [cleanup tests](../../../scripts/lib/invitation-runtime-cleanup.test.mjs), `filters private payloads, unknown stages and another fixture from invitation evidence` | Fixed stage/category output only; raw provider/assertion output remains suppressed                                                                                             |
| Independent cleanup and residue     | [Cleanup tests](../../../scripts/lib/invitation-runtime-cleanup.test.mjs), `invitation fixture cleanup evidence`; [cleanup helper](../../../scripts/lib/invitation-runtime-cleanup.mjs), `cleanupInvitationRuntime`                                                             | Exercises shutdown/discovery/database/Auth/residue/mail/file failures; database assertions execute only in disposable runtime CI                                               |
| Mail ownership                      | [Cleanup tests](../../../scripts/lib/invitation-runtime-cleanup.test.mjs), `invitation mailbox cleanup`                                                                                                                                                                         | Exact current-run recipients, bounded inventory, nonempty-ID deletion and absence check; [Mailpit API](https://mailpit.axllent.org/docs/api-v1/) owns the provider contract    |
| Worker lifecycle                    | [Lifecycle tests](../../../scripts/lib/local-edge-lifecycle.test.mjs), `fixture-specific Edge readiness` and `owned Edge process shutdown`                                                                                                                                      | Handler-specific GET rejection and verified process-tree exit; configured callback origin stays fixed, so the probe alone does not establish a fresh environment               |
| Full invitation fixture             | [Runtime fixture](../../../scripts/test-feat-004-runtime.mjs), named `diagnostics.enter` stages and final `fixture-cleanup`; [runner](../../../scripts/run-runtime-matrix.mjs)                                                                                                  | Existing new/existing-recipient, concurrency and forged-school assertions remain. Matrix stop/start supplies fixture isolation; success is emitted only after verified cleanup |

On the FIX-008 worktree based on `feb16bb`, the focused diagnostics, cleanup and
lifecycle group passed 49 tests. These local regressions use synthetic mocks and
owned test processes. The occupied local Supabase stack was preserved; required
PR CI supplies new database/runtime evidence through #62. No application policy,
provider configuration, schema, RLS or audit contract changed.
