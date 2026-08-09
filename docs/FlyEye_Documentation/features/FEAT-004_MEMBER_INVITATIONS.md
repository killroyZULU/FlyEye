# Feature Specification: FEAT-004 — Member Invitations

## Status

- State: Ready for implementation-authorization decision
- Current SDLC phase: Specification
- Owner: Founder/Product Owner
- Baseline: `main` at `f1afa5da9008a47c0369f44fb03fde0acf1109b4`
- Task branch: `docs/feat-004-member-invitations-spec`
- Evidence plan: [FEAT-004 Traceability](FEAT-004_TRACEABILITY.md)
- Related requirements: SRS `IAM-001` through `IAM-012`

## User outcome

As an Organization Admin, I can invite one person to one organization with one
approved initial role, safely resend or revoke a pending invitation, and let the
verified recipient explicitly accept it without creating cross-tenant or
premature authority.

## Scope

Included:

- Create, list, resend, expire, supersede, revoke, and accept one-person member
  invitations
- Exactly one initial role: Student Pilot, Instructor Pilot, or Organization
  Admin
- New Supabase Auth users and existing confirmed FlyEye users
- One-hour invitation validity and fail-closed delivery uncertainty
- Atomic membership, initial-role, invitation-state, and audit changes on
  acceptance
- Local synthetic email capture and two-organization verification

Non-goals:

- General role changes, multiple roles, delegation, or custom role creation
  (`FEAT-006`)
- Profiles, suspension, reactivation, membership review, or deprovisioning
  (`FEAT-005`)
- Bulk import, batch invitation, public registration, anonymous acceptance, or
  social/SSO onboarding
- Minor-student consent or guardian workflow, production email, hosted provider
  activation, real data, deployment, or production approval
- MFA recovery, factor replacement, recovery codes, or support override

## Sources, assumptions, and unresolved questions

| Item | Source/owner/version | State |
|---|---|---|
| Invitation-only accounts and protected membership authority | SRS `IAM-001`–`IAM-012`; Security Requirements sections 3–4 | Verified |
| One role per membership and later invitation workflow | Product and Governance Decisions, Organizations, memberships, and roles | Verified |
| Initial roles and future role extensibility | Founder/Product Owner decision, 2026-08-09 | Verified |
| Explicit acceptance for new and existing users | Founder/Product Owner decision, 2026-08-09 | Verified |
| One-hour validity | Founder/Product Owner decision and local `auth.email.otp_expiry = 3600` | Verified for local scope |
| Supabase invitation, existing-user, redirect, and email-link behavior | [Supabase Users](https://supabase.com/docs/guides/auth/users), [Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates), and [Passwordless Email](https://supabase.com/docs/guides/auth/auth-email-passwordless), accessed 2026-08-09 | Provider-documented; verify against pinned local versions |
| Hosted SMTP, domain, capacity, monitoring, and support | Founder/Product Owner and qualified lifecycle owners | Unresolved; later gate |
| Real-data invitation retention and minor-student procedure | School, privacy/legal owner, and approved retention sources | Unresolved; blocks real-data use, not local synthetic delivery |

## Roles and authority

| Action | Permission | Tenant/record rule | Execution boundary | Reauthentication |
|---|---|---|---|---|
| List invitations | `membership.invitation.manage` | Active membership in the selected organization; return that organization only | Protected Edge Function and server-only RPC | Current password-authenticated AAL2/TOTP session |
| Create invitation | `membership.invitation.manage` | Selected organization is a validated hint; server derives actor membership and validates the initial role | Protected Edge Function and atomic server-only RPC | Password AMR no older than 600 seconds plus AAL2/TOTP |
| Resend invitation | `membership.invitation.manage` | Actor's organization; `pending`, `expired`, `delivery_failed`, `delivery_uncertain`, or `issuing` after the 60-second uncertainty cooldown | Protected Edge Function and atomic server-only RPC | Password AMR no older than 600 seconds plus AAL2/TOTP |
| Revoke invitation | `membership.invitation.manage` | Actor's organization; `pending`, `delivery_failed`, `delivery_uncertain`, or `issuing` after the 60-second uncertainty cooldown | Protected Edge Function and atomic server-only RPC | Password AMR no older than 600 seconds plus AAL2/TOTP |
| Accept invitation | Verified invited Auth subject | Invitation ID is only a hint; confirmed Auth email must match the locked invitation | Protected Edge Function and atomic server-only RPC | Password AMR no older than 600 seconds; role-specific portal MFA remains enforced by `auth-bootstrap` |

The built-in `admin` role initially receives
`membership.invitation.manage`. Browser roles receive no direct invitation,
membership, role, or audit table mutation authority. A future delegated inviter
requires an explicit reviewed permission assignment.

## Workflow and business rules

```text
issuing --provider send accepted--> pending --verified acceptance--> accepted
issuing --known failure--> delivery_failed
issuing --unknown provider result--> delivery_uncertain
pending --command materializes elapsed expiry--> expired
pending/expired/delivery_failed/delivery_uncertain/stale issuing --resend--> superseded + new issuing
pending/delivery_failed/delivery_uncertain/stale issuing --revoke--> revoked
```

1. An administrator enters one ASCII email address and selects exactly one
   server-approved initial role. The authoritative canonicalization is
   `lower(btrim(value))` in PostgreSQL after rejecting control characters,
   non-ASCII input, and values longer than 254 characters. The same operation
   is applied to the confirmed Auth email before acceptance. No provider alias
   transformation, Unicode normalization, plus-tag removal, or dot folding is
   permitted. Names and profile fields remain outside this feature.
2. Initial invite-assignable roles are `student_pilot`, `instructor_pilot`, and
   `admin`. The server locks and validates an active role marked
   `is_invitation_assignable`; client text, metadata, or hidden fields are not
   authority.
3. New roles default to not invite-assignable. Enabling a future role requires a
   reviewed migration, permission mapping, UI label, acceptance coverage, and
   tenant/security tests. The schema does not otherwise hard-code three roles.
4. Only one nonterminal invitation may exist for a normalized email and
   organization. Invitations to the same email in different organizations are
   independent and disclose nothing across tenants.
5. Invitation issuance is a two-transaction saga. The first transaction records
   `issuing` state and its intent audit before Supabase Auth is called. After the
   provider call, a second transaction locks the invitation and atomically
   records the safe provider result, state transition, and delivery-attempt
   audit. Only a provider-accepted send may become `pending`; this proves no
   inbox delivery. Known failure becomes `delivery_failed`, and an unknown
   provider result becomes `delivery_uncertain`.
6. The post-provider RPC uses a stable operation ID and is idempotent. A
   confirmed transaction failure leaves the invitation non-accepting `issuing`.
   A lost or timed-out response is not proof of commit or rollback: the Edge
   Function repeats the same operation or performs server-only read-back until
   it resolves the locked database state. Atomic `pending` plus its audit is
   valid acceptance authority even if the first response was lost; `issuing`
   remains non-accepting. If bounded read-back cannot resolve state, the caller
   receives `delivery_uncertain` guidance and must not report send success,
   failure, or start another provider call.
7. For a new or unconfirmed Auth identity, the trusted server uses
   `inviteUserByEmail`. If Supabase reports an existing confirmed identity, the
   server sends a passwordless sign-in notification with
   `shouldCreateUser: false`; the response to the administrator remains generic.
8. Provider email links authenticate or identify the recipient but never create
   FlyEye membership by themselves. The invitation callback requires an
   explicit user action, credential establishment when needed, and a fresh
   password-authenticated session before acceptance.
9. `issued_at` and `expires_at` use PostgreSQL transaction time, with
   `expires_at` exactly one hour after issuance. Equality is expired. Provider
   expiry is defense in depth; FlyEye's locked database state is authoritative.
   Before list, create, resend, revoke, or accept makes its decision, its
   server-only RPC locks relevant nonterminal rows, changes every elapsed
   `pending` row to `expired`, and writes the expiry audit in the same
   transaction. This materialization permits a new invitation after expiry;
   absence of a command never extends or revives validity.
10. Resend is permitted only from `pending`, `expired`, `delivery_failed`,
    `delivery_uncertain`, or `issuing` at least 60 seconds old. It atomically
    marks the source invitation superseded with an audit and creates a new
    `issuing` invitation before one new provider call. Any older provider link
    may authenticate but cannot accept the superseded FlyEye invitation.
11. Revocation is permitted only from `pending`, `delivery_failed`,
    `delivery_uncertain`, or `issuing` at least 60 seconds old. It blocks
    acceptance even if a provider link is still valid. Accepted invitations
    cannot be revoked; later member suspension is FEAT-005.
12. Acceptance locks the organization, invitation, matching membership, and
    role in a stable order; revalidates actor subject, confirmed email, password
    AMR, role, status, expiry, organization, and version; then creates one active
    membership, assigns one initial role, accepts the invitation, and writes
    audit evidence in one transaction.
13. Existing membership, concurrent acceptance, changed email, inactive role,
    suspended organization, expired/revoked/superseded invitation, audit
    failure, or provider uncertainty creates no new authority.
14. Acceptance and state commands use opaque idempotency keys. Same-scope retry
    returns a safe stable result; a conflicting key or stale version returns a
    non-enumerating conflict.

## Data and server contract

`organization_invitations` contains:

- opaque ID, `organization_id`, original bounded email, authoritative canonical
  email, initial `role_id`, status, version, and exact issue/expiry timestamps;
- inviter subject, created/updated timestamps, terminal timestamps, accepted
  subject/membership, superseded invitation, and hashed idempotency scope;
- bounded delivery state, attempt count, last-attempt time, provider operation
  class, and correlation IDs without provider tokens or message bodies.

The table is tenant-owned, RLS-enabled, deny-by-default, and inaccessible to
`PUBLIC`, `anon`, and `authenticated` table operations. Composite constraints
prevent cross-organization membership, role, and supersession relationships.
A partial unique index permits at most one nonterminal invitation per
organization and canonical email. Protected commands materialize elapsed rows
before uniqueness-dependent creation.

`roles.is_invitation_assignable` defaults to false. A migration enables it only
for the three approved initial roles and adds
`membership.invitation.manage` only to the built-in Organization Admin role.

Protected commands are `list-member-invitations`, `invite-member`,
`resend-member-invitation`, `revoke-member-invitation`, and
`accept-member-invitation`. Stable error families include unauthenticated,
unauthorized, recent-auth-required, validation-failed, not-found,
state-conflict, expired, rate-limited, delivery-failed, delivery-uncertain, and
provider-unavailable. Errors never reveal whether an email already has an Auth
identity, another tenant membership, or an invitation elsewhere.

Version-controlled local Auth configuration adds exact invitation callback
origins and a custom invite template. A callback destination not on the exact
allowlist fails configuration validation; it must not silently fall back to a
different Site URL. No new package is planned.

## UI behavior

- Administration shows an invitations page with a single-invite form and a
  bounded list of that organization's invitations.
- The form uses an email field and one role selector populated only from the
  server-approved invite-assignable roles. It includes validation summary,
  duplicate-submit protection, and confirmation of organization, email, and
  role before sending.
- Required states are loading, empty, validation error, unauthorized,
  recent-auth required, sending, sent, rate limited, delivery failed, delivery
  uncertain, expired, revoked, superseded, conflict, offline, and success.
- The acceptance route supports new credential setup, existing-account sign-in,
  explicit acceptance, stale/wrong-account guidance, role-specific MFA
  continuation, and final `auth-bootstrap` revalidation.
- Email, invitation identifiers, Auth tokens, and provider responses are never
  placed in analytics, screenshots, accessible names, local storage, offline
  queues, or diagnostic output. No invitation mutation is queued offline.
- Keyboard order, focus changes, labelled fields, live status, error summary,
  200% reflow, contrast, target size, and desktop/mobile layouts receive
  automated support plus human-review limitations.

## Audit and observability

Atomic events cover invitation created, accepted, revoked, expired, superseded,
denied, and conflicted. The post-provider state transition and delivery-attempt
event commit in one locked transaction; audit failure cannot open `pending`
acceptance authority. Delivery-attempt evidence records only invitation ID,
organization, actor/subject when verified, operation class, safe provider
acceptance/failure/uncertainty, attempt number, correlation ID, and timestamps.
It does not claim inbox delivery. Emails, tokens, links, secrets, provider
bodies, and hidden tenant or identity state are prohibited.

Local atomic token buckets use a dedicated invitation-limiter secret:

| Action | Local limit | Burst | Required failure behavior |
|---|---:|---:|---|
| `list` | 12 per 60 seconds per actor and organization | 4 | Fail closed |
| `create` | 6 per hour per actor and organization | 2 | No row or provider call after denial |
| `resend` | 3 per hour per invitation and actor | 1 | Preserve current state |
| `revoke` | 6 per 60 seconds per actor and organization | 2 | Preserve current state |
| `accept` | 6 per 60 seconds per subject and invitation | 2 | Create no membership |

Provider quotas and frontend timers are defense in depth only. Hosted
thresholds, network-source trust, capacity, alert ownership, retention, and
support remain later environment-specific gates.

## Security, privacy, and abuse cases

- Email is personal data and is visible only to authorized administrators in
  its organization and the matching verified recipient.
- Cross-tenant list, ID, email, resend, revoke, and acceptance attempts return
  safe denials without confirming hidden state.
- Direct table/RPC calls by browser roles, user-metadata roles, arbitrary role
  IDs, stale organization selection, replay, races, mixed-case duplicate email,
  and inviter/invitee role confusion are adversarial test cases.
- Email-link prefetch or tracking may authenticate or consume a provider token
  but cannot accept FlyEye membership without an explicit action and fresh
  password AMR.
- Service-role credentials remain only in the protected Edge runtime. Delivery,
  database, limiter, and audit uncertainty fail closed.
- Synthetic `.test` identities in at least two organizations are the only local
  fixture data. Minor status and real identity information are prohibited.

## Acceptance criteria

- [ ] `FEAT-004-AC-01` Only an active permitted Organization Admin with current
      AAL2/TOTP and fresh password AMR can create, resend, or revoke.
- [ ] `FEAT-004-AC-02` Listing returns only the selected authorized
      organization's bounded invitation data.
- [ ] `FEAT-004-AC-03` Exactly one approved active initial role is accepted;
      arbitrary, inactive, future-disabled, or multi-role input is denied.
- [ ] `FEAT-004-AC-04` Future roles remain disabled until a reviewed
      server-controlled change enables invitation assignment.
- [ ] `FEAT-004-AC-05` New identities receive the provider invitation path;
      existing confirmed identities receive the existing-account path without
      exposing identity existence to the inviter.
- [ ] `FEAT-004-AC-06` Issuance intent/audit precedes the provider call; the
      locked post-provider state/audit transaction is atomic and idempotent;
      confirmed failure leaves non-accepting `issuing`; and transport uncertainty
      is resolved from database state without assuming commit or rollback.
- [ ] `FEAT-004-AC-07` Validity is exactly one hour by database time; equality
      and later are expired, relevant commands materialize expiry atomically,
      and a new invitation can be created after the previous one expires.
- [ ] `FEAT-004-AC-08` Resend accepts only the specified state/cooldown set,
      supersedes the old invitation, makes one new provider call, and prevents
      old links from creating membership.
- [ ] `FEAT-004-AC-09` Revocation accepts only the specified state/cooldown set
      and prevents acceptance without changing an already accepted member.
- [ ] `FEAT-004-AC-10` A provider link alone cannot create membership or role
      authority.
- [ ] `FEAT-004-AC-11` Acceptance requires matching confirmed Auth email,
      verified subject, fresh password AMR, and the exact locked invitation.
- [ ] `FEAT-004-AC-12` Acceptance atomically creates one active membership, one
      initial role, accepted state, and audit evidence.
- [ ] `FEAT-004-AC-13` Audit, constraint, organization, role, membership, or
      concurrency failure rolls back all FlyEye authority.
- [ ] `FEAT-004-AC-14` Same- and cross-invitation races create at most one
      organization membership for the subject.
- [ ] `FEAT-004-AC-15` Same email in separate organizations remains isolated and
      may produce independent memberships only through independent acceptance.
- [ ] `FEAT-004-AC-16` Existing membership, wrong account, changed email, stale
      version, expired, revoked, superseded, and unknown IDs fail without
      enumeration.
- [ ] `FEAT-004-AC-17` Email canonicalization is identical in server and
      database paths; whitespace/case variants cannot bypass uniqueness, and
      provider-specific alias rewriting is not used.
- [ ] `FEAT-004-AC-18` Role-specific MFA and portal permission are revalidated by
      `auth-bootstrap` after acceptance; invitation never grants aviation or
      operational authority.
- [ ] `FEAT-004-AC-19` Rate-limit, provider, offline, and delivery uncertainty
      create no bypass, duplicate mutation, or unsafe retry.
- [ ] `FEAT-004-AC-20` Required responsive and accessibility states are covered
      with human-only limitations explicit.
- [ ] `FEAT-004-AC-21` Source, build, logs, evidence, and history contain no
      invitation token, Auth credential, real identity, service key, or provider
      message body.
- [ ] `FEAT-004-AC-22` FEAT-001 through FEAT-003 Auth, recovery, MFA, RLS,
      tenancy, audit, and browser behavior remain green.
- [ ] `FEAT-004-AC-23` Local synthetic evidence does not claim hosted email,
      real-data, deployment, production, minor-student, or universal-MFA
      readiness.

## Planned verification

| Test ID | Level | Scenario | Expected result |
|---|---|---|---|
| `FEAT-004-UNIT-01` | Unit | Email canonicalization, role, state, expiry, error, and callback validation | Exact bounded schemas and safe failures |
| `FEAT-004-COMP-01` | Component | Admin create/list/resend/revoke states | Accessible deterministic behavior |
| `FEAT-004-COMP-02` | Component | New/existing/wrong-account acceptance states | Explicit acceptance and corrective guidance |
| `FEAT-004-SQL-01` | SQL | Tables, constraints, canonical email, indexes, statuses, one-hour boundary | Schema invariants pass |
| `FEAT-004-RLS-01` | SQL/RLS | `PUBLIC`, `anon`, and `authenticated` direct access | All prohibited access denied |
| `FEAT-004-RPC-01` | SQL/RPC | Create/resend/revoke/accept atomicity and idempotency | State and audit remain atomic |
| `FEAT-004-RPC-02` | SQL/RPC | Same/different invitation races | At most one membership and role |
| `FEAT-004-RPC-03` | SQL/RPC | Elapsed pending row is materialized, audited, and reinvited | Expired row no longer blocks a new invitation |
| `FEAT-004-EDGE-01` | Edge | JWT, origin, body, AMR, AAL2, permission, role, provider errors | Protected commands fail closed |
| `FEAT-004-TENANT-01` | Runtime | Two organizations, same/different emails and direct IDs | No cross-tenant read, inference, or mutation |
| `FEAT-004-AUTH-01` | Runtime | New identity invitation, password setup, acceptance | One verified membership |
| `FEAT-004-AUTH-02` | Runtime | Existing confirmed identity joins another organization | Explicit second-organization acceptance |
| `FEAT-004-AUTH-03` | Runtime | Expired, resent, revoked, wrong account, provider uncertainty, and lost post-provider response | Database state is read back idempotently; no outcome is assumed |
| `FEAT-004-MAIL-01` | Runtime | Local invite/magic-link templates and exact callback allowlist | Mail captured locally with safe callback |
| `FEAT-004-E2E-01` | Browser | Admin invites and recipient accepts on desktop/mobile | End-to-end success and final bootstrap |
| `FEAT-004-A11Y-01` | Browser/manual support | Keyboard, focus, announcements, reflow, contrast, target size | Automated scope pass; formal review later |
| `FEAT-004-SEC-01` | Security | Enumeration, replay, races, arbitrary roles, metadata, secret scans | No bypass or prohibited disclosure |
| `FEAT-004-REG-01` | Regression | Complete application and database/runtime matrices | FEAT-001–003 remain green |
| `FEAT-004-FIXTURE-01` | Runtime | Random synthetic identities, cleanup, residue scan | Zero unintended residue or uncertain cleanup |

## Dependencies

No new package or paid provider is planned. The feature uses the pinned
Supabase client/CLI, PostgreSQL, Edge Functions, local SMTP capture, and existing
test stack. Hosted SMTP remains separately gated.

## Change boundary

Allowed areas:

- One version-controlled migration, generated database types, invitation Edge
  Functions/shared contracts, Auth callback and administration UI, local email
  templates/configuration, focused fixtures/tests, and canonical evidence

Excluded areas:

- FEAT-005 member administration, FEAT-006 general role assignment, profiles,
  operational modules, bulk tools, architecture replacement, hosted mutation,
  real data, deployment, production, destructive cleanup, and branch deletion

## Definition of done

- [ ] Contract, sources, assumptions, and later gates remain explicit
- [ ] Data, RLS, protected commands, frontend, email, audit, limiter, and
      cleanup behavior are implemented with synthetic data
- [ ] Positive, negative, cross-tenant, concurrency, replay, failure,
      accessibility-supporting, and secret checks pass
- [ ] Provider links and service-role authority never become FlyEye membership
      authority
- [ ] Traceability records exact evidence and limitations
- [ ] Documentation checks and separate review pass
- [ ] A scoped implementation branch has a green review-ready pull request
