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

## Acceptance concurrency evidence

[SEC-006 / issue #124](https://github.com/killroyZULU/FlyEye/issues/124) owns
execution results for the [acceptance concurrency contract](FEAT-004_MEMBER_INVITATIONS.md#acceptance-concurrency-investigation).
The [runner](../../../scripts/test-h002-acceptance.mjs) observes database blockers;
the [case matrix](../../../scripts/lib/h002-acceptance-cases.mjs) defines twelve
interleavings and five negative controls. [Assertions](../../../scripts/lib/h002-acceptance-assertions.mjs)
check membership, role, invitation and exact event outcomes. [Fixture ownership](../../../scripts/lib/h002-acceptance-fixture.mjs)
limits mutations to synthetic rows and a dedicated role; normal and injected
observer-failure runs must prove cleanup and unchanged existing roles/permissions.
Execution evidence is not established by source inspection.

Existing `RPC-02`/`TENANT-01` and `EDGE-01`/`AUTH-01/02` above cover their recorded
cross-school and trusted identity/freshness boundaries. This SQL schedule matrix
does not extend that evidence to provider identity changes during waits, global
session policy, every implicit write wait or hosted operation. Broader H002
coverage remains in [issue #39](https://github.com/killroyZULU/FlyEye/issues/39).

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

## Invitation gateway extraction evidence

[A002 / #76](https://github.com/killroyZULU/FlyEye/issues/76) records the extraction target, separate review and final CI evidence. The [compatibility tests](../../../src/features/auth/services/member-invitation-gateway.test.ts), suites `member invitation gateway compatibility` and `invitation credential preparation compatibility`, cover the frontend portion of [FEAT-004 acceptance](FEAT-004_MEMBER_INVITATIONS.md#acceptance-criteria): exact command payloads, versions/idempotency, replay responses, malformed results, safe error/retry guidance and new/existing credential ordering with failure short circuits.

The focused gateway/invitation group passed 93 tests on baseline `d9ec310` and after extraction. Synthetic SDK responses establish compatibility, not server authorization or delivery; the [runtime fixture](../../../scripts/test-feat-004-runtime.mjs) and existing SQL/RLS checks supply those separate local integration boundaries through required CI. The occupied local database remains preserved.

## Invitation administration UI extraction evidence

[A003 / #94](https://github.com/killroyZULU/FlyEye/issues/94) separates the administration workflow from the form/confirmation and invitation list under the unchanged [FEAT-004 contract](FEAT-004_MEMBER_INVITATIONS.md#workflow-and-business-rules).

The `FEAT-004 member invitation administration` suite in [component tests](../../../src/features/auth/components/MemberInvitationsPanel.test.tsx) covers loading/empty states, heading focus, role/email validation, confirmation editing, pending controls, command version/key payloads, refresh failures, action eligibility including the 60-second boundary, and obsolete initial responses after a gateway change. All 94 focused component, gateway, schema and application-integration cases passed against baseline `3fd684c` before extraction; the same cases plus ten maintainability/configuration checks passed afterward. The [workflow hook](../../../src/features/auth/components/useMemberInvitations.ts) and extracted views meet normal maintainability limits without the former component exemptions.

These synthetic mocks establish bounded compatibility, not hosted delivery, complete race coverage or formal accessibility. Final application checks, separate review and disposable runtime/cleanup results belong to #94's linked PR. The occupied local database remains excluded.

## Invitation handler extraction evidence

[A003 / #104](https://github.com/killroyZULU/FlyEye/issues/104) separates the
[HTTP handler](../../../supabase/functions/member-invitations/handler.ts) from
[contracts](../../../supabase/functions/member-invitations/contracts.ts),
[limiter/authentication guards](../../../supabase/functions/member-invitations/guards.ts),
[actions](../../../supabase/functions/member-invitations/actions.ts),
[delivery](../../../supabase/functions/member-invitations/delivery.ts),
[idempotency helpers](../../../supabase/functions/member-invitations/idempotency.ts), and
[responses](../../../supabase/functions/member-invitations/responses.ts).
The handler is 105 lines; its legacy size and complexity exceptions were removed.
Its factory/type exports and production entrypoint wiring remain compatible.

The [handler tests](../../../supabase/functions/member-invitations/handler.test.ts),
suite `member invitation extraction compatibility`, add 36 cases covering HTTP
validation and headers, server-resolved limiter scope, exact command payloads,
limiter failure/retry metadata, awaited denial audits and error precedence,
create/resend finalization retries with one provider send, safe delivery
uncertainty, confirmed-email denials, and malformed/failed backend results.
Together with the [authentication-evidence](../../../supabase/functions/_shared/authentication-evidence.test.ts)
and [invitation gateway](../../../src/features/auth/services/member-invitation-gateway.test.ts)
suites, all 113 focused tests passed on unchanged baseline `7d8f9ee` and after
extraction. Adding [maintainability tests](../../../scripts/lib/code-maintainability.test.mjs)
produced 121 passing checks.

This synthetic evidence establishes bounded compatibility under the
[FEAT-004 contract](FEAT-004_MEMBER_INVITATIONS.md#acceptance-criteria).
The existing SQL/RLS and [runtime fixture](../../../scripts/test-feat-004-runtime.mjs)
supply separate authority, forged-school, real Auth/Edge and cleanup evidence
through required disposable PR CI. The occupied local database was preserved;
hosted delivery remains outside this evidence.

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
