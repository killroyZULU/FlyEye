# FEAT-007 Traceability

## R5 source inventory

This focused record accompanies the [implicit-wait contract](FEAT-007_REGISTRY_IMPLICIT_WAITS.md),
split from the near-budget parent [traceability record](FEAT-007_TRACEABILITY.md).
Inventory baseline: `e79e5efa69c63bc496ebff26f7937624ac3e37b8`. Source inspection
identified candidates; it did not execute these schedules or establish a defect.

| Surface                                                                                              | Existing evidence and remaining gap                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mutate_aircraft_record`                                                                             | [SEC-001](../../../supabase/migrations/20261005234138_sec_001_registry_lock_revalidation.sql) rechecks after explicit advisory/record locks. The [frozen 63 schedules](FEAT-007_REGISTRY_IMPLICIT_WAITS.md#frozen-investigation-manifest) target later implicit waits; execution pending. |
| `mutate_aircraft_document`, `mutate_aircraft_document_category`                                      | [SEC-003](../../../supabase/migrations/20261006110323_sec_003_remaining_h002_revalidation.sql) includes a final authorization check with rollback. Implicit write schedules remain unexecuted; source checks are not runtime proof.                                                       |
| `complete_aircraft_document_file`, `open_aircraft_document_notification`, `update_my_member_profile` | Same SEC-003 migration covers named explicit waits. Subsequent domain/audit writes need separately frozen implicit-wait cases.                                                                                                                                                            |
| `stage_aircraft_document_file`, `confirm_aircraft_document_download_issued`                          | [Document functions](../../../supabase/migrations/20260901000100_feat_007b_aircraft_document_records.sql) write stored-file/audit rows after authorization. Implicit waits are untested. Previously issued signed-URL lifetime is a separate policy boundary.                             |
| Audited member/profile reads                                                                         | `list_organization_members`, `get_organization_member`, `get_my_member_profile` can wait on mandatory audit writes before returning a result. Not covered by this registry mutation manifest.                                                                                             |
| Audited aircraft/document reads                                                                      | `list_aircraft_records`, `get_aircraft_record`, `list_aircraft_document_status`, `list_aircraft_for_document_status`, `get_aircraft_document_detail`, `list_aircraft_document_history`, `list_aircraft_document_notifications`: audit-write candidates remain untested.                   |
| Onboarding and invitations                                                                           | Reuse only named R2–R4 tests in [FEAT-003](FEAT-003_TRACEABILITY.md) and [FEAT-004](FEAT-004_TRACEABILITY.md). Onboarding status audit writes and invitation-list expiry materialization need explicit inventory disposition; family-level coverage is not assumed.                       |
| Maintenance/internal helpers                                                                         | Storage reconciliation, notification jobs and denial-audit helpers have different service/actor boundaries; no actor-revocation contract is inferred for them. Transitive lifecycle effects are included only in the two named registry trigger cases.                                    |

Global permission changes remain R6; recovery/session/provider residuals remain
R7/R8 and the [governance decisions](../17_PRODUCT_AND_GOVERNANCE_DECISIONS.md).
The [audit inventory](https://github.com/killroyZULU/FlyEye/issues/39) remains open.

## Execution evidence

No R5 execution is recorded yet. The registry SQL/RLS baseline and earlier explicit
lock results remain in the parent traceability record with their original limits.
