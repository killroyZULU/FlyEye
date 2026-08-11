# Feature Specification: FEAT-005 — User Management and Basic Profiles

## Contract references

- Baseline: merged through PR #15 at `a3a39ca68d86748728e49a2b39c81828bb8bb658`
- State: Delivered; forward incomplete-profile directory correction is locally verified, independently reviewed, and awaiting PR/CI
- Owner: Founder/Product Owner
- Correction branch: `fix/FIX-005-incomplete-profile-list-contract`
- Evidence plan: [FEAT-005 Traceability](FEAT-005_TRACEABILITY.md)
- Related requirements: SRS `IAM-002` through `IAM-012`, `REC-001` through
  `REC-003`, `NFR-004`, `NFR-008`, and `NFR-009`

## User outcome

As an Organization Admin, I can review and safely suspend, reactivate, or
revoke members of one organization. As an active member, I can maintain a
minimal organization-scoped profile without changing my account, role, or
authority.

## Scope

Included:

- Bounded organization-member list, search, status filter, and detail review
- Self-service organization-scoped basic profile with a required display name
  for a completed profile and an optional contact number
- Read-only current Auth email for the member and authorized Organization Admin
- Per-organization membership suspension, reactivation, and terminal revocation
- Preservation of the membership role and profile during status changes
- Last-active-Organization-Admin, self-action, tenancy, audit, concurrency, and
  reauthentication controls
- Local synthetic desktop/mobile and two-organization verification

Non-goals:

- Role assignment, demotion, multiple roles, delegation, or custom roles
  (`FEAT-006`)
- Auth-user deletion, global ban, password or MFA administration, invitation
  changes, or support impersonation
- Administrator editing of another member's profile
- Restoring or reinviting a revoked membership
- Bulk actions, imports, exports, directory sync, SSO, or external notifications
- Legal name verification, government identifiers, date of birth, guardian or
  consent records, address, emergency contact, photo, or attachments
- Aviation licence, rating, medical, qualification, currency, instructor, or
  student compliance data
- Real data, hosted activation, deployment, production, or retention approval

## Sources, assumptions, and unresolved questions

| Item | Source/owner/version | State |
|---|---|---|
| Member review, suspension, reactivation, server authority, tenancy, and audit | SRS `IAM-002`–`IAM-012`; Security Requirements sections 3–4 and 9 | Verified |
| Independent organization memberships and one initial role | Product and Governance Decisions, Organizations, memberships, and roles | Verified |
| Organization-scoped minimal profile and approved management boundary | Founder/Product Owner decision, 2026-08-10 | Verified |
| Profile fields: display name, optional contact number, read-only Auth email | Founder/Product Owner decision, 2026-08-10 | Verified |
| Organization-only terminal revocation without Auth or record deletion | Founder/Product Owner decision, 2026-08-10 | Verified |
| Existing `active`, `suspended`, and `revoked` membership states | Versioned FEAT-001 schema at the baseline | Verified locally |
| Exact real-data purpose, retention, correction, and contact-number procedure | School controller and qualified privacy/legal owner | Unresolved; blocks real-data use, not local synthetic delivery |
| Rejoining an organization after terminal revocation | Founder/Product Owner and future workflow specification | Unresolved; outside FEAT-005 |

No profile value is verified legal or aviation identity. Display name and
contact number are administrative convenience data only and never grant
authority.

## Roles and authority

| Action | Permission | Tenant/record rule | Execution boundary | Reauthentication |
|---|---|---|---|---|
| List, search, and review members | `membership.member.review` | Active administrator membership in the selected active organization; return that organization only | Protected Edge Function and atomic server-only RPC | Current AAL2/TOTP session |
| View own profile | Active membership | Exact authenticated subject and membership in the selected active organization | Protected Edge Function and server-only RPC | Current authenticated session and applicable portal MFA |
| Update own profile | Active membership | Exact authenticated subject and membership in the selected active organization; no role or status fields accepted | Protected Edge Function and atomic server-only RPC | Current authenticated session and applicable portal MFA |
| Suspend member | `membership.member.manage_status` | Same active organization; target active; actor cannot target self or last active administrator | Protected Edge Function and atomic server-only RPC | Password AMR no older than 600 seconds plus AAL2/TOTP |
| Reactivate member | `membership.member.manage_status` | Same active organization; target suspended; preserved role must remain active | Protected Edge Function and atomic server-only RPC | Password AMR no older than 600 seconds plus AAL2/TOTP |
| Revoke member | `membership.member.manage_status` | Same active organization; target active or suspended; actor cannot target self or last active administrator | Protected Edge Function and atomic server-only RPC | Password AMR no older than 600 seconds plus AAL2/TOTP |

The built-in `admin` role initially receives both permissions. Browser roles
receive no direct membership-status, profile-audit, or administration-event
table mutation authority. Profile ownership and administrator authority are
derived from server-controlled membership records, not JWT metadata, request
roles, email, or selected organization alone.

## Workflow and business rules

```text
active --authorized suspension--> suspended --authorized reactivation--> active
active --authorized revocation--> revoked
suspended --authorized revocation--> revoked
revoked --no FEAT-005 transition--> revoked
```

1. Every command revalidates that the organization is active. A suspended or
   unknown organization returns no profile or directory data and permits no
   profile or membership mutation. Member administration is organization-scoped;
   the same Auth user can remain active in another organization when one
   membership is suspended or revoked.
2. List and search return a cursor-paginated maximum of 50 members per page,
   ordered by immutable membership `created_at` descending and membership ID
   descending, with nulls prohibited in both keys. The server-issued opaque
   cursor contains that tuple, validates its shape, and is bound to the exact
   status filter and normalized search request; tampered or mismatched cursors
   are rejected. A display-name or Auth-email change between pages therefore
   cannot reorder the cursor. Newer memberships appear on a later refresh, while
   a status change may correctly remove a row from the active filter. Filters are
   `active`, `suspended`, and `revoked`. Search is a trimmed 2–80 character match
   using the database's `lower(btrim(value))` against display name or current Auth
   email within the authorized organization only; no Unicode or provider-specific
   alias normalization is applied.
3. Auth email is read from server-controlled Auth records at request time and
   is never copied into the profile. It is read-only in FEAT-005. Provider or
   database lookup failure returns a safe error rather than stale or fabricated
   identity data.
4. Each membership has at most one organization-scoped profile. A completed
   profile requires a trimmed display name of 2–80 characters. Contact number
   is optional, trimmed, at most 32 characters, and limited to digits, spaces,
   `+`, `-`, `(`, `)`, and `.`. It is not normalized into an assumed national
   format and is not used for authentication or SMS.
5. Existing memberships are backfilled with an incomplete profile rather than
   an invented name. Profile incompleteness is visible but does not create or
   remove authority. Saving requires a valid display name; clearing a completed
   display name is rejected.
6. Only an active member can update that member's own profile. Organization
   Admins can review but cannot rewrite another person's profile. Profile update
   accepts an expected version and replaces only display name and contact number.
7. Suspension immediately changes only the target organization membership from
   `active` to `suspended`. It preserves role, profile, invitation history, and
   audit evidence. Every server-authorized request and RLS path must deny the
   suspended membership even if a browser still holds an Auth session.
8. Reactivation changes only `suspended` to `active`. It revalidates that the
   organization and preserved role are active. It never adds or changes a role.
9. Revocation changes `active` or `suspended` to terminal `revoked`. It preserves
   the role link and records for evidence but creates no usable authority. It
   never deletes or globally bans the Auth user and never affects another
   organization membership.
10. Rejoining after revocation has no FEAT-005 path. A new invitation or direct
    update cannot bypass the existing membership conflict. A later approved
    workflow must define any restoration.
11. Suspension, reactivation, and revocation require one action-specific,
    server-approved reason code, target membership version, and opaque
    idempotency key. Arbitrary reason codes and all free-text reason fields are
    rejected. Same-scope replay returns the stable result; changed input, stale
    version, invalid state, or concurrent action returns a safe conflict.

    | Action | Code | UI label |
    |---|---|---|
    | Suspend | `temporary_access_hold` | Temporary access hold |
    | Suspend | `administrative_review` | Administrative review |
    | Reactivate | `hold_resolved` | Hold resolved |
    | Reactivate | `suspension_corrected` | Suspension corrected |
    | Revoke | `membership_ended` | Membership ended |
    | Revoke | `membership_created_in_error` | Membership created in error |

    The server returns only the codes valid for the requested action. These
    categories document an administrative access decision; they do not state a
    legal, aviation, employment, disciplinary, or security conclusion.
12. Self-suspension and self-revocation are prohibited. Suspended users cannot
    reactivate themselves because they lack active administration authority.
13. The database locks the target membership and relevant active administrator
    memberships in a stable order. A command that would leave zero active
    Organization Admins fails before changing status. Role text or client counts
    are never authoritative.
14. Membership status, version, actor, update timestamp, required audit event,
    and idempotency result change in one transaction. Audit or constraint failure
    rolls back the status change. No external provider call is required.
15. Profile update and its audit event also commit atomically. A stale version,
    invalid value, inactive membership, audit failure, or cross-tenant attempt
    preserves the prior profile.
16. Organization-member list, search, and detail data are returned by an atomic
    server-only RPC only after its minimized access event commits in the same
    transaction. Audit-write failure returns no directory or profile data.

## Data and server contract

`organization_member_profiles` contains an opaque ID, `organization_id`,
`membership_id`, nullable display name until first valid completion, optional
contact number, positive version, creation/update attribution, and UTC
timestamps. A composite foreign key binds the profile to the same organization
membership, and a unique constraint permits one profile per membership.

The table is tenant-owned, RLS-enabled, deny-by-default, and inaccessible to
`PUBLIC` and `anon`. `authenticated` receives no direct write grant. Protected
server-only functions perform reads and atomic updates. Status remains
authoritative in `organization_memberships`; FEAT-005 adds no duplicate status
or role field.

`member_administration_events` is append-only and records organization, actor,
target membership, event name, outcome, reason code, correlation ID, hashed
idempotency key where applicable, non-sensitive metadata, and UTC time. Required
events cover member list/detail access, profile update, suspension,
reactivation, revocation, denial, and conflict. Ordinary browser roles cannot
insert, update, or delete these events.

Protected commands are `list-organization-members`, `get-organization-member`,
`get-my-member-profile`, `update-my-member-profile`,
`suspend-organization-member`, `reactivate-organization-member`, and
`revoke-organization-member`. Stable error families include unauthenticated,
unauthorized, recent-auth-required, validation-failed, not-found,
state-conflict, last-administrator, rate-limited, and service-unavailable. Safe
denials do not reveal another organization, user, membership, role, profile,
email, or status.

The migration adds the two permissions only to the built-in Organization Admin
role, creates incomplete profiles for existing memberships, adds constraints,
indexes, RLS, grants, protected functions, and event tables, and regenerates
database types. Rollback in shared environments is forward-fix only after data
exists; destructive profile or audit removal is not an ordinary rollback.

## UI behavior

- Administration adds a Members page with bounded search, status filter,
  responsive list/cards, member detail, profile completeness, read-only role,
  read-only email, and permitted status actions.
- The member profile page exposes display name and optional contact number while
  making email and organization read-only. It does not label display name as a
  legal name or contact number as a verified phone.
- Status actions show organization, target, current and resulting status,
  preserved role, permanence of revocation, and one required server-provided
  reason category before final confirmation. Free-text reasons are not collected.
  Revocation uses stronger terminal-action wording.
- Required states include loading, empty, incomplete profile, unauthorized,
  recent-auth required, validation error, saving, success, stale conflict,
  last-administrator conflict, rate limited, service unavailable, and offline.
- No profile or membership mutation is queued offline. Entered profile data
  remains in memory after recoverable validation or conflict errors but is not
  placed in local storage, analytics, screenshots, or logs.
- Keyboard order, labelled controls, validation summary, focus recovery, live
  status, non-color status labels, confirmation semantics, 200% reflow, target
  size, contrast, desktop/mobile behavior, and responsive member cards receive
  automated support plus explicit formal-review limitations.

## Audit and observability

- Successful status events record status transition, target membership, actor,
  approved reason code, prior and new versions, organization, correlation, and
  time without copying email, contact number, display name, or free text.
- Profile events record changed field names only, never prior/current values.
- List/detail access events record bounded action and result count without query
  text, email, names, contact numbers, or returned rows.
- Denied, conflicted, last-administrator, rate-limited, and audit-failure signals
  are monitorable without exposing hidden tenant or identity data.
- Same idempotency scope cannot create duplicate status events.

Local atomic token buckets use a dedicated FEAT-005 limiter secret:

| Action | Local limit | Burst | Failure behavior |
|---|---:|---:|---|
| Member list/detail | 30 per 60 seconds per actor and organization | 10 | Fail closed without directory data |
| Own-profile read/update | 12 per 60 seconds per subject and membership | 4 | Preserve profile on denial |
| Suspend/reactivate/revoke | 6 per 60 seconds per actor and organization | 2 | Preserve membership and audit no false success |

Unauthorized organization or membership hints collapse to one actor-and-action
denial scope. Hosted thresholds, network-source trust, capacity, monitoring,
retention, alert ownership, and support remain environment-specific gates.

## Security, privacy, and abuse cases

- Display name, contact number, email, membership status, and role are personal
  administrative data visible only to the subject and authorized administrators
  of that organization.
- Cross-tenant list, search, direct-ID, profile, status-command, RPC, and Edge
  attempts return safe denials and create no inference or mutation.
- Direct table/RPC access, user-metadata roles, forged organization selection,
  arbitrary status, self-action, last-admin races, stale versions, replay,
  malformed search/profile/reason input, and limiter bypass are adversarial cases.
- Suspension and revocation do not rely on frontend logout. Server membership
  checks and RLS deny every subsequent protected or direct data path.
- Search input is data, never dynamic SQL. Logs and audit exclude query text and
  all profile values.
- Service-role credentials remain server-only. Synthetic `.test` identities in
  at least two organizations are the only fixtures.

## Acceptance criteria

- `FEAT-005-AC-01` Only an active permitted Organization Admin with AAL2/TOTP
  can list, search, filter, and review members of the selected active
  organization, and no directory data is returned unless the minimized access
  audit commits in the same transaction.
- `FEAT-005-AC-02` Member results are bounded, cursor-paginated, consistently
  ordered by immutable creation time and ID, bound to the search/filter request,
  stable across name/email changes, and limited to approved fields.
- `FEAT-005-AC-03` Search and filters cannot reveal another organization's
  members, emails, profiles, roles, or statuses.
- `FEAT-005-AC-04` An active member can view and update only that member's own
  organization-scoped display name and optional contact number.
- `FEAT-005-AC-05` Profile validation, expected version, and audit are enforced
  atomically; invalid, stale, inactive, or cross-tenant updates preserve data.
- `FEAT-005-AC-06` Existing memberships receive explicit incomplete profiles
  without invented identity data or authority changes.
- `FEAT-005-AC-07` Auth email and role are current read-only values and cannot
  be changed through profile input or metadata.
- `FEAT-005-AC-08` Suspension requires same-organization permission, fresh
  password AMR, AAL2/TOTP, valid state/version, idempotency, and one approved
  `temporary_access_hold` or `administrative_review` reason code; arbitrary,
  cross-action, and free-text reasons are rejected.
- `FEAT-005-AC-09` Suspended membership loses all organization authority on
  server and RLS paths while preserving profile, role, history, and other tenants.
- `FEAT-005-AC-10` Reactivation accepts only suspended membership with an active
  organization, preserved active role, and `hold_resolved` or
  `suspension_corrected`; it grants no additional role.
- `FEAT-005-AC-11` Revocation accepts active or suspended membership, is
  terminal in FEAT-005, requires `membership_ended` or
  `membership_created_in_error`, preserves records, and never deletes or
  globally bans Auth.
- `FEAT-005-AC-12` Self-suspension, self-revocation, self-reactivation, and any
  action leaving zero active Organization Admins are denied under concurrency.
- `FEAT-005-AC-13` Status, version, attribution, idempotency, and required audit
  commit once or roll back together.
- `FEAT-005-AC-14` Same-scope retry is stable; changed input, stale version,
  invalid state, and concurrent commands return safe conflicts.
- `FEAT-005-AC-15` Direct browser table/RPC writes to membership status,
  profile audit, roles, and administration events are denied.
- `FEAT-005-AC-16` Errors, audit, logs, evidence, analytics, and screenshots
  contain no contact number, email, display name, reason text, token, or secret.
- `FEAT-005-AC-17` Local rate-limit, offline, service, database, and audit
  failure paths create no partial profile or membership change and disclose no
  unaudited member-directory data.
- `FEAT-005-AC-18` Required responsive and accessibility states are covered
  with formal human-review limitations explicit.
- `FEAT-005-AC-19` FEAT-001 through FEAT-004 Auth, recovery, MFA, invitations,
  RLS, tenancy, audit, runtime, and browser behavior remain green.
- `FEAT-005-AC-20` Local synthetic evidence makes no hosted, real-data,
  retention, qualified privacy, deployment, or production claim.

## Planned verification

| Test ID | Level | Scenario | Expected result |
|---|---|---|---|
| `FEAT-005-UNIT-01` | Unit | Profile, search, reason-code, status, cursor binding, error, and request schemas | Exact bounded validation and safe failures |
| `FEAT-005-COMP-01` | Component | Member list/search/filter/detail states | Accessible organization-only behavior |
| `FEAT-005-COMP-02` | Component | Own-profile completion/update and conflict states | Values preserved safely and fields remain bounded |
| `FEAT-005-COMP-03` | Component | Suspend/reactivate/revoke confirmations and errors | Clear authority, permanence, and recovery guidance |
| `FEAT-005-SQL-01` | SQL | Profile/event schema, constraints, backfill, indexes, statuses | Schema invariants and no invented profile data |
| `FEAT-005-RLS-01` | SQL/RLS | `PUBLIC`, `anon`, and `authenticated` direct operations | Prohibited access denied |
| `FEAT-005-RPC-01` | SQL/RPC | Profile update atomicity, versioning, and audit failure | One complete update or rollback |
| `FEAT-005-RPC-02` | SQL/RPC | Status transitions, exact per-action reason-code allowlists, replay, stale versions, invalid states | Exact transition and audit behavior; arbitrary and cross-action codes denied |
| `FEAT-005-RPC-03` | SQL/RPC | Self-action and last-admin concurrent races | At least one active administrator remains |
| `FEAT-005-RPC-04` | SQL/RPC | Directory list/detail audit success and injected audit failure | Data returns only with committed minimized access event |
| `FEAT-005-EDGE-01` | Edge | JWT, origin, body, active organization, AAL2, fresh password, permission, lookup failure | Protected commands fail closed |
| `FEAT-005-TENANT-01` | Runtime | Same subject in two organizations; cross-tenant list/search/IDs | No leakage; independent membership effects |
| `FEAT-005-AUTH-01` | Runtime | Active, suspended, reactivated, and revoked sessions | Server access tracks membership state immediately |
| `FEAT-005-PAGE-01` | Integration | Profile/email change and new/status-changed rows between cursor pages | Stable tuple order, valid filter behavior, no mutable-key duplication |
| `FEAT-005-E2E-01` | Browser | Admin review/status flow and member profile on desktop/mobile | End-to-end approved behavior |
| `FEAT-005-A11Y-01` | Browser/manual support | Keyboard, focus, announcements, reflow, contrast, target size | Automated scope pass; formal review later |
| `FEAT-005-SEC-01` | Security | Enumeration, injection, metadata, replay, races, limiter, secret scans | No bypass or prohibited disclosure |
| `FEAT-005-REG-01` | Regression | Complete application and database/runtime matrices | FEAT-001–004 remain green |
| `FEAT-005-FIXTURE-01` | Runtime | Random synthetic profiles/members and unconditional cleanup | Zero unintended residue or uncertain cleanup |

## Dependencies

No new package, paid provider, file storage, or external notification service is
planned. The feature uses the pinned Supabase client/CLI, PostgreSQL, Edge
Functions, existing authentication evidence, limiter pattern, and test stack.

## Change boundary

Allowed areas:

- One FEAT-005 SQL migration, generated database types, focused Edge Function,
  Administration/Members and profile UI, tests, runtime fixture, and canonical
  FEAT-005 documentation/evidence
- Minimal shared Auth, access-context, limiter, error, styling, and test-harness
  changes required by the approved contract

Excluded areas:

- FEAT-006 role assignment and unrelated product modules
- Architecture or authority changes outside this specification
- Hosted resources, real data, production deployment, destructive operations,
  merge, and branch deletion

## Definition of done

- [x] Contract, sources, assumptions, and unresolved items remain explicit
- [x] Data, RLS, protected commands, UI, audit, and rate limits are implemented
- [x] Positive, negative, cross-tenant, concurrency, failure, and accessibility-supporting checks pass
- [x] Service-role authority and all personal values remain appropriately bounded
- [x] Traceability records reproducible evidence and limitations
- [x] Documentation checks and separate-agent review pass
- [x] Scoped branch has a green review-ready pull request
