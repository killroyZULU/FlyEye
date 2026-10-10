# FEAT-006 Traceability

## Evidence boundary

- Reviewed target: Slice B merge `65d11aa`
- Slice A target: Issue #24; merged through PR #25 at `835b9dc`
- Slice B target: Issue #26; independent technical review clear; PR #27 merged at `65d11aa` after required CI passed
- Verification date: 2026-08-14
- Local/hosted/data boundary: Local synthetic verification only
- Pull requests and CI: Slice A PR #25 and Slice B PR #27 merged after their required CI passed
- Known limitations: No hosted validation, real-data authority, factor
  recovery/replacement, formal accessibility review, qualified aviation role
  matrix, deployment, or production approval

This record separates the two sequential delivery slices. Local results do not
establish hosted, production, qualified aviation, or customer readiness.

## Slice A requirements and results

| Requirement/AC ID                                  | Design or control                                                                                                                       | Test/evidence ID                                                                   | Result                 | Limitation or later gate                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `IAM-002/003/010`, `FEAT-006A-AC-01/07`            | Server-derived sole active membership; self-only protected flow; no client school selector                                              | `FEAT-006A-EDGE-01`, `TENANT-01`                                                   | Local pass             | Hosted validation remains later                                                                         |
| `IAM-005/006`, `FEAT-006A-AC-01/04`                | Recent password start/completion; verified TOTP and AAL2 completion                                                                     | `FEAT-006A-EDGE-01`; positive local `AUTH-01`; mocked existing-factor/resume cases | Layered local pass     | Existing-factor and interrupted-operation hosted runtime evidence remains later                         |
| `IAM-007`, `REC-001/002/003`, `FEAT-006A-AC-05/07` | Start intent plus atomic readiness/operation/completion audit; no authority on failure                                                  | `FEAT-006A-SQL-01`, `EDGE-01`, `SEC-01`                                            | Local pass             | Hosted alert routing and retention remain later                                                         |
| `IAM-008/009`, `FEAT-006A-AC-05/07`                | Deny-by-default operation/readiness tables; service-role-only functions                                                                 | `FEAT-006A-SQL-01`, `TENANT-01`, `SEC-01`                                          | Local pass             | No hosted RLS evidence                                                                                  |
| `FEAT-006A-AC-02/03/06`                            | Strict one-factor inventory, memory-only secrets, unbound cancellation, and bound-operation resume without automatic factor deletion    | `FEAT-006A-UNIT-01`, `FEAT-006A-COMP-01`; positive local `AUTH-01`                 | Layered local pass     | Provider failure/reconciliation cases are mocked; factor removal and replacement are excluded           |
| `NFR-004`, `FEAT-006A-AC-08`                       | Keyboard/focus/announcement and QR/manual component behavior; already-ready and privileged missing-factor entry at desktop/mobile sizes | `FEAT-006A-COMP-01`; bounded `E2E-01`                                              | Partial local evidence | Full provider-backed enrollment browser flow, 200% reflow, and formal accessibility review remain later |
| `NFR-008/010`, `FEAT-006A-AC-09/10`                | Secret-safe app/database/runtime matrices and unconditional fixture cleanup                                                             | `FEAT-006A-REG-01`, PR #25 CI                                                      | Pass on merged Slice A | Hosted evidence remains later                                                                           |

## Slice B requirements and results

| Requirement/AC ID                                  | Design or control                                                                                                                                  | Test/evidence ID                                                                 | Result                                                         | Limitation or later gate                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `IAM-002/003/008/010`, `FEAT-006B-AC-01/06`        | Server-derived actor/target, same-school protected command, self denial                                                                            | Handler tests; 40 SQL assertions; local Auth/Edge runtime                        | Local pass                                                     | Hosted validation remains later                               |
| `IAM-005/006`, `FEAT-006B-AC-01/03`                | Actor AAL2/recent password and live target factor/readiness match                                                                                  | Handler negatives; local target-TOTP runtime                                     | Local pass                                                     | Recovery/replacement and hosted evidence remain later         |
| `IAM-007`, `REC-001/002/003`, `FEAT-006B-AC-05/06` | Atomic minimized role audit and fail-closed mutation                                                                                               | SQL/RPC assertions; runtime audit and replay checks                              | Local pass                                                     | Hosted alert routing and retention remain later               |
| `IAM-011`, `FEAT-006B-AC-02/03/07`                 | Three explicit portal roles with centralized labels, assurance, and workspace permissions; no operational or aviation authority                    | SQL metadata/grant assertions; access-context tests                              | Local pass                                                     | Additional roles and qualified permission matrix remain later |
| `IAM-012`, `FEAT-006B-AC-04`                       | Shared deterministic admin locks and last-active-admin rule                                                                                        | SQL negatives; concurrent live role/status runtime                               | Local pass                                                     | Hosted concurrency evidence remains later                     |
| `NFR-004`, `FEAT-006B-AC-08`                       | Responsive keyboard/focus role confirmation, offline, reauthentication, MFA, conflict, last-admin, rate-limit, service-failure, and success states | Component tests; 20 desktop/mobile E2E scenarios                                 | Local supporting pass                                          | 200% reflow and formal accessibility review remain later      |
| `NFR-008/010`, `FEAT-006B-AC-08`                   | Complete quality/security matrices with generated types and cleanup                                                                                | 253 app tests; 326 SQL tests; seven runtime fixtures; schema lint and type drift | Local pass; independent review clear; PR #27 required CI green | Hosted evidence remains later                                 |

## Member-MFA limiter concurrency evidence

[SEC-012 / #136](https://github.com/killroyZULU/FlyEye/issues/136) owns execution
targets and results for the [limiter investigation](FEAT-006_ROLE_ASSIGNMENT.md#member-mfa-limiter-concurrency-investigation).
The [runner](../../../scripts/test-member-mfa-limiter.mjs), `contention`, observes
older workers blocked by a newer bucket owner. `forwardRefill`, `isolation`,
`eventFailure` and `timeout` cover retained controls, atomic failure and safe
recovery. The [fixture](../../../scripts/lib/member-mfa-limiter-fixture.mjs),
`assertRecords`, compares full responses, buckets and events. Normal and
injected-observer-failure paths require owned rows/sessions absent and unchanged
roles/permissions. Source inspection is not execution evidence; baseline failures,
unreached cases and corrected results remain distinct in #136.
[Baseline CI](https://github.com/killroyZULU/FlyEye/actions/runs/37782571059) at
`fc6c7bf` reproduced eight older `complete` waiters failing with SQLSTATE `23514`
after a newer owner exhausted the inserted bucket. Owner-only state/event,
normal/interrupted cleanup and teardown were verified; twenty other cases were
not reached. The [correction](../../../supabase/migrations/20261008131836_sec_012_member_mfa_limiter_monotonic_time.sql)
clamps effective time after the locked read without changing transaction-time
events or thresholds. Corrected execution results belong to #136. Existing MFA
authorization, provider and cross-school evidence retains its original scope.

## Member-MFA cancellation concurrency evidence

[SEC-018 / #150](https://github.com/killroyZULU/FlyEye/issues/150) owns execution
and review of the [selected cancellation matrix](FEAT-006_ROLE_ASSIGNMENT.md#member-mfa-cancellation-concurrency-investigation)
against baseline `e1eb237`. The [case manifest](../../../scripts/lib/h002-mfa-cancel-cases.mjs),
`cases`, contains sixteen cases; `race` observes the operation-lock owner through
the [runner](../../../scripts/test-h002-mfa-cancel.mjs), `observe`.
[Assertions](../../../scripts/lib/h002-mfa-cancel-assertions.mjs), `transition`,
`unchanged` and `replay`, compare exact state and audit identity. The runner's
normal and interrupted paths require cleanup after all owned sessions settle.
Source inspection is not execution evidence; #150 records passed, failed and
unreached cases and the exact final-head CI target.

Existing [handler tests](../../../supabase/functions/member-mfa/handler.test.ts),
`denies cancellation before mutation when preflight %s differs` and
`retains a bound factor and operation for safe resume instead of deleting it`,
cover the distinct Edge boundary with mocked dependencies. The
[SQL suite](../../../supabase/tests/feat_006a_member_totp_enrollment_test.sql)
retains completion-audit rollback, browser grants and tenant negatives. These
results do not prove provider factor lifecycle or full browser enrollment; the
Slice A limitations above remain open. No production behavior correction is
claimed from inspection or planned cases.

## Runtime fixture maintenance

[Issue #42](https://github.com/killroyZULU/FlyEye/issues/42) recorded the
`FEAT-006A-AC-09/10` cleanup correction after [PR #41 post-merge CI](https://github.com/killroyZULU/FlyEye/actions/runs/35732201053)
passed persistence assertions but failed cleanup. The original log does not
identify the failing cleanup substep.

Review identified worker-readiness and shutdown weaknesses: a shared OPTIONS
response could come from a worker using a different limiter secret, and killing
the Node CLI wrapper did not establish process-tree termination. The correction
uses a fresh exact origin and the handler's side-effect-free GET rejection,
verifies the limiter identity before the lost-response
probe, awaits bounded shutdown, and reports allowlisted cleanup substeps. Auth
deletion is verified directly in the local database; provider errors cannot count
as proof of absence. Existing keyed-row, lost-response and baseline assertions
remain mandatory.

The independently reviewed correction was delivered by [PR #43](https://github.com/killroyZULU/FlyEye/pull/43),
head `ba70b9b`, merged at `813dbd9` on 2026-09-23. [Post-merge CI](https://github.com/killroyZULU/FlyEye/actions/runs/35843256944)
passed application, disposable database/runtime, and required quality gates.
The occupied local database was excluded from runtime execution. This evidence
verifies the correction; it does not identify the original failing cleanup substep.

## Password-session read boundary

[FIX-009 / #64](https://github.com/killroyZULU/FlyEye/issues/64) corrects the
[own-readiness authentication contract](FEAT-006_ROLE_ASSIGNMENT.md#roles-and-authority).
The [handler suite](../../../supabase/functions/member-mfa/handler.test.ts),
`FEAT-006A member MFA handler`, reproduced non-password status access before the
fix. Focused regressions pass for method-only denials before factor/status access,
older password acceptance, and denial-audit failure. The existing sign-in-again
response remains compatible with the client; the audit reason distinguishes
missing password evidence from mutation freshness failure. Cancellation and
mutation policy are unchanged.

The [runtime fixture](../../../scripts/test-feat-006-runtime.mjs),
`password-session-denial` stage, adds a real local Auth recovery-session denial
and persisted audit assertion before the existing password-positive workflow.
This new runtime evidence requires disposable CI execution; it has not been run
against the occupied local database. Publication and CI results belong to #64's
linked PR. These checks do not establish global session expiry or revocation.

## Member MFA gateway extraction evidence

[A002 / #82](https://github.com/killroyZULU/FlyEye/issues/82) isolates the existing [Slice A workflow](FEAT-006_ROLE_ASSIGNMENT.md#slice-a-workflow-and-rules). The `Member MFA facade commands` and `Member MFA preparation and binding compatibility` suites in [member-mfa-gateway.test.ts](../../../src/features/auth/services/member-mfa-gateway.test.ts) cover payload/version/replay propagation, schemas, error guidance, provider order, initial/resumed challenges, invalid-enrollment cleanup, same-operation binding reconciliation, error causes and cancellation.

All 148 focused cases passed on baseline `6a844b4` and after extraction, including the existing [gateway suites](../../../src/features/auth/services/auth-gateway.test.ts) and `Shared onboarding authenticator compatibility` in [administrator tests](../../../src/features/auth/services/admin-onboarding-gateway.test.ts). Synthetic provider mocks establish compatibility, not hosted behavior. Final application checks, separate review and disposable runtime/cleanup evidence belong to the linked delivery issue/PR.

## Member MFA backend extraction evidence

[A003 / #108](https://github.com/killroyZULU/FlyEye/issues/108) records the extraction target, separate review and final application/CI results under the unchanged [Slice A workflow](FEAT-006_ROLE_ASSIGNMENT.md#slice-a-workflow-and-rules). The `member MFA handler compatibility` suite in [handler tests](../../../supabase/functions/member-mfa/handler.test.ts) covers exact action inputs and order, hash-only factor references, readiness/resume states, limiter metadata, provider/audit failures, complete-time freshness and assurance, cancellation preflight binding, retained-factor behavior, replay propagation and strict status responses.

The handler/authentication-evidence/gateway group passed 122 cases on baseline `72c126c` before extraction and afterward. The [handler](../../../supabase/functions/member-mfa/handler.ts) delegates contracts, guards, factor conflict handling, enrollment and cancellation; its legacy size/complexity exemptions were removed. Production wiring, SQL/RLS, responses and frontend contracts are unchanged. Synthetic mocks establish compatibility; [SQL/RLS tests](../../../supabase/tests/feat_006a_member_totp_enrollment_test.sql) and the [runtime fixture](../../../scripts/test-feat-006-runtime.mjs) supply separate authority, isolation, atomic audit and cleanup evidence through disposable CI. The occupied local database remains excluded.

## Member MFA UI extraction evidence

[A003 / #92](https://github.com/killroyZULU/FlyEye/issues/92) separates the enrollment workflow and credential lifecycle from status and verification rendering under the unchanged [Slice A contract](FEAT-006_ROLE_ASSIGNMENT.md#slice-a-workflow-and-rules).

The `FEAT-006A member TOTP enrollment UI` suite in [component tests](../../../src/features/auth/components/MemberMfaEnrollmentFlow.test.tsx) covers code validation/refocus, password reauthentication, bound resume/cancellation, version and completion-key reuse, secret removal before pending completion, safe error messages and late responses after unmount. All 87 focused UI, gateway and application-integration cases passed against baseline `57a48e1` before extraction; the same cases plus ten maintainability/configuration checks passed afterward. The [workflow hook](../../../src/features/auth/components/useMemberMfaEnrollment.ts) and extracted panels pass normal maintainability limits without the former component exemptions.

These synthetic mocks establish compatibility, not hosted provider behavior. Final application checks, separate review and disposable runtime/cleanup results belong to #92's linked PR; the occupied local database remains excluded.

## Slice B runtime diagnostic and cleanup evidence

[FIX-012 / #88](https://github.com/killroyZULU/FlyEye/issues/88) addresses the missing diagnostic and cleanup evidence in [PR #87 post-merge CI](https://github.com/killroyZULU/FlyEye/actions/runs/37089121604), targeting `FEAT-006B-REG-01` and `FEAT-006B-AC-08` in the [Slice B contract](FEAT-006_ROLE_ASSIGNMENT.md#slice-b-workflow-and-rules). That run does not identify the original failure cause.

The [runtime fixture](../../../scripts/test-feat-006b-runtime.mjs) retains its role-assignment, forged-school, replay, audit and last-admin assertions. The `role assignment fixture cleanup` and `role assignment fixture completion` suites in [fixture tests](../../../scripts/lib/role-assignment-runtime-fixture.test.mjs) pass synthetic failure injections for cleanup continuation, exact-run scopes, residue rejection and success only after verified cleanup. The `runtime matrix FEAT-006B diagnostics integration` suite in [runner tests](../../../scripts/lib/runtime-matrix-diagnostics.test.mjs) verifies capture and filtering on both successful and failed child exits. Worker readiness and shutdown reuse the [tested lifecycle helper](../../../scripts/lib/local-edge-lifecycle.test.mjs).

These unit results do not establish database cleanup. Disposable CI must supply SQL/RLS, all runtime cleanup, lint/types and teardown evidence; delivery results belong to #88's linked PR. The occupied local database remains excluded, and a later passing run cannot establish the historical failure cause.

## Evidence rules

- Do not mark `Pass` without reproducible evidence for the reviewed slice target.
- Record detailed output once; later unchanged reports link to it.
- Keep Slice A and Slice B implementation, review, PR, and CI evidence distinct.
- Separate local synthetic, hosted synthetic, real-data, deployment, and
  production evidence.
- Agent review is technical evidence, not qualified independent human review or
  risk acceptance.
- Update this record when a requirement, implementation, test, source, reviewed
  target, or limitation changes.
