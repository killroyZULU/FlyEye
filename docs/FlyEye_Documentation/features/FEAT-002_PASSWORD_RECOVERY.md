# Feature Specification: FEAT-002 — Password Recovery

## Status

- State: Merged through PR #5 at `4f993f0`
- Outcome: Verified local synthetic password recovery for invited email/password users
- Evidence: [FEAT-002 Traceability](FEAT-002_TRACEABILITY.md)
- Later gates: Hosted provider validation, remaining accessibility evidence, real data, deployment, and production

This document is the stable feature contract. Implementation chronology and detailed results belong in traceability, Git, PR #5, PR #6, and CI.

## User outcome

As an invited FlyEye user who forgot their password, I can recover access through my verified email address, choose a new password, revoke prior sessions, and return to fresh sign-in without exposing account or organization information.

## Scope

Included:

- Public “Forgot password?” entry from sign-in
- Generic recovery-request acknowledgement for every syntactically valid email
- Single-use 3,600-second local recovery credential and explicit prefetch-resistant verification
- Password update with a 15-character minimum, support for at least 64 characters, spaces, paste, autofill, and password managers, with Supabase authoritative
- Global refresh-session revocation and fresh password sign-in
- Password-changed notification, audit evidence, abuse controls, and required UI states
- Synthetic unit, component, Auth, runtime, browser, replay, abuse, session, and tenant-isolation coverage

Non-goals:

- Registration, invitations, activation, email-address changes, or authenticated settings changes
- MFA recovery, recovery codes, factor replacement, or administrator-assisted recovery
- Passwordless, magic-link, passkey, SSO, social, or SMS sign-in
- Organization, membership, role, permission, profile, or operational-authority changes
- Lost-mailbox recovery or production provider/deployment decisions

This feature changes no aviation rule or operational authority.

## Canonical requirements and sources

- SRS: `IAM-007`, `IAM-009`, and applicable security/privacy NFRs
- Security Requirements: identity, abuse control, tenant isolation, secrets, and audit sections
- Product and Governance Decisions: invitation-only accounts, password-recovery boundary, synthetic data
- Pinned implementation baseline: Supabase CLI `2.109.1`, GoTrue `v2.192.0`, and `@supabase/supabase-js` `2.110.7`

Vendor behavior must be reverified when pinned Auth versions change.

## Roles and authority

| Action | Authority and record boundary |
|---|---|
| Request recovery | Public, rate-limited Auth action; accepts no organization, membership, role, or redirect authority |
| Verify credential | Possession of the current credential; Auth identity only; no FlyEye organization context |
| Set password | Updates only the authenticated user's Supabase Auth password |
| Revoke sessions | Same recovered identity; changes no application or organization record |
| Review provider evidence | Restricted support/security access under a separately approved procedure |

Organization Admin cannot view, choose, assign, or reset a user's password.

## Business and security rules

1. Public sign-up remains disabled. Unknown-email recovery creates no user or application record.
2. Malformed email receives accessible local guidance. Every syntactically valid request produces the same visible acknowledgement regardless of eligibility, account state, throttling, CAPTCHA, or provider failure.
3. Approved local callbacks are exactly `http://127.0.0.1:5173/auth/recovery` and `http://127.0.0.1:4173/auth/recovery`. Wildcard or supplied continuation redirects are prohibited.
4. The credential expires after 3,600 seconds, is single-use, and is absent from application tables, durable browser storage, logs, analytics, screenshots, DOM output, referrer-bearing requests, and prompts.
5. Opening the landing page does not consume the credential. Verification requires an explicit user action, after which credential material is removed from browser history.
6. The client always requests `type: "recovery"`, but that value is not an authorization boundary. On the pinned runtime, recovery tokens may be accepted through `recovery`, `email`, or `magiclink`, and all issue OTP-only sessions.
7. FEAT-001 `auth-bootstrap` derives AMR only from the verified JWT and denies/audits any session whose AMR lacks `password` before membership resolution. OTP-only sessions cannot enter a FlyEye workspace.
8. Password and confirmation must match. Supabase enforces at least 15 characters; the UI supports at least 64 characters, spaces, paste, autofill, and password managers without composition rules. Password data is never logged, audited, stored in application tables, or sent to prompts.
9. Invalid, expired, used, malformed, replayed, or superseded credentials fail safely. `weak_password` and `same_password` receive non-sensitive corrective guidance.
10. After password update, global sign-out revokes refresh-token-backed sessions, local recovery/session state is cleared, and the user returns to fresh sign-in. The flow never opens a workspace directly.
11. Verification covers two clients, old refresh tokens, old access JWTs, Auth bootstrap, and every browser-accessible Data API/RPC path. Surviving old access is a hard stop for specification review.
12. If the password changed but revocation or completion confirmation fails, clear local state, open no workspace, give safe sign-in/support guidance, and do not attempt password rollback.
13. Local Mailpit messages are tenant-neutral and contain no password, credential, organization, membership, role, or restricted data.
14. Local recovery uses a 60-second per-user cooldown and a provider-neutral CAPTCHA boundary. Rate-limited and provider-failure outcomes retain the generic response.
15. Authentication requires connectivity; no recovery operation or secret is queued offline.

## UI states and accessibility

The state machine covers request, generic acknowledgement, explicit confirmation, verification, password entry, invalid/expired/used credential, validation, offline, provider failure, terminal revocation failure, and success-to-sign-in.

Each transition manages heading/focus, labelled controls, field and summary errors, live announcements, keyboard operation, duplicate-submit prevention, stale-response rejection, responsive reflow, password-manager compatibility, and secret clearing. Browser Back or refresh must not restore a usable credential or completed recovery state.

## Audit and privacy

The pinned Auth evidence includes `user_recovery_requested`, `login`, `user_updated_password`, `user_modified`, and `logout`. Do not claim an unobserved `token_revoked` event; pair `logout` with old-token and old-path denial.

Raw provider audit rows are restricted because they include full email and IP fields. Durable evidence records only action/field names, booleans, bounded identifiers, and HTTP/result classes. Protected OTP-only bootstrap denial uses the existing application audit path and fails closed if audit cannot be written.

## Acceptance criteria

- `FEAT-002-AC-01` Generic public response prevents account enumeration across eligible, unknown, restricted, rate-limited, CAPTCHA, and provider-failure cases.
- `FEAT-002-AC-02` Unknown-email recovery creates no Auth or application record.
- `FEAT-002-AC-03` Eligible local recovery sends a tenant-neutral Mailpit message with an exact approved callback.
- `FEAT-002-AC-04` Link prefetch does not consume the credential.
- `FEAT-002-AC-05` A verified OTP-only recovery session can reach only password update and is denied/audited by FlyEye bootstrap.
- `FEAT-002-AC-06` Invalid, expired, used, malformed, superseded, replayed, and cross-type cases fail safely.
- `FEAT-002-AC-07` Password validation and Supabase errors are accessible and non-sensitive while supporting the approved password policy.
- `FEAT-002-AC-08` Successful recovery changes the password once, prevents credential replay, revokes refresh sessions, clears local state, and requires fresh sign-in.
- `FEAT-002-AC-09` Old tokens and browser-accessible paths on two clients are denied; fresh password sign-in follows normal role/AAL/MFA checks.
- `FEAT-002-AC-10` Post-update revocation uncertainty is terminal and fail-closed.
- `FEAT-002-AC-11` Audit and password-changed notification evidence is attributable and privacy-minimized.
- `FEAT-002-AC-12` Cooldown, CAPTCHA, concurrency, and duplicate-submit behavior limit abuse without enumeration.
- `FEAT-002-AC-13` Multi-organization recovery reveals and changes no membership data.
- `FEAT-002-AC-14` Source/build evidence contains no service-role key, credential, password, arbitrary redirect, or real-person fixture.
- `FEAT-002-AC-15` Required desktop/mobile, keyboard, focus, announcement, failure, and offline behavior is covered at the applicable evidence level.

## Verification contract

Stable test families are `FEAT-002-UNIT-*`, `COMP-*`, `AUTH-*`, `ABUSE-*`, `SEC-*`, `TENANT-*`, `E2E-*`, `CONFIG-*`, `SCAN-*`, and `REG-*`. The traceability record maps acceptance criteria to exact evidence and limitations.

No new application dependency or schema migration was required. Any future migration or provider dependency requires a specification amendment and the normal dependency/architecture review.

## Remaining lifecycle gates

Before real-data or production use, select and review the exact hosted callbacks, domain, Supabase plan/region/residency, email provider and sender, support address, CAPTCHA, breached-password protection, project/IP/WAF controls, timing tolerances, monitoring and alert ownership, Auth-log retention/access/export, lost-mailbox and MFA recovery, factor replacement, supervised support, account-compromise response, accessibility evidence, backup/recovery, and costs.
