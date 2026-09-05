# Feature Specification: FEAT-007 — Aircraft Document Records (Slice B)

## Status

- State: Implementation and local synthetic verification complete; separate technical review clear
- Current SDLC phase: PR/CI
- Owner: Founder/Product Owner
- Baseline: specification head `fbea354`; implementation branch
  `feat/FEAT-007B-aircraft-documents`
- Contract issue: [#35](https://github.com/killroyZULU/FlyEye/issues/35)
- Implementation issue: [#37](https://github.com/killroyZULU/FlyEye/issues/37)
- Parent discovery: [#22](https://github.com/killroyZULU/FlyEye/issues/22)
- Dependency: [FEAT-007A Aircraft Registry Foundation](FEAT-007_AIRCRAFT_REGISTRY_FOUNDATION.md)
- Related requirements: SRS `CMP-002`, `CMP-003`, `CMP-006`, `REC-001`–`REC-003`,
  `NFR-004`, `NFR-008`, `NFR-010`, and `NFR-011`

## User outcome

As an Organization Admin, I can maintain current and historical aircraft-linked
ARROWI document records so that authorized school users can see configured
document status and administrators can act on upcoming expiration without
discarding earlier evidence.

FlyEye reports its configured record status only. It does not determine
airworthiness, registration validity, serviceability, regulatory compliance,
ownership, operational availability, or dispatch eligibility.

## Scope

Included:

- Six seeded ARROWI categories: Airworthiness Certificate, Registration
  Certificate, Radio Station License, Weight and Balance Data, Operating
  Handbook, and Insurance
- Required seeded categories for every Tracked aircraft; custom categories
  assigned only to selected Tracked aircraft
- Required document title, source, and expiration date; optional reference
  number, issue/effective date, notes, and one private attachment
- Current configured status, immutable versions, renewal/correction, suspension,
  restoration, history, and no ordinary permanent deletion
- Philippine calendar-date calculation, seven-day warning, and in-application
  Organization Admin notifications
- Status-only Student and Instructor access; full Admin metadata/history access
- Protected audited reads and mutations, private staged file handling,
  organization isolation, idempotency, concurrency, and responsive UI design

Non-goals:

- Preflight forms, aircraft selection blocking, dispatch, release, approval,
  operational status, or aviation judgment
- Weight-and-balance configuration values or calculations; this slice treats
  Weight and Balance Data only as a document category
- Email/SMS notifications, exports, offline mutation, permanent deletion,
  real-data migration, hosted activation, deployment, or production
- More than one attachment per document version, editable binaries, public
  links, or attachment access by Student or Instructor

This slice satisfies the metadata, validity-date, configured-status, and private
attachment portions of `CMP-002` and the notification portion of `CMP-003`. Its
immutable document versions establish a prerequisite for `CMP-006`; that
requirement remains unsatisfied until a separately approved finalization
snapshot contract implements submission-time revalidation and preserved
snapshots using qualified workflow sources.

## Sources, decisions, and unresolved questions

| Item | Source/owner/version | State |
|---|---|---|
| Metadata fields, required expiration, optional file, role visibility, and one-file versioning | Founder/Product Owner, 2026-09-01 | Approved |
| Six seeded categories and custom per-aircraft assignment | Founder/Product Owner, 2026-08-28 and 2026-09-01 | Approved product configuration |
| Philippine date, seven-day warning, dashboard notification, and versioned renewal | Founder/Product Owner, 2026-08-28 | Approved product behavior |
| Private file, authority, audit, and isolation controls | SRS `CMP-002`, `REC-001`–`REC-003`; Security Requirements sections 4, 7–9 | Required |
| Malware scanner/provider and hosted scheduler | Provider, cost, privacy, and security review | Unresolved; hosted activation blocked |
| Retention and end-of-contract deletion | School controller and qualified privacy/legal reviewer | Unresolved; permanent deletion excluded |
| Regulatory meaning, preflight effect, and operational authority | Approved school source owner and qualified aviation reviewer | Unresolved; excluded |

Requiring `expiration_date` is a FlyEye record rule approved for later form use.
It is not a claim that every named real-world document has a legally prescribed
expiry. The application accepts past dates so an administrator can record an
already expired document.

## Roles and authority

| Action | Permission | Record rule | Execution boundary | Reauthentication |
|---|---|---|---|---|
| Read aircraft/category/status/expiry summary | `aircraft.document.status.read` | Active membership; Tracked aircraft; current requirement only | Protected audited read | Student AAL1; Instructor/Admin AAL2 |
| Read full metadata and version history | `aircraft.document.read` | Active Admin; same organization | Protected audited read | Current AAL2/TOTP |
| List/open document notifications | `aircraft.document.notification.read` | Active Admin recipient; same organization; bounded current/history pages | Protected audited read | Current AAL2/TOTP |
| Create, renew, correct, suspend, or restore | `aircraft.document.manage` | Active Admin; Tracked aircraft; active requirement; expected version where applicable | Protected audited command | Current AAL2/TOTP |
| Configure/assign custom categories | `aircraft.document.category.manage` | Active Admin; same organization; expected version | Protected audited command | Current AAL2 plus password AMR within 10 minutes |
| Stage/complete an attachment | `aircraft.document.manage` | Active Admin; one pending file for the intended new version | Protected upload flow | Current AAL2/TOTP |
| Download a clean attachment | `aircraft.document.attachment.read` | Active Admin; same aircraft/version; clean attached file | Short-lived protected download | Current AAL2 plus password AMR within 10 minutes |

Organization Admin receives all six permissions. Instructor Pilot and Student
Pilot receive only `aircraft.document.status.read`. Their response contains the
aircraft display label, category, configured status, expiration date, and status
calculation date—never source, reference number, issue date, notes, history,
attachment metadata, file existence, or download capability.

Permissions remain server-derived. Organization Admin document management does
not grant operational, safety, quality, airworthiness, dispatch, or approval
authority. Browser roles receive no direct table, audit, notification, or
Storage-object grant.

## Workflow and business rules

```text
Required category + no current version --> Missing
Missing --authorized create--> Current version
Current --authorized renew/correct--> Superseded version + new current version
Current --authorized suspend + reason--> Suspended
Suspended --authorized restore + reason--> date-derived current status
Current/Suspended --aircraft or custom requirement archived--> Archived history
```

1. The six seeded categories are stable, system-owned, and required for every
   Tracked aircraft. They cannot be renamed, archived, or made optional through
   the application.
2. Admins may create, rename, archive, and assign custom categories. A custom
   category affects only explicitly assigned Tracked aircraft. Removing an
   assignment archives its current record/history from normal views; it does
   not delete evidence. Historical versions preserve the category label used at
   creation.
3. One active logical document record may exist per aircraft and category. A
   required category with no current version is `Missing`.
4. Every version requires a trimmed title of at most 160 characters, a trimmed
   source/issuing-authority label of at most 160 characters, and an ISO calendar
   expiration date. Reference number and issue/effective date are optional;
   notes are optional and limited to 500 characters. Control/format characters
   and unrecognized fields fail validation. FlyEye enforces no document-number
   pattern or real-document date-order rule; any such rule requires a qualified
   source and a separate approved contract.
5. Status is calculated server-side using the current calendar date in
   `Asia/Manila`: `Expired` when expiration is before today; `Expiring Soon`
   from seven calendar days before expiration through expiration day; otherwise
   `Valid`. `Suspended` overrides date-derived display. Historical or removed
   records display `Archived`. No `Unknown` status exists; unavailable
   calculation returns a service error rather than a misleading status.
6. A correction and a renewal both create an immutable next version and
   supersede the prior version. Renewal describes replacement due to a new
   validity period; correction describes fixed metadata or an added/replaced
   attachment. Neither overwrites history.
7. Suspend and restore are reversible administrative actions. Each requires a
   trimmed reason of 10–300 characters. The reason must describe record
   administration and cannot be presented as an aviation finding. Renewal or
   correction of a suspended record creates the next version but preserves the
   suspended state; restoration remains a separate reasoned action. A suspended
   record emits no new warning or expiration notification.
8. Every mutation supplies an opaque idempotency key. Non-create actions also
   supply the current positive aggregate version. Same-fingerprint replay
   returns the stored outcome; changed-input reuse or stale version fails
   without another version, file link, notification, or audit event.
9. Archiving an aircraft stops current-status notifications and removes its
   requirements from normal status views while retaining Admin history.
   Reactivation recalculates status and creates only any notification currently
   due and not already recorded for that document version.
10. No write is queued offline. Current-session results may remain visible as
    explicitly stale and read-only; reload, sign-out, or permission loss clears
    them.

### Attachment rules

1. A proposed new document version may contain no file or exactly one PDF, JPEG,
   or PNG. The initial ceiling is 20 MiB; PDFs are limited to 200 pages and
   images to 40 megapixels. Limits are server-controlled and may only change
   through reviewed configuration and abuse testing.
2. The server creates an opaque organization/aircraft/version-scoped staging
   key. Original file names are display metadata only and never object paths.
3. Completion verifies declared type, file signature, size, page/dimension
   bounds, cryptographic hash, and malware result. Files remain private and
   quarantined while pending. Failed, unavailable, or indeterminate validation
   cannot attach the file or mark it trusted.
4. The object lifecycle is `staged` to `quarantined` to `clean`, `rejected`, or
   `scan_failed`; only a verified-existing `clean` object with the expected hash
   can enter the database transaction that links it to a new immutable document
   version and audit event. Storage persistence and the PostgreSQL transaction
   are not cross-service atomic. A failed database commit leaves an inaccessible
   staged/clean orphan that deterministic retry may link using the same
   idempotency key; reconciliation records unresolved orphans for cleanup only
   under the approved temporary-object/retention procedure. An Admin may instead
   explicitly continue metadata-only. Retrying cannot attach twice.
5. Adding or replacing a file later requires a corrected document version. A
   file is never replaced in place. Download requires fresh authorization and a
   short-lived signed URL; public URLs and browser-persisted file caches are
   prohibited.

## Data and server design

The Slice A `aircraft_records` aggregate remains the aircraft identity owner.
Slice B adds tenant-owned tables with composite organization/aircraft integrity:

- `aircraft_document_categories`: stable code for seeded categories, custom
  label, category state, system/custom marker, version, and attribution;
- `aircraft_document_requirements`: custom aircraft/category assignment state,
  version, and attribution; seeded requirements are derived for every Tracked
  aircraft rather than copied as mutable rows;
- `aircraft_documents`: logical aircraft/category aggregate, current version
  pointer, active/suspended/archived state, concurrency version, suspension
  attribution/reason, and UTC attribution;
- `aircraft_document_versions`: immutable sequence, category-label snapshot,
  title, source, optional reference/issue date/notes, required expiration date,
  optional `stored_file_id`, reason, and UTC attribution;
- `stored_files`: private bucket/object key, generated/display name, media type,
  size, SHA-256 hash, scan state, classification, uploader, and lifecycle; and
- `aircraft_document_notifications`: recipient, document version, warning or
  expiry event, due/resolved state, and uniqueness evidence.

Partial unique constraints protect active custom labels, custom assignments,
one logical document per aircraft/category, one version number per document,
one current version, one attachment per version, and one notification per
recipient/version/event. Date/status, aircraft/category, notification due, and
stable history/list paths receive reviewed tenant-first indexes. Representative
query plans determine any additional index.

All tables start with deny-by-default RLS and no browser grants. A focused
`aircraft-documents` Edge surface provides bounded summary, Admin detail/history,
notification list/open, category/assignment, lifecycle,
upload-initiation/completion, and download actions. Status/history and
notification pages default to 25 and permit at most 50 items with stable
server-controlled ordering and an explicit bounded continuation. The surface
derives organization and permissions from Auth and active membership, rejects
organization hints, applies server-side schemas and token buckets, and invokes
fixed-`search_path` server-only PostgreSQL functions.
Successful reads produce their required audit evidence atomically or return no
records. Mutations lock the aircraft, requirement, and document in a stable
order and atomically create the new state/version and audit event.

Status is never persisted as authoritative date-derived state. Protected reads
and the notification job use one versioned PostgreSQL calculation function with
an explicit Philippine date input for deterministic tests. A daily idempotent
job evaluates active Tracked-aircraft versions after Philippine midnight and
creates one warning notification at the seven-day boundary and one expiration
notification after the expiration day for each unsuspended current version.
Creating an expiration notification resolves the same version's warning.
Correction or renewal resolves all open notifications for the superseded
version and evaluates the new version. Suspension resolves open notifications;
restoration reopens or creates only the notification applicable on that date.
Aircraft/category archival or requirement removal resolves affected open
notifications; reactivation/reassignment evaluates the current version. A late
first evaluation of an already expired version creates only the expiration
notification and records the skipped warning in job evidence. Repeated jobs and
newly eligible Admin recipients use the same uniqueness contract. Email is not
invoked.

Stable error families include unauthenticated, MFA/recent-password required,
unauthorized, not found, validation failed, state/version/idempotency conflict,
rate limited, audit failed, file rejected, scan pending/failed/unavailable,
storage unavailable, and service unavailable. Cross-school and unauthorized
identifiers do not disclose record, category, file, or notification existence.

The general request bucket reuses Slice A capacity 60/refill two per second.
Summary/detail/history reads share capacity 30/refill one per second; metadata
create/correct/renew share capacity 6/refill one per 10 seconds; lifecycle and
category/assignment actions share capacity 3/refill one per 30 seconds; upload
initiation/completion share capacity 3/refill one per 30 seconds; and attachment
downloads use capacity 10/refill one per six seconds. Limiter uncertainty fails
closed before protected data/file access. Stored idempotent mutation replay uses
only the general token.

Schema, RLS, grants, Storage policies, functions, indexes, seeded categories,
and notification scheduling require version-controlled migrations and generated
types. Shared-use rollback is forward-fix only. Database and object restore
must reconcile version/file links, hashes, scan state, and object existence.

For future `CMP-006` compatibility, each immutable version has a stable opaque
identifier and preserves its category code/label, title, source, expiration,
and optional metadata. A separately approved preflight-submission command may
later revalidate the then-current versions and copy their identifiers and
relevant values into an immutable submission snapshot. This slice does not
define which status permits or blocks aircraft selection or submission.

## UI design

The authenticated Aircraft workspace opens a selected aircraft as
`Registration (Manufacturer — Model)` with **Identity** and **Documents**
sections. The Documents section uses structured category rows rather than a
card per category. Each row shows category, configured status, expiration date,
status calculation date, and permitted next action. Admin detail also shows the
source and optional issue/effective date. Status labels always include text and
an icon rather than relying on color.

Admins receive **Add document**, **Renew**, **Correct**, **Suspend**, **Restore**,
**History**, and **Manage custom categories** only when permitted by current
state. The form marks title, source, and expiration as required; reference,
issue/effective date, notes, and attachment are optional. Upload UI shows
selection, bounded validation, progress, scanning/quarantine, clean, rejected,
retry, and metadata-only continuation states. It never implies that a selected
file is attached before clean completion.

Student and Instructor views expose only aircraft label and category rows with
status, expiration, and calculation date. They receive no Admin actions or
indication that a private file exists. The dashboard shows Admin-only warning
and expiration notifications with aircraft, category, expiration, and a link to
the document record; no operational eligibility badge is added.

Loading, no aircraft, missing documents, filtered-empty history, unauthorized,
offline, stale, upload failure, scan pending/failure, version conflict, and
success states use plain language and predictable focus. Forms preserve entered
metadata after safe failures. Confirmation names the aircraft/category and
reasoned action. Desktop and small-screen layouts follow the authenticated shell
and `07_UI_UX_GUIDELINES.md`; keyboard operation, semantic labels, error summary,
status announcements, dialog focus return, and 200% reflow are required.

## Audit and observability

Atomic domain events include category/assignment creation or archival,
document creation/correction/renewal, suspension/restoration, and notification
creation/resolution. Events record organization, actor, target, UTC time,
correlation, idempotency hash, prior/new aggregate and document version,
category, expiration before/after, lifecycle reason, and attachment-presence or
hash change—not unrestricted notes or file content.

Successful status, detail, and history reads and authorized short-lived download
issuance are audited. File events record staging, validation/scan outcome, clean
attachment, rejection, download-link issuance, and reconciliation failure
without tokens, signed URLs, original content, or unsafe provider detail. Audit
failure blocks the corresponding protected result, mutation, or link issuance;
provider access logs remain security evidence rather than domain audit. Security logs cover denials,
cross-school attempts, limiter outcomes, malformed files, scan/storage/job
failures, and abnormal download behavior using value-free bounded categories.

Monitor job completion, notification lag/duplicates, status-calculation errors,
orphan staged objects, missing objects, hash mismatches, scan failures, audit
failures, and database/object restore reconciliation. Hosted alert ownership
remains a release gate.

## Security, privacy, and abuse cases

- Tenant IDs, roles, permissions, status, version, file keys, scan results,
  notification recipients, and audit values are server-controlled.
- Direct Data API, RPC, Storage, guessed-ID, list/search, signed-link replay,
  and cross-school attempts fail without existence disclosure.
- File signatures—not extensions—control format acceptance. Object keys are
  generated, private, and scoped. Quarantined/unscanned files cannot be viewed
  or trusted; active content is never executed.
- Metadata fields reject injection/control abuse and enforce exact bounded
  schemas. File endpoints enforce body/object/format/size/page/dimension limits,
  timeouts, hash verification, idempotency, and cost-aware rate limits.
- Short-lived downloads require current authorization and recent password;
  responses use safe content disposition, anti-sniffing, and no-store headers.
- Status-only responses and errors cannot reveal source, history, notes,
  attachment existence, file names, or Admin activity to Student/Instructor.
- Sign-out, permission loss, aircraft archival, or membership suspension clears
  permission-scoped in-memory data and invalidates new download issuance.
- Development, verification, screenshots, and files remain synthetic. Real-data
  use awaits privacy, retention, scanner/provider, backup/restore, access-review,
  and production gates.

## Acceptance criteria

- [x] `FEAT-007B-AC-01` Six stable seeded requirements appear for every Tracked
      aircraft; a custom requirement affects only explicitly assigned aircraft.
- [x] `FEAT-007B-AC-02` Every current version requires title, source, and
      expiration; optional fields and past dates follow the approved validation
      contract without asserting document-number or aviation rules.
- [x] `FEAT-007B-AC-03` Server status deterministically produces Missing, Valid,
      Expiring Soon, Expired, Suspended, or Archived from approved record state
      and Philippine calendar date, with no Unknown or operational conclusion.
- [x] `FEAT-007B-AC-04` Correction/renewal preserves an immutable prior version;
      concurrency, idempotency, and races cannot create two current versions or
      duplicate audit/notification/file links.
- [x] `FEAT-007B-AC-05` Admins alone manage full metadata, history, categories,
      suspension, and attachments; Student/Instructor receive only the approved
      status summary at their required assurance level.
- [x] `FEAT-007B-AC-06` One optional PDF/JPEG/PNG attachment can become linked to
      a version only after bounded validation and a clean scan; unsafe,
      uncertain, duplicate, or unauthorized files remain unavailable.
- [x] `FEAT-007B-AC-07` Private download rechecks Admin authority and recent
      password, issues only a short-lived link, and creates audit evidence
      without exposing Storage paths or attachment existence to other roles.
- [x] `FEAT-007B-AC-08` Warning and expiration notifications are idempotent per
      Admin/version/event; expiration, correction, renewal, suspension,
      restoration, archival/removal, reactivation/reassignment, late jobs, and
      job/mutation races apply the approved resolve/reopen/skip rules without
      stale or duplicate alerts.
- [x] `FEAT-007B-AC-09` Every significant read/mutation/file action creates the
      required audit evidence atomically or returns no protected outcome.
- [x] `FEAT-007B-AC-10` Direct browser grants, forged authority, cross-school
      data/file paths, enumeration, mass assignment, replay, and limiter/audit
      uncertainty fail closed.
- [x] `FEAT-007B-AC-11` Required responsive, accessible, offline/stale, conflict,
      upload/scan, empty/missing, unauthorized, and success UI states behave
      predictably without invented operational labels.
- [x] `FEAT-007B-AC-12` Database and Storage cleanup/recovery verification detects
      orphan, missing, mismatched-hash, wrong-scope, or unclean objects and leaves
      no synthetic fixture residue.
- [x] `FEAT-007B-AC-13` No preflight selection, dispatch authority, W&B values,
      email, permanent deletion, public file access, hosted activation, or
      production behavior is introduced.

## Planned verification

| Test ID | Level | Scenario | Expected result |
|---|---|---|---|
| `FEAT-007B-UNIT-01` | Unit | Metadata schemas, dates, status boundaries, reason/file rules | Only approved inputs and deterministic statuses pass |
| `FEAT-007B-COMP-01` | Component | Role views, category rows, forms, history, conflicts, offline, upload/scan states | Responsive accessible contract holds |
| `FEAT-007B-SQL-01` | SQL/RLS | Schema, seeded/custom requirements, immutability, grants, indexes, direct denial | Integrity and least privilege fail closed |
| `FEAT-007B-RPC-01` | SQL/RPC | Create/correct/renew/suspend/restore/category actions, audit failure, replay | State/version/audit changes are atomic |
| `FEAT-007B-RACE-01` | SQL/runtime | Concurrent renewal/correction, job/mutation notification, upload completion | One current version/file link and no duplicate event |
| `FEAT-007B-EDGE-01` | Handler/runtime | Auth, assurance, permission, schemas, limiters, safe errors | Protected boundaries reject invalid/uncertain requests |
| `FEAT-007B-FILE-01` | Storage/runtime | Magic/type/size/page/dimension/hash/scan states, signed download, orphan cleanup | Only clean authorized object is available |
| `FEAT-007B-TENANT-01` | SQL/runtime | School A/B metadata, history, notification, object key, direct-ID/download | No cross-school read, inference, or mutation |
| `FEAT-007B-JOB-01` | SQL/runtime | Philippine date boundaries, late/repeated runs, renewal/archival/reactivation | Status and notifications remain deterministic/idempotent |
| `FEAT-007B-E2E-01` | Browser | Admin and status-only role journeys on desktop/mobile | Approved UI and role boundary pass |
| `FEAT-007B-REC-01` | Recovery | Database/object backup fixture and reconciliation failures | Missing/orphan/mismatched evidence blocks readiness |
| `FEAT-007B-REG-01` | Regression | Existing identity, dashboard, and aircraft registry matrices | Earlier behavior remains green |

## Dependencies

- FEAT-007A supplies aircraft identity, lifecycle, permissions, and protected
  registry patterns. FEAT-008 supplies the authenticated shell and dashboard
  placement; implementation must reconcile both after their merge decisions.
- Supabase private Storage is already approved. No new file-processing package
  or scanner is selected by this specification. Before implementation, any new
  package requires maintenance, license, vulnerability, bundle/runtime, and
  existing-alternative review.
- Hosted file trust and scheduling remain disabled until an approved malware
  scanner/provider, cost, privacy terms, credentials, failure behavior, and job
  environment exist. Local synthetic tests use a deterministic adapter and do
  not establish hosted readiness.

## Change boundary

Allowed implementation areas:

- Versioned migrations/types for document/category/version/file/notification
  data, RLS, functions, grants, Storage policies, seeds, indexes, and jobs
- Focused aircraft-document frontend, Edge surface, shared schemas, and tests
- Authenticated-shell integration and required canonical evidence

Excluded areas:

- Unrelated identity, member, dispatch, training, W&B calculation, weather,
  assessment, export, email, retention/deletion, and AI modules
- Architecture or authority changes outside this specification
- Merge, real data, hosted-provider activation, production deployment,
  destructive actions, and branch deletion

## Specification and design definition of done

- [x] Product fields, categories/applicability, expiry, role visibility,
      suspension, attachment cardinality, history, and notification decisions
      are explicit
- [x] Data/RLS/protected-command/file/UI/audit design and future preflight
      boundary are specified
- [x] Documentation checks and separate technical review pass
- [x] Scoped branch has a green review-ready documentation pull request
- [x] Founder/Product Owner accepts the written contract before implementation

## Implementation definition of done

- [x] Versioned schema, deny-by-default RLS, protected functions, permissions,
      private Storage, generated types, and deterministic local file validation
      implement the approved contract
- [x] Role-aware responsive UI covers status, metadata, version history,
      document lifecycle, custom categories, notifications, and private files
- [x] Unit, component, desktop/mobile browser, rollback-only SQL, real Auth/TOTP,
      Edge, private Storage, cleanup, and regression verification pass locally
- [x] Separate technical review is clear on the stable implementation target
- [ ] Scoped commit, review-ready pull request, and required CI checks are green
