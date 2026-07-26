# FEAT-002 Requirements Traceability

## Status

This record traces the documentation-complete FEAT-002 Password Recovery specification to its Founder/Product Owner decisions, security baseline, acceptance criteria, and planned evidence. Implementation has not started or been authorized. Every current result is therefore **Specified; not implemented or verified**.

## Approval boundary

- Founder/Product Owner: Approved the recorded decisions and documentation preparation on 2026-07-26.
- Technical reviewer: Not assigned; approval pending.
- Independent security/privacy reviewer: Not assigned; approval pending.
- Accessibility reviewer: Not assigned; approval pending.
- Aviation SME: Not required unless later scope introduces aviation authority or workflow behavior.
- FEAT-002 implementation remains unauthorized until the required reviewer assignments and approvals are recorded.
- Founder/Product Owner approval, AI review, and green CI do not constitute technical, security, privacy, accessibility, implementation, deployment, or production approval.

| Need ID | Source/problem | Requirement ID | Feature/design | Security/privacy/safety control | Planned test IDs/evidence | Current result | Approval |
|---|---|---|---|---|---|---|---|
| FEAT-002-01 | A user who forgot a password needs a safe self-service request | Product and Governance Decisions section 5; Security Requirements section 3 | Public request entry, local malformed-email guidance, and generic acknowledgement after any syntactically valid submission | Same visible behavior for eligible, unknown, suspended, banned, deleted, invited-but-unconfirmed, provider-only, rate-limited, CAPTCHA-rejected, and provider-failure cases; no organization lookup | FEAT-002-AC-01, FEAT-002-AC-02; FEAT-002-UNIT-01; FEAT-002-COMP-01; FEAT-002-AUTH-01; FEAT-002-ABUSE-01 | Specified; not implemented or verified | Founder/Product Owner decision recorded; technical, security/privacy, and accessibility reviews pending |
| FEAT-002-02 | Public recovery must not create accounts or widen access | IAM-001/002/003; ADR-0005 | Existing verified email/password identity only; no sign-up, membership, role, or tenant mutation | Public sign-up disabled; no user-supplied authority; no application table write | FEAT-002-AC-02, FEAT-002-AC-13; FEAT-002-AUTH-01; FEAT-002-TENANT-01; FEAT-002-REG-01 | Specified; not implemented or verified | Founder/Product Owner decision recorded; technical and security/privacy reviews pending |
| FEAT-002-03 | Recovery proof must be short-lived, single-use, and safe from automated link prefetch | Product and Governance Decisions section 5; Security Requirements sections 3 and 6 | 3,600-second synthetic expiry; explicit confirmation; version-controlled `TokenHash`/`verifyOtp` recovery template; bounded resend/supersession spike | Fixed `recovery` type; exact loopback origins; no verification on initial GET; invalid/used/expired/wrong-purpose/replayed credentials fail closed; unexpected supersession stops implementation | FEAT-002-AC-03, FEAT-002-AC-04, FEAT-002-AC-05, FEAT-002-AC-06, FEAT-002-AC-08; FEAT-002-UNIT-03; FEAT-002-AUTH-02; FEAT-002-SEC-01; FEAT-002-E2E-01 | Specified; runtime evidence pending | Founder/Product Owner decision recorded; technical and security/privacy reviews pending |
| FEAT-002-04 | Credential material must not leak through the web application or tooling | IAM-009; Security Requirements sections 5, 6, and 9 | URL scrubbing, in-memory-only handling, safe errors, publishable-key-only browser | No token/password in logs, analytics, DOM, referrer, durable storage, screenshots, application tables, or AI prompts | FEAT-002-AC-06, FEAT-002-AC-07, FEAT-002-AC-14; FEAT-002-UNIT-03; FEAT-002-UNIT-04; FEAT-002-SEC-01; FEAT-002-SCAN-01 | Specified; not implemented or verified | Founder/Product Owner decision recorded; security/privacy review pending |
| FEAT-002-05 | A recovered user must choose a valid new password | Security Requirements section 3; Supabase Auth password policy | Minimum 15, at least 64 supported, spaces/paste/autofill/password managers, no composition rule, server-authoritative `updateUser` | Supabase remains authoritative; `weak_password` and `same_password` handled safely; breached-password protection gates real-data use | FEAT-002-AC-07, FEAT-002-AC-08; FEAT-002-UNIT-04; FEAT-002-AUTH-03; FEAT-002-E2E-01 | Specified; runtime evidence and production plan control pending | Founder/Product Owner decision recorded; technical, security/privacy, and accessibility reviews pending |
| FEAT-002-06 | Password reset must end existing sessions and require fresh sign-in | Product and Governance Decisions section 5; Security Requirements section 3 | No-schema starting design; global refresh-session revocation, local cleanup, and sign-in redirect | Two clients, old refresh tokens/JWTs, auth bootstrap, and every browser Data API/RPC path tested; surviving access stops implementation for specification review | FEAT-002-AC-05, FEAT-002-AC-08, FEAT-002-AC-09, FEAT-002-AC-10; FEAT-002-UNIT-02; FEAT-002-COMP-02; FEAT-002-AUTH-04; FEAT-002-E2E-01; FEAT-002-REG-01 | Specified; runtime evidence pending and acceptance-blocking | Founder/Product Owner decision recorded; technical and security/privacy reviews pending |
| FEAT-002-07 | Partial provider/revocation failure must not create stale or privileged access | NFR-008/010; Security Requirements sections 3 and 15 | Fail-closed recovery state and operation-generation guard | No workspace on uncertainty; local state cleared; no password rollback; bounded safe retry/support path | FEAT-002-AC-10; FEAT-002-UNIT-02; FEAT-002-COMP-02; FEAT-002-AUTH-04 | Specified; not implemented or verified | Technical and security/privacy reviews pending |
| FEAT-002-08 | Security-sensitive credential changes require trustworthy evidence and user notification | IAM-007; REC-001/002/003; Security Requirements section 9 | Supabase Auth audit logs initially authoritative; version-controlled Mailpit password-changed notification; no assumed application audit migration | Exact event names/fields verified; missing evidence stops implementation; notification excludes password, token, organization, membership, role, and restricted data | FEAT-002-AC-11; FEAT-002-AUTH-05; FEAT-002-CONFIG-01 | Specified; runtime evidence pending | Founder/Product Owner decision recorded; security/privacy review pending |
| FEAT-002-09 | Recovery must resist flooding, bots, enumeration, and quota exhaustion | Security Requirements sections 3, 6, and 10 | 60-second synthetic per-user cooldown, provider-neutral CAPTCHA, duplicate guard, monitoring, future edge/WAF control if justified | Generic response retained under cooldown/provider/CAPTCHA failure; accessible fallback required; production limits await staging evidence | FEAT-002-AC-01, FEAT-002-AC-12; FEAT-002-UNIT-01; FEAT-002-UNIT-02; FEAT-002-COMP-01; FEAT-002-ABUSE-01 | Specified; runtime and staging evidence pending | Founder/Product Owner decision recorded; security/privacy and accessibility reviews pending |
| FEAT-002-10 | A multi-school identity must not expose or alter tenant context during recovery | IAM-002/003/010/011; architecture multi-tenancy boundary | Identity-scoped flow with no organization selection, lookup, branding, role routing, or membership write | Cross-tenant and multi-membership tests; no `organization_id` accepted or returned | FEAT-002-AC-13; FEAT-002-TENANT-01; FEAT-002-AUTH-01; FEAT-002-REG-01 | Specified; not implemented or verified | Security/privacy review pending |
| FEAT-002-11 | Recovery must be understandable, accessible, responsive, and safe offline | NFR-003/004; QA Plan sections 2 and 7 | Request, acknowledgement, explicit confirmation, password, invalid, failure, offline, and success states | Keyboard/focus/live-region behavior; no offline queue; secrets not retained; mobile/desktop coverage; CAPTCHA fallback | FEAT-002-AC-15; FEAT-002-COMP-01; FEAT-002-COMP-02; FEAT-002-COMP-03; FEAT-002-E2E-02 | Specified; human accessibility/UX evidence pending | Founder/Product Owner decision recorded; accessibility reviewer not assigned |
| FEAT-002-12 | Auth, email, redirect, rate, session, and notification behavior must be reproducible per environment | NFR-010/011; DevSecOps sections 4, 5, and 7 | Local/preview/production matrix; version-controlled local Auth configuration/templates or reviewed drift-detecting runbook | Exact loopback callbacks and synthetic Mailpit locally; separate environment origins/providers/secrets; hosted choices unresolved; no production data | FEAT-002-AC-03, FEAT-002-AC-11, FEAT-002-AC-12, FEAT-002-AC-14; FEAT-002-CONFIG-01; FEAT-002-SCAN-01 | Specified; hosted environment choices unresolved | Founder/Product Owner local decision recorded; technical, security/privacy, deployment, and production reviews pending |
| FEAT-002-13 | FEAT-002 must not weaken FEAT-001 login, MFA, audit, or tenant isolation | IAM-003/005/007/008/009/010; FEAT-001 specification | Bounded auth-recovery additions and full identity/security regression | Existing RLS/grants remain deny-by-default; no MFA bypass; no role or operational authority changes | FEAT-002-AC-05, FEAT-002-AC-09, FEAT-002-AC-13, FEAT-002-AC-14; FEAT-002-REG-01 | Specified; not implemented or verified | Independent technical and security/privacy reviews pending |
| FEAT-002-14 | Product-direction approval must not be mistaken for implementation or release evidence | QA Plan sections 7 and 9; production release gate | Explicit documentation-only boundary, reviewer-assignment status, open limitations, and evidence placeholders | No acceptance checkbox or trace result marked passed without reproducible runtime evidence; AI review and green CI are not human approval | Specification boundary and DoD review; PR diff and CI evidence for docs only | Specified; documentation PR evidence pending | Founder/Product Owner decision recorded; technical, security/privacy, accessibility, implementation, deployment, and production approvals remain pending |

## Unresolved gates

### Decisions required before implementation starts

| Gate | Required decision |
|---|---|
| Reviewer assignments | Assign technical, independent security/privacy, and accessibility reviewers and record their approvals of the specification and bounded synthetic-local implementation plan |
| Version baseline | Confirm the pinned Supabase CLI, Auth server, and JavaScript client versions for the authorized evidence spike |
| Environment boundary | Confirm local synthetic development only; no hosted environment, real data, implementation merge, or deployment is authorized |

### Runtime evidence required before implementation acceptance

| Gate | Required evidence |
|---|---|
| Recovery credential | Exact 3,600-second expiry, single use, replay, resend/supersession, wrong-purpose, and prefetch behavior on pinned versions; stop for specification review if a newer request leaves an older credential usable |
| Password policy | 15-character minimum, at-least-64-character support, spaces, paste, autofill, password managers, no composition rule, and safe `weak_password`/`same_password` handling |
| Session revocation | Two-client proof for old refresh tokens and access JWTs plus FEAT-001 bootstrap and every currently browser-accessible Data API/RPC path; stop for specification review if access survives |
| Non-enumeration and abuse | Eligible/unknown/suspended/banned/deleted/invited-unconfirmed/provider-only/rate-limited/provider-failure comparison, 60-second cooldown, CAPTCHA outcomes, timing distribution, and accessible fallback |
| Provider evidence and email | Exact Supabase Auth event names/fields/results plus version-controlled tenant-neutral Mailpit recovery and password-changed messages |
| Configuration | Exact loopback callbacks, recovery/security templates, credential expiry, password policy, cooldown, CAPTCHA boundary, session settings, and drift-detection evidence |

### Real-data pilot and production gates

| Gate | Required decision or evidence |
|---|---|
| Hosted environments | Production domain/redirects, hosting, Supabase plan/region/residency, separate resources, costs, and approval |
| Credentials and delivery | Production SMTP, sender identity/domain, final support address, delivery monitoring, CAPTCHA provider/keys, and contractual/privacy review |
| Security operations | Breached-password protection, project/IP/WAF limits, timing tolerances, monitoring thresholds, alerts, audit retention/export/log drains/access, alert routing, and ownership |
| Human recovery | Lost-mailbox recovery, MFA recovery codes, factor replacement, supervised identity proofing, administrator-assisted recovery, and formal account-compromise procedures |
| Human approvals | Technical, independent security/privacy, accessibility, deployment, and production approval with reproducible runtime evidence |

## Documentation-only review evidence

The FEAT-002 documentation pull request may record formatting, link/path inspection, secret scanning, repository checks, and independent diff review. Those checks validate only the documentation change. They do not satisfy any planned runtime test above and do not constitute Auth implementation, security/privacy approval, deployment, or production readiness.

## Evidence rules

- Update each row with exact commit/build, local or approved environment, Supabase/Auth configuration version, synthetic test data, automated/manual evidence link, tester, date, defects, and reviewer.
- Do not mark a row “Pass,” “Verified,” or “Approved” merely because this specification is complete or documentation CI is green.
- Use synthetic accounts from at least two organizations, including one identity with two memberships. Never use production/customer/student data, real credentials, or real recovery emails.
- Critical recovery, enumeration, token, session, audit, secret, and cross-tenant controls require independent human security review.
- Product acceptance remains separate from implementation review. Aviation-SME approval is required only if later scope introduces aviation authority or workflow behavior.
