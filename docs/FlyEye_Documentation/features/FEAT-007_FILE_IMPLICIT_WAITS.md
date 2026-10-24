# Feature Specification: FEAT-007 File Implicit Waits

## Scope and contract

This focused reference separates the R5 file-wait manifest from the near-budget
[document contract](FEAT-007_AIRCRAFT_DOCUMENT_RECORDS.md). The existing
[security requirements](../08_SECURITY_REQUIREMENTS.md#4-authorization-and-tenant-isolation)
and [atomic audit rule](../08_SECURITY_REQUIREMENTS.md#9-audit-and-security-logging)
apply. [Issue #192](https://github.com/killroyZULU/FlyEye/issues/192) owns delivery;
[the R5 inventory](FEAT-007_REGISTRY_IMPLICIT_WAIT_TRACEABILITY.md#r5-source-inventory)
retains other surfaces.

The bounded functions are `stage_aircraft_document_file`,
`complete_aircraft_document_file` and `confirm_aircraft_document_download_issued`.
If protected membership revocation or role demotion removes the required
permission before an implicit wait is released, return the existing
`unauthorized` result without file details or committed file/audit effects.
If locks serialize revocation after the command, prove that ordering and preserve
the authorized result. Preserve independently committed peer and revocation state.

Keep signatures, service-only grants, tenant predicates, current scan outcomes,
validation, explicit locks and replay semantics. Mandatory audit failure `P7101`
must still propagate. Correct production code only after a reproduced violation.
No browser, visual, provider, real Storage, session-policy or global
permission-bundle change belongs to this slice. Existing signed-URL lifetime and
hosted scanner/recovery requirements remain separate.

## Frozen investigation manifest

Source baseline: `30b6472f85a4266d2a864e2e1d3aec67b529812e`. Each base case runs
with protected membership revocation, protected role demotion to `student_pilot`,
and retained authority: **20 base cases, 60 schedules**.

| Cases                                   | Operation and barrier                                                                                                                | Base count |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------: |
| `domain-stage`, `audit-stage`           | Staging INSERT at `stored_files` SHARE lock; staging audit at `aircraft_document_events` SHARE lock                                  |          2 |
| `domain-complete-*`, `audit-complete-*` | Completion UPDATE and audit for clean, rejected, scan_failed, size mismatch and hash mismatch                                        |         10 |
| `audit-download`                        | Download-confirmation audit at the event-table SHARE lock                                                                            |          1 |
| `unique-stage-*`                        | Preseeded peer UPDATE acquires the proposed file ID or object key; peer commit and rollback                                          |          4 |
| `foreign-key-stage-*`                   | Organization, aircraft or uploader row FOR UPDATE; holder revokes through the protected command and commits, or rolls back unchanged |          3 |

Relation barriers must allow earlier reads and explicit row locks. Observe the
worker's ungranted RowExclusiveLock on the named relation and its blocking backend.
Natural waits require an observed worker/holder dependency. For independent
revokers, distinguish committed revocation from revocation blocked behind the
worker; elapsed time is not ordering evidence. The uniqueness peer is updated
after its seed transaction commits, avoiding an unrelated INSERT foreign-key lock.

## Acceptance and verification

- Record each exact decision and ordering. Characterization failures are defects
  or fixture failures to investigate, not accepted outcomes.
- Compare complete stored-file and affected document/audit snapshots. On denial,
  only independently committed peer/revocation state may remain. Positive controls
  assert exact file attributes, audit actor/target/correlation/outcome/metadata and
  unchanged unrelated records.
- Staging and clean-completion replay add no writes. Rejected/scan_failed
  completion retains its existing conflict behavior. Download confirmation is an
  audited issuance, not an idempotent replay operation.
- Rollback-only School A/School B cases prove non-disclosure and preserved scope;
  browser roles retain no direct execution. File audit failure rolls back all
  protected effects. A handler regression must withhold a signed URL when final
  confirmation denies authority.
- Run only in the disposable CI database, with empty-school/identifier ownership
  preflight and unchanged permission-definition snapshots. A controlled observer
  failure exercises interruption cleanup. Close and settle every owned session,
  prove absence before deleting owned rows, and verify zero residue. Failed
  settlement or case cleanup also blocks final deletion; do not retry through
  cleanup uncertainty.
- Obtain independent review and [applicable verification](../11_QA_TEST_PLAN.md#verification-applicability).
  Record baseline and correction evidence separately in the
  [R5 evidence record](FEAT-007_REGISTRY_IMPLICIT_WAIT_TRACEABILITY.md#file-operation-investigation).

Expected files are the isolated runner/helpers, SQL/handler regressions, CI
invocation and these canonical links. A reproduced violation may justify a new
migration replacing only the affected functions; no schema, RLS, dependency or
generated-signature change is planned. This manifest does not close all R5/H002.
