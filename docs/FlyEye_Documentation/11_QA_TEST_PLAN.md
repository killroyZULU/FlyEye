# QA and Test Plan

## 1. Quality objective

Prove that FlyEye performs approved workflows correctly, protects tenant and personal data, preserves trustworthy records, handles exceptions and weak connectivity, recovers from failure, and remains usable by actual flight-school roles. Passing tests are evidence, not an automatic claim of aviation correctness or production approval.

## 2. Test levels

| Level | Focus |
|---|---|
| Unit | Domain rules, calculation, expiry, state transitions, validation |
| Property/boundary | Envelope limits, dates, units, rounding, statuses |
| Mutation | Strength of safety-relevant calculation/rule tests |
| Component | Forms, states, accessibility, client behavior |
| Integration | Supabase Auth, Data API, PostgreSQL functions, Edge Functions, Storage, PDF, providers |
| Authorization | Every RLS policy, Edge/RPC command, role/permission/record scope, positive and negative |
| Tenant isolation | School A attempts all direct and protected read/write/search/download/export paths on School B |
| Contract | Generated database types and Edge Function request/response schema compatibility |
| End-to-end | Complete role workflows through browser and API |
| Security | Injection, XSS, CSRF, auth/session, upload, abuse, DAST |
| Privacy | Export, correction, retention, deletion/blocking workflows |
| Offline/sync | Loss, retries, duplicates, conflicts, stale data, queued files |
| Performance | Concurrent sessions, dashboards, submission, PDF/export, jobs |
| Recovery | Backup restore, integrity, RPO/RTO measurement |
| Usability/UAT | Realistic users, tasks, errors, terminology, acceptance |
| AI | Accuracy, hallucination, prompt injection, leakage, schema/failure behavior |

## 3. Test environments and data

Automated tests use isolated synthetic tenants and deterministic data in local or dedicated test Supabase environments. Staging contains realistic but synthetic/anonymized scenarios. Production data is not copied into development. Test data must include at least two organizations, overlapping names/IDs, multiple roles, expired/current documents, concurrent revisions, boundary calculations, and adversarial files/text.

## 4. Critical scenarios

- Expired aircraft document, medical, licence, or qualification
- Instructor not authorized/assigned for the selected activity
- Missing loading value; exact weight/CG boundary; invalid unit/configuration version
- Record returned, resubmitted, approved, cancelled, and reopened
- Aircraft/configuration changes between draft and submission
- Duplicate/idempotent submit; two reviewers race; stale version
- Connectivity loss during edit/upload and sync conflict
- Finalized assessment reopened; student tries to edit instructor result
- AI suggestion rejected/unavailable/maliciously prompted
- Audit write fails; backup restore; provider outage
- Valid user from another tenant tries list/search/direct ID/file/export access

## 5. Weight-and-balance verification

Every formula and unit has a documented approved source. Verify representative and boundary examples with qualified aviation personnel. Use decimal arithmetic, explicit rounding, snapshot reproduction, property tests, and mutation testing. Changes to engine/configuration schema require aviation-SME and technical review.

## 6. Performance test baseline

Before commercial pilot, rehearse approximately 100 authenticated sessions, 50 concurrent dashboard reads, 25 record submissions, 20 document-generation requests, and representative data such as 10,000 dispatch records, 25,000 assessments, and 100,000 audit entries. Tune these scenarios to measured usage and infrastructure; they are starting targets, not capacity guarantees.

## 7. Entry and exit criteria

Feature test entry: approved specification, traceable acceptance criteria, deployable build, migration/test data, and known dependencies.

Feature exit: automated checks pass; critical manual scenarios pass; RLS, protected functions, permissions, tenancy, Storage and audit are verified; no unresolved blocker; docs/traceability updated; product acceptance; aviation acceptance where relevant.

Pilot release exit additionally requires security review, recovery drill, incident tabletop, UAT approval, monitoring/alerts, support runbooks, and signed pilot readiness.

## 8. Defect severity

| Severity | Definition | Action |
|---|---|---|
| Critical | Data loss, wrong authoritative result, auth bypass, cross-tenant access, RCE, unsafe workflow authority | Stop release/pilot; immediate triage |
| High | Unauthorized change, exposed restricted data, broken audit, core workflow unavailable, exploitable high issue | Block release |
| Medium | Recoverable workflow/reporting/permission inconsistency with limited impact | Fix or time-bound accepted plan |
| Low | Cosmetic/copy/minor inconvenience | Prioritized backlog |

## 9. Test evidence

Store requirement ID, test ID, build/commit, Supabase/frontend environment identifiers, migration version, preconditions/data, steps or automated test link, expected/actual result, artifacts, tester, date, defect link, and reviewer. Evidence must be reproducible and privacy-safe.

## 10. Pilot quality metrics

- No critical defects and no unresolved exploitable high vulnerability
- Zero cross-tenant access and lost accepted records
- 100% significant workflow transitions audited
- ≥95% critical-task success before commercial release
- SUS ≥78
- ≥99% pilot availability excluding approved maintenance
- ≥80% reduction in incomplete/inconsistent required fields
- ≥30% reduction in median documentation-processing time
- ≥90% eligible assessments completed within 24 hours (subject to pilot agreement)

## 11. Responsibility

AI may generate tests and review suggestions. Humans approve the test strategy, verified sources, aviation scenarios, security risk, UAT, and production release. The implementation agent must not be the only reviewer of its own tests.
