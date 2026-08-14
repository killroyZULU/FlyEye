# Feature Specification: FEAT-006 — Member MFA Readiness and Role Assignment

## Status

- State: Slice A merged; Slice B implemented and locally verified
- Current SDLC phase: Slice B review-ready PR #27 open; required CI green
- Owner: Founder/Product Owner
- Baseline: `main` at Slice A PR #25 merge `835b9dc`
- Slice A: merged through PR #25
- Slice B: Issue #26; `feat/FEAT-006-role-assignment`; PR #27
- Evidence plan: [FEAT-006 Traceability](FEAT-006_TRACEABILITY.md)
- Related requirements: SRS `IAM-002`, `IAM-003`, `IAM-005`–`IAM-012`,
  `REC-001`–`REC-003`, and `NFR-004`, `NFR-008`, `NFR-010`

## User outcomes

1. As an active FlyEye member, I can privately enroll and verify my first TOTP
   authenticator so that my account can become eligible for privileged access
   without an administrator handling my authenticator secret.
2. As an Organization Admin, I can replace another active member's one assigned
   FlyEye role with one approved built-in role after the server verifies the
   member's MFA readiness when the new role is privileged.

## Staggered delivery

FEAT-006 is delivered as two bounded, sequential slices:

1. **Slice A — Member TOTP enrollment.** Add self-service initial enrollment,
   server-confirmed readiness, audit, failure handling, and local synthetic
   verification. It changes no membership role or application permission.
2. **Slice B — Role assignment.** Add the protected Organization Admin role
   replacement command and UI. It depends on the merged Slice A readiness
   contract and revalidates the target's current Auth factor before privileged
   assignment.

Each slice receives its own issue, branch, migration, verification, review, and
review-ready pull request. Slice B does not begin until Slice A reaches its
stable pull-request boundary and any required baseline decision is made.

## Scope

### Slice A included

- Self-service initial TOTP enrollment for an authenticated active member in
  the deployment's sole active organization
- Enrollment access for a Student from Account security and for an
  Instructor/Admin blocked from a privileged workspace because no verified
  TOTP exists
- Recent password authentication, strict factor inventory, one-factor limit,
  provider/database consistency, rate limiting, idempotency, audit, safe
  cancellation, responsive UI, and synthetic verification
- A deny-by-default server-controlled readiness record bound to the active
  membership, Auth subject, and a hash of the verified factor reference
- Existing verified-factor confirmation without exposing or replacing it

### Slice B included

- Replace exactly one existing membership role with exactly one approved active
  built-in role: Student Pilot, Instructor Pilot, or Organization Admin
- Organization Admin permission, self-action denial, last-active-admin
  protection, recent authentication, audit, concurrency, idempotency, rate
  limiting, and cross-school isolation
- Existing member-directory detail and confirmation UI for active memberships
- Immediate server-side permission effect and role-specific MFA enforcement on
  the target's next access bootstrap
- Live server verification of the target's current TOTP factor and matching
  readiness record before assigning Instructor Pilot or Organization Admin

### Non-goals

- Multiple simultaneous roles, custom roles, permission editing, delegation,
  temporary elevation, emergency override, bulk assignment, or directory sync
- Self-assignment, self-demotion, role removal without replacement, or changes
  for suspended or revoked memberships
- Administrator-created TOTP secrets or administrator access to another
  member's QR code, manual secret, verification code, factor identifier, or
  recovery data
- Verified-factor removal, replacement, recovery, backup factors, recovery
  codes, lost-device support override, or email/SMS MFA
- Aviation licence, medical, rating, qualification, currency, instructor
  authorization, competency, training, safety, operations, dispatch,
  assessment, or approval authority
- Invitation-role, membership-status, profile, Auth-user deletion, session
  revocation, hosted validation, real data, deployment, or production

## Sources, decisions, and unresolved questions

| Item | Source/owner/version | State |
|---|---|---|
| TOTP/AAL2 for privileged roles; email is not the privileged second factor | SRS `IAM-005`; Security Requirements section 3; System Architecture section 7 | Verified |
| First-admin TOTP enrollment and strict factor handling | FEAT-003 contract and implementation at `25f4ddd` | Verified locally; reuse controls, not bootstrap authority |
| General self-service initial enrollment followed by role assignment | Founder/Product Owner decision, 2026-08-13 | Approved as staggered delivery |
| One role per membership, protected commands, last-admin protection, and reauthentication | Database Design section 5; SRS `IAM-002`, `IAM-003`, `IAM-006`, `IAM-012`; Security Requirements sections 3–4 and 9 | Verified |
| Existing roles and effective permissions | FEAT-001, FEAT-004, and FEAT-005 migrations at `25f4ddd` | Verified locally |
| Aviation permission and separation-of-duties matrix | Founder/Product Owner, pilot school, and qualified aviation reviewer | Unresolved; blocks operational permissions and role combinations, not these portal controls |
| Factor recovery/replacement and real-data operating procedure | School controller and qualified privacy/legal/security owners | Unresolved; later real-data and production gate |

The built-in role labels describe FlyEye portal scope. Assigning
`instructor_pilot` does not verify that a person is qualified or authorized to
instruct. Assigning `admin` grants no operational or aviation authority.

## Roles and authority

| Action | Permission or identity rule | Execution boundary | Reauthentication |
|---|---|---|---|
| Read own MFA readiness | Active server-derived membership and matching Auth subject | Protected member-MFA Edge Function and server-only RPC | Current password-authenticated session |
| Start or confirm own first TOTP enrollment | Active member acting only for self; exact supported factor inventory | Supabase Auth enrollment plus protected member-MFA Edge Function | Password AMR no older than 600 seconds; AAL1 allowed only to establish TOTP |
| Complete own MFA readiness | Same actor, membership, enrollment operation, and verified factor reference | Server-side Auth factor recheck plus atomic readiness/audit RPC | Current AAL2/TOTP and password AMR no older than 600 seconds |
| Review role replacements | `membership.member.review` | Existing protected member-administration Edge Function and server-only RPC | Current AAL2/TOTP |
| Replace another member's role | `membership.role.assign`; active same-school target; no self-action | Protected member-administration Edge Function, server-side Auth factor check, and atomic server-only RPC | Password AMR no older than 600 seconds plus current AAL2/TOTP |

Browser roles receive no direct readiness, role, permission, membership, or
audit mutation grant. The server derives authority from verified Auth and
PostgreSQL records, never user metadata, client role text, email, or a
request-supplied organization alone.

Future school-validated roles remain version-controlled built-in permission
bundles under the governance role decision. Role security metadata and
permission-driven interface checks may be centralized in Slice B, but the
assignable set remains the three roles in this contract. Custom roles,
permission editing, and multiple-role assignment remain excluded.

## Slice A workflow and rules

```text
Active member + no factor
  -> protected start
  -> user privately enrolls and verifies TOTP with Supabase Auth
  -> protected completion revalidates Auth state
  -> readiness record + audit commit together
```

1. Only the authenticated subject may enroll or confirm that subject's own
   TOTP. An administrator cannot perform enrollment for another person.
2. Start requires one active membership in the deployment's active organization
   and a password AMR no older than 600 seconds. Suspended, revoked, empty,
   ambiguous, OTP-only, recovery-only, or forged-school contexts fail closed.
3. The complete bounded factor inventory is authoritative. Supported states are
   no factor, exactly one current-operation unverified TOTP, or exactly one
   verified TOTP. Multiple, mixed, duplicate, stale, hidden, phone, WebAuthn, or
   provider-uncertain inventories conflict without selection or mutation.
4. When no factor exists, the user's Supabase session enrolls exactly one TOTP.
   QR data, URI, manual secret, factor ID, and verification code remain in active
   memory only and never enter tables, URLs, browser storage, logs, analytics,
   screenshots, accessible names, documentation, or prompts.
5. The UI binds a newly created factor to the server-created enrollment
   operation before presenting completion as available. Only the same subject,
   operation, membership, and factor reference may complete or clean up that
   operation.
6. Verification uses Supabase Auth challenge and verify. Completion then
   refreshes the session and server-side factor inventory and requires current
   AAL2, TOTP AMR, recent password, exactly one verified TOTP, and the expected
   enrollment operation version.
7. Completion stores only a SHA-256 factor-reference hash, not the factor ID or
   secret. The tenant-owned readiness row, operation state, and
   `member_mfa.enrollment_completed` audit commit atomically. Failure leaves
   membership role and permissions unchanged.
8. Supabase Auth and PostgreSQL cannot share a transaction. Start intent is
   audited before provider enrollment. If provider verification succeeds but
   readiness completion fails, FlyEye reports confirmation incomplete and
   grants no new authority; the same bounded operation may retry completion.
9. A member with exactly one existing verified TOTP may run the confirmation
   path. The user must successfully challenge it before FlyEye creates or
   refreshes the matching readiness record.
10. Cancellation before factor binding closes the empty operation. After a
    factor is bound, FlyEye never automatically removes it because Supabase Auth
    cannot atomically prove that it remained unverified during deletion. The
    operation is retained for bounded resume; a member who no longer has the
    authenticator fails closed to support-assisted recovery.
11. A readiness record never grants a workspace or permission. Every privileged
    login and protected command still checks current role, permission, session,
    AAL, organization, and factor state.
12. Enrollment uses opaque idempotency keys, stable operation versions, bounded
    retry, and a local token bucket. No secret or factor operation is queued
    offline.

## Slice A data, server, UI, and audit contract

The Slice A migration adds:

- `member_mfa_enrollment_operations`, a deny-by-default tenant-owned table for
  bounded start/bind/complete/cancel state and hashed factor reference;
- `member_mfa_readiness`, one deny-by-default current readiness row per
  membership and Auth subject;
- constrained `member_mfa.*` authentication-event names and server-only audit
  writers;
- protected server-only PostgreSQL functions for status/start, factor binding,
  completion, cancellation reconciliation, and rate limiting; and
- generated TypeScript database types.

The protected Edge Function actions are `status`, `start`, `bind_factor`,
`complete`, and `cancel`. Stable errors include unauthenticated, unauthorized,
recent-auth-required, validation-failed, factor-conflict, state-conflict,
rate-limited, cleanup-uncertain, and service-unavailable.

The Account security UI supports loading, not configured, already configured,
recent-password required, QR/manual setup, verification, confirming, invalid or
expired code, factor conflict, rate limit, offline, cancellation, cleanup
uncertainty, failure, and success. Instructor/Admin users blocked only because
enrollment is missing are routed to the same flow before workspace access.
Focus, announcements, labels, paste/autofill, keyboard operation, and 200%
reflow follow the FEAT-003 controls.

Audit events include organization, actor subject, membership, operation,
correlation, bounded outcome/reason, version, factor-reference hash, and UTC
time. They exclude email, profile values, password, token, factor ID, QR data,
manual secret, verification code, provider response, and unrestricted network
data. Audit or readiness failure creates no FlyEye authority.

## Slice B workflow and rules

```text
Active membership + Role A --authorized replacement--> Active membership + Role B
```

1. A membership has exactly one role before and after a successful command.
2. Assignable roles are the active built-in `student_pilot`,
   `instructor_pilot`, and `admin` roles marked by a server-controlled flag.
3. Only another active member can be changed. Self-action and inactive targets
   are denied. Same-role input is a conflict.
4. Instructor/Admin assignment requires a live server-side Auth inventory of
   exactly one verified TOTP and a readiness record whose subject and factor
   reference hash match that inventory. Student assignment has no factor
   precondition.
5. The allowed reason categories are `responsibility_changed` and
   `assignment_corrected`; free text is not collected.
6. Demoting an Organization Admin requires another active Organization Admin.
   Role and status commands use the same deterministic membership lock order so
   concurrent changes cannot remove the last active admin.
7. Expected membership version, stable locks, and idempotency produce one
   deterministic result under retry and concurrency.
8. Role replacement, assignment attribution, membership version increment, and
   `member_role.changed` audit commit atomically or all roll back.
9. Current database authority takes effect at commit. Stale UI or an existing
   Auth session never preserves old permissions.
10. The UI offers only server-approved replacements and covers confirmation,
    MFA-not-ready, self, inactive, conflict, last-admin, rate-limit, offline,
    failure, and success states without claiming aviation authority.

## Acceptance criteria

### Slice A

- [x] `FEAT-006A-AC-01` Only an authenticated active member with a recent
      password session can start or confirm that member's own enrollment.
- [x] `FEAT-006A-AC-02` No-factor enrollment creates at most one TOTP and keeps
      QR, secret, factor ID, and code only in active memory.
- [x] `FEAT-006A-AC-03` Existing verified TOTP requires a successful challenge;
      duplicate, mixed, stale, unsupported, or unavailable inventory fails
      closed without factor selection or deletion.
- [x] `FEAT-006A-AC-04` Completion requires current AAL2/TOTP, recent password,
      matching subject/membership/operation/factor hash, and expected version.
- [x] `FEAT-006A-AC-05` Readiness, operation state, and completion audit commit
      together; failure changes no FlyEye role or permission.
- [x] `FEAT-006A-AC-06` Cancellation closes only an unbound operation. A bound
      factor is retained for safe resume; uncertainty signs out and grants
      nothing.
- [x] `FEAT-006A-AC-07` Cross-school, direct-table/RPC, metadata, replay,
      idempotency, rate-limit, offline, and audit-failure attacks create no
      hidden-state disclosure or authority.
- [x] `FEAT-006A-AC-08` Required responsive and accessible UI states pass
      automated coverage; formal accessibility review remains later.
- [x] `FEAT-006A-AC-09` Tests and evidence contain no credential, secret, token,
      real identity, or unrestricted provider data and leave zero residue.
- [x] `FEAT-006A-AC-10` Earlier feature verification remains green.

### Slice B

- [x] `FEAT-006B-AC-01` Only an active Organization Admin with
      `membership.role.assign`, AAL2/TOTP, and recent password can change
      another active same-school member's role.
- [x] `FEAT-006B-AC-02` Only the three active membership-assignable built-in
      roles are accepted and exactly one role remains.
- [x] `FEAT-006B-AC-03` Instructor/Admin assignment requires matching current
      verified TOTP readiness; missing or stale readiness changes no role.
- [x] `FEAT-006B-AC-04` Self-action and last-active-admin demotion are denied,
      including under concurrent status and role commands.
- [x] `FEAT-006B-AC-05` Version, locks, idempotency, role mutation, attribution,
      and audit are deterministic and atomic.
- [x] `FEAT-006B-AC-06` Direct browser mutation, forged school, arbitrary role,
      metadata, replay, limiter, and audit-failure attempts fail closed.
- [x] `FEAT-006B-AC-07` Current server authority changes immediately and creates
      no aviation qualification or operational authority.
- [x] `FEAT-006B-AC-08` Required responsive and accessible UI states and full
      regression matrices pass with zero fixture residue.

## Planned verification

| Test ID | Slice | Level | Scenario |
|---|---|---|---|
| `FEAT-006A-UNIT-01` | A | Unit | Schemas, factor states, idempotency, errors, secret rejection |
| `FEAT-006A-COMP-01` | A | Component | Enrollment, existing-factor, cancellation, failure, focus and announcements |
| `FEAT-006A-SQL-01` | A | SQL/RLS | Tables, constraints, grants, operation/readiness invariants and audit failure |
| `FEAT-006A-EDGE-01` | A | Handler/runtime | Auth, recent password, factor inventory, limiter and sanitized errors |
| `FEAT-006A-TENANT-01` | A | Runtime/SQL | Forged school, membership, RPC and metadata attempts |
| `FEAT-006A-AUTH-01` | A | Runtime | New and existing TOTP, AAL2, retry, cancellation and cleanup |
| `FEAT-006A-E2E-01` | A | Browser | Student setup and privileged missing-factor routing on desktop/mobile |
| `FEAT-006A-SEC-01` | A | Security | Secrets, replay, factor conflict, audit and provider consistency |
| `FEAT-006A-REG-01` | A | Regression | Complete app/database/runtime matrix and zero residue |
| `FEAT-006B-RPC-01` | B | SQL/RPC | Role swap, reasons, version, idempotency, last-admin and atomic audit |
| `FEAT-006B-RACE-01` | B | SQL/RPC | Concurrent role/status changes and last-admin protection |
| `FEAT-006B-EDGE-01` | B | Handler/runtime | Actor auth, target readiness, limiter and safe errors |
| `FEAT-006B-TENANT-01` | B | Runtime/SQL | Forged school, target, role option, RPC and Edge attempts |
| `FEAT-006B-E2E-01` | B | Browser | Admin role change and all required UI states |
| `FEAT-006B-REG-01` | B | Regression | Complete app/database/runtime matrix and zero residue |

## Dependencies and change boundary

No new package, paid service, provider, email/SMS channel, or architecture is
planned. Slice A reuses Supabase TOTP, the FEAT-003 factor classifier and secret
handling, FEAT-001 authentication audit, and existing Auth UI patterns. Slice B
reuses FEAT-005 member administration and depends on merged Slice A contracts.

Allowed areas are one migration and generated types per slice, focused Edge
Functions/shared authentication code, Auth/member-administration UI, focused
tests/runtime fixtures, and FEAT-006 documentation. Unrelated invitation,
profile, status, provider, operational, hosted, real-data, deployment, and
production behavior remains excluded.

## Definition of done

- [x] Both slice contracts, assumptions, provider/database boundaries, and
      later gates remain explicit
- [x] Each slice is implemented and verified independently with synthetic data
- [x] Positive, negative, cross-school, concurrency, failure, security,
      accessibility-supporting, regression, and cleanup checks pass
- [x] Secrets and service-role authority remain server-only
- [x] Traceability contains reviewed evidence and limitations per slice
- [x] Documentation checks and separate-agent review pass
- [x] Each scoped slice has a green review-ready pull request
