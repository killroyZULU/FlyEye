# FEAT-008 Traceability

## Historical evidence boundary

- Reviewed target: implementation commit `9220091` on `feat/FEAT-008-authenticated-dashboard-shell`; separate agent review clear
- Verification dates: local synthetic 2026-08-31; CI 2026-09-01
- Local/hosted/data boundary: local synthetic only
- Pull request and CI: PR #34 linked to Issue #33; run #33376126906 passed Application quality, Local Supabase security, and Required quality gate
- Known limitations: no operational dashboard metrics or formal human accessibility study

The following counts and results apply to this original dashboard target.
Combined aircraft integration evidence is recorded separately below.

## Requirements and results

| Requirement/AC ID   | Design or control                                      | Test/evidence ID                                                                                                                                       | Result | Limitation or later gate                         |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------ |
| `FEAT-008-AC-01/02` | Separate authenticated shell and role dashboard labels | `FEAT-008-UNIT-01`, `FEAT-008-COMP-01`; real Student browser walkthrough                                                                               | Pass   | Product Owner visual acceptance remains          |
| `FEAT-008-AC-03/05` | Persistent semantic primary navigation                 | `FEAT-008-COMP-03`; Profile browser navigation                                                                                                         | Pass   | Browser history/deep links are not introduced    |
| `FEAT-008-AC-04`    | Existing module and permission filtering               | `FEAT-008-COMP-02`, including unavailable Aircraft                                                                                                     | Pass   | Navigation is not authorization                  |
| `FEAT-008-AC-06`    | Responsive header/navigation/content shell             | `FEAT-008-E2E-01`; 20 desktop/mobile scenarios and overflow assertion                                                                                  | Pass   | Formal accessibility review remains              |
| `FEAT-008-AC-07`    | Existing operation invalidation and shell teardown     | `FEAT-008-COMP-04`; sign-out, revocation, disposal, and MFA-race checks                                                                                | Pass   | Hosted session behavior remains later validation |
| `FEAT-008-AC-08`    | Focused and full regression matrix                     | `FEAT-008-REG-01`; 27 files, 270 tests, coverage and build/secret/audit gates; 326 SQL assertions, 7 runtime fixtures, database lint/type-drift checks | Pass   | Local synthetic evidence only                    |

## Reconciliation verification

[PR #34](https://github.com/killroyZULU/FlyEye/pull/34) reconciled the dashboard
with maintenance from `main` at `813dbd9`, retaining the MFA runtime
readiness, cleanup and diagnostic controls. A008 was reproduced in
`AuthApp.test.tsx`: a late assurance rejection replaced both the signed-out
screen and a newer granted session with an error. The correction discards the
obsolete rejection using the existing operation guard; it changes no authority
or permission rule. These regressions extend `FEAT-008-AC-07` evidence. The
occupied local database was excluded from reconciliation runtime execution.

Aircraft integration places the existing registry and document panels inside
the persistent shell. Navigation retains module availability and server-approved
permission checks, including Student status-only document access. Module access
revocation still clears membership and revalidates access. Component navigation
cases and desktop/mobile aircraft browser scenarios cover this composition.

Final PR head `ab984c6` passed [CI run 35856873127](https://github.com/killroyZULU/FlyEye/actions/runs/35856873127).
PR #34 merged at `3c96fec` on 2026-09-23; [post-merge run 35861588094](https://github.com/killroyZULU/FlyEye/actions/runs/35861588094)
also passed Application quality, Local Supabase security, and Required quality
gate. These runs cover the combined application and disposable database/runtime
verification; the original counts above remain historical. Live delivery status
belongs in [Current State](../CURRENT_STATE.md).

## Authentication application extraction evidence

[A003 / #100](https://github.com/killroyZULU/FlyEye/issues/100) records the extraction target, separate review and final CI evidence. The `AuthApp orchestration compatibility` and `FEAT-001 authentication UI` suites in [AuthApp tests](../../../src/features/auth/AuthApp.test.tsx), with [shell tests](../../../src/features/auth/components/AuthenticatedShell.test.tsx) and [dashboard tests](../../../src/features/auth/components/WorkspaceDashboard.test.tsx), cover the [authentication boundary](FEAT-008_AUTHENTICATED_DASHBOARD_SHELL.md#authentication-boundary) and [access workflow](FEAT-001_LOGIN_AND_RBAC.md#workflow-and-state-transitions).

Nineteen compatibility cases were added before extraction. The three-file group passed 44 tests on baseline `bc9b190`, covering route isolation, pending restoration, safe failure/retry, grant-discovery outcomes, membership permission/assurance decisions, obsolete restoration/onboarding results, navigation and sign-out. Existing MFA-race, revocation and disposal cases remain. The extracted target is verified through the linked delivery record, including normal maintainability limits and the unchanged two private member-panel import exceptions; exporting those panels through the existing members entry would introduce an auth-contract cycle.

Synthetic component responses establish frontend compatibility, not server authority, complete session-race coverage or formal accessibility acceptance. Existing disposable CI supplies separate SQL/RLS, runtime and cleanup evidence; the occupied local database remains preserved.

## Deferred screen delivery evidence

[A011 / #112](https://github.com/killroyZULU/FlyEye/issues/112) owns the [deferred delivery contract](FEAT-008_AUTHENTICATED_DASHBOARD_SHELL.md#deferred-screen-delivery), separate review and final CI evidence. On baseline `c3af0c8`, initial JavaScript was 625.64 kB / 164.46 kB gzip in one file. The split measures 541.67 kB / 148.26 kB gzip across the entry and its static shared dependency; the largest chunk is 466.84 kB. Both measurements use the same local Vite configuration and Node gzip defaults, excluding CSS. All 12 JavaScript chunks fit the unchanged Vite warning limit. Byte budgets are enforced by [check-bundle](../../../scripts/check-bundle.mjs); the `production bundle budget` suite in [budget tests](../../../scripts/lib/bundle-budget.test.mjs) covers transitive/deduplicated totals, oversized deferred chunks and missing dependencies.

The existing 44-case AuthApp/shell/dashboard group passes after splitting. The `deferred screen boundary` suite in [boundary tests](../../../src/features/auth/components/DeferredScreen.test.tsx) covers loading/exit, safe failure, keyed recovery and disposal. [Production browser checks](../../../scripts/lib/deferred-screen-browser.mjs), invoked by [run-e2e](../../../scripts/run-e2e.mjs), exercise actual network deferral, sign-out during workspace loading, navigation/session-ended notification during module loading, explicit reload recovery, and eager recovery-credential scrubbing. The existing desktop/mobile scenarios now run against an isolated synthetic production build; its preview process and temporary output are cleaned up.

These checks support [FEAT-008-AC-03/04/05/06/07/08](FEAT-008_AUTHENTICATED_DASHBOARD_SHELL.md#acceptance-criteria) under synthetic responses. They do not establish hosted session-revocation latency, connectivity performance, formal accessibility, deployment or production approval. Gateway initialization, protected commands and database contracts are unchanged; disposable CI supplies separate integration evidence and the occupied local database is preserved.

## Evidence rules

- Results apply only to the reviewed commit and recorded local/CI target.
- Agent review is technical evidence, not qualified accessibility, aviation, customer, or production approval.
