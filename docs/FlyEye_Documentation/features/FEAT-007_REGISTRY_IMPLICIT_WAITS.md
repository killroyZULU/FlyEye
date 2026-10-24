# Feature Specification: FEAT-007 Registry Implicit Waits

## Scope and contract

This focused reference separates the R5 concurrency contract from the near-budget
[registry specification](FEAT-007_AIRCRAFT_REGISTRY_FOUNDATION.md). Existing
[authorization and audit requirements](../08_SECURITY_REQUIREMENTS.md) apply.
[Issue #39](https://github.com/killroyZULU/FlyEye/issues/39) owns the wider inventory.

The bounded target is `public.mutate_aircraft_record`: create, update, archive and
reactivate. A command waiting after its last authority check must not commit its
mutation, transitive trigger effects, success/conflict audit or idempotency result
when a protected membership revocation or role change removing manage permission
commits before that wait is released. Return the existing `unauthorized` result.
If existing locks serialize revocation after the command, preserve the authorized
command and prove that ordering. Preserve previously committed records.

Retain signatures, grants, tenant predicates, required audit failure propagation,
version/state conflicts, idempotency and existing lock order. Introduce a production
correction only for a reproduced gap. No frontend, provider, session-policy,
global permission-bundle or hosted behavior changes belong to this slice.

## Frozen investigation manifest

Source baseline: `e79e5efa69c63bc496ebff26f7937624ac3e37b8`. Execute each base case
with protected membership revocation, protected role change to `student_pilot`,
and retained authority: 21 base cases, 63 schedules. Use the existing service-role
RPC boundary; never grant direct membership access to the worker or revoker.

| Cases                                  | Actions                             | Barrier and release                                                                                                       | Base count |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------: |
| `domain-*`                             | create, update, archive, reactivate | SHARE lock on `aircraft_records`, released without a peer change                                                          |          4 |
| `audit-*`                              | same four                           | SHARE lock on `aircraft_registry_events`                                                                                  |          4 |
| `idempotency-*`                        | same four                           | SHARE lock on `aircraft_registry_idempotency`                                                                             |          4 |
| `unique-*-commit`, `unique-*-rollback` | create, update, reactivate          | A preseeded competing record acquires the target registration key in an uncommitted UPDATE; commit or roll back that peer |          6 |
| `foreign-key-create`                   | create                              | Organization row FOR UPDATE; the holder either revokes through the protected RPC and commits, or rolls back unchanged     |          1 |
| `trigger-*`                            | archive, reactivate                 | Existing document notification row FOR UPDATE; exercise the real lifecycle trigger                                        |          2 |

Relation barriers must allow preceding reads and explicit row-lock statements;
observe the worker's ungranted RowExclusiveLock on the exact relation. Natural
barriers require an observed worker/holder dependency. Observe whether the
revoker commits before release or blocks behind the worker; elapsed time alone
does not establish ordering. The uniqueness peer must not hold an organization
foreign-key lock from an INSERT, which would confound that ordering.

## Acceptance and verification

- Assert the exact decision and authority ordering for all named cases. A
  characterization result is evidence of a defect, not an accepted success.
- On denial, compare complete snapshots of registry records/events/idempotency
  and affected document records, versions, requirements, categories, notifications
  and events. Only the independent peer and revocation may remain committed.
- On authorized success, assert requested identity/state/version, exactly one
  matching registry audit and idempotency result, and expected trigger effects.
  Replaying retained-authority success must return the same result without writes.
- On an authorized committed uniqueness conflict, retain the competing record,
  write exactly the existing conflict audit and no mutation/idempotency result.
- Reuse unchanged registry SQL cases for cross-school denial, forged scope,
  version conflicts and mandatory audit failure; run them with any SQL correction.
- Exercise a controlled observer failure while a worker is blocked. Close every
  owned session, settle pending work, remove only preflight-owned synthetic rows,
  assert zero residue and unchanged permission definitions. Cleanup uncertainty
  stops execution. Use only the disposable GitHub Actions database.
- Review the stable fixture and any reproduced correction independently. Apply
  [QA verification applicability](../11_QA_TEST_PLAN.md#verification-applicability)
  and record exact targets/results in the [evidence record](FEAT-007_REGISTRY_IMPLICIT_WAIT_TRACEABILITY.md).

## Affected surfaces and remaining boundary

Expected changes are isolated test helpers/runner, CI invocation, this contract
and its evidence links. A new versioned migration may replace only the registry
function if reproduction warrants it. No new dependency, schema, RLS, frontend,
generated signature or provider change is planned. Rollback of a failed command
must include its audit and trigger effects; deployment rollback is outside scope.

The separate aircraft-list UI branch overlaps the parent specification and
traceability links. Reconcile those documentation edits against current main
before publication; preserve its visual and browser work. This contract adds no
aviation or operational authority and does not close R5 beyond its named schedules.
