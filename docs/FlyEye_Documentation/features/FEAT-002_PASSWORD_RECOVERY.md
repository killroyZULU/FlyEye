# Feature Specification: FEAT-002 — Password Recovery

## Status and ownership

- Status: Founder/Product Owner decisions recorded for documentation preparation; implementation not started or authorized
- Founder/Product Owner: Approved the decisions recorded in this specification for synthetic local implementation planning and documentation preparation on 2026-07-26
- Technical reviewer: Not assigned; approval pending
- Independent security/privacy reviewer: Not assigned; approval pending
- Accessibility reviewer: Not assigned; approval pending
- Aviation SME: Not required for the password-recovery behavior; no aviation authority or workflow is changed
- Technical owner: FlyEye project
- Target release: Identity-foundation sequence after FEAT-001

Founder/Product Owner approval is product-direction approval only. It is not technical, security, privacy, accessibility, implementation, deployment, or production approval. AI review and green CI are not human approval. FEAT-002 implementation remains unauthorized until the required technical, independent security/privacy, and accessibility reviews are assigned and their approvals are recorded.

## User outcome and problem

As an invited FlyEye user who has forgotten their password, I want to recover access through my verified email address without help from an administrator, so that I can choose a new password while protecting my account, school memberships, and active sessions.

## Scope

### Included

- A public “Forgot password?” entry point from the FEAT-001 sign-in screen
- Recovery requests only for existing verified email/password users through Supabase Auth
- The same generic request acknowledgement for every syntactically valid request, including eligible, unknown, suspended, banned, deleted, invited-but-unconfirmed, provider-only, rate-limited, CAPTCHA-rejected, and provider-failure cases
- A single-use recovery credential with a 3,600-second synthetic baseline expiry, delivered to the account’s verified email address
- A prefetch-resistant explicit user-confirmation step before the recovery credential is verified
- A recovery-only page for setting and confirming a new password
- A synthetic password baseline of at least 15 characters, with at least 64 characters, spaces, paste, autofill, and password-manager input supported; Supabase remains authoritative
- Revocation of every refresh-token-backed session after a successful password change, followed by a fresh sign-in
- Password-changed security notification and provider authentication evidence
- Loading, generic acknowledgement, invalid/expired/used link, validation, provider error, revocation failure, offline, and success states
- Unit, component, Auth integration, browser, abuse, replay, and prior-session tests using synthetic accounts
- A provider-neutral CAPTCHA boundary and a 60-second synthetic per-user recovery-request cooldown

### Non-goals

- Public registration, account invitation, email-address change, or account activation
- Authenticated “change password” settings
- MFA enrollment, recovery codes, lost-factor recovery, factor replacement, or support recovery
- Administrator viewing, assigning, emailing, or resetting a user’s password
- Passwordless sign-in, magic-link sign-in, passkeys, SSO, social login, or SMS recovery
- Organization membership, role, permission, profile, or operational-authority changes
- Recovery of an account whose verified mailbox is unavailable
- Production domain, SMTP vendor, Supabase plan/region, deployment, or production approval

## Source and assumptions

| Item | Verified source/owner/version | Status |
|---|---|---|
| Recovery outcome and administrator boundary | [Product and Governance Decisions](../17_PRODUCT_AND_GOVERNANCE_DECISIONS.md), section 5, July 2026 | Product-owner approved |
| Non-enumerating reset, throttling, session controls, and security logging | [Security Requirements](../08_SECURITY_REQUIREMENTS.md), sections 3, 6, and 9 | Baseline requirement |
| Security-sensitive account events are logged and alertable | [SRS](../03_PRODUCT_REQUIREMENTS_SRS.md), IAM-007 | Baseline requirement |
| Service-role credentials remain outside the browser | [SRS](../03_PRODUCT_REQUIREMENTS_SRS.md), IAM-009; [ADR-0005](../adr/ADR-0005-LEAN-SUPABASE-STACK.md) | Accepted architecture |
| Current Supabase password-recovery flow | [Supabase password-based Auth](https://supabase.com/docs/guides/auth/passwords), reviewed 2026-07-26 | Vendor behavior to reverify at implementation |
| Token-hash verification and email-prefetch risk | [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates), reviewed 2026-07-26 | Vendor behavior to reverify at implementation |
| Auth rate limits and CAPTCHA | [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits) and [CAPTCHA protection](https://supabase.com/docs/guides/auth/auth-captcha), reviewed 2026-07-26 | Exact environment settings pending |
| Session revocation and residual access-token lifetime | [Supabase user sessions](https://supabase.com/docs/guides/auth/sessions) and [sign out](https://supabase.com/docs/guides/auth/signout), reviewed 2026-07-26 | Refresh-token revocation supported; residual JWT control requires implementation proof |

This feature has no aviation rule, dispatch decision, airworthiness action, training assessment, or competency decision.

## Founder/Product Owner decisions

The following decisions are approved for documentation preparation and later synthetic local implementation planning. They do not authorize implementation.

| Decision area | Approved synthetic/local position |
|---|---|
| Recovery eligibility | Only existing, verified email/password identities are eligible. Unknown, suspended, banned, deleted, invited-but-unconfirmed, and provider-only accounts receive the same generic public response. A recovery request creates no user, organization, membership, role, or application record. |
| Password policy | Minimum 15 characters; support at least 64 characters, spaces, paste, autofill, and password managers. Do not require uppercase, lowercase, digit, or symbol composition rules. Supabase is authoritative. Handle `weak_password` and `same_password` safely. Breached-password protection is required before real-data use but deferred until an appropriate Supabase plan is selected. |
| Recovery credential | Expiry is 3,600 seconds. Credentials are single-use and fail closed when invalid, expired, used, malformed, or wrong-purpose. A bounded evidence spike during implementation may determine resend and supersession behavior on pinned Supabase versions. If a newer request does not invalidate older credentials, stop for specification review. |
| Verification flow | Use a version-controlled custom recovery template based on `TokenHash` and `verifyOtp` with type `recovery`. Opening the landing page does not consume the credential; verification follows explicit user action. Credential material is scrubbed from the URL and excluded from durable storage, logs, analytics, screenshots, DOM output, and AI prompts. |
| Session revocation | Begin with no schema migration. After password change, globally revoke refresh-token-backed sessions, clear local state, and require fresh sign-in. Test two clients, old refresh tokens, old access JWTs, auth bootstrap, and every currently browser-accessible Data API or RPC path. If any old-session access survives, stop and amend the specification before proposing `session_id` validation, a migration, or another protected control. |
| Redirects | Exact synthetic callbacks are `http://127.0.0.1:5173/auth/recovery` and `http://127.0.0.1:4173/auth/recovery`. Wildcard, user-supplied, tenant-supplied, role-supplied, and arbitrary continuation redirects are prohibited. Production domain and redirects are deferred. |
| Email and notifications | Use local Mailpit and synthetic sender information. Version-control the recovery and password-changed notification templates during implementation. Messages are tenant-neutral and contain no password, token, organization, membership, role, or restricted information. Production SMTP, sender identity/domain, delivery monitoring, and final support address are deferred. |
| CAPTCHA | Use a provider-neutral application boundary. Cloudflare Turnstile is the current production candidate, not an approved production provider. Live keys, contractual/privacy review, and production activation are deferred. Synthetic tests cover challenge success, failure, expiry, retry, generic responses, and accessible fallback behavior. |
| Rate limiting | Apply a 60-second synthetic per-user recovery-request cooldown. Rate-limited and provider-failure outcomes preserve the generic public acknowledgement. Production project-wide limits, IP/WAF controls, timing tolerances, monitoring thresholds, and alerts await staging evidence. |
| Audit evidence | Supabase Auth audit logs are initially authoritative for recovery requests, password changes, and token/session revocation. Do not assume an application audit table or migration. Verify exact available event names and fields during implementation; if required evidence is missing, stop for specification review. Production retention, export, log drains, access controls, alert routing, and ownership are deferred. |
| Environment boundary | Planning and any later implementation are limited to local synthetic development. No real customer, student, school, or production data is authorized. Hosting, domain, Supabase plan/region/residency, SMTP, CAPTCHA credentials, costs, and deployment remain unresolved. |
| Deferred scope | Lost-mailbox recovery, MFA recovery codes, factor replacement, supervised identity proofing, administrator-assisted recovery, and formal account-compromise procedures remain outside FEAT-002 and are blockers before real-data pilot or production use. |

## Unresolved gates

### Decisions required before implementation starts

- Assign technical, independent security/privacy, and accessibility reviewers.
- Record their approval of this specification and the bounded synthetic-local implementation plan.
- Confirm the pinned Supabase CLI, Auth server, and JavaScript client versions used for the evidence spike.
- Confirm that implementation remains local synthetic development only, with no hosted environment or real data.

### Runtime evidence required before implementation acceptance

- Prove exact 3,600-second expiry, single use, replay denial, wrong-purpose denial, prefetch resistance, and resend/supersession behavior on the pinned versions.
- Prove the 15-character minimum, at-least-64-character support, spaces, paste, autofill, password-manager compatibility, and safe `weak_password` and `same_password` handling.
- Prove the custom `TokenHash`/`verifyOtp` recovery template and exact loopback redirects without credential leakage.
- Prove two-client global refresh-token revocation and test old refresh tokens, old access JWTs, FEAT-001 auth bootstrap, and every currently browser-accessible Data API or RPC path.
- Verify exact Supabase Auth audit event names and fields for recovery requests, password changes, and token/session revocation.
- Verify Mailpit recovery and password-changed notifications, tenant neutrality, the 60-second cooldown, provider-neutral CAPTCHA outcomes, generic responses, timing behavior, and accessible fallback.
- Stop for specification review if newer requests leave older credentials usable, any old-session access survives, or required audit evidence is unavailable.

### Real-data pilot and production gates

- Select and independently review the production domain and redirects, Supabase plan/region/residency, hosting, SMTP provider, sender identity/domain, support address, delivery monitoring, CAPTCHA provider and keys, contractual/privacy terms, and costs.
- Enable and verify breached-password protection before any real-data use.
- Establish project-wide and IP rate limits, WAF controls, response-timing tolerances, monitoring thresholds, alerts, Auth-log retention/export/drains/access, operational ownership, and incident/account-compromise procedures.
- Approve lost-mailbox recovery, MFA recovery codes, factor replacement, supervised identity proofing, administrator-assisted recovery, and formal account-compromise procedures.
- Complete required technical, security, privacy, accessibility, deployment, and production reviews; green CI or AI review cannot satisfy these gates.

## Configuration decision matrix

| Configuration | Local synthetic development | Preview/staging | Production |
|---|---|---|---|
| Authorization | Documentation decisions approved; implementation requires assigned reviewer approvals | Not authorized or configured | Not authorized or configured |
| Data | Synthetic accounts only; at least two organizations and one multi-membership identity | Synthetic data only if a future preview is approved | Real data prohibited until all pilot/production gates pass |
| Recovery callbacks | `http://127.0.0.1:5173/auth/recovery` and `http://127.0.0.1:4173/auth/recovery` only | Exact origin unresolved; no wildcard or supplied continuation | Domain and exact callbacks unresolved; no wildcard or supplied continuation |
| Email | Local Mailpit, synthetic sender, version-controlled recovery and password-changed templates | Provider, sender, support address, and monitoring unresolved | SMTP, sender identity/domain, support address, monitoring, and terms unresolved |
| Password controls | Minimum 15; at least 64 supported; spaces/paste/autofill/password managers; no composition rule; Supabase authoritative | Must preserve approved baseline; breached-password plan unresolved | Breached-password protection required; plan and settings unresolved |
| Recovery credential | 3,600-second expiry, single use, explicit verification, bounded resend/supersession spike | Must be reverified on selected hosted versions | Must be reverified and independently approved |
| Session control | No-schema starting design; global refresh revocation and complete old-session evidence required | Separate project and repeatable evidence required before use | Plan/session settings and independent evidence required |
| CAPTCHA | Provider-neutral boundary with synthetic success, failure, expiry, retry, generic-response, and accessible-fallback tests | Candidate/provider and non-live test configuration unresolved | Turnstile is a candidate only; provider, keys, privacy, contract, and activation unresolved |
| Rate limits | 60-second synthetic per-user cooldown; generic acknowledgement retained | Project/IP/timing/monitoring settings require staging evidence | Project/IP/WAF limits, timing, monitoring, and alerts unresolved |
| Audit | Supabase Auth logs initially authoritative; exact local event names/fields must be evidenced | Retention, export, access, correlation, and alerts unresolved | Log drains, retention, access, alert routing, and ownership unresolved |

## Roles, permissions, and record scope

| Action | Permission | RLS / protected-function organization and assignment rule | Reauthentication |
|---|---|---|---|
| Request recovery | Public, rate-limited Supabase Auth recovery endpoint | No organization is accepted, selected, returned, or inferred; the response never confirms account existence | CAPTCHA or equivalent abuse challenge when configured; no existing session required |
| Verify recovery credential | Possession of a valid current recovery credential delivered to the verified mailbox | Auth identity only; no membership, role, permission, organization, or operational record is loaded | Valid single-use recovery credential within the 3,600-second synthetic expiry |
| Set new password | Temporary recovery session created from the verified credential | May update only the authenticated user’s Supabase Auth password; no public tenant table write | Valid recovery context; normal signed-in sessions must not be accepted as a substitute |
| Revoke sessions and return to sign-in | Same recovered Auth identity | Global Auth session revocation; no organization state change | Successful password update |
| Review provider recovery evidence | Restricted security/support role outside ordinary application access | Provider console/log access is least-privileged, time-limited where possible, and never grants school operational authority | MFA and recent authentication under the approved support procedure |

Organization Admin has no password-reset capability. Recovery is identity-scoped because one Auth user may have memberships in multiple organizations; it must neither select a school nor disclose membership information.

## Preconditions and business rules

1. Public sign-up remains disabled.
2. Recovery accepts an email address only as a delivery hint. It never accepts user ID, organization ID, membership, role, redirect URL, or password-policy settings from the requester.
3. A malformed email receives local accessible field guidance and is not submitted. Every syntactically valid request shows the same acknowledgement text and navigation regardless of whether the identity is eligible, unknown, suspended, banned, deleted, invited-but-unconfirmed, provider-only, throttled, CAPTCHA-rejected, or affected by provider failure. Server/provider failures may be logged safely but must not create an enumeration oracle through text, status-dependent UI, timing, focus, or retry behavior.
4. Only `http://127.0.0.1:5173/auth/recovery` and `http://127.0.0.1:4173/auth/recovery` are approved for synthetic local use. Wildcard, user-supplied, tenant-supplied, role-supplied, and arbitrary continuation redirects are prohibited. Production redirects remain unresolved.
5. The recovery credential uses a 3,600-second synthetic expiry and is single-use. It is not stored in application tables, logs, analytics, error monitoring, screenshots, referrer-bearing requests, DOM output, AI prompts, or durable browser storage.
6. Opening the application landing page does not consume the credential. A deliberate user action initiates verification so automated email-link prefetching does not invalidate the link.
7. The browser scrubs recovery credential material from the address bar/history as soon as it has been read for verification and must not render it into the DOM.
8. A verified recovery credential creates only a temporary recovery context. The application must not call FEAT-001 access bootstrap, select an organization, or enter a role workspace before the password is changed and a fresh normal sign-in occurs.
9. The new password and confirmation must match and satisfy the server-configured Supabase Auth policy: at least 15 characters, at least 64 characters supported, spaces permitted, and paste, autofill, and password managers supported, with no uppercase/lowercase/digit/symbol composition rule. Supabase remains authoritative; `weak_password` and `same_password` errors receive safe corrective guidance. The password is sent only to Supabase Auth over TLS and is never logged, audited, cached, analyzed, or sent to application tables/functions.
10. A successfully consumed, expired, malformed, wrong-purpose, or superseded credential cannot be replayed. A bounded implementation evidence spike must determine resend and supersession behavior on the pinned versions. If a newer request leaves an older credential usable, implementation stops for specification review.
11. After the password update succeeds, the no-schema starting design globally revokes every refresh-token-backed session, clears local recovery/session state, and routes the user to sign-in. The exact SDK sequence must be proven against the pinned version; the application never continues directly into a workspace.
12. Evidence must test two clients, old refresh tokens, old access JWTs, FEAT-001 auth bootstrap, and every currently browser-accessible Data API or RPC path. If any old-session access survives, implementation stops for specification review before `session_id` validation, a migration, or another protected control is proposed.
13. If the password changed but global revocation or completion confirmation fails, the client fails closed: it clears local recovery state, does not open the application, shows safe sign-in/support guidance, and records non-sensitive failure telemetry. It never attempts to roll the password back.
14. Local Mailpit uses synthetic sender information and version-controlled recovery and password-changed templates. Messages are tenant-neutral and contain no password, token, organization, membership, role, or restricted information. Production delivery and the final support address remain deferred.
15. Administrators and support personnel never view, receive, select, or manually assign a user password.
16. Authentication requires connectivity. No recovery request, credential, or new password is queued for offline replay.
17. A provider-neutral CAPTCHA boundary covers challenge success, failure, expiry, retry, generic-response, and accessible-fallback behavior. Cloudflare Turnstile is a production candidate only.
18. Synthetic recovery requests use a 60-second per-user cooldown. Rate-limited and provider-failure outcomes retain the generic public acknowledgement.

## Workflow and state transitions

```text
SignIn
  -- open recovery -->
RecoveryRequest
  -- submit any syntactically valid request -->
GenericAcknowledgement

RecoveryLanding
  -- explicit continue with valid credential -->
RecoveryReady
  -- submit valid matching password -->
UpdatingPassword
  -- password changed -->
RevokingSessions
  -- global revocation and local cleanup -->
RecoveryComplete
  -- continue -->
SignIn

RecoveryLanding
  -- missing / invalid / expired / used credential -->
InvalidRecovery

RecoveryReady
  -- validation failure -->
RecoveryReady

UpdatingPassword
  -- provider rejection / network failure before confirmed change -->
RecoveryReady | SafeRetry

RevokingSessions
  -- revocation or confirmation failure -->
FailClosed
  -- clear local state -->
SignInOrSupport
```

Duplicate request submissions remain generic and are subject to provider/application throttling. Duplicate password submissions are disabled while one operation is pending and use an operation-generation guard so stale responses cannot restore a completed or abandoned recovery state. Browser refresh, Back, multiple tabs, an already consumed credential, and concurrent password submissions fail closed without reopening access.

## Data and migration

- Supabase Auth remains the password, recovery credential, and session authority.
- Passwords, recovery credentials, CAPTCHA tokens, access tokens, refresh tokens, email contents, and full email addresses are not added to the public application schema.
- No tenant-owned application table is required for the baseline recovery request or password update.
- Existing organization, membership, role, permission, and audit rows remain unchanged.
- Begin with no schema migration. If any old-session access survives the required evidence, stop and amend the specification before proposing `session_id` validation, an additive migration, or another protected control. Never rewrite FEAT-001 migrations.
- Any new application audit row must use a pseudonymous Auth subject identifier after identity verification, minimize metadata, define retention, deny browser writes/reads, and avoid copying email or token material.
- Auth settings, exact redirect allowlists, recovery and password-changed templates, password policy, session limits, CAPTCHA, and rate limits must be reproducible through version-controlled local configuration or a reviewed environment runbook with drift detection.
- There is no production backfill. Rollback disables the recovery entry point and restores the previously reviewed Auth configuration without deleting provider evidence.

## Data and protected-function contract

### Request recovery

- Preferred baseline: existing Supabase JavaScript client calls `resetPasswordForEmail` with the normalized email, an exact application-owned redirect, and CAPTCHA token when enabled.
- The public browser uses only the environment’s publishable key. No service-role or secret key is required.
- The UI maps every outcome to the same acknowledgement and does not expose raw provider codes.
- The synthetic local flow enforces the 60-second per-user cooldown without changing the public acknowledgement.
- A custom Edge Function must not be added merely to hide user existence. If later justified for additional rate control or observability, it must return the same public contract, keep provider secrets server-only, avoid storing email/token data, and undergo a specification amendment.

### Verify recovery credential

- Use a version-controlled custom recovery template based on `TokenHash` and `verifyOtp` with `type: "recovery"`.
- Verification occurs only after explicit user confirmation, not automatically on initial navigation.
- Accept only the fixed recovery type and application-controlled continuation route. Ignore or reject arbitrary `type`, `next`, `redirectTo`, organization, and role values.

### Set password and revoke sessions

- Use the authenticated recovery session to call Supabase Auth `updateUser({ password })`.
- On confirmed success, invoke or verify the approved global sign-out/session-revocation behavior and clear client state. Do not assume one SDK call order until integration tests prove it on the pinned Supabase versions.
- Safe client-facing outcomes: invalid/expired/used link, password-policy validation, generic temporary failure, fail-closed revocation state, and success requiring a fresh sign-in.
- Raw Auth errors, stack traces, email existence, token values, tenant information, and password-policy internals not needed for correction are not returned or logged.

### RLS, grants, Storage, and generated types

- No new browser table grants, RLS policies, Storage objects, or organization-scoped Data API operations are expected.
- Any implementation diff touching grants, RLS, views, triggers, privileged functions, or generated database types requires explicit justification and the full FEAT-001 SQL/RLS regression suite.

## UI/UX

- The sign-in page provides a keyboard-accessible “Forgot password?” link.
- The request page contains an email field, submit action, return-to-sign-in link, and privacy-safe generic guidance.
- The acknowledgement is always equivalent to: “If an eligible account matches that email, recovery instructions will be sent.”
- The landing page requires an explicit “Continue securely” action before credential verification.
- The new-password page provides new-password and confirmation fields, show/hide controls, visible server-aligned password guidance, and no organization or role selector.
- Loading states prevent duplicate submission. Focus moves to the page heading or error summary after navigation/result changes.
- Field validation is associated with inputs; generic/provider errors use an accessible live region; contrast, focus, labels, target size, and keyboard order target WCAG 2.2 AA review.
- Invalid, expired, used, or missing credentials share safe recovery guidance and allow a new request without explaining which condition occurred.
- Offline behavior is explicit and retryable. The browser never queues the email, credential, CAPTCHA token, or password.
- On success, the page states that the password changed, sessions were ended, and a fresh sign-in is required. It does not auto-fill or preserve the new password.

## Validation and safety

- Client validation improves usability; Supabase Auth remains authoritative for credential validity and password policy.
- Redirect destinations, recovery type, and workflow state are application-controlled constants.
- Recovery never grants a role, membership, MFA bypass, operational permission, or aviation authority.
- The user cannot use a recovery session as a normal FEAT-001 application session.
- Provider uncertainty, malformed responses, audit/notification gaps, or revocation uncertainty fail closed and do not open a workspace.
- There is no AI or authoritative aviation calculation in this feature.

## Audit, notifications, and observability

- Supabase Auth audit logs are the initial authority for recovery requests, password changes, and token/session revocation. No new application audit table or migration is assumed.
- Use version-controlled recovery and password-changed templates with local Mailpit and synthetic sender information during implementation.
- During implementation, verify exact available event names and fields, including actor/subject attribution, timestamps, result, and source context. If required evidence is missing, stop for specification review; browser-authored “success” is not authoritative audit evidence.
- Production retention, export, log drains, access controls, alert routing, operational ownership, delivery monitoring, and the final support address remain deferred.
- If an application event is approved, it is emitted only after identity verification, uses the Auth subject UUID and a correlation ID, contains a bounded outcome/reason code, and excludes email, password, credential, token, organization membership, IP address unless separately justified, and provider internals.
- Metrics may include request count, delivery/provider failure count, invalid/expired verification count, password-policy rejection count, revocation failure count, and completion count. Use coarse aggregation and access controls so metrics cannot become an enumeration channel.
- Alert thresholds for request spikes, verification failures, provider delivery failures, password-change anomalies, and revocation failures require security-owner approval before production.

## Security, privacy, and abuse cases

- Account enumeration through response text, status, timing, focus, CAPTCHA behavior, resend behavior, email delivery, or support messages
- Recovery-email flooding, automated bots, distributed IP abuse, and provider quota exhaustion
- Open redirect, broad allowlist, malicious `next`/`type` values, link rewriting, and email tracking
- Link prefetch consuming the credential before deliberate user confirmation
- Token theft from URL logs, browser history, referrers, analytics, monitoring, screenshots, extensions, or copied links
- Replay of used, expired, malformed, superseded, or wrong-purpose credentials
- Normal authenticated session presented as a recovery session
- Multiple tabs, double submit, stale async response, browser Back/refresh, and password-update race
- Old refresh token or access JWT used after password reset
- Service-role or secret key included in the browser, source, bundle, logs, email, or documentation
- Cross-tenant inference through organization-branded responses, membership lookups, role routing, or support behavior
- Password, email, Auth error, or recovery credential captured in logs, audit metadata, application tables, analytics, clipboard helpers, or AI prompts
- Compromised mailbox and social-engineering risks; these require the later approved supervised-recovery procedure and cannot be solved by this slice

## Acceptance criteria

- [ ] **FEAT-002-AC-01:** Given any syntactically valid email input, when recovery is requested for an eligible, unknown, suspended, banned, deleted, invited-but-unconfirmed, provider-only, rate-limited, CAPTCHA-rejected, or provider-failure case, then the visible response, navigation, and retry guidance are generic and do not reveal account state or provider outcome.
- [ ] **FEAT-002-AC-02:** Given public sign-up is disabled, when an unknown email requests recovery, then no Auth user, organization, membership, role, or application row is created.
- [ ] **FEAT-002-AC-03:** Given a valid synthetic invited user, when recovery is requested, then local Mailpit receives a tenant-neutral message from a synthetic sender using the version-controlled template and one exact callback: `http://127.0.0.1:5173/auth/recovery` or `http://127.0.0.1:4173/auth/recovery`.
- [ ] **FEAT-002-AC-04:** Given an email-security scanner loads the landing URL, when the user has not explicitly continued, then the recovery credential remains unconsumed.
- [ ] **FEAT-002-AC-05:** Given a valid current recovery credential, when the user explicitly verifies it, then only a temporary recovery context can reach the new-password form; FEAT-001 access bootstrap and role workspaces remain unavailable.
- [ ] **FEAT-002-AC-06:** Given an invalid, expired, already used, malformed, wrong-purpose, superseded, or disallowed-redirect credential, when verification is attempted, then the same safe invalid-recovery state is shown and no password or application data changes. If a newer request leaves an older credential usable, implementation stops for specification review.
- [ ] **FEAT-002-AC-07:** Given a valid recovery context, when passwords are empty, mismatched, shorter than 15 characters, equal to the current password, or rejected by Supabase with `weak_password` or `same_password`, then no success is shown and accessible corrective guidance is provided without logging password data. At least 64 characters, spaces, paste, autofill, and password managers are supported without composition rules.
- [ ] **FEAT-002-AC-08:** Given a valid recovery context and accepted new password, when the update completes, then the password changes exactly once, the recovery credential cannot be replayed, all refresh-token-backed sessions are revoked, local recovery/session state is cleared, and fresh sign-in is required under the no-schema starting design.
- [ ] **FEAT-002-AC-09:** Given sessions on two clients before the reset, when old refresh tokens, old access JWTs, FEAT-001 auth bootstrap, and every currently browser-accessible Data API or RPC path are exercised after completion, then access is denied. Any surviving access stops implementation for specification review before a migration or protected-control change.
- [ ] **FEAT-002-AC-10:** Given password update succeeds but revocation/completion confirmation fails, when the client handles the partial failure, then it fails closed, clears local state, opens no workspace, and gives safe sign-in/support guidance without rolling back the password.
- [ ] **FEAT-002-AC-11:** Given an active synthetic account completes recovery, then Supabase Auth exposes the required recovery/password-change/revocation event names and fields and local Mailpit receives the version-controlled password-changed notification without password, token, organization, membership, role, or restricted data. Missing required evidence stops implementation for specification review.
- [ ] **FEAT-002-AC-12:** Given repeated, automated, and concurrent requests, then the 60-second synthetic per-user cooldown, provider-neutral CAPTCHA challenge success/failure/expiry/retry behavior, duplicate-submit guards, and monitoring limit abuse without changing the generic public response, including through an accessible fallback.
- [ ] **FEAT-002-AC-13:** Given one Auth identity has memberships in two synthetic organizations, then request, email, verification, update, failure, notification, and success states reveal neither organization and change neither membership.
- [ ] **FEAT-002-AC-14:** Given source and production bundle inspection, then no service-role/secret key, password, recovery credential, email test fixture from a real person, arbitrary redirect, or sensitive logging path is present.
- [ ] **FEAT-002-AC-15:** Given keyboard-only and mobile/desktop use, then request, explicit confirmation, new-password, invalid, fail-closed, and success flows meet the specified focus, label, error-announcement, responsive, and offline behavior.

## Tests and evidence

| Test ID | Level | Scenario | Expected result |
|---|---|---|---|
| FEAT-002-UNIT-01 | Unit | Email normalization, fixed redirect, and public response mapping | Exact application redirect; all provider outcomes map to one acknowledgement |
| FEAT-002-UNIT-02 | Unit | Recovery state machine, operation generation, duplicate submit, Back/refresh, and cleanup | Stale or concurrent actions cannot restore or bypass a terminal state |
| FEAT-002-UNIT-03 | Unit | Credential parsing and URL scrubbing | Only recovery credential/type accepted; credential removed and never logged/rendered |
| FEAT-002-UNIT-04 | Unit | Password/confirmation validation and safe error mapping | Accessible correction with no secret retention or raw provider error |
| FEAT-002-COMP-01 | Component | Request through generic acknowledgement for known/unknown/provider failure | Visibly indistinguishable result and accessible focus behavior |
| FEAT-002-COMP-02 | Component | Explicit confirmation, invalid link, password entry, revocation failure, and success | All required states render; no route reaches a role workspace |
| FEAT-002-COMP-03 | Component | Offline request/update and retry | No secret or recovery request is queued; clear connectivity guidance |
| FEAT-002-AUTH-01 | Auth integration | Known and unknown synthetic email recovery requests with public sign-up disabled | Known user receives Mailpit message; unknown user creates nothing; UI response remains generic |
| FEAT-002-AUTH-02 | Auth integration | Valid, expired, used, malformed, wrong-purpose, replayed, concurrent, resent, and potentially superseded credentials | Only one valid recovery completes; all invalid/replay cases fail closed; unexpected supersession behavior stops implementation |
| FEAT-002-AUTH-03 | Auth integration | 15-character minimum, at-least-64-character support, spaces, paste/autofill/password-manager input, no composition rule, `weak_password`, `same_password`, and password update | Supabase enforces approved settings; errors map safely; password changes only on valid submission |
| FEAT-002-AUTH-04 | Auth/session integration | Existing sessions on two clients; old refresh tokens/JWTs; FEAT-001 bootstrap; browser Data API/RPC paths | Global refresh revocation succeeds and every old-session path is denied, or implementation stops for specification review |
| FEAT-002-AUTH-05 | Auth integration | Exact Supabase Auth evidence fields and Mailpit password-changed notification | Required events/fields and tenant-neutral notification are present, safe, attributable, and reviewable |
| FEAT-002-ABUSE-01 | Security | Request flood, 60-second cooldown, CAPTCHA success/failure/expiry/retry, generic response, accessible fallback, and timing comparison | Abuse is limited without an account-existence oracle |
| FEAT-002-SEC-01 | Security | Open redirect, wildcard, token leakage, logs, analytics, and browser storage inspection | No untrusted redirect or credential leakage |
| FEAT-002-TENANT-01 | Tenant isolation | Multi-membership user plus users in two organizations | Recovery exposes and modifies no organization or membership data |
| FEAT-002-E2E-01 | Browser | Complete synthetic desktop and mobile recovery through Mailpit | Fresh password signs in; old password and recovery replay fail; user starts at sign-in |
| FEAT-002-E2E-02 | Browser/accessibility | Keyboard, focus, announcements, invalid/failure/offline states | Specified WCAG-oriented behavior passes automated checks and human review |
| FEAT-002-CONFIG-01 | Configuration | Reset local stack and compare Auth, version-controlled templates, exact loopback redirects, 3,600-second expiry, password, 60-second cooldown, CAPTCHA, and session settings | Versioned local behavior is reproducible and drift is detected |
| FEAT-002-SCAN-01 | Static/build | Browser/service-role/general secret and sensitive-string scans | No credential, token, secret key, or real user data found |
| FEAT-002-REG-01 | Regression | FEAT-001 unit, SQL/RLS, Auth/TOTP/Edge, tenant, and Playwright suites | Existing login, MFA, audit, and tenant isolation remain green |

Evidence must identify the commit/build, Supabase and frontend environment, Auth configuration, email-template version, synthetic accounts, timestamps, expected/actual result, artifacts, tester, date, defects, and reviewer. No row may be marked “Pass” from this documentation-only pull request.

## Dependencies

- Existing `@supabase/supabase-js` client and Supabase Auth
- Existing React, TypeScript, Vite, Zod, Vitest, Testing Library, Playwright, and Supabase CLI toolchain
- Local Mailpit for synthetic email-flow tests
- A future approved production SMTP provider, sender domain, CAPTCHA provider, and Supabase plan/configuration

No new application package is expected. Any proposed dependency requires documented purpose, maintenance status, vulnerability history, license, bundle/operational effect, and why the existing platform cannot meet the need.

## Files allowed to change during implementation

- `src/features/auth/**` for the bounded recovery UI, state, validation, and gateway behavior
- Existing auth routing/entry composition only where necessary to expose recovery
- `supabase/config.toml` and version-controlled local recovery/security email templates
- A new additive FEAT-002 SQL migration only after runtime evidence stops implementation, a specification amendment is approved, and live-session validation or minimized application evidence requires it
- `supabase/functions/**` only if a reviewed protected control is proven necessary; no service-role wrapper is assumed
- FEAT-002 unit, component, Auth integration, security, and Playwright tests
- Generated database types only if an approved schema/function migration changes the generated contract
- This specification, FEAT-002 traceability, and the documentation change log

## Files not allowed to change

- `AGENTS.md`
- Existing FEAT-001 migrations
- Organization, membership, role, permission, MFA-factor, invitation, profile, aircraft, dispatch, training, or other unrelated modules
- Existing ADR decisions unless a discovered conflict requires a separately approved ADR
- Production credentials, production data, deployment configuration, or GitHub Actions workflows

## Documentation-only task boundary

This specification pull request may change only:

- `docs/FlyEye_Documentation/features/FEAT-002_PASSWORD_RECOVERY.md`
- `docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md`
- `docs/FlyEye_Documentation/README.md`
- `docs/FlyEye_Documentation/16_CHANGE_LOG.md`

It does not authorize implementation, package installation, database migration, Supabase dashboard changes, deployment, production data, or production credentials.

## Known limitations and approvals still required

- No implementation or executable evidence exists yet.
- Founder/Product Owner decisions are approved only for documentation preparation and synthetic local implementation planning; implementation is unauthorized.
- Technical, independent security/privacy, and accessibility reviewers are not assigned, and their approvals remain pending.
- No preview or production domain, exact hosted redirect allowlist, sender identity, SMTP provider, CAPTCHA provider, Supabase plan/region/residency, hosting, or production Auth configuration is approved.
- Exact resend/supersession behavior, recovery-prefetch behavior, session revocation across all old-session paths, and provider audit-event coverage require runtime evidence on pinned versions.
- Breached-password protection, production rate/IP/WAF controls, retention, export, log drains, access controls, alerts, delivery monitoring, and operational ownership remain unresolved.
- Lost-mailbox, MFA-factor, recovery-code, supervised support, and account-compromise procedures are deferred and remain mandatory before real-data pilot or production use.
- Aviation-SME approval is not required unless later changes introduce aviation authority or workflow behavior.
- A documentation review or green CI result is not implementation approval, security validation, privacy approval, deployment authorization, or production readiness.

## Definition of Done

- [ ] Founder/Product Owner confirms the implemented outcome matches the approved decisions
- [ ] Assigned technical, independent security/privacy, and accessibility reviewers approve the selected Supabase recovery, email, redirect, abuse-control, audit, session-revocation, and accessible-fallback design
- [ ] Exact Auth configuration and email templates are version-controlled or covered by a reviewed drift-detecting runbook
- [ ] Bounded UI/Auth implementation is complete without unrelated identity or application changes
- [ ] No public schema change occurs unless runtime evidence stops implementation, the specification is amended, and the session/audit requirement and additive migration are approved
- [ ] Unit, component, Auth integration, authorization, tenant, abuse, replay, session, browser, accessibility, and regression tests pass
- [ ] Previously issued sessions, residual JWT behavior, password-change notification, and provider audit evidence are independently verified
- [ ] Service-role/secret keys, passwords, recovery credentials, real data, and sensitive logs remain absent from browser/source/build/test evidence
- [ ] Loading, generic acknowledgement, invalid, expired, used, validation, provider error, revocation failure, offline, and success states are reviewed
- [ ] FEAT-002 traceability is updated with reproducible evidence; no result is inferred from documentation
- [ ] Separate implementation diff, security/privacy review, and product acceptance are recorded
- [ ] No deployment or production approval is inferred
