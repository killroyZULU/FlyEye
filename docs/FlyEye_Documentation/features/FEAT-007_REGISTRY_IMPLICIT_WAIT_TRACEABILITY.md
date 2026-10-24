# FEAT-007 Traceability

## R5 source inventory

This focused record accompanies the [implicit-wait contract](FEAT-007_REGISTRY_IMPLICIT_WAITS.md),
split from the near-budget parent [traceability record](FEAT-007_TRACEABILITY.md).
Inventory baseline: `e79e5efa69c63bc496ebff26f7937624ac3e37b8`. Source inspection
identified candidates; it did not execute these schedules or establish a defect.

| Surface                                                           | Existing evidence and remaining gap                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mutate_aircraft_record`                                          | [SEC-001](../../../supabase/migrations/20261005234138_sec_001_registry_lock_revalidation.sql) rechecks after explicit advisory/record locks. The [frozen 63 schedules](FEAT-007_REGISTRY_IMPLICIT_WAITS.md#frozen-investigation-manifest) reproduced later implicit-wait gaps; see execution evidence below. Early-return audit branches are outside this manifest. |
| `mutate_aircraft_document`, `mutate_aircraft_document_category`   | [SEC-003](../../../supabase/migrations/20261006110323_sec_003_remaining_h002_revalidation.sql) includes final authorization checks with rollback. The [243-schedule manifest](FEAT-007_DOCUMENT_WRITE_WAITS.md#frozen-investigation-manifest) targets remaining implicit writes; execution evidence is recorded below.                                              |
| File staging, completion and download confirmation                | The [60-schedule file manifest](FEAT-007_FILE_IMPLICIT_WAITS.md#frozen-investigation-manifest) reproduced implicit-wait gaps; see file-operation evidence below. Previously issued signed-URL lifetime remains a separate policy boundary.                                                                                                                          |
| `open_aircraft_document_notification`, `update_my_member_profile` | SEC-003 covers named explicit waits. Subsequent domain/audit writes still need separately frozen implicit-wait cases.                                                                                                                                                                                                                                               |
| Audited member/profile reads                                      | `list_organization_members`, `get_organization_member`, `get_my_member_profile` can wait on mandatory audit writes before returning a result. Not covered by this registry mutation manifest.                                                                                                                                                                       |
| Audited aircraft/document reads                                   | `list_aircraft_records`, `get_aircraft_record`, `list_aircraft_document_status`, `list_aircraft_for_document_status`, `get_aircraft_document_detail`, `list_aircraft_document_history`, `list_aircraft_document_notifications`: audit-write candidates remain untested.                                                                                             |
| Onboarding and invitations                                        | Reuse only named R2–R4 tests in [FEAT-003](FEAT-003_TRACEABILITY.md) and [FEAT-004](FEAT-004_TRACEABILITY.md). Onboarding status audit writes and invitation-list expiry materialization need explicit inventory disposition; family-level coverage is not assumed.                                                                                                 |
| Maintenance/internal helpers                                      | Storage reconciliation, notification jobs and denial-audit helpers have different service/actor boundaries; no actor-revocation contract is inferred for them. Transitive lifecycle effects are included only in the two named registry trigger cases.                                                                                                              |

Global permission changes remain R6; recovery/session/provider residuals remain
R7/R8 and the [governance decisions](../17_PRODUCT_AND_GOVERNANCE_DECISIONS.md).
The [audit inventory](https://github.com/killroyZULU/FlyEye/issues/39) remains open.

## Execution evidence

[Baseline CI 39254525835](https://github.com/killroyZULU/FlyEye/actions/runs/39254525835)
at `f669bd17abb448a44072c5b04cb3cfa47f75d1cd` ran all 63 frozen schedules against
unchanged production functions. All 42 revocation schedules failed the expected
denial: 36 returned mutation success and six returned a duplicate-registration
conflict after revocation committed. All 21 retained-authority controls passed
exact state/audit/idempotency/trigger and applicable replay assertions. No case
serialized revocation behind the worker. These are reproduced gaps, not safe
scenarios. The final count assertion was misleadingly labelled `case-cleanup`;
both interruption and final cleanup markers passed, with database teardown.

The [runner](../../../scripts/test-h002-registry-implicit.mjs), `runCase`, observes
the blocking backends and authority ordering. Its [assertions](../../../scripts/lib/h002-registry-implicit-assertions.mjs),
`assertRegistry`, compare complete denial snapshots and exact positive effects.
The [fixture](../../../scripts/lib/h002-registry-implicit-fixture.mjs), `cases`,
is the executable manifest. Local assertion/cleanup regressions passed 27 tests;
the [quiescence tests](../../../scripts/lib/h002-registry-implicit-cleanup.test.mjs)
reject deletion after unverified session absence or failed settlement.

[SEC-028](../../../supabase/migrations/20261019124941_sec_028_registry_implicit_revalidation.sql)
adds a final fresh authority check on normal and uniqueness-conflict paths and
an outer rollback handler for only SQLSTATE `P7304`. Existing `P7001` audit
failure must propagate. Correction `6e3a021e2e1592e5aa2eee3fa7c533f2ee51e968`
passed [CI 39255447507](https://github.com/killroyZULU/FlyEye/actions/runs/39255447507):
all 42 revocation schedules denied with rollback and all 21 retained-authority
controls passed. Controlled interruption and final cleanup/residue passed, as
did SQL/RLS, all 27 runtime executions/final cleanup markers, database lint/types,
teardown and the required application/aggregate gates.

[PR #187](https://github.com/killroyZULU/FlyEye/pull/187) owns reconciliation and
final-head evidence after diagnostic #189. Existing registry SQL/RLS cases and
earlier explicit-wait evidence retain their original targets and limits; no
broader R5 or H002 closure follows from this manifest.

## File-operation investigation

The [frozen file manifest](FEAT-007_FILE_IMPLICIT_WAITS.md#frozen-investigation-manifest)
targets production source `30b6472f85a4266d2a864e2e1d3aec67b529812e`.
[Baseline CI 40060270025](https://github.com/killroyZULU/FlyEye/actions/runs/40060270025)
at `8320309e11d780af563aa5f5a0701a5544ce456d` ran all 60 schedules against unchanged
production functions. All 40 revocation schedules failed the expected denial:
14 returned `staged`, four `completed`, 16 `file_rejected`, two `confirmed`, and
four `state_conflict` after revocation committed. No revocation serialized behind
the worker. All 20 retained-authority controls passed exact file/audit/peer and
applicable replay assertions. These results reproduce authority gaps; they are
not safe revocation outcomes. All 534 SQL/RLS assertions, both file cleanup checks
and disposable database teardown passed. Later runtime checks were not reached.

[SEC-031](../../../supabase/migrations/20261024040015_sec_031_file_implicit_revalidation.sql)
adds a final fresh check and rollback handler for only SQLSTATE `P7305` in the
three affected functions. Staging's existing uniqueness handler rechecks after
its file/audit effects have rolled back. Other failures, including mandatory
audit failure `P7101`, still propagate.
[PR #193](https://github.com/killroyZULU/FlyEye/pull/193) owns correction and final-head evidence for
[#192](https://github.com/killroyZULU/FlyEye/issues/192). This scope does not close
other R5 paths or global H002.

PR #193 integrated at `853b697a9871c27fd806e081548ca53b9f67b5ec`.
[Post-merge CI 40066924161](https://github.com/killroyZULU/FlyEye/actions/runs/40066924161)
passed all gates: 40 file denials and 20 retained controls, both file cleanup
checks, 534 SQL/RLS assertions, 63 registry schedules, 27 runtime executions/final
cleanup markers, database lint/types and teardown. The merge tree matches reviewed
`6058a3a2c942363516e0a1d6508e15cd07c8cc0a`.

| Contract                                                                                    | Evidence locator                                                                                                                                                                   | Boundary                                                                         |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [60 observed schedules](FEAT-007_FILE_IMPLICIT_WAITS.md#frozen-investigation-manifest)      | [Runner](../../../scripts/test-h002-file-implicit.mjs), `runCase`; [fixture](../../../scripts/lib/h002-file-implicit-fixture.mjs), `cases`                                         | Selected implicit waits only; previous explicit-wait evidence retains its target |
| [Exact state/audit and replay](FEAT-007_FILE_IMPLICIT_WAITS.md#acceptance-and-verification) | [Assertions](../../../scripts/lib/h002-file-implicit-assertions.mjs), `assertFile`/`assertFileReplay`; [regressions](../../../scripts/lib/h002-file-implicit-assertions.test.mjs)  | Assertions are not proof until the corresponding schedule executes               |
| [Cleanup hard stop](FEAT-007_FILE_IMPLICIT_WAITS.md#acceptance-and-verification)            | Runner `--cleanup-probe`; [final cleanup](../../../scripts/lib/h002-file-implicit-cleanup.mjs), `finishCleanup`; [tests](../../../scripts/lib/h002-file-implicit-cleanup.test.mjs) | Requires observed settlement, absence, residue and unchanged permissions         |
| [Scope and audit failure](FEAT-007_FILE_IMPLICIT_WAITS.md#acceptance-and-verification)      | [Rollback-only SQL](../../../supabase/tests/sec_031_file_implicit_test.sql), School A/B denial and mandatory-audit assertions                                                      | Synthetic database evidence; no real file scanning or hosted Storage proof       |
| [Withheld download URL](FEAT-007_FILE_IMPLICIT_WAITS.md#acceptance-and-verification)        | [Handler tests](../../../supabase/functions/aircraft-documents/handler.test.ts), `withholds a signed URL when final download confirmation denies changed authority`                | Mocked handler boundary; previously issued URL lifetime remains separate         |

## Document/category write investigation

Production baseline `853b697a9871c27fd806e081548ca53b9f67b5ec` retains normal-path
rollback checks and existing uniqueness-conflict handlers. Source inspection
identifies the latter as candidates, not reproduced defects.

| Contract                                                                                       | Evidence locator                                                                                                                                                                          | Result and boundary                                                      |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Frozen barriers and ordering](FEAT-007_DOCUMENT_WRITE_WAITS.md#frozen-investigation-manifest) | [Runner](../../../scripts/test-h002-document-implicit.mjs), `runCase`; [fixture](../../../scripts/lib/h002-document-implicit-fixture.mjs), `cases`                                        | Execution required; source inspection is not runtime proof               |
| [State, audit and retry](FEAT-007_DOCUMENT_WRITE_WAITS.md#acceptance-and-verification)         | [Assertions](../../../scripts/lib/h002-document-implicit-assertions.mjs), `assertDocument`/`assertReplay`; [regressions](../../../scripts/lib/h002-document-implicit-assertions.test.mjs) | Expected rollback and retained controls; no inferred global H002 closure |
| [Cleanup hard stop](FEAT-007_DOCUMENT_WRITE_WAITS.md#acceptance-and-verification)              | Runner `--cleanup-probe`; [cleanup](../../../scripts/lib/h002-document-implicit-cleanup.mjs), `finishCleanup`; [tests](../../../scripts/lib/h002-document-implicit-cleanup.test.mjs)      | Disposable CI only; settlement, absence and residue required             |
| [Scope and mandatory audit](FEAT-007_DOCUMENT_WRITE_WAITS.md#acceptance-and-verification)      | [Rollback-only SQL](../../../supabase/tests/sec_032_document_implicit_test.sql), School A/B and audit-failure assertions                                                                  | Database execution required; no hosted or provider claim                 |
