# Security Requirements

## 1. Security objective

Prevent foreseeable attacks, detect abnormal behavior quickly, limit damage, preserve trustworthy records, recover within agreed objectives, and maintain evidence. No system is “fully secure”; production readiness is an evidenced risk decision.

Use current NIST SSDF and OWASP ASVS as secure-development and verification baselines, supplemented by current Philippine privacy guidance and an AI-specific standard when AI is enabled. Map exact control versions during implementation.

## 2. Threat priorities

Release-blocking threats include authentication bypass, cross-school data access, unauthorized record modification, incorrect authoritative calculations, sensitive-file exposure, audit failure/tampering, malicious uploads, secret leakage, destructive migration/data loss, compromised privileged accounts, insecure AI data flow, and unavailable recovery.

## 3. Identity and account controls

- Invitation-only registration and verified organization assignment
- Strong password/passkey policy and breached-password controls where supported
- MFA mandatory for every user before real-data pilot or production access
- TOTP as the initial MFA method, with single-use recovery codes, audited factor replacement, supervised recovery, and throttling; SMS is not the primary method
- Login/reset throttling, non-enumerating responses, lockout/risk detection
- Secure session cookies, CSRF defense, session rotation, inactivity/absolute expiry, revocation
- Reauthentication for exports, role changes, record reopening, sensitive document access, configuration/limit changes, and support elevation
- Rapid deprovisioning and periodic access review

## 4. Authorization and tenant isolation

Supabase RLS and protected Edge/PostgreSQL functions verify authentication, active membership, organization, permission, record assignment/scope, current state, and reauthentication. Every exposed table policy and protected function has positive and negative authorization tests. A School A user must not read, infer, search, modify, download, or export School B data.

Organization context must be applied to RLS, database constraints/functions, Storage object keys/policies, caches, jobs, notifications, reports, exports, and logs. Any cross-tenant result is a critical release blocker. User-editable metadata is not an authorization source, and service-role access is never exposed to the browser.

One person may have separate memberships in multiple organizations, but each membership has independent tenant and role context. Organization Admin does not automatically receive operational, training, safety, quality, dispatch, assessment, or approval authority. The first administrator is bootstrapped through a protected audited process, membership and role changes require protected commands and recent authentication, and ordinary workflows cannot remove or demote the last active administrator.

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

| Severity | Example | Release rule |
|---|---|---|
| Critical | Auth bypass, cross-tenant access, RCE, data loss, wrong W&B result | Block |
| High | Unauthorized change, exposed restricted file, missing audit, exploitable dependency | Block unless eliminated; no routine waiver |
| Medium | Limited non-critical inconsistency or information leak | Fix or documented owner/time-bound acceptance |
| Low | Cosmetic/security hardening issue | Backlog with owner |

See [DevSecOps Guide](10_DEVSECOPS_GUIDE.md), [QA Plan](11_QA_TEST_PLAN.md), and [Production Release Checklist](templates/PRODUCTION_RELEASE_CHECKLIST.md).
