# Feature Specification: FEAT-007 — Aircraft Registry Foundation (Slice A)

## Status

- State: Implementation, local synthetic verification, and technical review complete; current-head PR checks pending after bounded CI diagnostic remediation
- Current SDLC phase: PR/CI verification
- Owner: Founder/Product Owner
- Baseline: `main` at `1a85ae6`
- Task issue: [#31](https://github.com/killroyZULU/FlyEye/issues/31)
- Parent discovery: [#22](https://github.com/killroyZULU/FlyEye/issues/22)
- Related requirements: SRS `CMP-001`, `IAM-003`, `IAM-005`, `IAM-008`–`IAM-011`,
  `REC-001`–`REC-003`, `NFR-004`, `NFR-008`, and `NFR-010`

## User outcome

As an Organization Admin, I can maintain a minimal school aircraft registry so
that FlyEye has trustworthy organization-scoped aircraft identity records for
later separately approved workflows.

This slice records administration only. A Tracked or Archived label does not
state airworthiness, operational condition, maintenance condition, ownership,
compliance, registration validity, or dispatch eligibility.

## Scope

Included:

- Create, view, search, edit, archive, and reactivate aircraft registry records
- Registration mark, manufacturer, and model as the only aircraft identity
  fields
- Separate `aircraft.record.read` and `aircraft.record.manage` permissions,
  assigned only to Organization Admin in this slice
- Deny-by-default organization-scoped reads and protected audited mutations
- Registration duplicate protection, optimistic concurrency, idempotency,
  responsive interface behavior, and local synthetic verification planning

Non-goals:

- Airworthiness, operational, maintenance, compliance, registration-validity,
  ownership, or dispatch-eligibility status
- Manufacturer serial number, fleet code, display name, year of manufacture,
  document metadata, attachments, expiry rules, or notifications
- Aircraft configuration, weight and balance, dispatch, exports, permanent
  deletion, or offline mutation
- Student Pilot or Instructor Pilot access, new operational roles, hosted
  validation, real data, deployment, or production

This contract satisfies only the administrative aircraft-record foundation of
`CMP-001`. Its operational-status requirement remains unresolved for a later
qualified workflow specification.

## Sources, decisions, and unresolved questions

| Item | Source/owner/version | State |
|---|---|---|
| Organization-scoped aircraft records | SRS `CMP-001`; Founder/Product Owner, 2026-08-28 | Approved for this administrative subset |
| Three required fields; manufacturer serial number unavailable | Founder/Product Owner, 2026-08-28 | Approved |
| Organization Admin read and manage authority for non-operational records | Founder/Product Owner, 2026-08-28; SRS `IAM-011` boundary retained | Approved |
| Tracked/Archived lifecycle, duplicate handling, reasons, UI, and server validation | Founder/Product Owner, 2026-08-28 | Approved |
| Caseless comparison algorithm | [Unicode 15.1 components and `CaseFolding.txt`](https://www.unicode.org/versions/components-15.1.0.html) | Pinned technical source |
| Aircraft operational status, related roles, and separation of duties | Pilot school and qualified aviation reviewer | Unresolved; excluded |
| Registration format and authoritative validation rules | Approved regulatory or school source owner | Unresolved; no format pattern enforced |
| Retention and deletion period | School controller and qualified privacy/legal reviewer | Unresolved; permanent deletion excluded |

## Roles and authority

| Action | Permission | Record rule | Execution boundary | Reauthentication |
|---|---|---|---|---|
| List, search, and read aircraft records | `aircraft.record.read` | Active membership in the deployment's sole organization | Protected Edge Function and atomic audited server-only PostgreSQL read | Current AAL2/TOTP |
| Create or edit a Tracked record | `aircraft.record.manage` | Same organization; valid expected version for edit | Protected Edge Function and atomic server-only PostgreSQL function | Current AAL2/TOTP; no additional recent-password prompt |
| Archive a Tracked record | `aircraft.record.manage` | Same organization; expected version; approved archive reason | Protected Edge Function and atomic server-only PostgreSQL function | Current AAL2/TOTP; no additional recent-password prompt |
| Reactivate an Archived record | `aircraft.record.manage` | Same organization; expected version; approved reactivation reason; no active duplicate | Protected Edge Function and atomic server-only PostgreSQL function | Current AAL2/TOTP; no additional recent-password prompt |

Organization Admin receives both permissions. Student Pilot and Instructor Pilot
receive neither. Browser roles receive no direct insert, update, archive,
reactivate, delete, audit, tenant, or attribution-field grant. A future role may
receive read access only through a separately approved role and workflow
contract.

## Workflow and business rules

```text
No record --authorized create--> Tracked
Tracked --authorized edit--> Tracked
Tracked --authorized archive + reason--> Archived
Archived --authorized reactivate + reason--> Tracked
```

1. FlyEye assigns an opaque identifier. Registration mark is not the permanent
   database identity.
2. Registration mark, manufacturer, and model are required. Registration is
   trimmed, displayed with ASCII letters uppercase, and limited to 32
   characters. Manufacturer and model are trimmed and limited to 100 characters
   each.
3. Empty values, control or format characters, disallowed whitespace/dash
   variants, and over-limit values fail validation. FlyEye does not enforce an
   aviation registration-format pattern in this slice.
4. The authoritative registration-key algorithm applies Unicode NFC, Unicode
   15.1 Default Case Folding using the common/full `C` and `F` mappings from the
   pinned `CaseFolding.txt`, applies NFC again, and removes only ASCII space
   `U+0020` and hyphen-minus `U+002D`. Locale-specific `T` mappings are not used.
   Other Unicode separator, dash-punctuation, control, and format characters
   are rejected rather than silently folded. One versioned server-side function
   produces or verifies the key for every write; browser normalization is
   advisory only. At most one Tracked record per organization may use the same
   key.
5. Archived history does not establish that a registration permanently
   identifies one airframe. An Archived record may share a key with a later
   Tracked record but cannot be reactivated while that conflict exists.
6. Create omits `expectedVersion`; supplying it is a validation error. Update,
   archive, and reactivate supply the current positive version. Every mutation
   supplies an opaque idempotency key. A stale version fails without overwriting
   either record.
7. Editing a registration repeats duplicate validation. Manufacturer and model
   changes create no implied change to aircraft type, capability, or approval.
8. Archive reasons are `no_longer_tracked`, `duplicate_record`, and
   `created_in_error`. No free-text reason is collected.
9. Reactivation reasons are `tracking_resumed` and `archive_incorrect`. No
   free-text reason is collected.
10. Archived records are read-only until reactivated. The application exposes
    no permanent delete action.
11. Create, edit, archive, or reactivate commits the record change, version,
    attribution, and required audit event atomically or changes nothing.
12. An idempotency record binds the key to actor, organization, action, target
    when one exists, expected version for non-create actions, and a SHA-256 hash
    of the canonical validated request. After the general request limiter allows
    the request, reuse with the same fingerprint returns the original outcome
    without consuming a mutation token or creating another mutation/audit event;
    reuse with changed input returns an idempotency conflict. Rate limitation
    may defer a replay but can never repeat the business change.
13. No mutation is queued offline. Retry after network uncertainty uses the
    same idempotency key and canonical request.

Archive and reactivation reasons describe FlyEye registry administration only.
They do not state aircraft ownership, registration validity, serviceability,
airworthiness, compliance, maintenance condition, or operational availability.

## Data and server contract

The implementation adds one `aircraft_records` tenant-owned aggregate:

- opaque `id` and required `organization_id` with composite tenant integrity;
- `registration_mark`, server-derived `registration_key`, `manufacturer`, and
  `model`;
- `registry_state` constrained to `tracked` or `archived`;
- positive integer `version` and UTC creation/update attribution;
- current archive attribution and reason when Archived; and
- no operational, compliance, ownership, attachment, or dispatch field.

A tenant-scoped partial unique index protects the registration key for Tracked
records. The organization, registry-state, registration-key, and stable-order
paths require reviewed indexes. Manufacturer/model search indexes are added
only when representative query plans demonstrate the need. Search is bounded and
paginated. A query is NFC-normalized, trimmed, limited to 100 characters, and
rejects the same control/format characters as record text. It performs
parameterized case-insensitive literal substring matching; wildcard characters
such as `%`, `_`, and `\` have no pattern meaning. Each request repeats its
search and Tracked/Archived filter, uses a default and maximum page size of 25
and 50, and permits at most 100 pages before requiring a narrower search. The
protected list function uses bounded offset pages rather than a reusable cursor.
Default ordering is registration key then opaque record ID ascending.

Records are internal school registry metadata. Permanent deletion and a
retention interval remain unavailable until the canonical retention decision is
validated. Development and verification use synthetic records only.

The browser receives no direct table-select grant. The protected
`aircraft-registry` surface accepts `list`, `get`, `create`, `update`, `archive`,
and `reactivate`. Every action derives organization and authority from
server-controlled Auth and membership records, requires current AAL2/TOTP,
applies the general request limiter before data access, validates the request,
and invokes a server-only PostgreSQL function. Mutations also lock the target where
applicable and check version and idempotency. The table retains deny-by-default
RLS as defense in depth; server functions recheck active membership,
organization, and the applicable permission rather than relying on service-role
access.

The list function alone enforces the bounded literal-search and offset-page
contract. The get function accepts one opaque record ID. Both create their
required audit event in the same database transaction as the query and return no
records if that audit write fails. Direct Data API list, search, and detail
attempts remain denied even for Organization Admin.

Stable error families are unauthenticated, MFA required, unauthorized, not
found, validation failed, duplicate registration, state conflict, version
conflict, idempotency conflict, rate limited, audit failed, and service
unavailable. Unauthorized and cross-school identifiers do not reveal whether a
record exists. Reads return a bounded result and correlation ID. Mutations
return a safe record summary, resulting version, idempotency outcome, and
correlation ID.

Rate limiting uses atomic token buckets keyed by a server-held hash of actor and
organization. A general request bucket with burst capacity 60 and refill two
tokens per second gates every action before domain-data or idempotency access.
`list` and `get` then share a read bucket with capacity 30 and refill one token
per second. A mutation whose idempotency key has no stored outcome consumes its
action bucket: `create` and `update` share capacity 6 with refill one token per
10 seconds; `archive` and `reactivate` share capacity 3 with refill one token per
30 seconds. An existing same-fingerprint replay or changed-input conflict uses
only the general request token and bypasses mutation-token consumption. Each
applicable bucket charges one token; buckets do not permit borrowing or negative
balances. Unavailable, malformed, or failed limiter state returns service
unavailable before any read, mutation, or domain audit event. Rate-limit denial
returns a bounded retry time, makes no business change, and creates only the
approved security log.

The implementation requires a version-controlled migration for schema,
permissions, role mappings, RLS, grants, indexes, protected functions, and
audit constraints, followed by generated TypeScript database types. Rollback is
forward-fix only after shared use; no destructive migration is planned.

## UI behavior

The admin workspace contains an **Aircraft registry** entry visible only with
`aircraft.record.read`.

- The default list shows Tracked records with registration mark, manufacturer,
  model, registry state, and last-updated time.
- Search matches registration mark, manufacturer, and model. **Include
  archived** adds Archived records without losing the current search.
- The interface uses the labels **Tracked** and **Archived**, never Active,
  Available, Airworthy, Serviceable, or Eligible.
- **Add aircraft**, **Edit record**, **Archive record**, and **Reactivate
  record** appear only with `aircraft.record.manage` and in valid registry
  state.
- The form contains only the three approved fields. It preserves entries after
  validation, network, service, and version-conflict errors.
- Desktop uses structured rows. Small screens prioritize registration,
  manufacturer/model, state, and actions without tiny horizontal tables.
- Loading, empty, filtered-empty, error, unauthorized, version-conflict,
  offline, and saved states use plain language and predictable focus.
- Archive and reactivation require a confirmation naming the record and one
  approved reason. Focus returns to the triggering record after cancellation.
- When offline, only results already held in current-session memory remain
  visible, read-only, and explicitly stale. No registry data is persisted in
  IndexedDB, Cache Storage, service-worker data caches, local storage, or other
  browser storage. Reload or application restart while offline shows no
  registry data. All mutations are disabled with a connectivity explanation.
- A conflict preserves the user's attempted values, reports that the server
  record changed, and requires review or refresh; FlyEye never silently merges.

Semantic forms, labelled fields, error summaries, keyboard operation, visible
focus, status announcements, confirmation-dialog focus management, and 200%
reflow follow `07_UI_UX_GUIDELINES.md`. Formal accessibility validation remains
a later lifecycle gate.

## Audit and observability

Successful mutations emit `aircraft_record.created`,
`aircraft_record.updated`, `aircraft_record.archived`, or
`aircraft_record.reactivated` in the same transaction as the record change.
Each event includes organization, actor, target, UTC time, correlation ID,
idempotency key hash, prior/new version, registry state, and an approved
lifecycle reason when applicable. Create records the three new identity values;
update records bounded before/after values for changed registration,
manufacturer, or model fields; archive and reactivation record prior/new
registry state. These protected audit values are limited to the validated field
lengths in this contract.

Successful list/search and detail reads emit `aircraft_registry.listed` and
`aircraft_record.viewed`. List audit records contain a hash of normalized search
criteria, the Archived filter, page number/size, ordering version, and returned
count; detail audit records contain the record target. The read result and audit
event are produced by one server-only database call. Audit failure returns no
registry data.

Audit metadata excludes tokens, unrestricted request bodies, client-supplied
authority, and excluded aircraft identifiers. Audit failure blocks the
mutation. Application and security logs remain value-free and cover bounded
outcomes, denials, conflicts, duplicate attempts, limiter results, latency, and
audit failures without duplicating the record or protected audit payload.

Authorization denials, cross-school attempts, rate-limit events, and other
security-relevant failures remain security logged without duplicating protected
registry values. Any later sensitive, compliance, attachment, or export read
requires a new audit decision.

Notifications are not part of this slice. Retrying a successful idempotent
command produces no second mutation or audit event.

## Security, privacy, and abuse cases

- Every tenant-owned row retains `organization_id`; direct reads begin and
  remain deny-by-default. Protected reads require active membership plus
  server-derived `aircraft.record.read`. Organization Admin assignment remains
  in the role-permission mapping rather than being hard-coded into RLS or the
  server function.
- The server rejects forged organization, permission, role, record, version,
  state, reason, attribution, registry key, or audit fields.
- Cross-school list, search, direct-ID, Data API, RPC, Edge Function, audit, and
  export attempts fail without data or existence disclosure.
- Student and Instructor sessions cannot infer registry data through UI,
  pagination counts, search, errors, caches, or direct calls.
- Validation rejects control/format characters, ambiguous whitespace/dashes,
  and over-limit abuse. Runtime schemas prevent unrecognized fields and mass
  assignment. Unit and database tests use equivalent normalization vectors.
- Every endpoint applies the specified server-enforced actor/organization token
  bucket before data access. Limiter uncertainty fails closed. Mutations also
  enforce bounded bodies, idempotency, and safe error responses.
- Search uses parameterized literal matching, escaped wildcard input, explicit
  criteria on every bounded offset page, and a maximum page window. No public
  export or attachment path is introduced.
- Offline display retains only current-session in-memory results. Cache keys and
  client state are permission- and organization-aware. Sign-out or detected
  permission loss clears memory; reload or application restart while offline
  shows no registry data.
- The browser never receives a service-role key or direct table read/mutation
  grant.

## Acceptance criteria

- [x] `FEAT-007A-AC-01` Only an active Organization Admin with
      `aircraft.record.read` and current AAL2 can list, search, or read aircraft
      records from the deployment's organization through the protected read
      boundary.
- [x] `FEAT-007A-AC-02` Only an active Organization Admin with
      `aircraft.record.manage` and current AAL2 can create, edit, archive, or
      reactivate a record through the protected command.
- [x] `FEAT-007A-AC-03` Each record contains only the approved aircraft identity
      fields plus tenant, lifecycle, version, attribution, and audit metadata.
- [x] `FEAT-007A-AC-04` Registration, manufacturer, and model validation follows
      the approved normalization and length rules without asserting a
      registration-format rule.
- [x] `FEAT-007A-AC-05` Two Tracked records cannot share a normalized
      registration key within the organization, including under concurrent
      create, update, or reactivate attempts.
- [x] `FEAT-007A-AC-06` Version and idempotency behavior prevents silent
      overwrites, changed-input key reuse, duplicate mutations, and duplicate
      audit events, including versionless create and rate-limited replay.
- [x] `FEAT-007A-AC-07` Archive and reactivation accept only approved reasons,
      remain reversible, and never imply an operational aircraft status.
- [x] `FEAT-007A-AC-08` Record mutation and the required audit event commit
      atomically; audit failure leaves the record unchanged.
- [x] `FEAT-007A-AC-09` Direct browser table reads/writes, unauthorized roles,
      forged authority, and cross-school list/search/direct-ID/RPC/Edge attempts
      fail closed without hidden-state disclosure.
- [x] `FEAT-007A-AC-10` Loading, empty, filtered-empty, error, unauthorized,
      conflict, offline, and success interface states preserve accessibility and
      user-entered values where applicable.
- [x] `FEAT-007A-AC-11` The application exposes no operational status,
      compliance judgment, attachment, expiry, notification, dispatch, export,
      or permanent deletion behavior.
- [x] `FEAT-007A-AC-12` Synthetic verification leaves no residual school,
      membership, aircraft, idempotency, limiter, or audit fixture data.
- [x] `FEAT-007A-AC-13` Search treats wildcard input literally, applies bounded
      pages with repeated criteria and stable ordering, and returns no
      unauthorized or out-of-window data.
- [x] `FEAT-007A-AC-14` Offline registry data remains current-session memory
      only; successful protected reads create their bounded domain audit event
      or return no registry data.
- [x] `FEAT-007A-AC-15` Read, mutation, and lifecycle token buckets enforce the
      specified order, capacities, and refill rates; an authorized stored replay
      bypasses mutation-token consumption, and limiter failure causes no data
      access or change.

## Planned verification

| Test ID | Level | Scenario | Expected result |
|---|---|---|---|
| `FEAT-007A-UNIT-01` | Unit | Unicode/ASCII normalization vectors, schemas, reasons, state, errors | Only the approved contract is accepted |
| `FEAT-007A-COMP-01` | Component | List, search, form, confirmations, conflict, offline, focus | Required responsive and accessible states behave predictably |
| `FEAT-007A-SQL-01` | SQL/RLS | Schema, constraints, grants, partial uniqueness, RLS | Tenant and authority boundaries fail closed |
| `FEAT-007A-RPC-01` | SQL/RPC | Versionless create, update, archive, reactivate, fingerprinted idempotency, before/after audit | Mutations are deterministic and atomic |
| `FEAT-007A-RACE-01` | SQL/RPC | Concurrent registration and lifecycle changes | One valid result; no duplicate Tracked key or lost update |
| `FEAT-007A-READ-01` | SQL/handler | Audited list/search/detail, audit failure, direct-table denial | Each successful read is bounded and audited; failure returns no data |
| `FEAT-007A-EDGE-01` | Handler/runtime | Auth, AAL2, permission, validation, exact token buckets, limiter failure, safe errors | Protected actions reject invalid, unavailable, or unauthorized requests |
| `FEAT-007A-TENANT-01` | Runtime/SQL | School A/B list, search, direct ID, Data API, RPC, Edge | No cross-school data or existence disclosure |
| `FEAT-007A-SEARCH-01` | SQL/handler/component | Literal wildcard input, query limits, page bounds, repeated criteria, ordering | Protected search remains bounded, stable, and permission-scoped |
| `FEAT-007A-E2E-01` | Browser | Admin registry workflow on desktop and mobile | Approved workflow and all required UI states pass |
| `FEAT-007A-SEC-01` | Security | Forgery, mass assignment, injection, replay, changed-input key reuse, audit failure | No unauthorized state or audit gap is created |
| `FEAT-007A-REG-01` | Regression | Existing identity and administration matrices | Earlier feature behavior remains green with zero residue |

## Dependencies and change boundary

No new package, provider, paid service, attachment scanner, notification channel,
or architecture was added. The implementation reuses current Auth,
permission, protected-command, RLS, audit, limiter, responsive form, and test
patterns.

The implementation is bounded to one migration and generated types, a focused
aircraft-registry Edge Function and server contract, the aircraft feature UI,
focused synthetic tests/fixtures, and required canonical evidence. Unrelated
identity, member administration, operational status, documents, dispatch,
weight and balance, provider, hosted, real-data, deployment, and production
behavior remains excluded.

## Specification and design definition of done

- [x] Founder/Product Owner decisions define scope, roles, fields, duplicate
      behavior, lifecycle, reasons, interface, validation, and server boundaries
- [x] Sources, assumptions, unresolved aviation rules, and later gates are
      explicit
- [x] Data, RLS, protected-command, UI, audit, security, and planned verification
      behavior is specified
- [x] Documentation formatting, structure, links, and duplication checks pass
- [x] Separate-agent review reports no unresolved actionable finding
- [ ] The scoped branch has a green review-ready pull request
