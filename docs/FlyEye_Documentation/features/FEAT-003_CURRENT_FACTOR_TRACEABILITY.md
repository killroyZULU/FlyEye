# FEAT-003 Traceability

This focused record keeps the [current-factor contract](FEAT-003_CURRENT_FACTOR_SESSIONS.md)
and its evidence reviewable without exceeding the parent traceability budget.
[SEC-026/#165](https://github.com/killroyZULU/FlyEye/issues/165) owns delivery coordination.

## Evidence map

| Concern                             | Executable evidence                                                                                                                                                                                                                                                            | Result / boundary                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| START/COMPLETE session gate         | [Handler suite](../../../supabase/functions/organization-admin-onboarding/handler.test.ts), `SEC-026 current-factor session boundary`                                                                                                                                          | On base `1d9468d`, two added mocked-handler regressions returned 200 instead of 403. This demonstrates the missing gate locally, not provider behavior. Corrected focused handler/bootstrap suites: 130 tests passed.                                              |
| Immutable provenance and privileges | [Migration](../../../supabase/migrations/20261015023902_sec_026_admin_session_factor_binding.sql); [rollback-only SQL](../../../supabase/tests/sec_026_admin_session_factor_test.sql)                                                                                          | Runtime execution pending; unknown history, ownership, inventory, AAL/AMR, immutability, RLS/grants, cascades and capture rollback assertions present.                                                                                                             |
| Sole verified replacement           | [Provider cases](../../../scripts/lib/onboarding-current-factor-cases.mjs), `runCurrentFactorCases`; [state/audit assertions](../../../scripts/lib/onboarding-current-factor-evidence.mjs)                                                                                     | Execution pending; original/refresh/rechallenge/AAL1/replay, fresh recovery, organization/grant waits and committed-admin preservation.                                                                                                                            |
| Binding lock order                  | [Observed schedules](../../../scripts/lib/onboarding-current-factor-locks.mjs), `bindingActor`                                                                                                                                                                                 | Execution pending; concurrent first verification/validation and rollback-only session/user deletion.                                                                                                                                                               |
| Obsolete browser result             | [Browser journey](../../../scripts/lib/onboarding-current-factor-browser.mjs), `onboardingCurrentFactorBrowser`                                                                                                                                                                | Execution pending; unchanged real verification response delayed until replacement, denied completion, cancellation and fresh recovery.                                                                                                                             |
| Assertion integrity                 | [Mutation tests](../../../scripts/lib/onboarding-current-factor-evidence.test.mjs), `current-factor denial evidence`                                                                                                                                                           | 18 local tests passed; reject quota/outage, changed authority, wrong attribution and missing/extra audit.                                                                                                                                                          |
| Owned cleanup and retained gates    | [Runner](../../../scripts/test-feat-003-runtime.mjs), `--current-factor` / `--current-factor-cleanup-probe`; [shared evidence](../../../scripts/lib/onboarding-provider-evidence.mjs), `assertClean`; [runner tests](../../../scripts/lib/runtime-matrix-diagnostics.test.mjs) | Execution pending; binding residue/foreign preservation added. CI retains all prior modes and cleanup-gated restarts. Security-job allowance rises from 40 to 50 minutes for the added TOTP windows/schedules; the prior exact-merge matrix took about 31 minutes. |

## Delivery verification

Separate design review required unknown historical provenance and both AAL1 timing
cases. Migration review found separate inventory reads could mix snapshots; the
correction uses one aggregate statement per inventory classification. Fixture review
required success markers after assertions/cleanup and real unenrollment plus provider
AAL1-session pruning evidence; the binding case now includes those assertions.
Local `verify:app` passed (1,594 tests, 26 browser scenarios); the post-review focused
fixture/diagnostic recheck passed 135 tests. Separate review confirmed both fixture
findings corrected with no remaining actionable finding. Provider/SQL execution and
generated-type comparison were not run locally; their delivery evidence belongs to
the exact-head CI linked from #165's pull request. The type addition requires that
generated comparison. No local database or occupied service was changed.

R3 closure and merge remain pending. These cases do not establish global H002
closure, hosted behavior, recovery capability, global session policy or production
readiness. Historical failures retain their existing unknowns in
[the audit inventory](https://github.com/killroyZULU/FlyEye/issues/39).
