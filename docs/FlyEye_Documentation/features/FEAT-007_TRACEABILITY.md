# FEAT-007 Traceability

## Evidence boundary

- Delivery target: Issue #31 on `feat/FEAT-007A-aircraft-registry`; PR #32
- Verification date: 2026-08-31
- Local/hosted/data boundary: Local synthetic verification only
- Review and CI: Final implementation and diagnostic-remediation technical
  re-reviews clear; all required pull-request checks passed for reviewed head
  `ef61821` after four intermittent FEAT-006 fixture failures
- Known limitations: No hosted validation, real-data authority, formal
  accessibility review, qualified aviation workflow review, retention decision,
  deployment, or production approval

This record covers FEAT-007 Slice A only. It establishes an administrative
aircraft identity registry, not airworthiness, operational availability,
compliance, registration validity, ownership, or dispatch authority.

## Requirements and results

| Requirement/AC ID | Design or control | Test/evidence ID | Result | Limitation or later gate |
|---|---|---|---|---|
| `CMP-001`, `AC-01/02/09` | Server-derived sole-school context; Admin-only read/manage permissions; AAL2/TOTP; protected Edge/RPC boundary; no browser grants | `FEAT-007A-EDGE-01`, `SQL-01`, `TENANT-01`, local Auth/Edge runtime | Local app, SQL, and runtime pass | Hosted and qualified workflow validation remain later |
| `AC-03/04/05` | Three-field identity aggregate; complete pinned Unicode 15.1 C/F map; partial unique Tracked key | `FEAT-007A-UNIT-01`, `SQL-01`, live concurrent-create runtime | Local app, SQL, and runtime pass | No regulatory registration-format claim is made |
| `AC-06/07/08` | Versioned reversible lifecycle, retained uncertain-retry keys, row locking, and atomic mutation audit | `FEAT-007A-RPC-01`, `RACE-01`, `SEC-01`, runtime replay/conflict/audit checks | Local app, SQL, and runtime pass | Retention and permanent deletion remain excluded |
| `AC-09/11` | Deny-by-default tables; same-school functions; strict schemas, late-denial audit, and safe errors; no operational fields or actions | `FEAT-007A-SQL-01`, `EDGE-01`, `TENANT-01`, source/diff review | Local app, SQL, and runtime pass | No qualified aviation or production approval |
| `NFR-004`, `AC-10/14` | Structured responsive rows, semantic forms, focus-managed confirmation, conflict preservation, in-memory-only offline display | `FEAT-007A-COMP-01`; 22 desktop/mobile `E2E-01` scenarios | Local supporting pass | Formal accessibility and 200% reflow review remain later |
| `AC-12` | Rollback-only SQL plus unconditional runtime teardown with exact zero-residue assertions | `FEAT-007A-SQL-01`, `REG-01`; eight-fixture runtime matrix | Local SQL and runtime pass | Synthetic data only |
| `AC-13` | Parameterized literal substring search, bounded offset pages, repeated criteria, stable ordering, audited reads | `FEAT-007A-SEARCH-01`, `READ-01`, component and SQL assertions | Local app, SQL, and runtime pass | Representative hosted query-plan evidence remains later |
| `NFR-008/010`, `AC-15` | General/read/mutation/lifecycle token buckets, HMAC keys, pre-limit replay lookup, fail-closed limiter/audit behavior | Handler/config tests, expanded SQL limiter assertions, local runtime; schema lint and generated-type check | Local app, SQL, runtime, lint, and type checks pass | Hosted telemetry and alert routing remain later |

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

Reviewed head `ef61821` is pushed, and all three required pull-request checks
pass. Fail-closed diagnostics remain available if the intermittent FEAT-006
fixture failure recurs; their output is limited to approved stage, event, and
error-category labels.

## Evidence rules

- Local synthetic results do not establish hosted, real-data, customer,
  regulated, deployment, or production readiness.
- Agent review is technical evidence, not qualified aviation, accessibility,
  privacy/legal, or customer approval.
- Update this record when the implementation, reviewed target, evidence, or
  limitation changes.

## Slice B Aircraft Document Records evidence

- Delivery target: Issue #37 on `feat/FEAT-007B-aircraft-documents`, stacked on
  specification head `fbea354`; implementation pull request pending
- Verification date: 2026-09-05
- Boundary: Local synthetic verification only; deterministic local file scanner
  and browser-reachable local signed URLs
- Review and CI: Separate technical correction review clear; pull-request CI pending
- Known limitations: No hosted scanner or scheduler, real-data authority,
  retention/deletion approval, qualified aviation review, deployment, or
  production approval

| Requirement/AC ID | Design or control | Test/evidence ID | Result | Limitation or later gate |
|---|---|---|---|---|
| `CMP-002`, `AC-01/02/03` | Six seeded categories, explicit custom assignments, required metadata, Philippine date calculation, non-operational configured status | `FEAT-007B-UNIT-01`, `SQL-01`, `JOB-01`, component and runtime status checks | Local unit, SQL, UI, and runtime pass | Regulatory meaning and operational use remain excluded |
| `AC-04/08/09` | Immutable versions, expected aggregate version, target-independent create replay, atomic audit, idempotent notification lifecycle | `FEAT-007B-RPC-01`, `RACE-01`, `JOB-01`, runtime replay/conflict/renewal | Local SQL, handler, and runtime pass | Hosted scheduling and alert ownership remain later gates |
| `AC-05/10` | Server-derived role and school context, Student/Instructor status-only projection, Admin AAL2, no browser table grants | `FEAT-007B-EDGE-01`, `TENANT-01`, SQL and real Auth/TOTP runtime | Local SQL and runtime pass | Hosted access review remains later |
| `AC-06/07/12` | Generated private object keys, signed upload, deterministic magic/size/hash/content validation, clean-only link, recent-password download, exact cleanup | `FEAT-007B-FILE-01`, `REC-01`, handler tests and real local Storage runtime | Local unit, SQL, Storage, download, and cleanup pass | Provider malware scanning and hosted recovery remain disabled |
| `NFR-004`, `AC-11` | Structured responsive rows, status text/icons, role-scoped actions, retained retry key, explicit stale/offline and safe failure states | `FEAT-007B-COMP-01`, `E2E-01`; desktop/mobile Admin and Student journeys | Local component and browser pass | Formal accessibility review remains later |
| `AC-13`, `CMP-006` boundary | No dispatch/preflight decision, W&B values, public files, permanent deletion, email, hosted activation, or production path | Source, migration, UI, configuration, and diff review | Local source boundary passes | `CMP-006` remains dependent on a separately approved immutable preflight snapshot |

Slice B adds one local runtime fixture to the regression matrix. The nine-fixture
matrix passes with real Auth, TOTP, protected Edge reads and mutations, private
signed upload/download, deterministic file validation, notification lifecycle,
direct Data API denial, audit evidence, and zero synthetic residue.

- Application gate: 43 files and 349 tests, coverage thresholds, formatting,
  documentation, maintainability, lint, types, build, browser-key scan, all 26
  desktop/mobile scenarios, and dependency audit passed. Frozen installation passed.
- Database gate: 10 files and 447 rollback-only assertions, all nine runtime
  fixtures, schema lint, and generated-type comparison passed.
- Separate review confirmed corrected custom-category transport and reuse,
  minimized status-only fields, signing-before-download-audit, stale-job alert
  preservation, page continuation, and cross-aircraft notification editing.
