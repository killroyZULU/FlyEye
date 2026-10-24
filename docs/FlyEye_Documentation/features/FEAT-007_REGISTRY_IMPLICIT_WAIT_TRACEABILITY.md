# FEAT-007 Traceability

## R5 source inventory

This focused record accompanies the [implicit-wait contract](FEAT-007_REGISTRY_IMPLICIT_WAITS.md),
split from the near-budget parent [traceability record](FEAT-007_TRACEABILITY.md).
Inventory baseline: `e79e5efa69c63bc496ebff26f7937624ac3e37b8`. Source inspection
identified candidates; it did not execute these schedules or establish a defect.

| Surface                                                                                              | Existing evidence and remaining gap                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mutate_aircraft_record`                                                                             | [SEC-001](../../../supabase/migrations/20261005234138_sec_001_registry_lock_revalidation.sql) rechecks after explicit advisory/record locks. The [frozen 63 schedules](FEAT-007_REGISTRY_IMPLICIT_WAITS.md#frozen-investigation-manifest) reproduced later implicit-wait gaps; see execution evidence below. Early-return audit branches are outside this manifest. |
| `mutate_aircraft_document`, `mutate_aircraft_document_category`                                      | [SEC-003](../../../supabase/migrations/20261006110323_sec_003_remaining_h002_revalidation.sql) includes a final authorization check with rollback. Implicit write schedules remain unexecuted; source checks are not runtime proof.                                                                                                                                 |
| `complete_aircraft_document_file`, `open_aircraft_document_notification`, `update_my_member_profile` | Same SEC-003 migration covers named explicit waits. Subsequent domain/audit writes need separately frozen implicit-wait cases.                                                                                                                                                                                                                                      |
| `stage_aircraft_document_file`, `confirm_aircraft_document_download_issued`                          | [Document functions](../../../supabase/migrations/20260901000100_feat_007b_aircraft_document_records.sql) write stored-file/audit rows after authorization. Implicit waits are untested. Previously issued signed-URL lifetime is a separate policy boundary.                                                                                                       |
| Audited member/profile reads                                                                         | `list_organization_members`, `get_organization_member`, `get_my_member_profile` can wait on mandatory audit writes before returning a result. Not covered by this registry mutation manifest.                                                                                                                                                                       |
| Audited aircraft/document reads                                                                      | `list_aircraft_records`, `get_aircraft_record`, `list_aircraft_document_status`, `list_aircraft_for_document_status`, `get_aircraft_document_detail`, `list_aircraft_document_history`, `list_aircraft_document_notifications`: audit-write candidates remain untested.                                                                                             |
| Onboarding and invitations                                                                           | Reuse only named R2–R4 tests in [FEAT-003](FEAT-003_TRACEABILITY.md) and [FEAT-004](FEAT-004_TRACEABILITY.md). Onboarding status audit writes and invitation-list expiry materialization need explicit inventory disposition; family-level coverage is not assumed.                                                                                                 |
| Maintenance/internal helpers                                                                         | Storage reconciliation, notification jobs and denial-audit helpers have different service/actor boundaries; no actor-revocation contract is inferred for them. Transitive lifecycle effects are included only in the two named registry trigger cases.                                                                                                              |

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
targets source `30b6472f85a4266d2a864e2e1d3aec67b529812e`. Production functions are
unchanged in the baseline investigation. Source inspection is not execution
evidence; [#192](https://github.com/killroyZULU/FlyEye/issues/192) owns its results.

| Contract                                                                                    | Evidence locator                                                                                                                                                                   | Boundary                                                                         |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [60 observed schedules](FEAT-007_FILE_IMPLICIT_WAITS.md#frozen-investigation-manifest)      | [Runner](../../../scripts/test-h002-file-implicit.mjs), `runCase`; [fixture](../../../scripts/lib/h002-file-implicit-fixture.mjs), `cases`                                         | Selected implicit waits only; previous explicit-wait evidence retains its target |
| [Exact state/audit and replay](FEAT-007_FILE_IMPLICIT_WAITS.md#acceptance-and-verification) | [Assertions](../../../scripts/lib/h002-file-implicit-assertions.mjs), `assertFile`/`assertFileReplay`; [regressions](../../../scripts/lib/h002-file-implicit-assertions.test.mjs)  | Assertions are not proof until the corresponding schedule executes               |
| [Cleanup hard stop](FEAT-007_FILE_IMPLICIT_WAITS.md#acceptance-and-verification)            | Runner `--cleanup-probe`; [final cleanup](../../../scripts/lib/h002-file-implicit-cleanup.mjs), `finishCleanup`; [tests](../../../scripts/lib/h002-file-implicit-cleanup.test.mjs) | Requires observed settlement, absence, residue and unchanged permissions         |
| [Scope and audit failure](FEAT-007_FILE_IMPLICIT_WAITS.md#acceptance-and-verification)      | [Rollback-only SQL](../../../supabase/tests/sec_031_file_implicit_test.sql), School A/B denial and mandatory-audit assertions                                                      | Synthetic database evidence; no real file scanning or hosted Storage proof       |
| [Withheld download URL](FEAT-007_FILE_IMPLICIT_WAITS.md#acceptance-and-verification)        | [Handler tests](../../../supabase/functions/aircraft-documents/handler.test.ts), `withholds a signed URL when final download confirmation denies changed authority`                | Mocked handler boundary; previously issued URL lifetime remains separate         |
