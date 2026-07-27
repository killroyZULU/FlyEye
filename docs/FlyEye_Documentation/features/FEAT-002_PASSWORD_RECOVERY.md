# Feature Specification: FEAT-002 — Password Recovery

## Status and ownership

- Status: Evidence-based amendment, bounded local synthetic implementation, post-password-change correction, Codex review, final automated verification, participant-exercised local synthetic desktop recovery walkthrough, Founder/Product Owner bounded local MVP acceptance, and normal merge through PR #5 are complete; hosted validation, deployment, real-data, production, and FEAT-003 gates remain pending
- Founder/Product Owner: Approved the original decisions, completed an owner-led review, approved the verified-password-AMR amendment, and separately authorized the bounded local synthetic implementation on 2026-07-26
- Owner-led review coverage: Recovery eligibility/authority, recovery-link security, password policy, session revocation, enumeration/abuse controls, audit/notifications/privacy, accessibility, and the local synthetic-development boundary
- Codex role: Facilitated the owner review, implemented the bounded change, reviewed the corrected diff, and produced the automated technical evidence; this is agent review, not qualified independent human review or Founder/Product Owner approval
- Qualified independent human technical/security/privacy review: Not performed. The Founder/Product Owner accepted the completed Codex review and automated verification as the bounded-local technical code-review evidence under the risk-based governance amendment
- Aviation SME: Not required for the password-recovery behavior; no aviation authority or workflow is changed
- Technical owner: FlyEye project
- Target release: Identity-foundation sequence after FEAT-001

The completed owner-led review approved the original specification and governance boundary. The 2026-07-26 pinned-runtime review then disproved the assumption that a Supabase recovery session is automatically isolated from normal FlyEye application access. The Founder/Product Owner approved the smallest secure amendment and separately authorized this bounded local synthetic implementation. After the review-found post-password-change defect was corrected, focused affected checks and one final required verification matrix passed. That completed Codex review and automated evidence satisfy the bounded-local technical review gate. No qualified independent human technical or security/privacy review was performed. On 2026-07-27 the Founder/Product Owner—not the agent or automation—granted bounded local MVP product acceptance with the documented residual evidence limitations and separately authorized the scoped Git publication and draft pull request. PR #5 then normally merged feature commit `fd1bd2f9aef9bce159b93ce76dd7530371f2d897` into development `main` at merge commit `4f993f0d0dc40f8a5783ae5176ffe2ef6000ca94`.

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
| Pinned token-hash verification behavior | [Supabase Auth `verify.go` at `v2.192.0`](https://github.com/supabase/auth/blob/v2.192.0/internal/api/verify.go), reviewed and exercised locally 2026-07-26 | Recovery and magic-link types share recovery-token lookup and recovery verification; generic email verification can also resolve a recovery token |

This feature has no aviation rule, dispatch decision, airworthiness action, training assessment, or competency decision.

## Local synthetic runtime evidence review

The documentation-and-evidence-only review used Supabase CLI `2.109.1`, `@supabase/supabase-js` `2.110.7`, and GoTrue `v2.192.0` on the local stack. The temporary harness created randomized `example.test` identities and one synthetic organization; its evidence output contained no token, password, full email, service-role credential, IP value, or raw audit payload. It removed temporary users and application rows, and no executable spike file was retained.

| Evidence area | Observed result | Specification consequence |
|---|---|---|
| Verification-type matrix | A recovery token hash was accepted with `recovery`, `email`, and `magiclink`; it was rejected with `signup`, `invite`, and `email_change` | Provider verification type is not a reliable recovery-purpose boundary on the pinned runtime |
| Client event | `recovery` emitted `PASSWORD_RECOVERY`; `email` emitted `SIGNED_IN` | Client events remain useful UI signals but cannot authorize application access |
| JWT claims | Both accepted sessions had the same claim keys, `aal1`, `amr` method `otp`, a `session_id`, and no recovery-purpose claim | The protected server cannot distinguish recovery from magic-link/email verification by a purpose claim |
| FEAT-001 AMR compatibility | Password sign-in produced `amr` method `password`; the promoted AAL2 session contained `password` and `totp` | Requiring verified password AMR preserves the existing password and password-plus-TOTP entry paths |
| Pre-password Auth access | Both accepted sessions could call `/auth/v1/user` before a password change | The verified mailbox credential creates a normal Supabase Auth session |
| Pre-password FlyEye access | Both accepted sessions received HTTP `200` from FEAT-001 `auth-bootstrap` before a password change | The original client-only temporary-context design was unsafe and required the now-approved password-AMR gate |
| Direct browser data paths | Direct `organizations` Data API and `resolve_auth_access_context` RPC requests received HTTP `403` | Existing deny-by-default grants continue to protect direct table/RPC paths |
| Post-change global sign-out | The old refresh token received HTTP `400`; old access-token Auth, bootstrap, table, and RPC paths received `403`, `401`, `403`, and `403` | The pinned no-schema global-revocation behavior passed the bounded replay evidence |
| Provider audit actions | `user_recovery_requested`, `login`, `user_updated_password`, `user_modified`, and `logout` were observed; `token_revoked` was not | Do not claim or require an unobserved `token_revoked` action on this version; combine `logout` evidence with token/path denial |
| Provider audit fields | `auth.audit_log_entries` contained `instance_id`, `id`, `payload`, `created_at`, and `ip_address`; relevant payloads contained `action`, `actor_id`, `actor_username`, `actor_via_sso`, and `log_type` | Provider evidence is attributable but privacy-restricted because raw rows contain a full email and IP address |

The pinned server source explains the verification matrix: `email` searches both confirmation and recovery tokens, while `recovery` and `magiclink` both search the recovery token and execute the same recovery-verification path. All successful cases issue an OTP-authenticated session. The JavaScript client only changes the local event name according to the caller-supplied type.

## Authorized local implementation evidence

The authorized implementation was exercised on 2026-07-26 and corrected and fully reverified on 2026-07-27 in the then-uncommitted `feat/FEAT-002-password-recovery` working tree based on `77fb9cbea5d7caecd55cfd906fe4e3dd1855a70e`. It was published as feature commit `fd1bd2f9aef9bce159b93ce76dd7530371f2d897`, retained Supabase CLI `2.109.1`, GoTrue `v2.192.0`, and `@supabase/supabase-js` `2.110.7`, added no package or SQL migration, and used only randomized `example.test` identities and synthetic organizations.

| Evidence area | Local automated result | Boundary |
|---|---|---|
| Protected bootstrap | Handler tests and the real local Edge runtime denied `recovery`, `email`, and `magiclink` OTP-only sessions with HTTP `403` and `authentication_method_not_allowed` before membership resolution; the runtime harness asserted a separate protected denial audit row for each alias | Denials used the existing protected audit writer with null/empty organization context; missing audit evidence failed closed |
| Existing login/MFA | Password AMR and password-plus-TOTP AMR continued through the existing FEAT-001 role, AAL, MFA, organization-selection, tenant, RPC, body-limit, and audit paths | No role, permission, membership, RLS, grant, RPC, or schema behavior was widened |
| Recovery UI | Unit, component, and desktop/mobile Playwright coverage exercised generic request acknowledgement, malformed/offline handling, URL scrubbing, explicit confirmation, password validation, invalid link, resolved and rejected global-sign-out failures, unexpected post-change revocation failure, and success requiring fresh sign-in; reliable page-state focus transitions were asserted. The Founder/Product Owner then exercised the local synthetic desktop request, link, password, validation, completion, and return-to-sign-in path and reported no material accessibility defect in that path | The application always called `verifyOtp` with `recovery`; post-update exceptions had no path back to password entry or a workspace. Invalid-link, offline, injected fail-closed, mobile, assistive-technology live-region, password-manager/autofill, measured contrast/target-size, 200% zoom/reflow, and active CAPTCHA fallback were not separately recorded as human observations |
| Auth configuration and email | The pinned local stack accepted the exact loopback callbacks, 3,600-second expiry, 60-second cooldown, 15-character minimum, empty composition rule, version-controlled recovery template, and password-changed notification | Mailpit messages were tenant-neutral; retained evidence did not copy message credentials, passwords, full email addresses, IP values, or raw Auth rows |
| Credential and password behavior | The local Auth test reproduced accepted `recovery`/`email`/`magiclink` aliases and rejected `signup`/`invite`/`email_change`; replay, `same_password`, `weak_password`, and immediate cooldown requests failed; a 64-character password with spaces succeeded | Public unknown-email recovery created no Auth user or application row |
| Session revocation | After the password update and global logout, both clients' old refresh tokens and both clients' old Auth/bootstrap/Data API/RPC access paths were denied; the old password failed and a fresh password session passed normal bootstrap | Evidence used the observed `logout` action plus path denial and did not infer `token_revoked` |
| Database and tenancy | Clean migration reset, 47 SQL/RLS tests, schema-wide RLS discovery, database lint, generated-type drift check, and two-organization synthetic coverage passed | No migration, generated database type, exposed-table policy, grant, trigger, view, or privileged PostgreSQL function changed |

The 2026-07-27 correction additionally proved that `SupabaseAuthGateway.signOutEverywhere()` maps both a resolved global-sign-out error and a rejected global-sign-out exception to `revocation_failed`, attempts local cleanup in either case, and that every unexpected exception after the password update enters the terminal sign-in/support state with password fields and recovery state cleared, no organization/workspace load, and no second password submission.

These agent and automated results support the local implementation only. The participant-exercised desktop walkthrough and its limitations are recorded in [FEAT-002 traceability](FEAT-002_TRACEABILITY.md). The Founder/Product Owner accepted those documented residual local limitations only for this bounded MVP publication decision, and their later merge authorization did not expand that evidence. CAPTCHA provider activation, distributed/IP abuse behavior, timing-distribution analysis, unexercised human-only accessibility behavior at later applicable gates, hosted validation, real-data use, deployment, and production approval remain unresolved. No qualified independent human technical or security/privacy review was performed.

## Approved smallest secure amendment

The Founder/Product Owner approved this amendment and separately authorized its bounded local synthetic implementation on 2026-07-26:

1. Keep the application-controlled template and client call fixed to `type: "recovery"`, but do not treat that value or the `PASSWORD_RECOVERY` client event as a server authorization boundary.
2. Harden FEAT-001 `auth-bootstrap` to derive authentication methods only from the already verified access JWT and deny every session whose `amr` does not contain `password`. Continue enforcing the existing AAL and TOTP requirements after this check.
3. Record the denial through the existing protected authentication-audit path with a bounded reason such as `authentication_method_not_allowed`; do not add a table, browser grant, RLS policy, service-role wrapper, or schema migration.
4. Recovery, magic-link, and generic email-OTP sessions may use Supabase Auth only for the bounded credential update. They cannot load organization context, select a tenant, or enter any FlyEye workspace.
5. After the password update, globally sign out, clear local state, and require a fresh password sign-in. A fresh password session may then proceed through normal FEAT-001 bootstrap and the existing role/MFA checks.
6. Passwordless and magic-link FlyEye workspace access remain non-goals. Any future passkey, SSO, passwordless, or different AMR support requires a separately approved allowlist and regression review.
7. Treat raw provider audit rows as restricted security data. Reproducible evidence records action names, field names, match booleans, and HTTP results only; it does not copy full emails, IP addresses, tokens, or raw payloads into application logs, screenshots, documentation, or AI prompts.
8. Use `logout` plus old-refresh-token and old-access-path denial as the pinned session-revocation evidence. Reverify exact actions on every pinned Auth upgrade; do not infer `token_revoked`.

This approved amendment preserves the no-schema baseline and reuses the existing protected bootstrap and audit boundary. The local implementation follows this boundary. Product acceptance, publication, and merge were granted through separate recorded decisions; hosted use, deployment, and production remain separately gated.

## Founder/Product Owner decisions and approved amendments

The decisions and evidence-based amendments below record the bounded local synthetic implementation approval as it existed before later publication and merge decisions. At that stage, the approval did not authorize a commit, push, pull request, merge, hosted environment, real data, deployment, or production use.

| Decision area | Approved synthetic/local position |
|---|---|
| Recovery eligibility | Only existing, verified email/password identities are eligible. Unknown, suspended, banned, deleted, invited-but-unconfirmed, and provider-only accounts receive the same generic public response. A recovery request creates no user, organization, membership, role, or application record. |
| Password policy | Minimum 15 characters; support at least 64 characters, spaces, paste, autofill, and password managers. Do not require uppercase, lowercase, digit, or symbol composition rules. Supabase is authoritative. Handle `weak_password` and `same_password` safely. Breached-password protection is required before real-data use but deferred until an appropriate Supabase plan is selected. |
| Recovery credential | **Approved amendment:** Expiry is 3,600 seconds. Credentials are single-use and fail closed when invalid, expired, used, malformed, replayed, or superseded. The client always uses `recovery`, but the pinned provider also accepts recovery-token hashes through `email` and `magiclink`; every accepted OTP session is restricted until fresh password sign-in. |
| Verification flow | Use a version-controlled custom recovery template based on `TokenHash` and `verifyOtp` with type `recovery`. Opening the landing page does not consume the credential; verification follows explicit user action. Credential material is scrubbed from the URL and excluded from durable storage, logs, analytics, screenshots, DOM output, and AI prompts. |
| Session revocation | **Approved amendment:** Begin with no schema migration. Before password completion, deny every non-password-AMR session at protected bootstrap. After password change, globally revoke refresh-token-backed sessions, clear local state, and require fresh password sign-in. Test two clients, old refresh tokens, old access JWTs, auth bootstrap, and every currently browser-accessible Data API or RPC path. |
| Redirects | Exact synthetic callbacks are `http://127.0.0.1:5173/auth/recovery` and `http://127.0.0.1:4173/auth/recovery`. Wildcard, user-supplied, tenant-supplied, role-supplied, and arbitrary continuation redirects are prohibited. Production domain and redirects are deferred. |
| Email and notifications | Use local Mailpit and synthetic sender information. Version-control the recovery and password-changed notification templates during implementation. Messages are tenant-neutral and contain no password, token, organization, membership, role, or restricted information. Production SMTP, sender identity/domain, delivery monitoring, and final support address are deferred. |
| CAPTCHA | Use a provider-neutral application boundary. Cloudflare Turnstile is the current production candidate, not an approved production provider. Live provider credentials, contractual/privacy review, and production activation are deferred. Synthetic tests cover challenge success, failure, expiry, retry, generic responses, and accessible fallback behavior. | <!-- gitleaks:allow: documentation describes unresolved credentials without containing a credential -->
| Rate limiting | Apply a 60-second synthetic per-user recovery-request cooldown. Rate-limited and provider-failure outcomes preserve the generic public acknowledgement. Production project-wide limits, IP/WAF controls, timing tolerances, monitoring thresholds, and alerts await staging evidence. |
| Audit evidence | **Approved amendment:** Supabase Auth audit logs are initially authoritative for recovery requests, password changes, and logout. On the pinned runtime the observed actions are `user_recovery_requested`, `login`, `user_updated_password`, `user_modified`, and `logout`; no `token_revoked` action was observed. Use redacted provider evidence plus old-token/path denial. The existing protected application audit path records denied bootstrap without a schema migration. |
| Environment boundary | Planning and any later implementation are limited to local synthetic development. No real customer, student, school, or production data is authorized. Hosting, domain, Supabase plan/region/residency, SMTP, CAPTCHA credentials, costs, and deployment remain unresolved. |
| Deferred scope | Lost-mailbox recovery, MFA recovery codes, factor replacement, supervised identity proofing, administrator-assisted recovery, and formal account-compromise procedures remain outside FEAT-002 and are blockers before real-data pilot or production use. |

## Implementation authorization and unresolved gates

### Recorded authorization for this local implementation

- Founder/Product Owner approved the verified-password-AMR bootstrap amendment on 2026-07-26.
- Founder/Product Owner separately authorized the bounded AI-assisted local synthetic FEAT-002 implementation on `feat/FEAT-002-password-recovery`.
- Supabase CLI `2.109.1`, GoTrue `v2.192.0`, and `@supabase/supabase-js` `2.110.7` remained pinned.
- The implementation used only local synthetic `example.test` identities and randomized organizations. At the implementation stage, no hosted environment, real data, commit, push, pull request, merge, or deployment was authorized or performed; later publication and merge decisions are recorded separately.

### Risk-based technical review and evidence reuse

- The completed Codex review and automated verification are the technical code-review evidence for this bounded local change. Never label either as qualified independent human review.
- The reviewed working-tree implementation was based on `77fb9cbea5d7caecd55cfd906fe4e3dd1855a70e` and was published on `feat/FEAT-002-password-recovery` as commit `fd1bd2f9aef9bce159b93ce76dd7530371f2d897`, with the same implementation-content manifest, pinned dependencies, local configuration, and evidence recorded in [FEAT-002 traceability](FEAT-002_TRACEABILITY.md).
- The review-found post-password-change defect was corrected, focused affected checks passed, and one final required verification matrix passed on 2026-07-27.
- Do not repeat the complete matrix while the branch, HEAD, working-tree content hashes, dependencies, configuration, and referenced evidence remain unchanged.
- No qualified independent human technical or security/privacy review was performed. The Founder/Product Owner received the material finding and correction outcome and approved this governance treatment.
- The participant-exercised focused human desktop walkthrough is recorded in the traceability file. Its unexercised human-only behaviors remain explicit local evidence limitations and are not qualified independent human technical or security/privacy review.

### Runtime evidence required before implementation acceptance

- Preserve the evidenced 3,600-second expiry, single use, replay denial, and resend/supersession behavior; prove prefetch resistance in the application.
- Reproduce the pinned verification-type matrix and prove that every OTP-derived session, including provider-accepted `recovery`, `email`, and `magiclink` aliases, is denied by FEAT-001 bootstrap before a fresh password sign-in.
- Prove the 15-character minimum, at-least-64-character support, spaces, paste, autofill, password-manager compatibility, and safe `weak_password` and `same_password` handling.
- Prove the custom `TokenHash`/`verifyOtp` recovery template and exact loopback redirects without credential leakage.
- Prove two-client global refresh-token revocation and test old refresh tokens, old access JWTs, FEAT-001 auth bootstrap, and every currently browser-accessible Data API or RPC path.
- Verify the observed Supabase Auth actions and fields for recovery request, login, password change, modification, and logout; combine logout evidence with old-token/path denial and do not assume `token_revoked`.
- Verify Mailpit recovery and password-changed notifications, tenant neutrality, the 60-second cooldown, provider-neutral CAPTCHA outcomes, generic responses, timing behavior, and accessible fallback.
- Stop implementation for specification review if newer requests leave older credentials usable, any old-session access survives, required audit evidence is unavailable, or required security, privacy, or accessibility evidence fails or remains unavailable.
- Reuse the recorded final matrix until the review-target fingerprint changes; any correction after a change receives focused affected checks and then one new final required matrix.

### Real-data pilot and production gates

- Select and independently review the production domain and redirects, Supabase plan/region/residency, hosting, SMTP provider, sender identity/domain, support address, delivery monitoring, CAPTCHA provider credentials, contractual/privacy terms, and costs. <!-- gitleaks:allow: documentation describes unresolved credentials without containing a credential -->
- Enable and verify breached-password protection before any real-data use.
- Establish project-wide and IP rate limits, WAF controls, response-timing tolerances, monitoring thresholds, alerts, Auth-log retention/export/drains/access, operational ownership, and incident/account-compromise procedures.
- Approve lost-mailbox recovery, MFA recovery codes, factor replacement, supervised identity proofing, administrator-assisted recovery, and formal account-compromise procedures.
- Complete required technical, security, privacy, accessibility, deployment, and production reviews; green CI or AI review cannot satisfy these gates.

## Configuration decision matrix

| Configuration | Local synthetic development | Preview/staging | Production |
|---|---|---|---|
| Authorization | Amendment and bounded implementation approved; Codex review, local automated technical evidence, and the scope-limited human desktop walkthrough are recorded; bounded local MVP acceptance was granted and PR #5 normally merged feature commit `fd1bd2f9aef9bce159b93ce76dd7530371f2d897` into development `main` at `4f993f0d0dc40f8a5783ae5176ffe2ef6000ca94` | Not authorized or configured | Not authorized or configured |
| Data | Synthetic accounts only; at least two organizations and one multi-membership identity | Synthetic data only if a future preview is approved | Real data prohibited until all pilot/production gates pass |
| Recovery callbacks | `http://127.0.0.1:5173/auth/recovery` and `http://127.0.0.1:4173/auth/recovery` only | Exact origin unresolved; no wildcard or supplied continuation | Domain and exact callbacks unresolved; no wildcard or supplied continuation |
| Email | Local Mailpit, synthetic sender, version-controlled recovery and password-changed templates | Provider, sender, support address, and monitoring unresolved | SMTP, sender identity/domain, support address, monitoring, and terms unresolved |
| Password controls | Minimum 15; at least 64 supported; spaces/paste/autofill/password managers; no composition rule; Supabase authoritative | Must preserve approved baseline; breached-password plan unresolved | Breached-password protection required; plan and settings unresolved |
| Recovery credential | 3,600-second expiry, single use, explicit verification; pinned cross-type, replay, boundary, and resend/supersession behavior recorded | Must be reverified on selected hosted versions | Must be reverified and independently approved |
| Session control | No-schema password-AMR bootstrap gate implemented; OTP-only denial audit, two-client global refresh/access denial, and fresh-password regression passed locally | Separate project and repeatable evidence required before use | Plan/session settings and independent evidence required |
| CAPTCHA | Provider-neutral boundary with synthetic success, failure, expiry, retry, generic-response, and accessible-fallback tests | Candidate/provider and non-live test configuration unresolved | Turnstile is a candidate only; provider, keys, privacy, contract, and activation unresolved |
| Rate limits | 60-second synthetic per-user cooldown; generic acknowledgement retained | Project/IP/timing/monitoring settings require staging evidence | Project/IP/WAF limits, timing, monitoring, and alerts unresolved |
| Audit | Pinned local Auth actions/field structure recorded; raw email/IP rows restricted; protected bootstrap denial uses existing application audit path | Retention, export, access, correlation, and alerts unresolved | Log drains, retention, access, alert routing, and ownership unresolved |

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
8. A verified recovery credential creates a normal Supabase OTP session, not a purpose-bound recovery session. The client uses it only for password recovery, and FEAT-001 `auth-bootstrap` must deny it server-side because its verified JWT `amr` lacks `password`. It cannot select an organization or enter a role workspace before the password is changed and a fresh password sign-in occurs.
9. The new password and confirmation must match and satisfy the server-configured Supabase Auth policy: at least 15 characters, at least 64 characters supported, spaces permitted, and paste, autofill, and password managers supported, with no uppercase/lowercase/digit/symbol composition rule. Supabase remains authoritative; `weak_password` and `same_password` errors receive safe corrective guidance. The password is sent only to Supabase Auth over TLS and is never logged, audited, cached, analyzed, or sent to application tables/functions.
10. A successfully consumed, expired, malformed, or superseded credential cannot be replayed. The client rejects untrusted verification-type input and always sends `recovery`; server authorization nevertheless assumes that the pinned provider may accept the same recovery token through `email` or `magiclink`. Every resulting OTP session remains denied from FlyEye bootstrap.
11. After the password update succeeds, the no-schema starting design globally revokes every refresh-token-backed session, clears local recovery/session state, and routes the user to sign-in. The pinned sequence denied old refresh tokens and access paths in the bounded review; the implementation suite must reproduce it. The application never continues directly into a workspace.
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
- Keep the no-schema baseline. The evidence requires a protected `auth-bootstrap` AMR check, not `session_id` state or an application-table migration. If later evidence shows that verified JWT AMR cannot enforce the boundary, stop before proposing an additive migration or another protected control. Never rewrite FEAT-001 migrations.
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
- The application accepts only its fixed recovery route and never accepts a verification type, `next`, `redirectTo`, organization, or role from the URL or user. The provider's acceptance of `email` or `magiclink` for the same token is treated as hostile/direct-client behavior, not as an application success path.
- Client receipt of `PASSWORD_RECOVERY` is necessary for the intended UI transition but is not sufficient authorization for FlyEye application access.

### Restrict OTP sessions from FlyEye bootstrap

- After validating the access JWT through Supabase Auth, `auth-bootstrap` derives its authentication-method references from that verified JWT.
- Bootstrap requires `amr` to contain `password`. Missing, malformed, empty, or OTP-only AMR fails closed before organization membership, role, permission, or workspace context is returned.
- The browser cannot supply or override AMR. User metadata, request bodies, client events, and unverified token contents are not authorization inputs.
- A denied OTP-only bootstrap records the existing `authentication.access_denied` event through the protected audit writer with a bounded reason such as `authentication_method_not_allowed`.
- Existing AAL and TOTP checks remain in force after the password-AMR gate. This amendment does not weaken MFA or grant operational authority.
- Direct Data API tables and protected RPCs retain their existing deny-by-default grants.

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
- Redirect destinations, the client-supplied recovery type, and workflow state are application-controlled constants, but provider-side type handling is not an authorization boundary.
- Recovery never grants a role, membership, MFA bypass, operational permission, or aviation authority.
- FEAT-001 protected bootstrap requires verified password AMR so recovery, magic-link, and generic email-OTP sessions cannot become normal FlyEye application sessions.
- Provider uncertainty, malformed responses, audit/notification gaps, or revocation uncertainty fail closed and do not open a workspace.
- There is no AI or authoritative aviation calculation in this feature.

## Audit, notifications, and observability

- Supabase Auth audit logs are the initial authority for recovery requests, password changes, and logout. The pinned actions are `user_recovery_requested`, `login`, `user_updated_password`, `user_modified`, and `logout`; `token_revoked` was not observed. No new application audit table or migration is assumed.
- Use version-controlled recovery and password-changed templates with local Mailpit and synthetic sender information during implementation.
- Pinned local rows use table fields `instance_id`, `id`, `payload`, `created_at`, and `ip_address`; relevant payloads use `action`, `actor_id`, `actor_username`, `actor_via_sso`, and `log_type`. `actor_id` matched the synthetic Auth subject and `actor_username` matched the full synthetic email. Reverify on version change; browser-authored “success” is not authoritative audit evidence.
- Provider audit rows are restricted security/privacy evidence because they contain full email and IP data. Tests and documentation may record field names, action names, match booleans, counts, and HTTP results, but not raw rows or values.
- Global-revocation acceptance combines the `logout` action with denied old refresh-token and access-token paths. Do not infer a `token_revoked` action that the pinned runtime did not emit.

| Operation | Exact pinned Auth action evidence | Attribution and context fields |
|---|---|---|
| Recovery request | `user_recovery_requested` | Payload `actor_id` matched the synthetic Auth subject; `actor_username` matched the full synthetic email; `actor_via_sso` and `log_type` were present. Row `created_at` and `ip_address` were present. |
| Recovery credential verification | `login` | Same attributable payload and row field structure; the evidence record retains only field names and match booleans. |
| Password update | `user_updated_password`, followed by `user_modified` in the exercised flow | Same attributable payload and row field structure; no password value was present in retained evidence. |
| Global logout | `logout` | Same attributable payload and row field structure. |
| Token revocation | No separate `token_revoked` action was emitted or found | Prove revocation by the `logout` row plus rejection of old refresh tokens and every old access-token path; reverify on any Auth version change. |

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
- Replay of used, expired, malformed, or superseded credentials; direct verification of a recovery token through provider-accepted `email` or `magiclink` aliases
- OTP-derived recovery, magic-link, or generic email session presented to FEAT-001 bootstrap before fresh password sign-in
- Multiple tabs, double submit, stale async response, browser Back/refresh, and password-update race
- Old refresh token or access JWT used after password reset
- Service-role or secret key included in the browser, source, bundle, logs, email, or documentation
- Cross-tenant inference through organization-branded responses, membership lookups, role routing, or support behavior
- Password, email, Auth error, recovery credential, provider audit email/IP field, or raw audit payload captured in application logs, documentation, screenshots, analytics, clipboard helpers, or AI prompts
- Compromised mailbox and social-engineering risks; these require the later approved supervised-recovery procedure and cannot be solved by this slice

## Acceptance criteria

- [ ] **FEAT-002-AC-01:** Given any syntactically valid email input, when recovery is requested for an eligible, unknown, suspended, banned, deleted, invited-but-unconfirmed, provider-only, rate-limited, CAPTCHA-rejected, or provider-failure case, then the visible response, navigation, and retry guidance are generic and do not reveal account state or provider outcome.
- [ ] **FEAT-002-AC-02:** Given public sign-up is disabled, when an unknown email requests recovery, then no Auth user, organization, membership, role, or application row is created.
- [ ] **FEAT-002-AC-03:** Given a valid synthetic invited user, when recovery is requested, then local Mailpit receives a tenant-neutral message from a synthetic sender using the version-controlled template and one exact callback: `http://127.0.0.1:5173/auth/recovery` or `http://127.0.0.1:4173/auth/recovery`.
- [ ] **FEAT-002-AC-04:** Given an email-security scanner loads the landing URL, when the user has not explicitly continued, then the recovery credential remains unconsumed.
- [ ] **FEAT-002-AC-05:** Given a valid current recovery credential, when the user explicitly verifies it with the application-controlled `recovery` type, then the OTP session can reach only the new-password flow; verified password AMR is absent, FEAT-001 `auth-bootstrap` records a protected denial, and no organization or role workspace is returned.
- [ ] **FEAT-002-AC-06:** Given an invalid, expired, already used, malformed, superseded, or disallowed-redirect credential, when verification is attempted, then the same safe invalid-recovery state is shown and no password or application data changes. Given direct provider verification accepts a recovery token through `recovery`, `email`, or `magiclink`, every resulting OTP session remains denied from FlyEye bootstrap; `signup`, `invite`, and `email_change` remain rejected on the pinned runtime.
- [ ] **FEAT-002-AC-07:** Given a valid recovery context, when passwords are empty, mismatched, shorter than 15 characters, equal to the current password, or rejected by Supabase with `weak_password` or `same_password`, then no success is shown and accessible corrective guidance is provided without logging password data. At least 64 characters, spaces, paste, autofill, and password managers are supported without composition rules.
- [ ] **FEAT-002-AC-08:** Given a valid recovery context and accepted new password, when the update completes, then the password changes exactly once, the recovery credential cannot be replayed, all refresh-token-backed sessions are revoked, local recovery/session state is cleared, and fresh sign-in is required under the no-schema starting design.
- [ ] **FEAT-002-AC-09:** Given sessions on two clients before the reset, when old refresh tokens, old access JWTs, FEAT-001 auth bootstrap, and every currently browser-accessible Data API or RPC path are exercised after completion, then access is denied. Given a fresh password sign-in, bootstrap proceeds to the existing role/AAL/MFA checks. Any surviving old access or any OTP-only bootstrap success stops implementation for specification review.
- [ ] **FEAT-002-AC-10:** Given password update succeeds but revocation/completion confirmation fails, when the client handles the partial failure, then it fails closed, clears local state, opens no workspace, and gives safe sign-in/support guidance without rolling back the password.
- [ ] **FEAT-002-AC-11:** Given an active synthetic account completes recovery, then Supabase Auth exposes the pinned `user_recovery_requested`, `login`, `user_updated_password`, `user_modified`, and `logout` actions with attributable field structure; logout plus old-token/path denial proves revocation without assuming `token_revoked`; and local Mailpit receives the version-controlled password-changed notification without password, token, organization, membership, role, or restricted data. Raw email/IP audit values are not copied into test artifacts.
- [ ] **FEAT-002-AC-12:** Given repeated, automated, and concurrent requests, then the 60-second synthetic per-user cooldown, provider-neutral CAPTCHA challenge success/failure/expiry/retry behavior, duplicate-submit guards, and monitoring limit abuse without changing the generic public response, including through an accessible fallback.
- [ ] **FEAT-002-AC-13:** Given one Auth identity has memberships in two synthetic organizations, then request, email, verification, update, failure, notification, and success states reveal neither organization and change neither membership.
- [ ] **FEAT-002-AC-14:** Given source and production bundle inspection, then no service-role/secret key, password, recovery credential, email test fixture from a real person, arbitrary redirect, or sensitive logging path is present.
- [ ] **FEAT-002-AC-15:** Given keyboard-only and mobile/desktop use, then request, explicit confirmation, new-password, invalid, fail-closed, and success flows meet the specified focus, label, error-announcement, responsive, and offline behavior.

## Tests and evidence

| Test ID | Level | Scenario | Expected result |
|---|---|---|---|
| FEAT-002-UNIT-01 | Unit | Email normalization, fixed redirect, and public response mapping | Exact application redirect; all provider outcomes map to one acknowledgement |
| FEAT-002-UNIT-02 | Unit | Recovery state machine, operation generation, duplicate submit, Back/refresh, and cleanup | Stale or concurrent actions cannot restore or bypass a terminal state |
| FEAT-002-UNIT-03 | Unit | Credential parsing, fixed client type, and URL scrubbing | Application ignores/rejects supplied type and always uses `recovery`; credential is removed and never logged/rendered |
| FEAT-002-UNIT-04 | Unit | Password/confirmation validation and safe error mapping | Accessible correction with no secret retention or raw provider error |
| FEAT-002-COMP-01 | Component | Request through generic acknowledgement for known/unknown/provider failure | Visibly indistinguishable result and accessible focus behavior |
| FEAT-002-COMP-02 | Component | Explicit confirmation, invalid link, password entry, revocation failure, and success | All required states render; no route reaches a role workspace |
| FEAT-002-COMP-03 | Component | Offline request/update and retry | No secret or recovery request is queued; clear connectivity guidance |
| FEAT-002-AUTH-01 | Auth integration | Known and unknown synthetic email recovery requests with public sign-up disabled | Known user receives Mailpit message; unknown user creates nothing; UI response remains generic |
| FEAT-002-AUTH-02 | Auth integration | Valid, expired, used, malformed, replayed, concurrent, resent, superseded, and cross-type token-hash verification | Single-use/replay/supersession rules hold; the pinned `recovery`/`email`/`magiclink` acceptance and other-type rejection matrix is reproduced without trusting it for authorization |
| FEAT-002-AUTH-03 | Auth integration | 15-character minimum, at-least-64-character support, spaces, paste/autofill/password-manager input, no composition rule, `weak_password`, `same_password`, and password update | Supabase enforces approved settings; errors map safely; password changes only on valid submission |
| FEAT-002-AUTH-04 | Auth/session integration | Existing sessions on two clients; old refresh tokens/JWTs; FEAT-001 bootstrap; browser Data API/RPC paths | Global refresh revocation succeeds and every old-session path is denied, or implementation stops for specification review |
| FEAT-002-AUTH-05 | Auth integration | Exact Supabase Auth action/field structure, redacted evidence, and Mailpit password-changed notification | Pinned actions/fields are attributable; logout is paired with old-token denial; no raw email/IP/token is retained; tenant-neutral notification is present |
| FEAT-002-AUTH-06 | Auth/Edge authorization | Provider-accepted `recovery`, `email`, and `magiclink` sessions before password completion plus fresh password sign-in | Every OTP-only JWT is denied and audited by `auth-bootstrap`; direct table/RPC paths remain denied; fresh password AMR proceeds to existing role/AAL/MFA checks |
| FEAT-002-ABUSE-01 | Security | Request flood, 60-second cooldown, CAPTCHA success/failure/expiry/retry, generic response, accessible fallback, and timing comparison | Abuse is limited without an account-existence oracle |
| FEAT-002-SEC-01 | Security | Open redirect, wildcard, token leakage, logs, analytics, and browser storage inspection | No untrusted redirect or credential leakage |
| FEAT-002-TENANT-01 | Tenant isolation | Multi-membership user plus users in two organizations | Recovery exposes and modifies no organization or membership data |
| FEAT-002-E2E-01 | Browser | Complete synthetic desktop and mobile recovery through Mailpit | Fresh password signs in; old password and recovery replay fail; user starts at sign-in |
| FEAT-002-E2E-02 | Browser/accessibility | Keyboard, focus, announcements, invalid/failure/offline states | Specified WCAG-oriented behavior passes automated checks; focused human keyboard/visual judgment covers behavior automation cannot reliably evaluate |
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
- Existing FEAT-001 `supabase/functions/auth-bootstrap/**` and shared access-context contract/tests only for the approved verified-password-AMR gate; no new Edge Function or service-role wrapper is authorized
- FEAT-002 unit, component, Auth integration, security, and Playwright tests
- Generated database types only if an approved schema/function migration changes the generated contract
- This specification, FEAT-002 traceability, and the documentation change log

## Files not allowed to change

- `AGENTS.md`
- Existing FEAT-001 migrations
- Organization, membership, role, permission, MFA-factor, invitation, profile, aircraft, dispatch, training, or other unrelated modules
- Existing ADR decisions unless a discovered conflict requires a separately approved ADR
- Production credentials, production data, deployment configuration, or GitHub Actions workflows

## Authorization boundary for this working tree

The earlier documentation-only review was superseded only by the Founder/Product Owner's explicit approval of the verified-password-AMR amendment and separate authorization for this bounded local synthetic implementation. The authorized file scope is the implementation list above plus the four FEAT-002 documentation files, local test scripts, and Playwright configuration required to exercise the bounded flow.

This implementation authorization permitted no package installation, SQL migration, Supabase dashboard change, or GitHub Actions change. Later explicit decisions authorized the recorded feature commit, push, PR #5, and normal merge only; no hosted environment, real data, deployment, production credential, or production use was authorized.

## Known limitations and approvals still required

- The bounded product implementation is complete, Founder/Product Owner-accepted for the local MVP decision, and normally merged into development `main` through PR #5. The feature branch was retained. Hosted validation, deployment, real-data use, and production approval remain unauthorized.
- The verified-password-AMR bootstrap amendment and local synthetic implementation were approved for this bounded task; no broader identity, hosted, or release authority is implied.
- No qualified independent human technical or security/privacy review was performed. Under the approved risk-based model, the Founder/Product Owner completed the participant-exercised focused desktop recovery walkthrough; the traceability record preserves the unexercised human-only accessibility behaviors as residual local evidence limitations.
- No preview or production domain, exact hosted redirect allowlist, sender identity, SMTP provider, CAPTCHA provider, Supabase plan/region/residency, hosting, or production Auth configuration is approved.
- The pinned provider-purpose matrix, 3,600-second boundary, resend supersession, replay denial, explicit-confirmation prefetch resistance, two-organization implementation coverage, password policy, notification, post-change old-token/path denial, audit action/field structure, full FEAT-001 automated regression, and participant-exercised desktop recovery path have bounded local evidence. Active CAPTCHA-provider behavior, distributed/IP abuse, timing-distribution analysis, and the unexercised human-only accessibility behaviors remain pending at their applicable gates.
- The pinned provider issues indistinguishable OTP sessions for recovery and accepted aliases. Security therefore depends on the implemented protected password-AMR bootstrap gate and deny-by-default direct data paths, not a recovery-purpose claim.
- Provider audit rows contain full email and IP address. Production retention, access, export, log drains, alert routing, and operational ownership remain unresolved privacy/security gates.
- Breached-password protection, production rate/IP/WAF controls, retention, export, log drains, access controls, alerts, delivery monitoring, and operational ownership remain unresolved.
- Lost-mailbox, MFA-factor, recovery-code, supervised support, and account-compromise procedures are deferred and remain mandatory before real-data pilot or production use.
- Aviation-SME approval is not required unless later changes introduce aviation authority or workflow behavior.
- Agent review and green automation are technical evidence only; they are not qualified independent human review, product acceptance, Git publication authorization, merge authorization, deployment approval, or production readiness.

## Definition of Done

- [x] Founder/Product Owner approves the evidence-based verified-password-AMR amendment and confirms the implemented local outcome matches it
- [x] Completed Codex review and automated verification are recorded as the bounded-local technical code-review evidence without being described as qualified independent human review
- [x] Exact local Auth configuration and email templates are version-controlled and accepted by the pinned local stack
- [x] Bounded UI/Auth implementation is complete without unrelated identity or application changes
- [x] FEAT-001 `auth-bootstrap` denies and audits every OTP-only recovery/email/magic-link session before organization context while fresh password AMR continues to the existing role/AAL/MFA checks
- [x] No public schema change occurs unless runtime evidence stops implementation, the specification is amended, and the session/audit requirement and additive migration are approved
- [x] Local automated formatting, lint, type, unit, component, handler, Auth integration, authorization, tenant, abuse-boundary, replay, session, browser, focus, secret, SQL/RLS, Edge, database-lint, generated-type, build, and dependency checks pass
- [x] The participant-exercised focused human desktop recovery walkthrough and its residual limitations are recorded; active-CAPTCHA/distributed-abuse/timing evidence and unexercised human-only accessibility behaviors remain gated to their applicable future review or hosted environment
- [x] Previously issued sessions, residual JWT behavior, password-change notification, pinned provider audit actions/fields, privacy-safe evidence handling, and absence of assumed `token_revoked` evidence are covered by the recorded agent/automated technical evidence
- [x] Service-role/secret keys, passwords, recovery credentials, real data, and sensitive logs remain absent from browser/source/build/test evidence
- [x] Loading, generic acknowledgement, invalid, expired, used, validation, provider error, revocation failure, offline, and success states are covered by the local automated implementation evidence
- [x] Any failed or unavailable required credential, session-revocation, audit, security, privacy, or accessibility evidence stops implementation for specification review
- [x] FEAT-002 traceability is updated with reproducible evidence; no result is inferred from documentation
- [x] Separate Founder/Product Owner product acceptance, scoped Git publication, and normal merge decisions are recorded
- [x] No deployment or production approval is inferred
