# Feature Specification: FEAT-003 — Organization Admin and MFA Onboarding

## Status and ownership

- Status: `Locally verified; publication pending` under the 2026-08-02 autonomous-delivery directive; the stabilized target passed the complete local application/database matrix, all three sanitized runtime fixtures, repository/history secret scans, zero-residue cleanup, correction of the separate-agent review finding, and final re-review; merge, hosted, real-data, deployment, production, and FEAT-004 gates remain closed
- Documentation baseline: `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66` on 2026-07-27
- Founder/Product Owner: Approved FEAT-003-DEC-01 through FEAT-003-DEC-05 exactly as written on 2026-07-27; later approved a 30-minute exact local lifetime for FEAT-003-DEC-04, named the CLI-only ephemeral local fixture, authorized the documentation-only independent-design-review amendment recorded below on 2026-07-27, authorized the documentation-only limiter-monitoring evidence correction and staged-review-gate amendment on 2026-07-28, and approved the provisional local-only limiter and operations choices recorded below for documentation-only recording on 2026-07-28
- Post-amendment verification: Completed as a strictly read-only documentation-consistency review on 2026-07-28 against baseline HEAD `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66` and tracked working-tree fingerprint `95bd2c6fce6f7819725733da692ab827aa0eb85b`; `DOC-STATUS-01` was resolved, all substantive documentation requirements were satisfied, and no documentation conflict remained. This is not implementation/runtime evidence, qualified human review, product acceptance, implementation authorization, Git publication, hosted validation, deployment, or production approval.
- Historical staged-review-gate verification: Completed as a strictly read-only documentation-consistency review on 2026-07-28 against baseline HEAD `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66` and tracked working-tree fingerprint `14dc4252fb90bd0ed3febc33dab3987568bd0db0`; all fourteen required checks passed and no documentation conflict remained. The 2026-08-02 autonomous-delivery directive supersedes this former human-before-publication gate.
- Provisional local limiter and operations verification: Completed as a strictly read-only documentation-consistency review on 2026-07-28 against baseline HEAD `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66` and tracked working-tree fingerprint `27014d8b60c17c129dfd29513fea79abe89f9483`; all fourteen required checks passed and no documentation conflict remained. This verified only the exact documentation recording of the reversible, unvalidated, local synthetic choices. It is not implementation/runtime evidence, competent-human review, product acceptance, implementation authorization, Git publication, hosted validation, deployment, production approval, or FEAT-004 authority.
- Aviation SME: Not required for the bounded identity outcome; required before any later role receives aviation or operational authority
- Technical owner: FlyEye project
- Security/privacy/accessibility/operations review: Completed automated evidence and corrected separate-agent review satisfy the local technical publication gate; qualified-human review is risk-triggered for later regulated, hosted, real-data, production, penetration-test, or formal-compliance claims
- Target release: Green review-ready pull request; merge, hosted validation, real-data use, deployment, and production remain unauthorized

Historical authorization note: this specification originally required a later
local-synthetic implementation prompt. The 2026-08-02 autonomous-delivery
directive now makes a clear bounded feature request standing authority for the
ordinary implementation, verification, correction, documentation, commit,
push, pull-request, and CI loop. It does not authorize merge, hosted application
or provider mutation, real data, deployment, production, or destructive work.

## Approved bounded user outcome

As a specifically pre-authorized first Organization Admin, I want to select the organization for which I am eligible, enroll or challenge one TOTP authenticator, and complete a protected first-admin bootstrap, so that I can enter only that organization's administration placeholder at AAL2 without receiving any operational, training, safety, quality, dispatch, assessment, or aviation approval authority.

The approved FEAT-003 implementation scope is **first-Organization-Admin onboarding only**. The repository already makes universal MFA mandatory before any real-data pilot or production access. Student Pilot and Instructor Pilot enrollment remain outside this bounded local feature unless the specification is formally amended.

## Scope boundary

### Included

- Server-held eligibility for the first Organization Admin of an organization
- A protected, expiring, single-use, audited first-admin bootstrap grant
- Password-authenticated entry into a narrow onboarding surface that is not a FlyEye workspace
- Explicit organization selection when one identity has multiple active memberships or eligible bootstrap grants
- TOTP factor discovery, enrollment, QR/manual-secret presentation, verification, challenge, bounded retry, cancellation, and safe cleanup
- Existing verified-factor challenge without silently creating a duplicate factor
- Fail-closed handling for duplicate factors, stale sessions, expired/revoked/consumed grants, concurrent completion, audit failure, and provider uncertainty
- Server enforcement of password AMR, required recent authentication, AAL2, TOTP AMR, active organization, eligible subject, and single-organization context
- Atomic creation of the first active Organization Admin membership and built-in `admin` role assignment, consumption of the grant, and application audit evidence
- Revalidation through the existing protected `auth-bootstrap` before opening the selected administration placeholder
- Synthetic local tests with at least two organizations and one multi-membership identity
- Complete responsive, accessibility, privacy, security, rollback, and release-gate evidence planning

### FEAT-004 boundary: Member Invitations

FEAT-003 does not:

- invite another person;
- send an invitation email;
- create a reusable invitation workflow;
- accept, resend, revoke, expire, or list member invitations;
- create a normal member account or membership after the first-admin bootstrap; or
- define invitation email delivery, branding, redirect, abuse, or support behavior.

FEAT-004 begins only after FEAT-003 has an approved and implemented first-admin foundation. It must use an already active, recently authenticated Organization Admin and a separately protected invitation command.

### FEAT-005 boundary: User Management and Basic Profiles

FEAT-003 does not:

- list, search, suspend, reactivate, archive, or edit members;
- edit names, contact details, student/instructor information, or profile fields;
- provide general factor-management or account-support consoles;
- remove, demote, replace, or transfer an existing administrator; or
- implement the ordinary last-active-administrator management workflow.

FEAT-005 must separately specify member visibility, profile data, privacy, lifecycle states, and last-active-administrator safeguards for suspension/reactivation behavior.

### FEAT-006 boundary: Role Assignment

FEAT-003 does not provide general role assignment. Its only role mutation is the one-time, protected assignment of the built-in `admin` role when the first-admin bootstrap completes atomically. It does not:

- assign a role to an existing normal membership;
- change or remove a role;
- support multiple roles per membership;
- define a detailed permission or separation-of-duties matrix; or
- grant Head of Training, CFI, safety, quality, operations, dispatch, instructor, assessment, or approval authority.

FEAT-006 must separately define protected role changes, recent-authentication rules, last-active-administrator enforcement, negative authorization, separation of duties, and qualified aviation/workflow review.

### Other non-goals

- Public registration, passwordless access, magic-link workspace access, passkeys, SSO, social login, or SMS MFA
- Recovery codes, lost-device recovery, factor replacement, supervised recovery, administrator-assisted factor reset, or support elevation
- Production bootstrap operations, production email, a hosted Supabase project, real data, deployment, monitoring operations, or production approval
- Full Organization Admin dashboard or any aircraft, personnel, dispatch, training, compliance, reporting, export, file, audit-review, or configuration workflow
- Any CAAP, PCAR, ATO, safety, operational, training, assessment, or aviation rule

## Authoritative sources and inspected baseline

| Item | Source or inspected baseline | Status |
|---|---|---|
| Invitation-only accounts and server-derived membership | SRS IAM-001/002; Security Requirements sections 3 and 4 | Authoritative |
| Universal MFA before real-data pilot or production | SRS IAM-005; Security Requirements section 3; Product and Governance Decisions section 5 | Authoritative release gate |
| Multi-organization membership and explicit selection | SRS IAM-010; architecture section 6; governance section 4 | Authoritative |
| Organization Admin authority boundary | SRS IAM-011; governance section 4 | Authoritative |
| First administrator and last-active-administrator rules | SRS IAM-012; Security Requirements section 4; governance section 4 | Authoritative baseline |
| Protected commands, deny-by-default RLS, and audit | ADR-0005; architecture sections 4, 6, and 7; SRS IAM-003/007/008/009 and REC-001/002/003 | Authoritative |
| Existing schema | FEAT-001 migrations and generated types at baseline commit | Inspected: organizations, memberships, roles, permissions, role assignments, and authentication events exist |
| Existing access path | FEAT-001 `auth-bootstrap`, server-only resolver/audit RPCs, access-context contract, React auth state machine | Inspected: password AMR, membership, role, permission, selected organization, AAL, and audit are server checked |
| Existing MFA path | Supabase Auth JS `2.110.7`, local GoTrue `v2.192.0`, local TOTP configuration, current MFA challenge UI | Inspected: challenge of one verified TOTP exists; enrollment, factor lifecycle, and support do not |
| Existing recovery guard | FEAT-002 password-AMR bootstrap gate | Inspected: OTP-only recovery/email/magic-link sessions cannot load FlyEye context |
| Current local MFA SDK behavior | Pinned `@supabase/auth-js` `2.110.7` types | Enrollment creates an unverified factor; verification promotes the current session to AAL2 and logs out other sessions; verified-factor removal requires AAL2 |

Pinned SDK descriptions are implementation-planning evidence, not a production guarantee. Exact factor, session, retry, provider-audit, and cleanup behavior must be reproduced against the pinned local runtime before implementation acceptance and reverified after any Auth upgrade.

## Approved Founder/Product Owner decisions

| Decision ID | Decision | Approved bounded choice | Effect if amended | Status |
|---|---|---|---|---|
| FEAT-003-DEC-01 | Initial MFA population | Enroll only the specifically eligible first Organization Admin in FEAT-003. Preserve the universal MFA gate before real data and production. | Choosing all existing roles expands the user outcome, UI routing, tests, support exposure, and acceptance matrix; revise this specification before implementation. | Approved 2026-07-27 |
| FEAT-003-DEC-02 | Who may authorize the first-admin grant | Local synthetic grants may be issued only by the CLI-only ephemeral fixture implemented through `scripts/test-feat-003-runtime.mjs`. It must reject non-loopback environments, obtain local administrative credentials only from the running local stack without logging or persisting them, create randomized `.test` subjects/organizations/grants, insert through direct local PostgreSQL administration, and remain unreachable to browser and application roles. A production issuer and approval runbook remain unresolved and block hosted/real-data use. | Naming a production operator or support role requires a reviewed authority model, authentication, audit, separation, and operational runbook. | Approved 2026-07-27; local fixture named 2026-07-27; local evidence passed 2026-08-02 |
| FEAT-003-DEC-03 | Recent-authentication window | Require server-verified password AMR no older than 10 minutes at onboarding start and completion; require current AAL2/TOTP at completion. | A different duration changes stale-session behavior, UX, tests, and risk acceptance. No client timestamp may decide freshness. | Approved 2026-07-27 |
| FEAT-003-DEC-04 | Bootstrap-grant lifetime | Set local synthetic grants to expire 30 minutes after the server-recorded issuance time. The expiry is finite and non-sliding, is rechecked at onboarding start and atomic completion, and cannot be revived after expiry, revocation, or consumption. A replacement requires a newly issued local synthetic grant. Production duration remains separately gated. | A different duration or sliding behavior requires a specification amendment and changes fixture, expiry, replay, concurrency, and operating evidence. | Approved 2026-07-27 |
| FEAT-003-DEC-05 | Existing or duplicate factors | Reuse exactly one verified TOTP through challenge. Treat multiple verified factors, mixed factor types, or uncertain cleanup as a conflict; do not replace or delete verified factors in FEAT-003. | Allowing replacement or automatic factor choice would introduce account-recovery/support scope and requires a separate amendment. | Approved 2026-07-27 |

These choices and the later implementation-readiness amendment are now authoritative product direction for this specification. The exact local grant lifetime and local synthetic fixture are recorded. A later explicit Founder/Product Owner authorization permitted the bounded local synthetic implementation now present in the working tree. Under the 2026-08-02 autonomous-delivery directive, the completed automated evidence and corrected separate-agent review satisfy the local technical publication gate. Qualified-human review is risk-triggered and remains required only for later regulated, real-data, hosted, production, penetration-test, or formal-compliance claims that inherently need it.

### Approved independent-design-review amendment

The Founder/Product Owner authorized the following documentation-only controls on 2026-07-27:

- represent local fixture issuance as an explicit non-human audit source rather than an authenticated human;
- use strict timestamped AMR parsing and an exact 600-second password-reauthentication boundary at onboarding start and completion;
- define a trusted server-only Edge-to-RPC authentication-evidence contract;
- make PostgreSQL time authoritative for the 30-minute grant lifetime and organization-scoped completion serialization;
- revoke table and privileged-function access from `PUBLIC`, `anon`, and `authenticated`;
- define the `status`, `start`, `complete`, and `cancel` contracts and their audit/idempotency behavior;
- classify the complete provider factor inventory and perform no automatic factor deletion without a server-verifiable current-operation binding; and
- harden the CLI-only fixture with same-stack attestation, transactional failure handling, postconditions, injected failures, credential protection, and cleanup-failure evidence.

These are specification controls, not implementation evidence or qualified human approval.

## Assumptions and unresolved questions

### Assumptions used for this specification

1. The current database role code `admin` represents the product-facing Organization Admin role; changing the code is unnecessary.
2. Supabase MFA factors are identity-scoped, not organization-scoped. A verified factor can strengthen the session used for any independently authorized membership, but it grants no membership or permission.
3. The first-admin Auth identity is created or confirmed through a separately controlled local synthetic setup. FEAT-003 does not create a public account or a normal invitation workflow.
4. The initial implementation remains online-only because enrollment, verification, grant consumption, membership creation, and audit require authoritative server state.
5. No real person, customer, student, flight-school, or production credential is used in development, tests, demonstrations, screenshots, logs, or prompts.

### Unresolved security, privacy, accessibility, and operational questions

- Production issuer identity, approval evidence, grant duration, revocation owner, support owner, and emergency procedure
- Recovery-code design, lost-device identity proofing, factor replacement, account-compromise handling, and last-admin recovery
- Auth-provider audit action names, factor-session revocation behavior, cleanup of stale unverified factors, rate limits, CAPTCHA behavior, and upgrade drift
- Competent validation of the approved provisional local-only per-action rates/bursts, PostgreSQL token-bucket storage/atomicity, HMAC subject/action keying, no-local-IP-trust rule, 15-minute inactive-state retention, limiter-unavailable behavior, stop-work monitoring/ownership, recovery, and no-override rule; all hosted and production thresholds, network/proxy trust, privacy/retention, monitoring, alerting, ownership, incident, emergency, and override decisions remain unresolved
- Whether later sensitive administrative commands use the same approved 10-minute window or a stricter separately approved window
- Authentication-event retention, access, export, alerting, and privacy ownership
- Production authenticator issuer label, domain, support address, Supabase plan/region, monitoring, and recovery commitments
- Human verification of screen-reader announcements, password-manager interaction, 200% zoom/reflow, measured contrast, target sizes, QR/manual-secret usability, and any active provider CAPTCHA
- Detailed permission and separation-of-duties matrix for later administrative and aviation roles

Any unresolved item that affects required local evidence stops implementation for specification review. Production-only items remain explicit blockers before hosted real-data or production use.

## Roles, permissions, and record scope

| Action | Proposed permission or authority | Organization and record rule | Reauthentication |
|---|---|---|---|
| Read own onboarding eligibility | Protected bootstrap-grant lookup; no browser table permission | Actor subject comes from verified JWT; returns only the actor's unexpired grants and safe organization labels | Password AMR within approved recent-auth window |
| Start TOTP onboarding | Narrow protected onboarding command plus Supabase Auth MFA enrollment | Selected grant ID is a hint; server re-derives actor and organization; no membership is created | Recent password AMR; AAL1 allowed only for initial enrollment |
| Verify a newly enrolled TOTP | Supabase Auth factor verification | Identity-scoped factor created in the current operation; no organization authority | Current password-authenticated session |
| Challenge one existing verified TOTP | Supabase Auth challenge and verify | Exactly one verified TOTP; duplicate/mixed factors fail closed | Current password-authenticated session |
| Complete first-admin bootstrap | Server-only Edge/RPC command | Grant subject, active organization, no active admin, expected grant version, AAL2, password and TOTP AMR revalidated; organization derived from grant | Recent password AMR and current TOTP/AAL2 |
| Enter administration placeholder | Existing `portal.admin.access` through `auth-bootstrap` | Active membership and role in the selected organization only | Password AMR and AAL2 |
| Cancel onboarding | Narrow protected cancellation command and audit | Initial bounded behavior does not automatically unenroll a factor; any later cleanup requires pinned-runtime evidence and a server-verifiable current-operation binding | Current authenticated session; then sign out |

No client-supplied role, permission, organization, user metadata, app metadata, email, factor status, AAL, AMR, or timestamp is authority.

## First-Organization-Admin eligibility and protected bootstrap

### Proposed eligibility record

An additive migration would introduce `organization_admin_bootstrap_grants` with at least:

```text
id
organization_id
eligible_user_id
status: pending | completed | revoked | expired
version
issued_at
expires_at
authorization_source_kind
authorization_source_code
authorization_source_instance_id
authorized_by_subject_id (nullable; null for the local fixture)
issuance_correlation_id
created_at
completed_at
completed_membership_id
revoked_at
completion_idempotency_key_hash
```

Requirements:

- Every row contains `organization_id`.
- The eligible subject is an Auth UUID; email, mutable metadata, and role claims are not stored as authority.
- The row is tenant-owned, RLS-enabled, deny-by-default, and unreadable/unwritable by `anon` and `authenticated`.
- Only a narrowly scoped protected server function may read or consume it.
- PostgreSQL sets `issued_at` from `transaction_timestamp()`; the fixture cannot supply or override it.
- A database constraint requires `expires_at = issued_at + interval '30 minutes'`.
- A grant is usable only while `status = 'pending'` and `transaction_timestamp() < expires_at`. At exact equality or later it is expired and unusable.
- Browser or application activity cannot update `issued_at` or `expires_at`. Expired, revoked, and completed grants cannot transition to `pending`; a replacement is a new row.
- Effective expiry is time-derived even if a row still stores `pending`. A protected status/start/complete command that locks an effectively expired pending row may atomically materialize `status = 'expired'`, increment the version, and write the expiry audit. Absence of that materialization never restores eligibility.
- Constraints prevent invalid status/timestamp combinations.
- Tenant-first indexes support subject/status/expiry lookup.
- A pending grant does not create a membership, role, portal permission, or access context.
- `scripts/test-feat-003-runtime.mjs` is the only approved local synthetic issuer/test setup. It is a CLI-only ephemeral fixture that rejects non-loopback environments, obtains local administrative credentials only from the running local stack without logging or persisting them, creates randomized `.test` identities/organizations/grants, inserts the grant and minimized issuance audit atomically through direct local PostgreSQL administration rather than the browser, Data API, or an application Edge Function, and performs bounded cleanup with uncertainty reported as failure.
- Local issuance requires `authorization_source_kind = 'local_fixture'`, fixed non-secret `authorization_source_code = 'feat-003-local-cli-fixture'`, a randomized `authorization_source_instance_id`, and a randomized issuance correlation ID. `authorized_by_subject_id` and audit human-actor fields are null. Constraints reject mixed, missing, or fabricated human/non-human attribution.
- The grant and required issuance audit are inserted in one PostgreSQL transaction. If either write or its postcondition fails, neither persists.
- The application may consume an eligible grant only through the protected onboarding workflow; it cannot create, extend, replace, or revive one. Production issuance remains blocked until a separate production authority model and operating runbook are approved.

### Non-human audit-source contract

The smallest coherent audit change is an additive extension to `authentication_events`, not a new general audit architecture:

- add `actor_kind` with allowed values `authenticated_subject` and `local_fixture`, defaulting existing records to `authenticated_subject`;
- add nullable `source_code`, `source_instance_id`, `target_kind`, `target_id`, and `idempotency_key_hash`;
- require authenticated-subject events to retain the existing non-null actor-subject rule and null fixture-source fields;
- require local-fixture events to have null human actor user/subject fields, the fixed source code `feat-003-local-cli-fixture`, and a non-null randomized source-instance UUID;
- retain organization, event, outcome, reason, correlation, and minimized target/version metadata; and
- keep the existing authenticated-access audit writer's non-null-subject behavior unchanged while adding a narrow server-only fixture-issuance path.

The source fields explain how synthetic eligibility was created. They do not confer human, application, administrative, operational, or aviation authority.

For idempotent `start` and `cancel` evidence, a partial unique index covers actor subject + event/action + opaque grant target + idempotency-key hash when the hash is non-null. Existing events keep null target/idempotency fields. Completion idempotency remains stored on the consumed grant because it is part of the same authority-bearing transaction.

### Strict recent-authentication contract

The protected Edge Function validates the user JWT with Supabase Auth before reading claims. It then parses a bounded AMR array of no more than 16 exact objects containing only a non-empty bounded `method` and a non-negative integer Unix-seconds `timestamp`.

- Missing AMR, string-only entries, additional malformed entries, non-integer timestamps, unknown structure, or an unbounded array fails closed.
- A qualifying password entry has `method = 'password'`, is not in the future relative to the verifying server clock, and has age `<= 600` seconds. Exact age 600 is accepted; age greater than 600 is denied.
- When multiple strict password entries exist, the most recent non-future timestamp is used deterministically. If no such entry exists, the request is denied.
- Completion also requires strict `totp` AMR, exact `aal2`, a valid session identifier, and a complete current factor inventory proving exactly one verified TOTP and no conflicting factor state.
- Start performs the 600-second check in the Edge Function. Completion repeats it immediately before the RPC and passes the verified actor UUID, subject UUID, session UUID, password-authenticated Unix timestamp, AAL, and bounded method names through the internal service-role-only call.
- The browser request cannot contain these authority fields. The completion RPC converts the server-derived password timestamp and rechecks `password_time <= transaction_timestamp()` and `transaction_timestamp() - password_time <= interval '600 seconds'`.

The 10-minute rule applies to onboarding start and completion. The administration placeholder requires password AMR and current AAL2/TOTP but does not impose a continuously renewed 10-minute password window. Future sensitive administrative commands define their own separately approved recent-authentication requirement.

### Protected completion

The proposed server-only PostgreSQL function `complete_first_organization_admin_bootstrap(...)`, called only by a protected Edge Function using its server authority, must:

1. load only the immutable organization hint for the opaque grant ID without treating it as authority;
2. lock the authoritative organization row first and the selected grant row second, then revalidate the grant-to-organization relationship;
3. match the verified actor subject, session evidence, expected version, and idempotency scope;
4. derive the organization from the locked grant, never from a request-body organization ID;
5. confirm the organization is active and the grant is pending and unexpired under PostgreSQL transaction time;
6. recheck the server-derived password timestamp against the exact 600-second boundary;
7. confirm current AAL2, strict TOTP AMR, and the Edge-verified complete factor state;
8. recheck that no active Organization Admin exists for the organization;
9. confirm the subject has no conflicting membership/role state for that organization;
10. create one active organization membership;
11. assign only the built-in `admin` role;
12. mark the grant completed with the membership ID, version change, and completion idempotency-key hash; and
13. create attributable, minimized application audit evidence in the same transaction.

If any validation, role lookup, insert, grant update, concurrency check, or audit write fails, the entire database transaction rolls back. A verified identity factor may remain at the Auth provider, but no FlyEye membership or authority may partially persist.

Every completion path uses the same organization-row-then-grant-row lock order and repeats all eligibility/admin/membership checks after both locks are held. Two attempts using the same or different grants for one organization therefore serialize on the organization row. At most one may create the first active administrator; the loser receives a safe `409` conflict and no membership, role, or success audit.

The completion idempotency key is a browser-generated opaque value with at least 128 bits of entropy. The Edge Function validates its bounded form, hashes it with SHA-256, and passes only the hash internally. Its scope is actor subject + grant + `complete`. A successful transaction stores the hash on the consumed grant for the grant's retention lifetime. A retry with the same actor, grant, action, and hash returns safe revalidation guidance without another mutation or success audit. A different key against a completed grant conflicts. A wrong actor is denied before replay behavior is disclosed.

### Last-active-administrator boundary

FEAT-003 creates the first administrator but exposes no removal, suspension, demotion, transfer, or role-change path. It must not modify an existing active administrator or complete a first-admin grant when an active administrator already exists.

FEAT-005 and FEAT-006 must later enforce the last-active-administrator rule atomically in every ordinary membership and role command. FEAT-003 must not pre-implement those general management workflows.

## MFA onboarding and challenge behavior

### Factor inventory

After protected eligibility succeeds, the client obtains the actor's factor inventory directly from Supabase Auth and treats it as untrusted until provider responses are validated. Classification uses the complete `listFactors().all` inventory, not only the verified `totp` convenience array. The complete inventory is parsed with a strict bounded runtime schema; duplicate IDs, unknown fields that affect authority, unknown status/type, or inconsistent convenience arrays fail closed.

| Factor state | Required behavior |
|---|---|
| No TOTP factor | Enroll one TOTP factor and retain its factor ID and secret only in the active in-memory operation. |
| Exactly one unverified TOTP created in the current operation | Show the QR/manual-secret and allow verification, bounded retry, or cancellation. |
| Stale unverified TOTP from an earlier operation | Do not guess ownership or silently delete it. Follow the runtime-proven explicit cleanup path or fail closed to support; exact behavior requires implementation evidence. |
| Exactly one verified TOTP | Do not enroll another factor. Challenge and verify the existing factor. |
| More than one verified TOTP | Show a duplicate-factor conflict; do not automatically choose, remove, or replace a factor. |
| Phone, WebAuthn, unknown, or mixed factors | Do not treat them as approved FEAT-003 TOTP. Fail closed without deletion or downgrade. |

### Enrollment secret handling

- The QR SVG/data, authenticator URI, and manual TOTP secret are credentials.
- Keep them only in memory for the active page operation.
- Never put them in application tables, audit metadata, URLs, local/session storage, caches, analytics, logs, error reports, test snapshots, screenshots, documentation, clipboard automation, or AI prompts.
- Render the QR through a strictly validated non-executable image path; never inject provider SVG as raw HTML.
- Provide an explicit manual-secret alternative with a user-controlled reveal. Accessible names must not contain the secret.
- A user-triggered copy action, if implemented, must identify what was copied without announcing or logging the secret.
- Refresh, route change, cancellation, timeout, sign-out, session revocation, or component disposal clears the in-memory secret and invalidates stale operations.

### Verification, challenge, retry, and cancellation

- TOTP input accepts exactly the provider-supported six numeric digits, uses `inputmode="numeric"` and `autocomplete="one-time-code"`, and permits paste.
- Disable duplicate submissions while a challenge is active.
- Invalid or expired codes return safe corrective guidance without clearing the factor secret or creating a membership.
- Retry uses provider-authoritative challenge behavior and throttling. No client counter may override provider denial.
- `429` or uncertain provider state shows a wait/retry state and never opens a workspace.
- Successful verification must refresh/revalidate the session and prove current AAL2 plus password and TOTP AMR before completion.
- The initial bounded implementation performs no automatic factor unenrollment on cancellation because browser-held factor ID or timing is not server-verifiable ownership proof. It clears all in-memory secret state, keeps the grant unconsumed, creates no membership, records the safe cancellation outcome, and signs out.
- Automatic cleanup may be proposed later only when pinned-runtime evidence and a protected server record bind the factor to the verified actor, session, grant, operation UUID, factor type, unverified status, and current operation. Without every check, do not call `unenroll`.
- Cleanup or audit uncertainty is visible but fail closed: no membership is created, no workspace opens, and the user receives safe support guidance.
- Cancellation never removes a verified factor, changes a membership, or consumes the bootstrap grant.

### Supabase Auth and PostgreSQL consistency boundary

Supabase Auth factor/session state and the PostgreSQL membership transaction cannot commit atomically. The accepted bounded local mitigation is:

1. challenge/verify the approved TOTP;
2. refresh and validate the user session;
3. immediately re-fetch the complete factor inventory and require exactly one verified TOTP with no mixed, duplicate, unknown, or uncertain state;
4. invoke the completion RPC without a client-controlled authority field;
5. after database completion, re-fetch Auth factor/session state and rerun protected `auth-bootstrap` before opening the placeholder; and
6. deny access and show support guidance if the provider is unavailable or the final state differs.

A factor removed after the pre-RPC check may leave a completed FlyEye membership because there is no distributed Auth/database transaction. It must not yield workspace access: final access bootstrap revalidates current provider factor state in addition to server-derived membership, permission, password AMR, and AAL2. The bounded local/synthetic implementation has automated pre/post provider-failure evidence and corrected separate-agent review. Representative hosted and production behavior still requires environment-specific security evidence before those later gates. If the pinned runtime cannot support the required pre/post checks, implementation stops for a specification amendment.

### Stale session and fail-closed behavior

The onboarding operation becomes stale on:

- password-AMR age beyond the approved window;
- JWT/session replacement or revocation;
- sign-out in another tab;
- membership, organization, grant, role, or factor change;
- browser Back/refresh or route replacement that invalidates the operation generation;
- provider response with missing/malformed factor, AAL, or AMR data; or
- expected-version mismatch.

Stale state clears the TOTP secret and selected grant from active UI state. The user must return to a fresh password sign-in. A client event, cached AAL, factor ID, organization label, or previous successful response cannot restore authority.

## Organization selection and multi-membership behavior

1. The server separately returns the actor's active memberships through `auth-bootstrap` and the actor's eligible first-admin grants through the protected onboarding status command.
2. If exactly one eligible organization context exists, it may be shown as the selected candidate but is still revalidated on every protected call.
3. If multiple eligible contexts exist, the user explicitly selects one. The client submits only the opaque membership or grant selection hint.
4. The server derives the organization and returns only the selected, revalidated context.
5. Completing a first-admin grant for Organization A creates no membership, role, or visibility in Organization B.
6. TOTP is identity-scoped. Its presence may satisfy MFA for another independently authorized membership after a fresh server bootstrap, but it never widens organization access.
7. A multi-membership identity can switch organizations only by invoking the protected access bootstrap again. Cached data and UI state from the prior organization are cleared.
8. If the selected membership or grant becomes unavailable, the operation ends in an empty, unauthorized, expired, or conflict state without revealing another tenant.

## Workflow and UI state machine

```text
CheckingSession
  -> SignedOut
  -> LoadingAccessAndEligibility

LoadingAccessAndEligibility
  -> Empty
  -> Unauthorized
  -> OrganizationSelection
  -> RecentAuthenticationRequired
  -> ExistingFactorChallenge
  -> EnrollmentReady
  -> Conflict
  -> Failure

EnrollmentReady
  -> Enrolling
  -> EnrollmentSecretReady
  -> Cancelling

EnrollmentSecretReady
  -> Verifying
  -> InvalidCode
  -> RateLimited
  -> StaleSession
  -> Cancelling
  -> CompletingBootstrap

ExistingFactorChallenge
  -> Verifying
  -> InvalidCode
  -> RateLimited
  -> StaleSession
  -> Cancelling
  -> CompletingBootstrap

CompletingBootstrap
  -> Conflict
  -> Failure
  -> RevalidatingAccess

RevalidatingAccess
  -> Unauthorized
  -> Conflict
  -> SuccessAdministrationPlaceholder

Any authenticated state
  -> SignedOut on cancellation, revocation, or explicit sign-out
```

### Required visible states

| State | Required behavior |
|---|---|
| Loading | Identify whether session, eligibility, factors, verification, completion, or workspace access is being checked; prevent duplicate action. |
| Empty | No active membership or eligible bootstrap grant; provide non-enumerating support guidance. |
| Unauthorized | The actor, organization, role, factor type, or authentication method is not allowed; reveal no hidden tenant or grant details. |
| Invalid | Associate field guidance with the TOTP input and preserve a retryable current operation only when server state remains valid. |
| Conflict | Explain that account/administrator review is required for duplicate factors, an existing admin, inconsistent role data, or concurrency loss. |
| Offline | State that enrollment, verification, bootstrap completion, and workspace access require connectivity; queue nothing. |
| Failure | Show a safe correlation ID where available, offer bounded retry when safe, and never imply membership or factor cleanup succeeded. |
| Recovery/support | Explain that lost-device, factor replacement, and supervised recovery are not yet available; do not offer bypass or downgrade. |
| Success | State the selected organization, Organization Admin role, MFA-protected session, and administrative-only authority boundary. |

## Accessibility and responsive requirements

- Use semantic headings, labels, descriptions, validation summaries, buttons, and status regions.
- Every operation is keyboard reachable in a logical order; QR scanning is never the only completion path.
- Move focus predictably to the page heading on state change and to the validation summary or first invalid field after submission errors.
- Use a polite live region for progress and ordinary status, and an assertive alert only for blocking errors that require immediate attention.
- Do not repeatedly announce changing countdowns, codes, secrets, or raw provider errors.
- Preserve visible focus and do not trap focus outside a true modal dialog.
- Support desktop, tablet, and mobile layouts without horizontal scrolling for the core workflow.
- At 200% zoom and narrow reflow, preserve the complete manual secret, code field, error text, cancellation, and primary action without overlap or clipping.
- Meet WCAG 2.2 AA contrast targets; never use color alone for factor, error, warning, or success state.
- Interactive targets meet WCAG 2.2 AA target-size expectations or an approved equivalent spacing exception.
- TOTP fields support paste, `autocomplete="one-time-code"`, mobile numeric keyboards, password-manager code filling where available, and manual entry.
- Password sign-in retains normal password-manager/autofill semantics. The TOTP secret does not impersonate a password field or become durable form history.
- QR images have concise purpose text and a manual-secret alternative; alt text never embeds the credential.
- Instructions explain authenticator-app time synchronization without blaming the user or inventing provider behavior.
- If a CAPTCHA or risk challenge is introduced by the selected provider, it must be keyboard and screen-reader operable, preserve focus, provide an accessible nonvisual fallback/support path, avoid tenant disclosure, and receive provider/privacy review. No active CAPTCHA provider is approved for FEAT-003.
- Automated accessibility checks are supporting evidence only. Human keyboard, screen-reader, zoom/reflow, contrast, target-size, authenticator, autofill/password-manager, and any active CAPTCHA review remain required at their applicable gates.

## Data, migration, RLS, and generated-type impact

### Proposed migration

One additive FEAT-003 migration is expected to:

- create `organization_admin_bootstrap_grants`;
- enable RLS before exposure and add no permissive browser policies;
- revoke all table access from `PUBLIC`, `anon`, and `authenticated`;
- add status, expiry, tenant, subject, version, and completion constraints/indexes;
- set database-generated `issued_at`, constrain `expires_at` to exactly 30 minutes later, and expose no sliding extension path;
- add the constrained non-human source fields to `authentication_events` while preserving the existing authenticated-subject writer rule;
- add or extend server-only audit event constraints for issuance, onboarding status/start, denial, cancellation, conflict, expiry, and completion;
- create narrow server-only status/start/cancel RPCs and the atomic completion RPC with fixed `search_path`, narrow input, no unsafe dynamic SQL, and service-role-only execution;
- revoke every protected function from `PUBLIC`, `anon`, and `authenticated`, grant only the exact server role, and prevent default privileges or overloads from reopening access;
- retain the existing FEAT-001 migrations unchanged; and
- preserve all existing data without a production backfill.

The implementation must inspect whether extending `authentication_events` remains the smallest coherent audit design. If a new general audit table is proposed instead, stop for a specification amendment rather than introducing an unreviewed cross-feature audit architecture.

### RLS and grant requirements

- `organization_admin_bootstrap_grants` is tenant-owned and deny-by-default.
- `PUBLIC`, anonymous, and authenticated browser roles cannot select, insert, update, delete, or execute any protected RPC directly.
- Existing organization, membership, role, permission, role-assignment, and authentication-event tables remain browser-inaccessible unless a separately approved policy says otherwise.
- The protected Edge Function may use server authority only for the narrow eligibility, completion, and audit operations.
- Direct calls with another subject, grant, or organization return no cross-tenant data.
- Migration review inspects and tests explicit/default privileges, `PUBLIC` reachability, function owner, every overload/signature, fixed `search_path`, schema qualification, `SECURITY DEFINER` use, views, triggers, and direct Data API/RPC access.
- Schema-wide RLS discovery, table privileges, function grants, views, triggers, and generated types are inspected after migration.

### Rollback and recovery

- Before release, the forward rollback is to disable the FEAT-003 onboarding entry point and protected command while preserving audit and completed memberships for review.
- Do not delete completed administrator memberships, factor evidence, or audit rows automatically.
- Pending synthetic grants may be revoked through a reviewed server-only operation; no destructive cleanup is implied.
- A failed migration or function deployment must leave existing FEAT-001/002 login and recovery behavior unchanged.
- Any partially verified Auth factor with no completed membership is not proof of FlyEye authority and must remain blocked from the administration workspace.

## Protected-function contract

### Proposed Edge Function

- Method/path: `POST /functions/v1/organization-admin-onboarding`
- Allowed actions: `status`, `start`, `complete`, and `cancel`
- Authentication: verified Supabase user JWT
- Origin: exact configured frontend origin; no wildcard
- Request: strict bounded JSON; opaque `bootstrapGrantId`, `expectedVersion`, action, and idempotency key where applicable
- Forbidden authority inputs: role, permission, email, user ID, AAL, AMR, factor status, organization authority, support override, or service-role credential

### Action contracts

| Action | Required behavior | Audit and idempotency |
|---|---|---|
| `status` | Validate JWT and strict recent password AMR; call a narrow service-role-only RPC that derives the actor, returns only that actor's effective unexpired grants and safe labels, and materializes effective expiry when required | No client idempotency key; a verified-subject eligibility decision and any materialized expiry audit in the same database transaction; audit failure returns `audit_unavailable` |
| `start` | Revalidate actor, grant, version, organization activity, effective expiry, strict recent password AMR, and complete factor inventory; create no membership or role | Require a bounded idempotency key; store only its hash in the minimized start audit with uniqueness scoped to actor + grant + `start`; same-scope replay returns the same safe state |
| `complete` | Revalidate JWT/session/factor state immediately before invoking the organization-serialized completion RPC with server-derived evidence only | Require a bounded idempotency key; store its hash on the consumed grant and atomic success audit; same-scope replay is non-mutating |
| `cancel` | Revalidate the current actor/grant where possible, record cancellation, clear client secret/operation state, and sign out; initial implementation performs no automatic factor deletion | Require a bounded idempotency key; cancellation audit records `not_attempted`, `succeeded`, `failed`, or `uncertain` cleanup outcome without a secret/factor payload; same-scope replay is safe |

Authentication failures that cannot be safely attributed do not create fabricated application actors. For every verified-subject decision that is defined as mandatory audit, failure to write the audit returns a safe failure and grants no authority.

Provider enrollment/challenge/cleanup and PostgreSQL audit are separate systems. The implementation must not describe them as one transaction. If a provider side effect succeeds but its application audit cannot be confirmed, the response reports uncertainty, clears local secret state, creates no membership, and opens no workspace.

Example completion request:

```json
{
  "action": "complete",
  "bootstrapGrantId": "opaque-uuid",
  "expectedVersion": 1,
  "idempotencyKey": "opaque-value"
}
```

The server derives actor, authentication methods and timestamps, factor/AAL state, organization, grant status, and role. A safe response contains the selected organization ID/name, created membership ID, current grant version/status, and correlation ID. It contains no TOTP secret, factor secret, raw JWT, service-role key, hidden membership, or provider audit payload.

The Edge-to-RPC internal contract is not the browser contract. It contains only values derived after JWT/provider validation: actor user/subject UUID, session UUID, password-authenticated Unix timestamp, exact assurance level, bounded authentication-method names, opaque grant ID, expected version, correlation ID, and the hashed idempotency key. The service-role-only RPC rejects missing, malformed, future, stale, inconsistent, or out-of-scope evidence and rechecks all database-owned state.

### Stable error families

| HTTP | Proposed code | Meaning |
|---|---|---|
| 400/422 | `admin_onboarding.invalid_request` | Malformed or unsupported request |
| 401 | `admin_onboarding.authentication_required` | Missing, invalid, or expired session |
| 403 | `admin_onboarding.not_eligible` | No eligible subject/context or disallowed authentication method |
| 403 | `admin_onboarding.recent_authentication_required` | Password authentication is not recent enough |
| 403 | `admin_onboarding.mfa_required` | Current verified TOTP/AAL2 is absent |
| 404 | `admin_onboarding.not_available` | Safe non-enumerating grant result |
| 409 | `admin_onboarding.conflict` | Existing admin, duplicate factor, stale version, or inconsistent authority state |
| 409 | `admin_onboarding.already_completed` | Idempotent replay of the actor's completed grant; return only safe revalidation guidance |
| 429 | `admin_onboarding.rate_limited` | Provider or application retry limit |
| 500 | `admin_onboarding.audit_unavailable` | Required audit evidence could not be written; action blocked |
| 503 | `admin_onboarding.provider_unavailable` | Auth/provider state cannot be confirmed; action blocked |

Error responses do not reveal whether another organization, user, administrator, grant, or factor exists.

### Rate-limiting and abuse-control boundary

At baseline `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66`, `supabase/config.toml` declares local Supabase Auth limits of 30 sign-in/sign-up requests and 30 token verifications per five-minute interval per IP, 150 token refreshes per five-minute interval per IP, and 30 email sends per hour. These values describe version-controlled local provider configuration only. They do not prove hosted settings, production capacity, provider MFA limits, or FlyEye-controlled throttling for a custom Edge Function.

The existing `auth-bootstrap` handler validates the session bearer token, exact origin, method, actual request-body size, strict request schema, password AMR, server-derived authorization, and mandatory audit behavior. It does not implement a separate FlyEye application-level limiter at this baseline. Supabase provider limits, Edge runtime/resource limits, frontend duplicate-submit prevention, and client counters are defense-in-depth and cannot be treated as the protected onboarding endpoint's abuse control.

Before FEAT-003 implementation acceptance, the `organization-admin-onboarding` endpoint must enforce reviewed per-action limits for `status`, `start`, `complete`, and `cancel`. The design must:

- use server-trusted dimensions appropriate to the action, including authenticated subject, safely obtained network source where approved, action, organization only after authorization, failure pattern, and operation cost;
- avoid returning or retaining a raw TOTP code, secret, token, email, unrestricted IP address, hidden tenant/grant/factor identifier, or provider payload;
- use an atomic limiter decision that remains effective across concurrent Edge isolates and cannot be reset or widened by client input;
- return the safe `admin_onboarding.rate_limited` family with bounded retry guidance and no tenant, account, grant, factor, threshold, or provider-state disclosure;
- preserve provider-authoritative TOTP denial and never let an application counter override or convert provider failure into success;
- fail closed for authority-bearing `start` and `complete` operations when required limiter state is unavailable or uncertain;
- define safe availability behavior for non-mutating `status` and cancellation without creating a bypass or losing required audit evidence;
- produce mandatory privacy-minimized synthetic implementation-acceptance evidence for every action and for allowed, rate-limited, limiter-unavailable, and recovered decisions across rapid, distributed-key, replay, concurrent-Edge-isolate, and recovery-after-window scenarios;
- prove that safe correlation identifiers connect the request, limiter decision, mandatory audit evidence where applicable, and recovery result without exposing a tenant, account, grant, factor, threshold, provider internal, unrestricted IP address, or secret; and
- prove accessible wait, retry, failure, and recovery states without relying on a disabled button or client counter as enforcement.

### Approved provisional local-only limiter and operations choices

On 2026-07-28, the Founder/Product Owner approved the following reversible local choices. They subsequently passed the complete local automated matrix and corrected separate-agent review:

| Action | Sustained local rate | Burst capacity | Continuous refill |
|---|---:|---:|---:|
| `status` | 12 per 60 seconds | 4 | One token every 5 seconds |
| `start` | 4 per 60 seconds | 2 | One token every 15 seconds |
| `complete` | 3 per 60 seconds | 1 | One token every 20 seconds |
| `cancel` | 6 per 60 seconds | 2 | One token every 10 seconds |

The provisional local design requires:

- a PostgreSQL-authoritative integer-scaled token bucket using database transaction time and an atomic lock or upsert so concurrent Edge isolates receive one serialized decision;
- one HMAC-SHA-256 limiter key derived server-side from authenticated subject plus action using a dedicated ephemeral local limiter secret that is stable for one evidence run, is never committed or logged, and is not derived from the service-role key;
- consumption of limiter capacity by every authenticated action attempt, including replayed requests or changed grant, organization, or idempotency hints, before protected action processing;
- no raw subject, organization, grant, factor, email, token, TOTP data, unrestricted IP address, or secret in limiter state or monitoring evidence;
- no trust in client-supplied `Forwarded`, `X-Forwarded-For`, or similar headers and no IP/network enforcement dimension in the local runtime; local evidence records `network_source_used = false`, while gateway-specific trusted-source and multi-account/distributed-network controls remain hosted decisions;
- server-generated correlation before the limiter decision, reused for applicable mandatory action audit, with durable local evidence limited to aggregate counts, outcomes, hashes, status codes, and safe correlation references;
- expiry of inactive limiter rows after 15 minutes, fixture cleanup of synthetic limiter/audit rows, and a zero-unexpected-residue postcondition;
- safe non-enumerating `429` responses with bounded whole-second retry guidance and no remaining-count, threshold, tenant, account, grant, factor, or provider disclosure;
- fail-closed safe `503` behavior for `status`, `start`, and `complete` when limiter state is unavailable or uncertain;
- for unavailable `cancel`, no server factor deletion, grant consumption, membership mutation, or claimed audit success; the client still clears in-memory secrets, invalidates the operation, signs out, and reports that server cancellation/audit confirmation is uncertain;
- one-occurrence stop-work failure for fail-open authority, an atomic-boundary violation, missing mandatory audit/correlation, cross-tenant or hidden-state disclosure, prohibited telemetry content, unsafe recovery, or failure to demonstrate recovery after the approved 60-second local window;
- expected `429` results in explicit abuse scenarios as passing evidence rather than alerts; the executing agent collects local evidence and immediately escalates stop conditions to the Founder/Product Owner, while no production on-call owner, vendor, or alert channel is selected; and
- no emergency override, manual counter edit, alternate-header bypass, disabled enforcement, or reuse of a stale allowed decision. Local emergency behavior is limited to stopping the endpoint or stack, preserving privacy-safe evidence, correcting the defect, and rerunning the required affected and final evidence.

These choices do not establish hosted or production thresholds, provider/network trust, production retention, alert ownership, incident roles, emergency behavior, capacity, cost, or production approval. The implemented local choices passed the complete automated matrix and corrected separate-agent review, satisfying the autonomous local publication gate. Hosted and production values require separate representative evidence and must not be inferred from local Supabase Auth declarations or these provisional local choices.

## Local synthetic fixture contract

The implemented `scripts/test-feat-003-runtime.mjs` must:

1. run only from the repository containing `supabase/config.toml` with `project_id = "flyeye"` and resolve all paths from that verified root;
2. obtain `supabase status -o json` from the locally installed pinned CLI and require loopback API and database hosts/ports;
3. verify that the API URL, PostgreSQL port, Docker database container identity/labels, configured project ID, and current working tree identify the same running local stack;
4. reject a linked, remote, non-loopback, missing, duplicate, stale, or ambiguous target before obtaining credentials or mutating data;
5. obtain the local service/admin material only from the running local stack, hold it only in process memory, use it only for necessary local Auth administration, and never copy status output or credentials into command arguments, child environment dumps, exceptions, logs, snapshots, or durable files;
6. create randomized UUIDs and `@example.test` identities without accepting untrusted SQL identifiers or values;
7. execute direct PostgreSQL fixture SQL with parameterized values or strictly generated/validated values, `psql -v ON_ERROR_STOP=1`, and an explicit `BEGIN`/`COMMIT`;
8. insert the grant and constrained non-human issuance audit together, then query bounded postconditions proving exactly one matching grant/audit pair before reporting success;
9. inject and prove rollback for both a grant-write failure and an audit-write/postcondition failure;
10. perform dependency-aware bounded cleanup in an explicit transaction, verify zero unexpected residual synthetic rows, and retain no administrative credential; and
11. report cleanup failure or uncertainty as the final evidence failure even when earlier assertions passed.

The fixture may create/delete randomized local Auth users through the in-memory local administrative client and may insert/remove its synthetic database rows through direct local PostgreSQL administration. It may not call a browser, Data API, application-accessible RPC, or Edge Function to issue, extend, replace, revive, or revoke a grant. Direct PostgreSQL administration bypasses RLS by design, so same-stack attestation, transactionality, minimized output, and bounded cleanup are mandatory safety controls rather than application authorization.

## Audit, privacy, notifications, and observability

### Required evidence

At minimum, record protected application events for:

- local synthetic grant issuance by the reviewed CLI fixture;
- onboarding eligibility granted or denied;
- onboarding started;
- cancellation/cleanup outcome;
- first-admin completion denied or conflicted;
- first-admin completion succeeded; and
- audit/provider failure that blocks authority where evidence can itself be safely recorded.

Completion audit is atomic with membership creation, role assignment, and grant consumption. Audit fields include organization, pseudonymous actor subject, event, outcome, reason code, correlation ID, grant/membership opaque identifiers where necessary, assurance level, bounded authentication-method names, and non-sensitive version metadata.

Local fixture issuance audit instead uses `actor_kind = 'local_fixture'`, null human actor fields, the fixed non-secret source code, randomized source-instance UUID, organization, event/outcome, correlation, opaque grant target, and non-sensitive version metadata. It contains no local administrative credential, email, password, token, factor data, or raw SQL.

Never record email, password, TOTP code, TOTP secret, QR data, authenticator URI, access/refresh token, cookie, full IP address without an approved security-log design, raw provider response, user metadata, or hidden cross-tenant details.

Supabase Auth provider logs remain separate restricted security evidence for factor enrollment, verification, challenge, removal, and session effects. Exact action names and fields must be observed and minimized on the pinned runtime; do not invent provider events.

### Notifications

No application email or notification is required for the bounded local synthetic implementation. Production factor-enrollment and factor-change notifications, sender identity, delivery evidence, support address, and compromise response remain unresolved production gates.

### Metrics and alerts

Implementation acceptance requires privacy-minimized synthetic/local monitoring evidence for each of `status`, `start`, `complete`, and `cancel`. The evidence must cover allowed, rate-limited, limiter-unavailable, and recovered decisions; rapid, replayed, distributed-key, and concurrent-Edge-isolate attempts; and recovery after the approved window. It must show the expected safe signal and correlate the request, limiter decision, mandatory application audit where applicable, and recovery result using only bounded action/outcome names, counts, booleans, status codes, hashes, and safe correlation identifiers.

The monitoring evidence must also prove that wait, retry, failure, and recovery guidance is accessible and that no signal, retained field, error, or correlation path reveals a credential, TOTP value, token, email, hidden tenant/account/grant/factor, configured threshold, provider internal, unrestricted IP address, or secret. For the provisional local-only design, any single fail-open, atomicity, audit/correlation, cross-tenant, prohibited-field, or unsafe-recovery result stops work and is escalated immediately; expected `429` outcomes in named abuse scenarios are evidence rather than alerts. The executing agent owns local evidence collection only. Production monitoring thresholds, alert rules, log drains, retention, on-call ownership, incident roles, emergency behavior, and override decisions remain unresolved.

## Security, privacy, and abuse cases

- Public, anonymous, recovery-OTP-only, magic-link, email-OTP, passwordless, malformed-AMR, and expired-session attempts
- User-editable `user_metadata` or `app_metadata` claiming organization, admin, role, permission, factor, or approval authority
- School B user reading, selecting, completing, replaying, or inferring School A grant or membership
- Multi-membership identity attempting to carry selected organization state or cached data across tenants
- Non-admin or already-admin user attempting first-admin bootstrap
- Suspended/revoked membership, inactive organization, inactive role, missing permission, expired/revoked/consumed grant, and wrong eligible subject
- Duplicate verified factors, stale unverified factors, mixed factor types, factor removed in another tab, and challenge replay
- TOTP guessing, rapid retry, duplicate submit, concurrent tabs, idempotency replay, and two grants racing to create the first administrator
- Audit writer, membership insert, role insert, grant update, provider verification, session refresh, or access revalidation failure
- QR/SVG injection, secret copied into DOM attributes, logs, analytics, screenshots, snapshots, errors, clipboard automation, browser storage, or AI prompts
- Browser bundle or request exposing a service-role key
- Direct Data API/RPC access bypassing Edge validation
- CAPTCHA or provider challenge creating an inaccessible or privacy-invasive sole path
- Support or administrator claiming a bypass, factor downgrade, password knowledge, operational authority, or aviation authority

Any cross-tenant result, unauthorized membership/role creation, audit-free completion, secret exposure, service-role browser exposure, OTP-only workspace access, or fail-open stale session is critical and blocks implementation acceptance.

## Acceptance criteria

- [ ] **FEAT-003-AC-01:** Given an eligible synthetic first Organization Admin with a recent password session, when onboarding status loads, then only that actor's safe eligible organization contexts are returned and no browser table grant is used.
- [ ] **FEAT-003-AC-02:** Given anonymous, OTP-only recovery/email/magic-link, passwordless, stale-password, wrong-subject, expired, revoked, consumed, or unknown grant input, when onboarding is requested, then it fails closed without tenant enumeration, membership creation, or role assignment.
- [ ] **FEAT-003-AC-03:** Given multiple active memberships or eligible grants, when the user selects an organization, then the selection is an opaque hint revalidated by the server and no data or authority crosses organizations.
- [ ] **FEAT-003-AC-04:** Given no TOTP factor, when enrollment starts, then exactly one unverified factor is created and its QR, URI, and manual secret exist only in active memory.
- [ ] **FEAT-003-AC-05:** Given a valid factor secret and code, when verification succeeds, then the session is refreshed to current AAL2 with password and TOTP AMR before bootstrap completion is attempted.
- [ ] **FEAT-003-AC-06:** Given an invalid/expired code, provider rate limit, offline state, or provider uncertainty, when verification is attempted, then no membership or success state is created and accessible retry/wait guidance is shown.
- [ ] **FEAT-003-AC-07:** Given exactly one verified TOTP, when onboarding resumes, then the existing factor is challenged and no duplicate factor is enrolled.
- [ ] **FEAT-003-AC-08:** Given multiple verified factors, mixed factor types, or unproven stale-factor cleanup, when onboarding loads, then the workflow enters conflict and does not automatically select, delete, replace, or downgrade a factor.
- [ ] **FEAT-003-AC-09:** Given cancellation before completion, when cleanup is runtime-proven safe, then only the current operation's unverified factor is removed; secret state is cleared, the user is signed out, the grant remains unconsumed, and no membership exists.
- [ ] **FEAT-003-AC-10:** Given cancellation cleanup fails, when the response returns, then the user receives fail-closed support guidance and cannot enter a workspace.
- [ ] **FEAT-003-AC-11:** Given a valid pending grant, recent password AMR, current AAL2/TOTP, active organization, and no active admin, when completion succeeds, then membership creation, built-in `admin` assignment, grant consumption, version update, and audit evidence commit atomically.
- [ ] **FEAT-003-AC-12:** Given two concurrent valid completion attempts for one organization, when both execute, then at most one first administrator is created; the other returns a safe conflict and no partial authority.
- [ ] **FEAT-003-AC-13:** Given audit, membership, role, constraint, or grant-update failure, when completion executes, then the transaction rolls back and no FlyEye authority persists.
- [ ] **FEAT-003-AC-14:** Given completion succeeds, when the application opens access, then it reruns protected `auth-bootstrap` for the selected organization and requires server-derived active admin membership, `portal.admin.access`, password AMR, and AAL2.
- [ ] **FEAT-003-AC-15:** Given an Organization Admin workspace, then no operational, training, safety, quality, dispatch, assessment, Head of Training/CFI, approval, airworthiness, competency, or aviation authority is available or implied.
- [ ] **FEAT-003-AC-16:** Given an organization already has an active administrator, when first-admin completion is attempted, then it conflicts without modifying, replacing, suspending, demoting, or removing that administrator.
- [ ] **FEAT-003-AC-17:** Given desktop, tablet, mobile, keyboard, focus, live-region, paste/autofill, 200% zoom/reflow, contrast, target-size, QR/manual-secret, and provider challenge scenarios, then the documented accessibility behavior is evidenced and unresolved human-only findings are explicit.
- [ ] **FEAT-003-AC-18:** Given offline, Back/refresh, sign-out, session revocation, factor change, stale operation, or organization switch, then no secret or protected action is queued and stale state cannot restore access.
- [ ] **FEAT-003-AC-19:** Given source, bundle, logs, audit, test output, snapshots, screenshots, and history inspection, then no service-role key, password, TOTP code/secret, QR/URI credential, real identity, real organization, token, or restricted provider audit value is present.
- [ ] **FEAT-003-AC-20:** Given the full FEAT-001 and FEAT-002 regression matrix, then password login, password-AMR recovery isolation, role/AAL/TOTP challenge, audit, organization selection, deny-by-default RLS, and cross-tenant isolation remain intact.
- [x] **FEAT-003-AC-21:** Given the bounded implementation is locally complete, then the local technical publication gate is satisfied. After the one-time explicit override of this task's earlier no-publication boundary, autonomous delivery may publish through a green review-ready pull request while merge, hosted validation, real-data use, deployment, and production remain separately closed.
- [ ] **FEAT-003-AC-22:** Given factor recovery, replacement, lost-device, support, and recovery-code behavior is deferred, then the UI offers no bypass and real-data pilot/production access remains blocked until those behaviors are separately approved, implemented, and evidenced.
- [ ] **FEAT-003-AC-23:** Given a local synthetic grant, then `expires_at` is exactly 30 minutes after server-recorded issuance, does not slide, is rechecked at onboarding start and atomic completion, and cannot be revived after expiry, revocation, or consumption.
- [ ] **FEAT-003-AC-24:** Given the named CLI fixture, then non-loopback execution stops before mutation; local execution creates randomized `.test` data plus the grant and minimized issuance audit atomically through direct PostgreSQL administration; credentials never enter output or durable files; no browser, Data API, or application issuer exists; and cleanup uncertainty fails the evidence run.
- [ ] **FEAT-003-AC-25:** Given local synthetic grant issuance, then the grant and audit use the constrained `local_fixture` source, null human actor fields, fixed non-secret source code, randomized source-instance/correlation IDs, and one transaction without fabricating human authority.
- [ ] **FEAT-003-AC-26:** Given AMR at onboarding start or completion, then only a strict timestamped object array is accepted; exact age 600 seconds passes, greater age/future/malformed/string-only evidence fails, and completion repeats the check against PostgreSQL transaction time.
- [ ] **FEAT-003-AC-27:** Given same-grant replay or two different grants racing for one organization, then the organization-row-first lock order, transactional rechecks, expected version, and scoped idempotency permit at most one first administrator.
- [ ] **FEAT-003-AC-28:** Given direct Data API or RPC access by `PUBLIC`, `anon`, or `authenticated`, including overload/default-privilege attempts, then no grant data or protected execution is available.
- [ ] **FEAT-003-AC-29:** Given cancellation without server-verifiable factor ownership, then no factor is unenrolled, in-memory credentials are cleared, the grant remains unconsumed, no membership exists, and the user is signed out with safe guidance.
- [ ] **FEAT-003-AC-30:** Given factor removal/provider failure in the Auth/database consistency window, then final provider and `auth-bootstrap` revalidation denies workspace access even if a membership transaction completed.
- [ ] **FEAT-003-AC-31:** Given allowed, repeated, concurrent, replayed, distributed-key, limiter-unavailable, or recovered requests to `status`, `start`, `complete`, or `cancel`, then reviewed server-enforced per-action limits return safe non-enumerating behavior and `429` guidance, authority-bearing actions fail closed, safe `status`/`cancel` behavior creates no bypass, provider denial is never overridden, and privacy-minimized evidence correlates the request, limiter decision, mandatory audit where applicable, and recovery without hidden-state, threshold, provider-internal, unrestricted-IP, or secret disclosure. Accessible wait, retry, failure, and recovery states are evidenced, and no protected action succeeds because client counters or platform quotas were mistaken for application throttling.

## Planned tests and evidence

| Test ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| FEAT-003-UNIT-01 | Unit | Eligibility/status response validation and safe errors | Malformed, duplicate, or cross-context data fails closed |
| FEAT-003-UNIT-02 | Unit | Onboarding state machine, operation generation, Back/refresh, cancellation, and stale async responses | No stale success, duplicate submit, or secret retention |
| FEAT-003-UNIT-03 | Unit | Strict password/TOTP AMR parsing, future/duplicate/malformed/string-only input, and 599/600/601-second boundaries | Server-derived timestamped objects only; deterministic boundary behavior |
| FEAT-003-UNIT-04 | Unit | Complete `listFactors().all` inventory classification and convenience-array inconsistency | Zero, one unverified, one verified, duplicate, mixed, removed, unknown, and inconsistent states map safely |
| FEAT-003-UNIT-05 | Unit | QR/manual-secret validation, redaction, and cleanup | No raw HTML injection, durable secret, or logged credential |
| FEAT-003-COMP-01 | Component | Loading, empty, unauthorized, invalid, conflict, offline, failure, recovery, and success states | Accessible content and no fail-open navigation |
| FEAT-003-COMP-02 | Component | Enrollment, invalid code, retry, rate limit, cancellation, cleanup failure, and stale session | Focus/live-region behavior and safe terminal states |
| FEAT-003-COMP-03 | Component | Multi-organization selection and switching | Selected context revalidated; prior tenant UI cleared |
| FEAT-003-COMP-04 | Component | Duplicate/mixed factor conflict and lost-device support boundary | No automatic deletion, replacement, or bypass |
| FEAT-003-SQL-01 | SQL | Grant/source constraints, database issuance time, exact expiry/status/version combinations, indexes, and FKs | Invalid attribution/time/state rows and cross-tenant relationships rejected |
| FEAT-003-RLS-01 | SQL/RLS | `PUBLIC`/anonymous/authenticated CRUD, RPC, overload, and default-privilege attempts | No browser/public table or protected RPC access |
| FEAT-003-RLS-02 | SQL/RLS | Two organizations and wrong subject/grant/direct ID | No cross-tenant data or mutation |
| FEAT-003-RPC-01 | SQL/function | Successful atomic first-admin completion | Membership, one role, consumed grant, and audit commit together |
| FEAT-003-RPC-02 | SQL/function | Existing admin, inactive org/role, conflict, stale version, expired/revoked grant | Safe denial with no mutation |
| FEAT-003-RPC-03 | SQL/function | Audit/role/membership/grant-write failure injection | Complete rollback |
| FEAT-003-RPC-04 | SQL/function | Organization-row-first locking, same/different-grant races, expected version, and scoped replay/idempotency | At most one first admin; safe replay/conflict |
| FEAT-003-EDGE-01 | Edge handler | Origin, method, JWT, body size/schema, strict timestamped AMR, exact recent-auth boundary, complete factor inventory, internal evidence contract, AAL2/TOTP, and safe codes | Protected contract enforced before RPC |
| FEAT-003-EDGE-02 | Edge/abuse | Per-action subject/network/action/authorized-organization limits, allowed/rate-limited decisions, bursts, concurrent isolates, replay, distributed keys, limiter failure/recovery, recovery after the window, safe `429`, and non-enumeration | Atomic server decision; no provider override, bypass, hidden-state disclosure, or fail-open authority; safe `status`/`cancel` behavior |
| FEAT-003-MON-01 | Monitoring/observability | Per-action allowed, rate-limited, limiter-unavailable, and recovered decisions across rapid, replayed, distributed-key, concurrent-isolate, and recovery-after-window scenarios | Privacy-minimized correlation among request, limiter decision, applicable audit, and recovery; expected safe signal observed; accessible wait/retry/failure/recovery state; no hidden identifier, threshold, provider internal, unrestricted IP address, or secret |
| FEAT-003-AUTH-01 | Local Auth integration | TOTP enroll, challenge, verify, invalid/expired code, AAL/AMR, session effects, two sessions, refresh, removal, and delayed downgrade | Pinned provider lifecycle reproduced with minimized output |
| FEAT-003-AUTH-02 | Local Auth integration | Cancellation with no binding; separately probe whether safe server-verifiable binding is possible | Initial behavior never deletes; any proposed cleanup must prove every ownership/status check or stop for amendment |
| FEAT-003-AUTH-03 | Local Auth integration | Existing, duplicate, stale, mixed, and removed factors | Fail-closed factor inventory behavior |
| FEAT-003-TENANT-01 | Integration | Org A first-admin candidate, Org B attacker, and identity with memberships/grants in both | No cross-organization visibility or authority |
| FEAT-003-SEC-01 | Security | Recovery/email/magic-link OTP sessions and user-metadata authority attempts | Password-AMR gate and server membership authority remain intact |
| FEAT-003-SEC-02 | Security | Guessing, throttling, replay, concurrent tabs, stale sessions, provider failure, factor removal immediately before/after RPC, and Auth/database race | No fail-open access under uncertainty; any completed membership remains inaccessible without final provider/bootstrap revalidation |
| FEAT-003-AUDIT-01 | Integration | Start, denial, cancellation, conflict, completion, and audit failure | Attributable minimized evidence; mandatory audit blocks completion |
| FEAT-003-E2E-01 | Browser | New first admin enrolls TOTP and reaches only selected admin placeholder | Complete local synthetic happy path |
| FEAT-003-E2E-02 | Browser | Existing factor challenge and multi-organization selection | No duplicate factor and correct tenant revalidation |
| FEAT-003-E2E-03 | Browser | Invalid/offline/conflict/stale/cancel/failure/recovery states | No queued secret/action or stale access |
| FEAT-003-A11Y-01 | Automated/human | Responsive, keyboard, focus, live regions, autofill/password manager, zoom/reflow, contrast, target size, QR/manual secret | Exact observations, tools, limitations, and reviewer recorded |
| FEAT-003-CAPTCHA-01 | Provider/accessibility | Active CAPTCHA/risk challenge if later selected | Keyboard/nonvisual fallback, privacy, focus, and failure behavior; otherwise explicitly not applicable locally |
| FEAT-003-SCAN-01 | Secret/scope | Source, history, bundle, logs, output, snapshots, docs, and diff | No credential/real-data/service-role leakage |
| FEAT-003-REG-01 | Regression | FEAT-001/002 unit, SQL/RLS, Auth/TOTP/Edge, recovery, browser, build, lint, types, and dependency checks | Existing behavior remains green |
| FEAT-003-CONFIG-01 | Configuration | Local reset, pinned versions, TOTP settings, declared Auth limits, exact origin, generated types, migrations/grants | Reproducible local synthetic configuration, exact provider-versus-application limit boundary, and no drift |
| FEAT-003-FIXTURE-01 | Local runtime fixture | Same-stack API/database/container/project attestation, non-loopback/linked refusal, in-memory credential handling, randomized `.test` creation, parameterized direct PostgreSQL transaction with `ON_ERROR_STOP`, atomic issuance audit, postconditions, injected grant/audit failure, and bounded cleanup | No remote/ambiguous mutation, durable/logged credential, fabricated human actor, partial grant/audit state, or browser/application issuer |
| FEAT-003-FIXTURE-02 | Local runtime fixture | Exact 30-minute boundary, start/completion recheck, no sliding extension, expiry/revocation/consumption terminality, and replacement by new grant only | Server-time behavior passes before/at/after boundary; stale/replayed grants never regain eligibility |

All implementation evidence uses randomized `example.test` identities and at least two synthetic organizations. Evidence records counts, booleans, safe action/field names, HTTP results, hashes, and correlation IDs only; it does not retain raw credentials or provider audit rows.

## Proposed implementation impact

### Schema

- Add `organization_admin_bootstrap_grants`.
- Add the minimum audit constraint/event support needed for FEAT-003 after design review.
- Do not rewrite FEAT-001 migrations.
- No invitation, profile, general user-management, general role-assignment, operational, training, or aviation schema.

### RLS and grants

- Enable deny-by-default RLS on the new tenant table.
- No `PUBLIC`, `anon`, or `authenticated` table policy or protected RPC grant.
- Service-role-only narrow server functions, fixed `search_path`, explicit owner/signature/default-privilege review, and adversarial tests.
- Preserve schema-wide RLS discovery and existing browser denial.

### Protected functions

- Add the protected `organization-admin-onboarding` Edge Function.
- Add narrow service-role-only status/start/cancel RPCs and the atomic first-admin completion RPC.
- Add a strict shared server-only timestamped AMR/internal-evidence contract.
- Add the server-enforced per-action abuse limiter using the recorded provisional local-only choices in this specification. Treat them as local/synthetic values backed by automated evidence and corrected separate-agent review; do not infer hosted or production values without representative evidence.
- Extend existing access bootstrap only as required to route an eligible actor to onboarding and to revalidate current provider factor state after success; preserve password-AMR, tenant, role, permission, AAL, and audit checks.

### Audit

- Add the constrained non-human fixture source fields to the existing authentication-event design without weakening the existing human-subject writer.
- Record minimized onboarding decisions, scoped idempotency hashes, and atomic completion evidence.
- Reproduce and document pinned Supabase Auth factor audit behavior without copying raw rows.
- Define retention/access/alert ownership before real data.

### Frontend

- Add a narrow onboarding flow to the existing auth feature.
- Reuse current session, organization-selection, operation-generation, state-panel, TOTP input, error, and responsive patterns.
- Add secure QR/manual-secret presentation and the complete states in this specification.
- Keep the administration workspace a non-operational placeholder.

### Tests

- Add unit, component, SQL/RLS, protected-function, Auth runtime, tenant, replay, concurrency, rollback, audit, monitoring/observability, accessibility, browser, secret, configuration, and FEAT-001/002 regression evidence listed above.
- Update generated types only after an authorized migration.
- Do not modify GitHub Actions unless a separate tooling change is justified and authorized.

## Dependencies

The proposed design uses the existing pinned React, TypeScript, Vite, Zod, Supabase JS/Auth, Supabase CLI, Vitest, Testing Library, jsdom, and Playwright dependencies.

No new package is proposed. The implementation should first use the validated Supabase TOTP enrollment response and browser image semantics without raw HTML. If safe QR rendering cannot be achieved with the existing stack, stop and document the proposed package's necessity, maintenance, license, vulnerability status, bundle/operations impact, and existing alternatives before requesting authorization.

## Files allowed to change in the bounded implementation

- A new ordered FEAT-003 SQL migration
- `supabase/functions/organization-admin-onboarding/**`
- A narrowly scoped server-only shared auth/AMR contract where necessary
- Existing `supabase/functions/auth-bootstrap/**` only for approved onboarding routing/revalidation without weakening FEAT-001/002
- `src/features/auth/**` for the bounded onboarding flow
- `src/lib/access-context.ts` and `src/lib/database.types.ts` only for approved contracts/generated schema types
- FEAT-003 SQL, Edge, Auth integration, component, and browser tests
- `scripts/test-feat-003-runtime.mjs` for the approved CLI-only ephemeral local fixture and runtime evidence
- Other local synthetic test scripts/configuration only where separately required and approved
- FEAT-003 specification, traceability, and necessary authoritative status/change documents

## Files not allowed to change without a specification amendment

- `AGENTS.md`, except in a separately authorized project-wide process/tooling task
- Existing FEAT-001 migrations
- FEAT-002 recovery templates or recovery behavior except a required regression correction
- Dependencies or lockfile
- GitHub Actions, except in a separately authorized project-wide process/tooling task
- Invitation, general member-management, profile, or general role-assignment modules
- Aircraft, personnel, compliance, dispatch, training, assessment, reporting, files, AI, or other operational modules
- Hosted, staging, production, DNS, email-provider, monitoring, secret, or deployment configuration

## Current implementation and tooling boundary

Historical implementation record: the Founder/Product Owner authorization created branch
`feat/FEAT-003-organization-admin-mfa-onboarding` from baseline
`b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66` and permitted only the bounded local
synthetic FEAT-003 implementation and evidence. That implementation is present
and completed local automated verification on 2026-08-02. The explicitly
requested 2026-08-02 project-wide process simplification may amend `AGENTS.md`,
CI/tooling, and development-governance Markdown without becoming FEAT-003
implementation evidence. The autonomous-delivery directive now authorizes
scoped staging, commit, branch push, a review-ready pull request, and CI
follow-up for new direct feature requests. This already-open FEAT-003 task
retains its earlier explicit no-staging/no-publication boundary until the
Founder/Product Owner supplies one clear override. It does not authorize merge,
hosted Supabase mutation, real-data use, deployment, production, branch
deletion, or FEAT-004 work.

## Explicit gates

| Gate | Required decision/evidence | Current state |
|---|---|---|
| Specification approval | Founder/Product Owner approves or amends FEAT-003-DEC-01 through DEC-05 and the bounded outcome | Approved as written on 2026-07-27 |
| Implementation-readiness values | Exact local grant lifetime and browser-inaccessible local issuer/test setup | Approved on 2026-07-27: 30 minutes, non-sliding; CLI-only `scripts/test-feat-003-runtime.mjs` fixture |
| Independent-design-review amendment | Exact audit-source, AMR/evidence, database time/locking/idempotency, grant/action, factor/race, and fixture controls | Documentation amendment authorized and recorded on 2026-07-27 |
| Post-amendment verification | Read-only verification against every prior blocking finding | Completed on 2026-07-28 as documentation-consistency review only; `DOC-STATUS-01` resolved; no implementation/runtime, qualified-human-review, product-acceptance, authorization, or release evidence |
| Historical staged-review-gate amendment | Formerly moved competent review before local acceptance and Git publication; superseded for local delivery by the 2026-08-02 autonomous-delivery directive | Documentation amendment authorized and recorded on 2026-07-28; retained only as history |
| Historical staged-review-gate verification | Strictly read-only verification of the former staged model | Completed on 2026-07-28 as documentation-consistency evidence only; retained only as history and not a current publication gate |
| Provisional local limiter/operations decisions | AI-guided recommendation brief and explicit Founder/Product Owner approval of the reversible local-only choices required for executable implementation and testing | Approved for documentation-only recording on 2026-07-28; PostgreSQL token buckets, per-action rates/bursts, HMAC subject/action keys, no local IP trust, 15-minute inactive-state retention, fail-closed behavior, local stop-work monitoring, and no override; later bounded local implementation authorization did not convert them into hosted or production values |
| Provisional local limiter/operations verification | Strictly read-only review confirms the exact approved local choices, limitations, unresolved hosted/production decisions, competent-review requirement, fingerprints, and closed downstream gates | Completed on 2026-07-28 as documentation-consistency evidence only against tracked fingerprint `27014d8b60c17c129dfd29513fea79abe89f9483`; all fourteen requirements passed and no documentation conflict remained; no implementation or release gate was satisfied |
| Historical implementation authorization | Original prompt named branch, baseline, scope, and local synthetic boundary | Granted for this feature on `feat/FEAT-003-organization-admin-mfa-onboarding`; future direct feature requests use the standing autonomous-delivery directive |
| Risk-triggered human review | Qualified review for regulated, real-data, hosted, production, penetration-test, or formal-compliance claims when inherently required | Not required for local synthetic Git publication; later applicable gates remain open |
| Local synthetic technical acceptance | Full planned matrix, exact diff, known limitations, and corrected separate-agent review | Completed on 2026-08-02 under the autonomous-delivery directive; stage is `Locally verified; publication pending` |
| Git staging, commit, and publication | One-time explicit override of this task's earlier no-publication boundary | Not yet granted for this already-open task; after the override, autonomous delivery may continue through a green review-ready pull request and merge remains human-only |
| Hosted validation | Separate staging/Supabase project, synthetic data, provider, privacy, and cost authorization | Not granted |
| Real-data pilot | Universal MFA, recovery codes, factor replacement, supervised recovery, support, monitoring, retention, privacy/PIA, named reviewers, and recovery evidence | Blocked |
| Deployment | Separate target, migration, rollback, secret, monitoring, and release approval | Not granted |
| Production | Human security/privacy/accessibility/operational acceptance and production checklist | Not granted |

Documentation approval does not satisfy any later gate.

## Historical Definition of Ready for local synthetic implementation

- [x] Founder/Product Owner approved all five recorded decisions as written on 2026-07-27.
- [x] The recent-authentication duration is authoritative at 10 minutes.
- [x] The exact local bootstrap-grant lifetime is 30 minutes from server-recorded issuance, non-sliding, and terminal after expiry, revocation, or consumption.
- [x] The CLI-only ephemeral `scripts/test-feat-003-runtime.mjs` fixture is the named local synthetic issuer/test setup and cannot be reached by browser or application roles.
- [x] The documentation-only independent-design-review amendment defines the non-human audit source, strict AMR/internal evidence, PostgreSQL time/locking/idempotency, public privilege revocation, action contracts, conservative factor cleanup, Auth/database boundary, and hardened fixture contract.
- [x] The baseline distinction between declared local Supabase Auth limits and the absence of a FlyEye-controlled `auth-bootstrap` limiter is documented.
- [x] The AI-guided decision brief and Founder/Product Owner approval on 2026-07-28 record the provisional local-only per-action rates/bursts, PostgreSQL token-bucket design, HMAC subject/action key, no local IP trust, privacy/retention behavior, failure behavior, stop-work monitoring/ownership, and no-override rule without treating them as implementation, competent review, hosted, or production values.
- [x] A separate strictly read-only review verified the provisional local limiter and operations documentation recording on 2026-07-28 against tracked fingerprint `27014d8b60c17c129dfd29513fea79abe89f9483`; all fourteen requirements passed, no documentation conflict remained, and no implementation or release gate was satisfied.
- [x] The historical staged-review model recorded immediate stop conditions; its blanket human-before-publication requirement was superseded by the 2026-08-02 autonomous-delivery directive.
- [x] A separate strictly read-only review verified the historical gate amendment on 2026-07-28; it is retained as documentation history and is not a current local publication gate.
- [x] The implementation branch, exact baseline, allowed files, local synthetic boundary, and stop conditions were explicitly authorized in the later Founder/Product Owner implementation prompt.
- [x] Pinned Supabase factor lifecycle, cleanup, AAL/AMR, audit, session, two-client, refresh, removal, and cross-system behavior to be tested is identified.
- [x] The final strictly read-only post-amendment documentation verification completed on 2026-07-28, resolved `DOC-STATUS-01`, confirmed the prior blocking design findings were resolved, and recorded the remaining human/provider gates without creating implementation or release evidence.

## Definition of Done

- [x] The approved bounded outcome is implemented without FEAT-004/005/006 scope.
- [x] Migration, RLS, grants, functions, views, triggers, constraints, indexes, and generated types are inspected.
- [x] Formatting, linting, type checking, unit/component/handler tests, production build, browser secret scan, Playwright, local reset, schema-wide and feature SQL/RLS, real Auth/TOTP/Edge/two-organization integration, database lint, generated-type drift, dependency audit, and repository secret scan pass.
- [x] Negative authorization, cross-tenant, replay, concurrency, rollback, audit-failure, provider-failure, and regression evidence passes.
- [x] Service-role material and TOTP credentials remain absent from browser code, logs, output, history, screenshots, documentation, and AI prompts.
- [ ] Responsive, keyboard, focus, live-region, autofill/password-manager, zoom/reflow, contrast, target-size, QR/manual-secret, and applicable provider accessibility evidence is recorded with limitations.
- [x] Separate-agent review covers database/RLS/privileged-function, security/privacy, accessibility-supporting implementation, and operations concerns; its required finding was corrected and the affected/full evidence was reverified.
- [x] Recovery, replacement, lost-device, support, hosted, real-data, deployment, and production limitations remain explicit.
- [x] A separate final diff and scope review confirms that no invitation, user-management/profile, general role-assignment, operational, training, safety, or aviation authority was introduced.
- [ ] Founder/Product Owner decides whether to merge; hosted, real-data, deployment, and production decisions remain separate when applicable.
