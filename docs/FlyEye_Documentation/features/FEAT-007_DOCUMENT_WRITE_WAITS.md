# Feature Specification: FEAT-007 Document and Category Write Waits

## Scope and contract

This reference separates the frozen R5 write-wait manifest from the near-budget
[document contract](FEAT-007_AIRCRAFT_DOCUMENT_RECORDS.md).
[Issue #194](https://github.com/killroyZULU/FlyEye/issues/194) owns the bounded
investigation of `mutate_aircraft_document` and `mutate_aircraft_document_category`.
Apply the existing [authorization](../08_SECURITY_REQUIREMENTS.md#4-authorization-and-tenant-isolation)
and [atomic audit](../08_SECURITY_REQUIREMENTS.md#9-audit-and-security-logging) rules.

When protected membership revocation or role demotion commits before an implicit
wait releases, return `unauthorized` without document/category details or surviving
domain, notification, audit or idempotency writes. Preserve independently committed
peer and revocation state. Existing normal-path rollback is not evidence that
uniqueness exceptions revalidate authority. Reproduce any gap before correction.

Preserve signatures, service-only grants, tenant predicates, validation, version
conflicts, explicit locks, immutable versions and mandatory audit failure `P7101`.
Retained authority must preserve existing success, conflict and explicit retry/replay
behavior. No automatic retry, UI, provider, hosted-service or policy change is in scope.

## Frozen investigation manifest

Production baseline: `853b697a9871c27fd806e081548ca53b9f67b5ec`.
Eleven variants cover document create/renew/correct/suspend/restore and category
create/rename/archive/new assignment/reassignment/removal. Each base case runs
with membership revocation, role demotion to `student_pilot`, and retained authority:
**81 base cases, 243 schedules**.

| Barrier                                                    | Variants                                                                                                                                      | Base count |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------: |
| Primary domain, audit and idempotency SHARE relation locks | All eleven variants at each barrier                                                                                                           |         33 |
| Secondary domain SHARE locks                               | Document create/version INSERT, renew/correct aggregate UPDATE; category archive requirement/document UPDATE, reassign/remove document UPDATE |          7 |
| Notification SHARE lock                                    | All five document variants plus category archive/reassign/remove                                                                              |          8 |
| Idempotency uniqueness peer commit/rollback                | All eleven variants                                                                                                                           |         22 |
| Active custom-label uniqueness peer commit/rollback        | Category create/rename                                                                                                                        |          4 |
| Natural foreign-key waits                                  | Document/category creation at organization and actor; document creation at notification recipient                                             |          5 |
| Notification uniqueness peer commit                        | Document restore and category reassignment                                                                                                    |          2 |

Use preseeded peer UPDATEs for uniqueness barriers. Foreign-key and notification
uniqueness holders perform the protected revocation in their own transaction,
then commit; retained controls release without revocation. Ordinary revokers must
commit before holder release. Unexpected serialization is a fixture result to
investigate, not an accepted denial schedule. Observe blocking backends; relation
barriers also require an ungranted RowExclusiveLock on the intended table.

Use fixed synthetic dates. Normal metadata cases avoid new notification recipients
at later barriers; notification cases deliberately exercise recipient creation.
Restore/reassignment cases normally reopen preseeded administrator notifications.
This isolates the intended wait from incidental recipient foreign-key locks.

## Acceptance and verification

- Check complete domain/version/category/requirement/file/notification/audit/
  idempotency state. On denial or conflict, compare unchanged snapshots with only
  committed peer changes. Check protected revocation state and its audit separately.
- Retained controls assert exact response, fields, actor, target, correlation,
  metadata and preserved unrelated rows. Replay adds no writes. Committed
  idempotency collisions retry as `idempotency_conflict`; label collisions remain
  `state_conflict`; committed notification collisions allow an explicit retry and
  then idempotent replay. No production retry is introduced.
- Rollback-only School A/B cases verify non-disclosure and insufficient-role
  denials. Both functions retain browser execution denial. Mandatory audit failure
  propagates and rolls back the whole action.
- Run database schedules only in disposable CI. Require empty-school/identifier
  ownership preflight, controlled observer-failure cleanup, settled/absent owned
  sessions before deletion, zero residue and unchanged global permissions.
  Uncertain settlement or cleanup blocks further deletion and execution.
- Obtain separate agent review and [applicable checks](../11_QA_TEST_PLAN.md#verification-applicability).
  Record baseline and any correction separately in the
  [R5 evidence record](FEAT-007_REGISTRY_IMPLICIT_WAIT_TRACEABILITY.md#documentcategory-write-investigation).

Affected files are the isolated runner/helpers, SQL tests, CI invocation and
canonical documentation. A reproduced defect may justify replacing only the
affected functions in a new migration; no schema, RLS or generated-signature
change is planned. Other R5 surfaces and R6–R8 remain separately inventoried.
