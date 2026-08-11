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

Automated tests use synthetic data in local or dedicated test Supabase environments. Committed runtime fixtures obey the one-school deployment invariant. Cross-school adversarial cases use rollback-only database transactions or separate isolated test deployments. Test data also covers overlapping names/IDs, multiple roles, expired/current documents, concurrent revisions, boundary calculations, and adversarial files/text. Production data is not copied into development.

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

Feature publication exit: automated checks pass; applicable synthetic browser
scenarios pass; RLS, protected functions, permissions, tenancy, Storage, and
audit are verified; separate-agent review findings are corrected; no unresolved
hard stop remains; and docs/traceability are updated. Aviation or other
qualified-human acceptance is required only for the regulated or formal claim it
covers, not for ordinary local feature publication.

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

Detailed evidence is stored or referenced once. Later reports may summarize it when the branch, HEAD, complete working-tree content hashes, dependencies, configuration, and evidence are unchanged. After a correction, run focused affected checks and then one final required verification matrix; do not repeat the full matrix again without a review-target change.

### Verification tiers

Use three explicit tiers so failures do not create unnecessary full-matrix runs
or Founder/Product Owner prompts:

1. **Focused:** the smallest checks proving an implementation or correction.
2. **Feature:** all feature-specific unit, component, SQL/RLS, handler, runtime,
   tenant, replay/concurrency, accessibility-supporting, privacy, and secret
   evidence required by the approved specification.
3. **Final matrix:** the complete application and database quality gates once
   the review target is stable.

During an approved local-delivery envelope, a failed check returns to focused
diagnosis and correction automatically. Run affected focused checks, then the
feature tier if needed, and only one final matrix after the implementation and
evidence stabilize. Ask the Founder/Product Owner for another decision only if
the failure reveals a material stop condition, requires scope or authority
expansion, or cannot be resolved safely inside the envelope.

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

AI may generate tests and perform a separate agent review. For bounded local
changes, that review plus required automated verification is the default
technical and Git-publication gate; the implementation context must not be the
only reviewer of its own tests. An agent review is not qualified independent
human review and cannot grant formal regulated acceptance, merge, deployment,
real-data use, or production approval.

Human escalation is required when a material defect or specification conflict
cannot be corrected safely inside the bounded outcome; required evidence is
unavailable; an unsupported aviation-authoritative or operational-safety rule is
needed; or a regulated, legal, real-data, hosted, production,
penetration-test, or formal-compliance claim inherently requires a qualified
person. A local synthetic schema, migration, RLS, grant, role, membership,
tenant-authority, privileged-function, security, privacy, or
accessibility-supporting change does not trigger human review by category alone;
it must instead pass the applicable automated negative/tenant evidence and
separate-agent review.
