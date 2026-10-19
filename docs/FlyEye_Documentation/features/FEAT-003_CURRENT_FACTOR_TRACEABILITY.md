# FEAT-003 Traceability

This focused record keeps the [current-factor contract](FEAT-003_CURRENT_FACTOR_SESSIONS.md)
and its evidence reviewable without exceeding the parent traceability budget.
[SEC-026/#165](https://github.com/killroyZULU/FlyEye/issues/165) owns delivery coordination.

## Evidence map

Provider/SQL results below are from `0ec706b` in
[CI 38674492848](https://github.com/killroyZULU/FlyEye/actions/runs/38674492848).
That run failed only its generated-types comparison and aggregate gate; passing
scenario evidence is not an overall CI pass.

| Concern                             | Executable evidence                                                                                                                                                                                                                                                            | Result / boundary                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| START/COMPLETE session gate         | [Handler suite](../../../supabase/functions/organization-admin-onboarding/handler.test.ts), `SEC-026 current-factor session boundary`                                                                                                                                          | On base `1d9468d`, two added mocked-handler regressions returned 200 instead of 403. This demonstrates the missing gate locally, not provider behavior. Corrected focused handler/bootstrap suites: 130 tests passed.                        |
| Immutable provenance and privileges | [Migration](../../../supabase/migrations/20261015023902_sec_026_admin_session_factor_binding.sql); [rollback-only SQL](../../../supabase/tests/sec_026_admin_session_factor_test.sql)                                                                                          | 37 new SQL assertions passed: unknown history, ownership, inventory, AAL/AMR, immutability, RLS/grants, cascades and capture rollback.                                                                                                       |
| Sole verified replacement           | [Provider cases](../../../scripts/lib/onboarding-current-factor-cases.mjs), `runCurrentFactorCases`; [state/audit assertions](../../../scripts/lib/onboarding-current-factor-evidence.mjs)                                                                                     | Passed: original/refresh/rechallenge/AAL1/replay, fresh recovery, organization/grant waits and committed-admin preservation.                                                                                                                 |
| Binding lock order                  | [Observed schedules](../../../scripts/lib/onboarding-current-factor-locks.mjs), `bindingActor`                                                                                                                                                                                 | Passed: concurrent first verification/validation, rollback-only session/user deletion, real provider unenrollment and AAL1-session pruning.                                                                                                  |
| Obsolete browser result             | [Browser journey](../../../scripts/lib/onboarding-current-factor-browser.mjs), `onboardingCurrentFactorBrowser`                                                                                                                                                                | Passed: unchanged real verification response delayed until replacement, denied completion, cancellation and fresh recovery.                                                                                                                  |
| Assertion integrity                 | [Mutation tests](../../../scripts/lib/onboarding-current-factor-evidence.test.mjs), `current-factor denial evidence`                                                                                                                                                           | 18 local tests passed; reject quota/outage, changed authority, wrong attribution and missing/extra audit.                                                                                                                                    |
| Owned cleanup and retained gates    | [Runner](../../../scripts/test-feat-003-runtime.mjs), `--current-factor` / `--current-factor-cleanup-probe`; [shared evidence](../../../scripts/lib/onboarding-provider-evidence.mjs), `assertClean`; [runner tests](../../../scripts/lib/runtime-matrix-diagnostics.test.mjs) | Passed: binding residue/foreign preservation, interrupted grant-wait cleanup, all 26 runtime executions/cleanup markers and retained A010/H002 gates. The security-job allowance is 50 minutes for real TOTP windows and retained schedules. |

## Delivery verification

Separate design review required unknown historical provenance and both AAL1 timing
cases. Migration review found separate inventory reads could mix snapshots; the
correction uses one aggregate statement per inventory classification. Fixture review
required success markers after assertions/cleanup and real unenrollment plus provider
AAL1-session pruning evidence; the binding case now includes those assertions.
Local `verify:app` passed (1,594 tests, 26 browser scenarios); the post-review focused
fixture/diagnostic recheck passed 135 tests. Separate review confirmed both fixture
findings corrected with no remaining actionable finding. Disposable CI passed all
11 current-factor cases, the interruption probe, 509 SQL/RLS assertions, retained
gates, database lint and teardown, but rejected the provisional generated types.
The candidate type layout was normalized, and CI now checks migration types before
the expensive runtime matrix, printing only a source-schema diff on mismatch and
still failing. The existing post-runtime type check remains. Subsequent exact-head
type/aggregate evidence belongs to [PR #167](https://github.com/killroyZULU/FlyEye/pull/167).
No local database or occupied service was changed.

[PR #167](https://github.com/killroyZULU/FlyEye/pull/167) merged as `a8038e9`;
[post-merge CI](https://github.com/killroyZULU/FlyEye/actions/runs/38685230085) passed
all gates and cleanup, completing the frozen local R3 package. These cases do not establish global H002
closure, hosted behavior, recovery capability, global session policy or production
readiness. Historical failures retain their existing unknowns in
[the audit inventory](https://github.com/killroyZULU/FlyEye/issues/39).
