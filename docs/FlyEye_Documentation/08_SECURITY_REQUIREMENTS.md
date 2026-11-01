# Security Requirements

## 1. Security objective

Prevent foreseeable attacks, detect abnormal behavior quickly, limit damage, preserve trustworthy records, recover within agreed objectives, and maintain evidence. No system is “fully secure”; production readiness is an evidenced risk decision.

Use current NIST SSDF and OWASP ASVS as secure-development and verification baselines, supplemented by current Philippine privacy guidance and an AI-specific standard when AI is enabled. Map exact control versions during implementation.

## 2. Threat priorities

Release-blocking threats include authentication bypass, cross-school data access, unauthorized record modification, incorrect authoritative calculations, sensitive-file exposure, audit failure/tampering, malicious uploads, secret leakage, destructive migration/data loss, compromised privileged accounts, insecure AI data flow, and unavailable recovery.

## 3. Identity and account controls

- Invitation-only registration and verified organization assignment
- Strong password/passkey policy and breached-password controls where supported
- TOTP/AAL2 mandatory for administrators, instructors, and any privileged, instructional, approval, safety, configuration, export, or access-management authority; student non-privileged portal access may use password-authenticated AAL1
- Email links/codes limited to mailbox verification and recovery, not privileged MFA; single-use recovery codes, audited factor replacement, supervised recovery, and throttling remain production requirements
- Login/reset throttling, non-enumerating responses, lockout/risk detection
- Secure session cookies, CSRF defense, session rotation, inactivity/absolute expiry, revocation; apply the explicit boundaries below
- Reauthentication for exports, role changes, record reopening, sensitive document access, configuration/limit changes, and support elevation; the personal-credential exception is defined in [Selected session policy](#selected-session-policy)
- Rapid deprovisioning and periodic access review

### Session-control applicability

These requirements remain mandatory. The local synthetic baseline does not establish
release compliance. [Session decisions](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md#session-control-decision-gate)
own unresolved choices; [session evidence](features/FEAT-001_TRACEABILITY.md#session-control-evidence)
records implementation observations and limitations. Do not silently replace a
requirement with current SDK behavior or provider defaults during refactoring.

| Control                               | Requirement and applicability                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESS-01` Storage, transport and CSRF | Resolve the secure-cookie requirement against the browser-managed bearer-token architecture before release approval. Record credential storage, request transport, XSS/token-theft exposure and CSRF defenses for each flow. Cookie attributes and CSRF checks apply wherever cookies authenticate requests; origin checks alone do not establish complete session protection. A different model or exception needs an explicit reviewed decision, and an ADR where architecture changes. |
| `SESS-02` Rotation                    | Verify refresh-token rotation and reuse/replay behavior against the pinned implementation and intended hosted configuration. Automatic refresh, a new access token, or library defaults alone do not prove the control. Never log tokens to collect evidence.                                                                                                                                                                                                                             |
| `SESS-03` Expiry                      | Define inactivity, absolute session lifetime, access-token lifetime and server enforcement explicitly. Distinguish user inactivity from background token refresh; an expiring JWT does not necessarily end a refreshable session. Document enforcement delay and test active/idle, sleeping/offline and multiple-tab behavior. Values remain a product/security decision, not an agent-selected constant.                                                                                 |
| `SESS-04` Revocation                  | Define termination events, session scope, enforcement point and acceptable delay. Verify ordinary logout, password recovery and membership/role changes separately. Distinguish refresh-token invalidation, issued access-token acceptance, server authorization and local UI cleanup. Recovery evidence cannot establish universal immediate logout revocation. Preserve stronger denial requirements already approved in feature contracts.                                             |
| `SESS-05` Recent authentication       | Preserve `IAM-005/006` and each approved feature's action-specific assurance, authentication method and freshness rules. A current session or AAL2 claim alone does not prove recent authentication. Apply the reauthentication requirement above to new sensitive operations; resolve unspecified freshness before implementation. Existing feature-specific windows are not a global idle or absolute-session policy.                                                                   |

Before an authorized hosted validation, its plan must identify the applicable
controls, target settings, unresolved tests and required reviewers. Validation may
supply missing evidence; it is not release approval. Unresolved decisions or failed
controls block real-data, pilot and production approval. This documentation does
not authorize a session redesign, hosted setting change or weaker feature contract.

### Selected session policy

This prospective policy selects product behavior for SESS-03–05; it does not
claim enforcement by the current implementation. Existing stricter feature
contracts remain, except for the explicit personal-credential exception below.
SESS-01 storage/transport and SESS-02 rotation/replay evidence remain release
gates. [Planned session tests](features/FEAT-009_TRACEABILITY.md#shared-session-verification-plan)
are not implementation results.

- Expire the application session after **45 minutes of inactivity** or **12
  hours from qualifying sign-in/reauthentication**, whichever comes first.
  Server time is authoritative, including after lock waits. At the deadline
  access is expired, with no grace. Activity extends only inactivity; token
  refresh, a new token issue time, reload or a new tab cannot reset the maximum.
- Activity means deliberate controls/clicks/taps, typing/editing, keyboard
  navigation, deliberate scrolling, opening/navigating records or Continue
  Session before expiry. Mouse movement alone, focus alone, quiet reading,
  polling, refresh, retries, background downloads, automatic scrolling and use
  of another application do not count. Report only activity fact/timing, never
  typed contents or browsing history. Late/offline signals cannot revive expiry.
- Tabs sharing the same authenticated session share activity/deadlines.
  Separately authenticated browsers/devices have independent timers. Hidden tabs
  must not generate synthetic activity. Resume/reconnect requires revalidation;
  a cross-tab message is not proof of authority. Timeout affects only its session;
  existing account-wide security/recovery revocation rules remain.
- Warn five minutes before either deadline (40 minutes idle or 11h55 maximum).
  Show one accessible warning for the earlier deadline, without focus theft or
  per-second announcements. Continue Session can extend an unexpired inactivity
  window; maximum expiry requires authentication. Warning display is not activity.
  Wake after expiry requires authentication, not a restarted warning period.
- Personal credential metadata/checklists/dates/status/notices may use Student
  AAL1. Evidence upload/preview/download requires current MFA: reuse the valid
  MFA-authenticated sign-in session or step up from AAL1. HoT/CFI approval and
  rejection likewise use a valid current MFA-authenticated session. There is **no
  separate evidence-viewing or credential-decision freshness timer**, and no
  additional recent-password prompt solely for those operations. This is an
  action-specific exception, not a claim that AAL2 proves recent authentication
  for other actions. Preserve existing shorter role/status-change requirements.
- Every protected operation still checks current membership, school, permission,
  assurance, ownership and state. Revocation wins over a valid session; no
  self-review or cross-school access is permitted by authentication alone.
- On expiry, clear protected records, evidence previews and file selections from
  the interface. Only allowlisted unsent text may remain hidden in the same tab's
  memory. Exclude passwords, MFA codes and file bytes; no localStorage, IndexedDB,
  server draft or cross-tab draft broadcast. Reload, tab close, explicit logout,
  account change or confirmed authorization denial clears it. Restore only after
  the same person/school passes fresh membership/permission checks and current
  server state is loaded; show conflicts without overwriting. Network failure or
  a mistyped password is not confirmed authorization denial.
- Never automatically submit, approve or reject after authentication. Committed
  actions persist; unknown outcomes require reconciliation before an explicit
  retry. Interrupted uploads require fresh ownership/lifecycle checks and file
  reselection where necessary; no automatic attachment or deletion.

Before enforcement implementation, resolve qualifying authentication and renewal
binding (including AAL1-to-MFA step-up), verified session identity, activity
coalescing/rate limits and the complete Edge/SQL/RPC/Storage/provider access-path
inventory. Prevent old tokens borrowing renewed deadlines; missing enforcement
state fails closed. Do not treat provider refresh-based inactivity as user
activity, or signed-link lifetime as current authorization. A failed mandatory
audit blocks the sensitive grant/action, but failure to log expiry cannot restore
access. Record applicable qualified review and remaining release risks.

## 4. Authorization and tenant isolation

Supabase RLS and protected Edge/PostgreSQL functions verify authentication, active membership, organization, permission, record assignment/scope, current state, and reauthentication. Every exposed table policy and protected function has positive and negative authorization tests. A School A user must not read, infer, search, modify, download, or export School B data.

Organization context must be applied to RLS, database constraints/functions, Storage object keys/policies, caches, jobs, notifications, reports, exports, and logs. Any cross-tenant result is a critical release blocker. User-editable metadata is not an authorization source, and service-role access is never exposed to the browser.

Each school uses an isolated application, Auth, database, Storage, secret, backup, and provider boundary. A deployment contains at most one organization and one membership per user; authentication derives that context without a selector. Organization Admin does not automatically receive operational, training, safety, quality, dispatch, assessment, or approval authority. The first administrator is bootstrapped through a protected audited process, membership and role changes require protected commands and recent authentication, and ordinary workflows cannot remove or demote the last active administrator.

Separation of duties is the default. Any future combination of roles must be explicit, necessary, MFA-protected, reauthenticated where appropriate, and audited. Detailed self-review, self-approval, delegation, and emergency-override rules require an approved permission matrix and qualified workflow review.

## 5. Data protection

- HTTPS/TLS, HSTS, secure headers, encrypted service connections
- Managed encryption at rest for Supabase database, Storage, backups, and developer devices
- Supabase service-role and provider secrets stored only in protected Edge Function/CI secret stores; publishable keys are not treated as authorization
- Separate development/staging/production resources and credentials
- No secrets in source, logs, build artifacts, images, or prompts
- No real customer or student data before the approved pilot, privacy, retention, reviewer, security, and recovery gates
- Sensitive exports encrypted/protected according to approved workflow

## 6. Web/API controls

- Parameterized Supabase clients and reviewed SQL functions; no unsafe dynamic SQL
- Output encoding and strict CSP; sanitize approved rich text only
- Anti-forgery protection; restrictive CORS
- Rate limiting on auth, reset, exports, downloads, AI, and expensive reports
- Server-enforced per-action abuse controls for protected Edge Functions using approved combinations of authenticated subject, safely derived network source, organization after authorization, failure pattern, and operation cost
- Provider quotas, platform/runtime resource limits, client counters, and disabled buttons are defense-in-depth only and do not satisfy FlyEye application-level rate limiting
- Safe non-enumerating `429` responses with bounded retry guidance; sensitive mutations fail closed if required limiter state is unavailable
- Request/body limits, timeouts, safe error responses, dependency timeouts/circuit behavior
- Managed frontend/edge protections, rate controls, and a WAF where the selected host/production risk warrants it
- Security headers and cache rules preventing sensitive browser/proxy caching
- SBOM and supported dependency policy

## 7. Supabase-specific controls

- Enable RLS on every table exposed through the Data API and begin with no permissive policies.
- Use separate staging and production projects, URLs, keys, buckets, and external-provider secrets.
- Never include the service-role key in frontend bundles, local screenshots, logs, documentation examples containing real values, or AI prompts.
- Restrict direct client writes to explicitly approved draft operations; revoke status, approval, finalization, role, and audit-field writes.
- Test `USING` and `WITH CHECK` behavior for every policy and action.
- Review security-definer functions, views, triggers, and Storage policies as privileged code.
- Do not trust `user_metadata` or stale client claims for roles or organization membership.
- Monitor administrative changes made through the Supabase dashboard and require migrations for durable schema/policy changes.

## 8. File security

Allowlisted formats; validate signature not extension; generated object names; private staged storage; size/page/dimension limits; cryptographic hash; malware scan/quarantine; no execution; safe rendering/download headers; short-lived authorized links; metadata minimization; soft delete/versioning; logged access. Unscanned or failed files cannot become trusted record attachments.

Supabase Storage buckets holding operational records are private and governed by RLS. Database backup success does not prove Storage object recoverability; maintain and test a separate object backup/export and reconciliation procedure.

## 9. Audit and security logging

Operational audit and cybersecurity logs are separate concepts. Record logins, MFA, denials, tenant violations, exports, downloads, malware results, admin/support access, configuration/secret changes, WAF/rate events, jobs, backups, and audit-write failures.

Never log passwords, cookies, tokens, secrets, full restricted documents, or unredacted AI prompts. Protect access, integrity, retention, and time synchronization. Failure to record a mandatory audit event blocks the sensitive action.

## 10. Monitoring and alerts

Alert on unavailability, error spikes, repeated privileged login failures, tenant violations, unusual exports/downloads, database exhaustion, failed backups/restores, deletion spikes, malware detections, audit failures, production configuration changes, background job failures, and abnormal AI use. Define on-call ownership and test each alert.

## 11. Backup and disaster recovery

Initial targets: RPO ≤1 hour and RTO ≤8 hours—subject to the selected Supabase plan, frontend/storage provider capability, cost, and contract. Use an appropriate paid database backup/PITR plan, separately protected Storage objects, version-controlled migrations, restricted backup access, quarterly isolated database-and-object restore drills, and post-restore consistency checks.

Targets are commitments only after successful drills prove them.

## 12. Incident response

Before real data, establish incident commander, technical lead, DPO/privacy lead, customer liaison, legal adviser, aviation representative, and evidence recorder. The runbook covers detection, classification, containment, credential revocation, evidence preservation, scope, customer/DPO notification, legal notification assessment, recovery, monitoring, root cause, and corrective action.

The responsible controller/DPO assesses Philippine breach reporting. FlyEye contracts must notify customers fast enough to meet their obligations.

## 13. AI security

- Task-specific endpoints only; no unrestricted production-data chat
- Permission check and purpose limitation before context assembly
- Redaction/minimization and enterprise provider terms
- Uploaded/user content treated as untrusted prompt material
- Structured output schema, length/content limits, and output validation
- No tools or credentials capable of changing operational status
- Human review and acceptance logging
- Quality, leakage, abuse, latency, and cost monitoring
- Provider outage isolation and kill switch

## 14. Security verification

Required before pilot: threat model, Supabase configuration and RLS review, SAST, secret and dependency scanning, SQL/policy/function authorization tests, Edge Function and cross-tenant integration tests, DAST on staging, file-upload tests, database-and-object restore, incident tabletop, and internal security review. Required before unrestricted commercial release: independent penetration test and closure/risk acceptance for findings.

## 15. Severity and gate

| Severity | Example                                                                             | Release rule                                  |
| -------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| Critical | Auth bypass, cross-tenant access, RCE, data loss, wrong W&B result                  | Block                                         |
| High     | Unauthorized change, exposed restricted file, missing audit, exploitable dependency | Block unless eliminated; no routine waiver    |
| Medium   | Limited non-critical inconsistency or information leak                              | Fix or documented owner/time-bound acceptance |
| Low      | Cosmetic/security hardening issue                                                   | Backlog with owner                            |

See [DevSecOps Guide](10_DEVSECOPS_GUIDE.md), [QA Plan](11_QA_TEST_PLAN.md), and [Production Release Checklist](templates/PRODUCTION_RELEASE_CHECKLIST.md).
