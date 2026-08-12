# Feature Specification: FEAT-003 — Organization Admin and MFA Onboarding

## Status

- State: Merged through PR #7 at `00dcfd2`
- Outcome: Protected first-Organization-Admin bootstrap and TOTP onboarding
- Evidence: [FEAT-003 Traceability](FEAT-003_TRACEABILITY.md)
- Hosted safeguards: [FEAT-003 Hosted Synthetic Hardening](FEAT-003_HOSTED_SYNTHETIC_HARDENING.md), merged through PR #8
- Later gates: Exact hosted target and run, real data, deployment, production, FEAT-005 user management, and FEAT-006 role assignment

This is the stable feature contract. Approval chronology, command logs, and detailed test output belong in Git, pull requests, CI, and traceability.

## User outcome

As the pre-authorized first administrator of a new organization, I can use a recent password-authenticated session, enroll or challenge one TOTP factor, complete one protected bootstrap transaction, and reach only that organization's administration placeholder.

## Scope

Included:

- Server-held, finite local synthetic eligibility grants for the first Organization Admin
- Exact 30-minute server-time grant expiry with no sliding extension
- Recent password authentication at onboarding start and completion
- TOTP enrollment or challenge, strict factor inventory, AAL2 verification, safe cancellation, and stale-session handling
- Atomic membership creation, built-in `admin` role assignment, grant consumption, and audit
- Single-school bootstrap with forged-school denial and no school selector
- Per-action abuse controls, privacy-minimized monitoring evidence, and required UI/accessibility states

Non-goals:

- Member invitations, resend/revoke/accept invitation behavior (`FEAT-004`)
- General user profile, suspension, reactivation, or membership management (`FEAT-005`)
- General role assignment, delegation, or multiple-role management (`FEAT-006`)
- Factor recovery, replacement, lost-device support, recovery codes, or bypass
- Operational, training, safety, quality, dispatch, assessment, Head of Training/CFI, approval, airworthiness, or competency authority
- Production grant issuance, hosted provider activation, real data, deployment, or production approval

## Requirements and authority

Applicable canonical requirements include SRS `IAM-002`, `IAM-003`, `IAM-005` through `IAM-012`, `REC-001` through `REC-003`, and the tenant, identity, audit, secret, abuse-control, and fail-closed controls in the Security Requirements.

No email, client metadata, client role, client organization ID, factor claim, AAL/AMR value, client clock, or UI state is authority. The server derives actor and organization from a verified JWT and locked grant.

### Stable decision identifiers

- `FEAT-003-DEC-01` limits FEAT-003 to the specifically eligible first Organization Admin.
- `FEAT-003-DEC-02` restricts local grant issuance to the named loopback CLI fixture and leaves production issuance unresolved.
- `FEAT-003-DEC-03` requires password AMR no older than 600 seconds at start and completion and current TOTP/AAL2 at completion.
- `FEAT-003-DEC-04` sets exact non-sliding 30-minute local grant expiry from server-recorded issuance.
- `FEAT-003-DEC-05` reuses exactly one verified TOTP and fails closed for duplicate, mixed, or uncertain factor state.
- `FEAT-003-DESIGN-AMD-01` defines strict non-human audit attribution, AMR, locking, idempotency, grants, factor inventory, Auth/database consistency, and fixture controls.
- `FEAT-003-DESIGN-AMD-02` separates provider quotas from FlyEye's atomic per-action abuse controls and monitoring evidence.
- `FEAT-003-DESIGN-AMD-03` records that qualified-human review is risk-triggered under the current delivery policy; unsafe authority still stops work.
- `FEAT-003-DESIGN-AMD-04` defines the local limiter values, secret separation, retention, failure, recovery, and no-bypass behavior.
- `FEAT-003-DESIGN-AMD-05` defines disabled-by-default hosted safeguards and remains merged but inactive pending an exact hosted target decision.

| Action | Required authority |
|---|---|
| Read status | Verified subject, recent password AMR, protected grant lookup; no browser table grant |
| Start onboarding | Eligible grant revalidated by the server; recent password AMR; AAL1 permitted only for initial TOTP enrollment |
| Verify TOTP | Current password-authenticated subject and the exact factor lifecycle allowed below |
| Complete bootstrap | Verified actor/session, locked pending grant, recent password AMR, strict TOTP AMR, AAL2, exact factor state, active organization, and no active admin |
| Enter placeholder | Server-derived active admin membership, `portal.admin.access`, password AMR, and current AAL2/TOTP through `auth-bootstrap` |
| Cancel | Current session, protected audit, in-memory cleanup, and sign-out; no unproven factor deletion |

## Eligibility grant

`organization_admin_bootstrap_grants` contains:

- opaque ID, `organization_id`, eligible Auth subject, status, and version;
- database-issued `issued_at` and exact `expires_at`;
- constrained authorization-source kind/code/instance and nullable human actor;
- issuance correlation;
- completion/revocation timestamps, completed membership, and completion idempotency-key hash.

Rules:

1. Every row is tenant-owned, RLS-enabled, deny-by-default, and inaccessible to `PUBLIC`, `anon`, and `authenticated` table operations.
2. The eligible subject is an Auth UUID. Email and mutable metadata are never authority.
3. PostgreSQL sets `issued_at = transaction_timestamp()` and constrains `expires_at` to exactly 30 minutes later.
4. A grant is usable only while pending and strictly before expiry. Exact equality is expired. Activity cannot extend, revive, or return a terminal grant to pending.
5. Status, start, or completion may atomically materialize time-derived expiry and its audit, but absence of materialization never restores eligibility.
6. A pending grant creates no membership, role, portal permission, or access context.
7. Local issuance uses only `scripts/test-feat-003-runtime.mjs`, restricted to the attested loopback stack and randomized `.test` identities/organizations.
8. The fixture keeps local administrative credentials only in process memory, logs no secrets, inserts the grant and issuance audit atomically through direct local PostgreSQL administration, verifies postconditions, and treats uncertain cleanup as failure.
9. Local issuance uses `actor_kind = 'local_fixture'`, fixed source code `feat-003-local-cli-fixture`, randomized source-instance and correlation IDs, and null human-actor fields. Constraints reject mixed or fabricated attribution.
10. No browser, Data API, or application issuer exists. Production issuance requires a separate authority model and runbook.

## Recent authentication

The Edge Function verifies the JWT with Supabase Auth and parses at most 16 exact AMR objects containing a bounded method and non-negative integer Unix timestamp.

- Missing, string-only, extra malformed, future, unknown, or unbounded AMR fails closed.
- A qualifying password entry is at most 600 seconds old. Age 600 passes; 601 fails. The most recent valid non-future entry is selected deterministically.
- Start checks the window. Completion repeats it immediately before the RPC and passes only server-derived actor, subject, session, password timestamp, AAL, and bounded methods internally.
- PostgreSQL rechecks that the password timestamp is not future and is within 600 seconds of transaction time.
- Completion also requires exact `aal2`, strict `totp` AMR, a session identifier, and a complete current factor inventory.

The administration placeholder requires password AMR and current AAL2/TOTP, but not a continuously renewed 600-second window. Later sensitive commands define their own reauthentication rule.

## TOTP factor contract

Classify the complete bounded `listFactors().all` inventory; convenience arrays are not authoritative.

| Factor state | Behavior |
|---|---|
| No TOTP | Enroll exactly one; keep its ID, QR/URI, and secret only in active memory |
| One current-operation unverified TOTP | Permit QR/manual secret, verification, bounded retry, or cancellation |
| Stale unverified TOTP | Do not guess ownership or delete; use a proven protected cleanup path or fail closed to support |
| Exactly one verified TOTP | Challenge it; do not enroll another |
| Multiple verified, mixed, duplicate, inconsistent, or unknown factors | Conflict; no selection, deletion, replacement, downgrade, or bypass |

Factor IDs must be unique and schemas bounded. TOTP input is exactly six numeric digits, permits paste, uses `inputmode="numeric"` and `autocomplete="one-time-code"`, and prevents duplicate active challenges.

QR data, authenticator URI, and manual secret are credentials. Keep them only in active memory; never place them in tables, URLs, browser storage, caches, logs, analytics, error reports, snapshots, screenshots, documentation, clipboard automation, accessible names, or prompts. Render QR through a validated non-executable path, provide a user-controlled manual alternative, and clear secrets on cancellation, timeout, route change, refresh, sign-out, stale operation, or disposal.

Cancellation clears memory, records a safe outcome, leaves the grant unconsumed, creates no membership, and signs out. It does not unenroll a factor unless a protected server record proves actor, session, grant, operation, factor ID/type/status, and current-operation ownership. It never removes a verified factor.

## Protected completion

`complete_first_organization_admin_bootstrap(...)` is server-only. It must:

1. Treat the opaque grant ID only as a lookup hint.
2. Lock the organization first and grant second, then revalidate their relationship.
3. Match verified actor/subject/session, expected version, and scoped idempotency.
4. Derive the organization from the locked grant.
5. Require an active organization and pending unexpired grant.
6. Recheck the 600-second password boundary, AAL2, TOTP AMR, and complete verified factor state.
7. Recheck that no active Organization Admin or conflicting membership/role exists.
8. Create one active membership and assign only the built-in `admin` role.
9. Consume the grant with membership ID, version change, and completion idempotency hash.
10. Create minimized attributable audit evidence in the same transaction.

Any validation, role, insert, grant, concurrency, constraint, or audit failure rolls back all FlyEye authority. Completion paths use the same lock order, so concurrent same- or different-grant attempts create at most one first admin; losers receive a safe conflict.

Completion idempotency uses a browser-generated opaque value with at least 128 bits of entropy. The Edge Function validates and SHA-256 hashes it; only the hash reaches PostgreSQL. The scope is actor + grant + `complete`. Same-scope retry returns safe revalidation without mutation or another success audit; a different key conflicts; a wrong actor is denied before replay information is disclosed.

FEAT-003 exposes no administrator removal, suspension, demotion, transfer, or general role change.

## Auth/database consistency

Supabase Auth and PostgreSQL cannot share one transaction. Mitigate by:

1. verifying/challenging the allowed TOTP;
2. refreshing and validating the session;
3. refetching the complete factor inventory and requiring exactly one verified TOTP;
4. calling completion without client-controlled authority fields;
5. refetching Auth state and rerunning protected `auth-bootstrap` after database completion; and
6. denying workspace access if the provider is unavailable or final state differs.

A removed factor may leave a completed membership, but final provider/bootstrap revalidation must make it inaccessible. Stale password/session/grant/membership/role/factor/organization/version state clears secrets and selection and requires fresh sign-in.

## UI and accessibility

Required states include loading, no eligibility, unauthorized, recent-auth required, enrollment, manual secret, verification, challenge, rate-limited wait, offline, duplicate/mixed factor conflict, cancellation, cleanup uncertainty, concurrent conflict, provider/database failure, stale operation, success, and final bootstrap denial.

The UI must support keyboard operation, deterministic focus/heading changes, labelled fields, error summaries and live announcements, paste/autofill, responsive mobile/tablet/desktop layout, 200% reflow, contrast and target-size review, QR/manual alternatives, duplicate-submit guards, and explicit wait/retry/recovery guidance. No secret or protected action is queued offline.

## Abuse controls and observability

PostgreSQL-authoritative atomic token buckets use authenticated-subject-plus-action HMAC keys with a dedicated ephemeral local secret. Local code trusts no IP or forwarded header.

| Action | Local limit | Burst | Limiter unavailable |
|---|---:|---:|---|
| `status` | 12 per 60 seconds | 4 | Fail closed |
| `start` | 4 per 60 seconds | 2 | Fail closed |
| `complete` | 3 per 60 seconds | 1 | Fail closed |
| `cancel` | 6 per 60 seconds | 2 | Clear local state, invalidate operation, sign out, and report uncertain server confirmation |

Inactive local limiter state is retained for 15 minutes and removed by the fixture. Client counters, disabled buttons, provider quotas, and platform limits are defense-in-depth only. There is no bypass or emergency override.

Evidence covers allowed, rate-limited, unavailable, recovered, rapid, replayed, distributed-key, concurrent-isolate, and recovery-after-window decisions. Correlation uses bounded actions/outcomes, counts, booleans, status codes, hashes, and safe IDs—never credentials, TOTP values, email, hidden tenants/accounts/grants/factors, configured thresholds, provider internals, unrestricted IPs, or secrets. One fail-open, atomicity, audit, cross-tenant, prohibited-field, or unsafe-recovery result is a hard stop.

## Acceptance criteria

- `FEAT-003-AC-01` Status returns only the actor's safe eligible contexts through protected lookup.
- `FEAT-003-AC-02` Anonymous, OTP-only, stale, wrong-subject, expired, revoked, consumed, and unknown input fails without enumeration or authority.
- `FEAT-003-AC-03` The protected grant derives the sole school and forged school context cannot grant authority.
- `FEAT-003-AC-04` No-factor start creates exactly one in-memory unverified TOTP.
- `FEAT-003-AC-05` Successful verification refreshes to current AAL2 with password and TOTP AMR before completion.
- `FEAT-003-AC-06` Invalid code, rate limit, offline, or provider uncertainty creates no membership and shows accessible guidance.
- `FEAT-003-AC-07` Exactly one verified TOTP is challenged without duplicate enrollment.
- `FEAT-003-AC-08` Duplicate, mixed, stale, or unknown factor state fails closed without automatic mutation.
- `FEAT-003-AC-09` Safe cancellation clears secrets, signs out, leaves the grant pending, and creates no membership.
- `FEAT-003-AC-10` Cleanup uncertainty cannot open a workspace.
- `FEAT-003-AC-11` Valid completion atomically creates membership/admin role, consumes the grant, updates version, and audits.
- `FEAT-003-AC-12` Concurrent completion creates at most one first admin.
- `FEAT-003-AC-13` Any authority or audit failure rolls back the transaction.
- `FEAT-003-AC-14` Final access reruns protected bootstrap and requires server-derived admin permission, password AMR, and AAL2.
- `FEAT-003-AC-15` Admin access implies no operational or aviation authority.
- `FEAT-003-AC-16` Existing active admin causes conflict without modifying that admin.
- `FEAT-003-AC-17` Required responsive and accessibility behavior is evidenced with human-only limitations explicit.
- `FEAT-003-AC-18` Offline, refresh, sign-out, session/factor change, or stale operation cannot restore authority or queue secrets.
- `FEAT-003-AC-19` Source, build, logs, evidence, and history contain no secrets, real identities, tokens, or restricted provider data.
- `FEAT-003-AC-20` FEAT-001 and FEAT-002 security, Auth, tenant, recovery, and browser regressions remain green.
- `FEAT-003-AC-21` Local technical publication evidence is complete; merge and later lifecycle gates remain separate.
- `FEAT-003-AC-22` Deferred factor recovery/replacement offers no bypass and blocks real-data/production readiness.
- `FEAT-003-AC-23` Grant expiry is exact, server-recorded, non-sliding, rechecked, and terminal.
- `FEAT-003-AC-24` The named fixture rejects non-loopback targets, uses randomized synthetic data and atomic issuance/audit, protects credentials, and fails on cleanup uncertainty.
- `FEAT-003-AC-25` Fixture audit uses constrained non-human attribution without fabricated human authority.
- `FEAT-003-AC-26` Strict timestamped AMR applies exact 600-second boundary behavior in Edge and PostgreSQL.
- `FEAT-003-AC-27` Lock order, version, rechecks, and idempotency allow at most one first admin across races and replay.
- `FEAT-003-AC-28` `PUBLIC`, `anon`, and `authenticated` receive no grant-table or protected-RPC authority.
- `FEAT-003-AC-29` Without proven factor ownership, cancellation unenrolls nothing.
- `FEAT-003-AC-30` Final provider/bootstrap validation denies access across Auth/database consistency failures.
- `FEAT-003-AC-31` Per-action limits and monitoring are atomic, non-enumerating, privacy-minimized, accessible, and fail closed as specified.

## Verification and remaining gates

Stable test families and exact results are maintained in [FEAT-003 Traceability](FEAT-003_TRACEABILITY.md). Current committed runtime fixtures use one synthetic school; rollback-only SQL tests retain adversarial cross-school coverage under ADR-0006.

Local values and fixtures are not hosted or production evidence. Before a hosted run, real-data pilot, or production claim, resolve the exact provider/project, region/plan/cost, origin, credentials, trusted network source, thresholds/capacity, monitoring/alerts/retention/ownership, issuance authority, cleanup/recovery, notifications/support, factor recovery/replacement, incident process, accessibility evidence, and any risk-triggered qualified review.
