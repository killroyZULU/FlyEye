# FEAT-007 Traceability

## H002 registry lock-wait evidence

[SEC-001 / #114](https://github.com/killroyZULU/FlyEye/issues/114) and
[PR #115](https://github.com/killroyZULU/FlyEye/pull/115) own the bounded
[lock-wait contract](FEAT-007_AIRCRAFT_REGISTRY_FOUNDATION.md#h002-lock-wait-investigation).
The probe at
[`e88c63a`](https://github.com/killroyZULU/FlyEye/blob/e88c63a35ab83dad33a50ba48a12ac3702fced8b/scripts/test-h002-locks.mjs)
passed the `Verify H002 SQL lock interleaving` step in
[disposable CI 37389648588](https://github.com/killroyZULU/FlyEye/actions/runs/37389648588).
Both probes observed blocking backends and committed protected revocation before release. Create
and update still returned success, persisted versions 1 and 2 respectively,
and wrote one success audit each. Fixture organization, users and worker
sessions were absent after cleanup. This confirms only these registry paths at `2a574d4`.

The [correction](../../../supabase/migrations/20261005234138_sec_001_registry_lock_revalidation.sql)
rechecks the same permission after each explicit wait. The
[regression matrix](../../../scripts/test-h002-locks.mjs), function `race`, covers
24 observed interleavings: membership revocation, protected role demotion and
retained-authority controls; create and exact replay at the advisory lock;
update/archive/reactivate at advisory and row locks. Denials compare complete
record, success-audit and idempotency snapshots; successful controls require
the expected version, one audit and one idempotency row. Worker calls use
`service_role` and assert Read Committed isolation; no new browser grant or
function signature is introduced.
Execution results for the correction belong to the final-head CI linked in
the PR; baseline characterization is not a regression pass.

[CI 37390937577](https://github.com/killroyZULU/FlyEye/actions/runs/37390937577)
at `057e24c` failed before the first concurrency result: the fixture snapshot
ordered idempotency rows by a nonexistent `id`, then cleanup reused the failed
observer. Fixture cleanup was unverified despite successful Supabase teardown.
The recovery orders by the actual composite key, reports only fixed phases and
allowlisted SQLSTATEs, and uses a fresh cleanup session after draining originals.
The `--cleanup-probe` execution deliberately raises SQLSTATE `22012` while a
worker is blocked, then requires all scoped rows/users and original sessions to
be absent. CI runs it before the normal matrix. The
[session-helper suite](../../../scripts/lib/h002-postgres-session.test.mjs),
`H002 SQL session diagnostics and recovery`, covers split error output,
redaction, closed/input-failed sessions and replacement connections.

Existing [registry SQL tests](../../../supabase/tests/feat_007a_aircraft_registry_test.sql)
retain the exact assertions `A cross-school forged-organization mutation is denied`,
`An exact replay creates no duplicate audit event`, and the
`feat007_reject_audit` trigger block proving mutation rollback on audit failure.
[Handler tests](../../../supabase/functions/aircraft-registry/handler.test.ts)
cover late `unauthorized` decisions and failure of required denial auditing.

### SQL inspection boundary

[SEC-003 / #118](https://github.com/killroyZULU/FlyEye/issues/118) and
[draft PR #119](https://github.com/killroyZULU/FlyEye/pull/119) extend the
[contract](FEAT-007_AIRCRAFT_REGISTRY_FOUNDATION.md#h002-lock-wait-investigation).
Inspection at `f02005b` identified 84 public functions, 29 with explicit locks.

[Characterization CI 37452816504](https://github.com/killroyZULU/FlyEye/actions/runs/37452816504)
at `101da6c` completed 183 interleavings under Read Committed: 91 stale
successes, 19 post-revocation denials, 10 commands serialized before revocation,
and 63 retained-authority controls. The
[case inventory](../../../scripts/lib/h002-review-cases.mjs), `cases`, and
[runner](../../../scripts/test-h002-review.mjs), `race`, observe exact blocking
backends and commit protected membership revocation or role demotion before
releasing the blocker; serialized cases verify the revoker itself is blocked.
Service_role lacks direct membership SELECT.

| Functions                                                                | Observed waits and result at baseline                                                                                                       | Correction boundary                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `mutate_aircraft_record`                                                 | Existing 24 regression interleavings passed                                                                                                 | PR #115 correction retained                                                         |
| `mutate_aircraft_document`                                               | Create/renew/correct/suspend/restore advisory and applicable aircraft/category/document/version/file/notification waits: 56 stale successes | Recheck explicit waits and final authority; roll back earlier writes on late denial |
| `mutate_aircraft_document_category`                                      | Create/rename/archive/assign/remove category advisory and applicable category/aircraft/requirement/notification waits: 30 stale successes   | Same bounded revalidation and rollback                                              |
| `complete_aircraft_document_file`, `open_aircraft_document_notification` | File and recipient-notification rows: four stale successes                                                                                  | Recheck after target lock                                                           |
| `update_my_member_profile`                                               | Profile-row wait: one stale membership success                                                                                              | Fresh active-context check; preserve concealed not_found                            |
| `change_organization_member_status`, `change_organization_member_role`   | Four administrator-lock denials; four late-target cases serialized before revocation                                                        | No SQL change                                                                       |
| List/begin/resend/revoke/finalize invitation                             | Ten organization-lock denials; six later invitation-row cases serialized before revocation                                                  | No SQL change                                                                       |
| Start/bind/complete MFA                                                  | Five context/operation-lock denials after membership revocation                                                                             | No SQL change                                                                       |

The [migration](../../../supabase/migrations/20261006110323_sec_003_remaining_h002_revalidation.sql)
changes only the five reproduced functions. Document/category late denials raise
and catch a private SQLSTATE within the existing exception block, rolling back
aggregate, history, notification, audit and idempotency writes. Signatures,
grants, RLS, permission predicates and audit failure behavior remain unchanged.
The regression matrix adds two exact-replay cases, totaling 189 interleavings.
Denials compare domain/audit snapshots; controls use [exact assertions](../../../scripts/lib/h002-review-assertions.mjs),
`assertReviewSuccess`. Final execution results belong to PR #119's current-head CI;
characterization success is not a correction pass.

[CI 37451488561](https://github.com/killroyZULU/FlyEye/actions/runs/37451488561)
at `2916fdc` stopped with SQLSTATE 42501 before any new authorization outcome:
the revoker's argument subquery read a table unavailable to service_role. Using
observer-prepared fixture versions corrected setup without granting table access.
Both runs passed registry regressions and H002 cleanup, including observer failure. Run 37452816504
later failed FEAT-003; its historical cleanup remains unverified under the
[separate recovery evidence](FEAT-003_TRACEABILITY.md#runtime-cleanup-recovery).

Negative evidence covers only observed schedules. Onboarding, invitation acceptance, cancellation cleanup and
six quota-locking limiter functions have distinct contracts; inspection does not
prove concurrent safety. Unprobed category-assignment archived-document locks,
invitation role/competing-invitation locks, implicit DML, foreign-key, uniqueness,
trigger/audit waits, global permission changes and session expiry remain open in
[audit #39](https://github.com/killroyZULU/FlyEye/issues/39). Local Docker was unavailable; databases were preserved.

## Bounded request-body transport

[FIX-010 / #66](https://github.com/killroyZULU/FlyEye/issues/66) records delivery
disposition for the [shared transport contract](../06_API_SPECIFICATION.md#bounded-request-body-transport).
The aircraft-document regression fails against `6898682`: absent or understated
Content-Length allows the previous reader to consume the tail after overflow.
The corrected reader passes the focused suite, stops at the excess chunk,
cancels the stream and releases its lock.

- [Shared reader tests](../../../supabase/functions/_shared/request-body.test.ts),
  suite `bounded request-body reader`: exact byte boundary, split UTF-8,
  absent/understated/invalid length hints, oversize chunks, decoder modes,
  source failure, and rejected/non-settling cancellation.
- Suite `streaming request-body contract` in
  [auth bootstrap](../../../supabase/functions/auth-bootstrap/handler.test.ts),
  [admin onboarding](../../../supabase/functions/organization-admin-onboarding/handler.test.ts),
  [invitations](../../../supabase/functions/member-invitations/handler.test.ts),
  [member administration](../../../supabase/functions/member-administration/handler.test.ts),
  [member MFA](../../../supabase/functions/member-mfa/handler.test.ts),
  [aircraft registry](../../../supabase/functions/aircraft-registry/handler.test.ts),
  and [aircraft documents](../../../supabase/functions/aircraft-documents/handler.test.ts):
  exact endpoint limits reach authentication; overflow preserves error contracts
  and calls no protected dependency.
- [Aircraft-document transport](../../../supabase/functions/aircraft-documents/transport.test.ts)
  and [registry transport](../../../supabase/functions/aircraft-registry/transport.test.ts),
  suites `aircraft-document body transport compatibility` and
  `aircraft-registry body transport compatibility`: replacement decoding and
  declared-size fast rejection remain unchanged. The five authentication/member
  handler suites also verify strict UTF-8 rejection before authentication.

Evidence uses synthetic Web Streams and existing handler doubles. Provider,
SQL/RLS and runtime evidence comes from the complete disposable CI gate linked
by #66; the occupied local database is preserved. Request deadlines, hosted
capacity and operational authority are outside this correction.

## Slice A historical evidence boundary

- Delivery target: Issue #31 on `feat/FEAT-007A-aircraft-registry`; PR #32
- Verification date: 2026-08-31
- Local/hosted/data boundary: Local synthetic verification only
- Review and CI: Final implementation and diagnostic-remediation technical
  re-reviews clear; all required pull-request checks passed for reviewed head
  `ef61821` after four intermittent FEAT-006 fixture failures
- Known limitations: No hosted validation, real-data authority, formal
  accessibility review, qualified aviation workflow review, retention decision,
  deployment, or production approval

The following counts and results apply to the recorded Slice A baseline;
integration and Slice B evidence are recorded separately below. Neither slice establishes airworthiness, operational availability,
compliance, registration validity, ownership, or dispatch authority.

## Requirements and results

| Requirement/AC ID        | Design or control                                                                                                                   | Test/evidence ID                                                                                           | Result                                              | Limitation or later gate                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `CMP-001`, `AC-01/02/09` | Server-derived sole-school context; Admin-only read/manage permissions; AAL2/TOTP; protected Edge/RPC boundary; no browser grants   | `FEAT-007A-EDGE-01`, `SQL-01`, `TENANT-01`, local Auth/Edge runtime                                        | Local app, SQL, and runtime pass                    | Hosted and qualified workflow validation remain later    |
| `AC-03/04/05`            | Three-field identity aggregate; complete pinned Unicode 15.1 C/F map; partial unique Tracked key                                    | `FEAT-007A-UNIT-01`, `SQL-01`, live concurrent-create runtime                                              | Local app, SQL, and runtime pass                    | No regulatory registration-format claim is made          |
| `AC-06/07/08`            | Versioned reversible lifecycle, retained uncertain-retry keys, row locking, and atomic mutation audit                               | `FEAT-007A-RPC-01`, `RACE-01`, `SEC-01`, runtime replay/conflict/audit checks                              | Local app, SQL, and runtime pass                    | Retention and permanent deletion remain excluded         |
| `AC-09/11`               | Deny-by-default tables; same-school functions; strict schemas, late-denial audit, and safe errors; no operational fields or actions | `FEAT-007A-SQL-01`, `EDGE-01`, `TENANT-01`, source/diff review                                             | Local app, SQL, and runtime pass                    | No qualified aviation or production approval             |
| `NFR-004`, `AC-10/14`    | Structured responsive rows, semantic forms, focus-managed confirmation, conflict preservation, in-memory-only offline display       | `FEAT-007A-COMP-01`; 22 desktop/mobile `E2E-01` scenarios                                                  | Local supporting pass                               | Formal accessibility and 200% reflow review remain later |
| `AC-12`                  | Rollback-only SQL plus unconditional runtime teardown with exact zero-residue assertions                                            | `FEAT-007A-SQL-01`, `REG-01`; eight-fixture runtime matrix                                                 | Local SQL and runtime pass                          | Synthetic data only                                      |
| `AC-13`                  | Parameterized literal substring search, bounded offset pages, repeated criteria, stable ordering, audited reads                     | `FEAT-007A-SEARCH-01`, `READ-01`, component and SQL assertions                                             | Local app, SQL, and runtime pass                    | Representative hosted query-plan evidence remains later  |
| `NFR-008/010`, `AC-15`   | General/read/mutation/lifecycle token buckets, HMAC keys, pre-limit replay lookup, fail-closed limiter/audit behavior               | Handler/config tests, expanded SQL limiter assertions, local runtime; schema lint and generated-type check | Local app, SQL, runtime, lint, and type checks pass | Hosted telemetry and alert routing remain later          |

## Verification summary

- App suite: 32 files and 303 tests; coverage thresholds passed.
- Database suite: 9 files and 382 rollback-only assertions passed, including 56
  FEAT-007A assertions.
- Browser suite: 22 desktop/mobile scenarios passed, including the full admin
  registry lifecycle.
- Runtime target: all eight local synthetic fixtures passed; FEAT-007 covered
  real Auth, TOTP, Edge, normalization, concurrent duplicate prevention,
  lifecycle races, replay, conflict, concealment, direct Data API denial, audit,
  and cleanup.
- Database lint reported no schema warnings, and generated types match the
  applied schema.

All three required pull-request checks passed for `ef61821`. Fail-closed
diagnostics remain available if the intermittent FEAT-006
fixture failure recurs; their output is limited to approved stage, event, and
error-category labels.

## Final integration evidence

The following CI runs passed Application quality, Local Supabase security, and
Required quality gate on the final PR heads. These 2026-09-23 results supersede
pending integration checks; they do not change the historical test counts below.

| Slice     | Final PR head                                                      | Merge commit | CI evidence                                                                   |
| --------- | ------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------- |
| Registry  | [PR #32](https://github.com/killroyZULU/FlyEye/pull/32), `218b8b8` | `4500ad4`    | [35855699099](https://github.com/killroyZULU/FlyEye/actions/runs/35855699099) |
| Documents | [PR #38](https://github.com/killroyZULU/FlyEye/pull/38), `d386258` | `4ec81cb`    | [35855985031](https://github.com/killroyZULU/FlyEye/actions/runs/35855985031) |

The combined dashboard/aircraft verification is recorded in
[FEAT-008 Traceability](FEAT-008_TRACEABILITY.md#reconciliation-verification).
Live delivery status belongs in [Current State](../CURRENT_STATE.md).

## Slice B reconciliation

[PR #38](https://github.com/killroyZULU/FlyEye/pull/38) delivered
[Issue #37](https://github.com/killroyZULU/FlyEye/issues/37).

| Requirement/AC ID                                      | Evidence                                                                                         | Reconciliation result                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FEAT-007B-AC-01`–`AC-05`, `AC-07`–`AC-10`, `AC-12/13` | Existing document domain/handler, SQL/RLS, component and runtime fixtures; final PR #38 CI above | Existing behavior retained; final application and database/runtime gates passed                                                                                                                                                                                                         |
| `FEAT-007B-AC-06/11`                                   | `AircraftDocumentsPanel.test.tsx`, invalid-file metadata-only continuation                       | A009 reproduced before correction; regression passes with one metadata save, null file ID and no upload                                                                                                                                                                                 |
| `FEAT-007B-AC-08`, `FEAT-007B-JOB-01`                  | Final stale-job SQL regression                                                                   | CI exposed mixed fixed/live dates after aircraft reactivation. The regression uses one non-decreasing evaluation date and compares all replacement notification fields before/after the stale job; final PR #38 CI passed                                                               |
| `NFR-008/010`, `FEAT-007B-REG-01`                      | `local-edge-request.test.mjs`, `runtime-diagnostics.test.mjs`, nine-fixture discovery            | Merged loopback-only retries and MFA cleanup retained; fixed aircraft diagnostic labels preserved without forwarding provider payloads. CI exposed omitted seeded-category cleanup in the reconciled MFA fixture; restored the organization-scoped deletion before organization cleanup |

The occupied local database was excluded from reconciliation runtime execution;
disposable CI supplied SQL/RLS, real Auth/Edge/Storage, cleanup, schema lint and type
drift evidence. Hosted file trust/scheduling, qualified review, real data,
deployment and production remain outside this evidence.

## Password-session read boundary

[FIX-009 / #64](https://github.com/killroyZULU/FlyEye/issues/64) applies the
[ADR-0006 authentication consequence](../adr/ADR-0006-SINGLE-SCHOOL-ISOLATED-DEPLOYMENTS.md#authentication-consequence)
to Student `aircraft_list` and `status_list`. The
[handler suite](../../../supabase/functions/aircraft-documents/handler.test.ts),
`Student %s password-session boundary`, reproduces the missing check and passes
method-only denial, older-password acceptance, and denial-audit-failure cases.
Denials preserve the general limiter and stop before protected data RPCs. Existing
permission, school-scope, Instructor/Admin AAL2 and mutation controls remain.

The [runtime fixture](../../../scripts/test-feat-007b-runtime.mjs),
`password-session-denial` stage, adds real local Auth recovery-session rejection
for both reads and persisted denial-audit assertions. Its execution is delegated
to disposable CI; the occupied local database is preserved. #64's linked PR owns
the execution results. This correction does not resolve the separate SQL
authorization-during-lock-wait hypothesis in audit #39.

## Evidence rules

- Local synthetic results do not establish hosted, real-data, customer,
  regulated, deployment, or production readiness.
- Agent review is technical evidence, not qualified aviation, accessibility,
  privacy/legal, or customer approval.
- Update this record when the implementation, reviewed target, evidence, or
  limitation changes.

## Slice B historical Aircraft Document Records evidence

- Delivery target: Issue #37 and [PR #38](https://github.com/killroyZULU/FlyEye/pull/38)
  on `feat/FEAT-007B-aircraft-documents`; implementation `cd93914`, stacked on
  specification head `fbea354`
- Verification date: 2026-09-06
- Boundary: Local synthetic verification only; deterministic local file scanner
  and browser-reachable local signed URLs
- Review and CI: Separate technical correction review clear; required CI results
  are tracked on PR #38
- Known limitations: No hosted scanner or scheduler, real-data authority,
  retention/deletion approval, qualified aviation review, deployment, or
  production approval

| Requirement/AC ID           | Design or control                                                                                                                                        | Test/evidence ID                                                             | Result                                               | Limitation or later gate                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `CMP-002`, `AC-01/02/03`    | Six seeded categories, explicit custom assignments, required metadata, Philippine date calculation, non-operational configured status                    | `FEAT-007B-UNIT-01`, `SQL-01`, `JOB-01`, component and runtime status checks | Local unit, SQL, UI, and runtime pass                | Regulatory meaning and operational use remain excluded                            |
| `AC-04/08/09`               | Immutable versions, expected aggregate version, target-independent create replay, atomic audit, idempotent notification lifecycle                        | `FEAT-007B-RPC-01`, `RACE-01`, `JOB-01`, runtime replay/conflict/renewal     | Local SQL, handler, and runtime pass                 | Hosted scheduling and alert ownership remain later gates                          |
| `AC-05/10`                  | Server-derived role and school context, Student/Instructor status-only projection, Admin AAL2, no browser table grants                                   | `FEAT-007B-EDGE-01`, `TENANT-01`, SQL and real Auth/TOTP runtime             | Local SQL and runtime pass                           | Hosted access review remains later                                                |
| `AC-06/07/12`               | Generated private object keys, signed upload, deterministic magic/size/hash/content validation, clean-only link, recent-password download, exact cleanup | `FEAT-007B-FILE-01`, `REC-01`, handler tests and real local Storage runtime  | Local unit, SQL, Storage, download, and cleanup pass | Provider malware scanning and hosted recovery remain disabled                     |
| `NFR-004`, `AC-11`          | Structured responsive rows, status text/icons, role-scoped actions, retained retry key, explicit stale/offline and safe failure states                   | `FEAT-007B-COMP-01`, `E2E-01`; desktop/mobile Admin and Student journeys     | Local component and browser pass                     | Formal accessibility review remains later                                         |
| `AC-13`, `CMP-006` boundary | No dispatch/preflight decision, W&B values, public files, permanent deletion, email, hosted activation, or production path                               | Source, migration, UI, configuration, and diff review                        | Local source boundary passes                         | `CMP-006` remains dependent on a separately approved immutable preflight snapshot |

Slice B adds one local runtime fixture to the regression matrix. The nine-fixture
matrix passes with real Auth, TOTP, protected Edge reads and mutations, private
signed upload/download, deterministic file validation, notification lifecycle,
direct Data API denial, audit evidence, and zero synthetic residue.

- Application gate: 43 files and 355 tests, coverage thresholds, formatting,
  documentation, maintainability, lint, types, build, browser-key scan, all 26
  desktop/mobile scenarios, and dependency audit passed. Frozen installation passed.
- Database gate: 10 files and 447 rollback-only assertions, all nine runtime
  fixtures, schema lint, and generated-type comparison passed.
- Separate review confirmed corrected custom-category transport and reuse,
  minimized status-only fields, signing-before-download-audit, stale-job alert
  preservation, page continuation, and cross-aircraft notification editing.
- CI retry exposed an intermittent FEAT-006 completion failure. The reviewed
  fixture now uses the existing bounded local-proxy recovery helper and emits
  only allowlisted HTTP-status diagnostics. Application errors remain terminal;
  exact-head runtime verification remains a required CI gate.
