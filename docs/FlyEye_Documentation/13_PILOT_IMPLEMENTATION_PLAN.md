# Pilot Implementation Plan

## 1. Purpose

Validate product usefulness, usability, data quality, reliability, security, workflow fit, and commercial interest in a controlled flight-school setting without prematurely replacing the school's approved official process. A potential school has been identified but remains anonymous until an approved proposal and written participation are established.

## 2. Proposed scope

| Element | Target |
|---|---:|
| Flight school | 1 |
| Duration | 8 weeks |
| Students | ≥10 |
| Instructors | ≥3 |
| Operations users | ≥1 |
| Head of Training/admin | ≥1 |
| Aircraft | ≥2 |
| Course | PPL first; CPL, IR, MER, and other stages later |
| Completed records/assessments | ≥75 |

## 3. Preconditions

- Signed pilot and data-processing agreements
- Named sponsor, CFI/SME, DPO/privacy, quality, operations, and technical contacts
- Approved pilot scope, success metrics, official/parallel process, and stop criteria
- Completed UAT, security, privacy, backup/restore, incident, monitoring, and support readiness
- Configured users, aircraft, documents, courses, permissions, sources, and retention
- No unresolved critical or high release-blocking defect
- Synthetic setup and rehearsal data only until the real-data privacy, agreement, retention, reviewer, access, and security/recovery gates pass
- If minors participate, approved guardian authority or consent, notices, safeguarding, access, retention, correction, and rights procedures

## 4. Baseline study

Measure at least 20 representative records where feasible: preparation time, review time, incomplete fields, returns/corrections, retrieval time, assessment completion delay, expiry incidents, and training gaps. Define numerator, denominator, exclusions, observer, and sampling before comparing FlyEye.

## 5. Stages

| Stage | Indicative duration | Activity |
|---|---:|---|
| Configuration/readiness | 1 week | Data setup, access review, scenario rehearsal, go/no-go |
| User training | 2–3 days | Role-based hands-on training and support contacts |
| Parallel operation | 2–4 weeks | FlyEye alongside approved existing process |
| Controlled expansion | 3–5 weeks | Add users/records after review of issues |
| Evaluation | Final week | Metrics, SUS, interviews, defects, lessons, decision |

## 6. Training

Separate sessions for students, instructors, operations, training management, quality/admin, and support. Cover responsibilities, source/freshness, record states, returns/amendments, offline limitations, security/MFA, privacy, incident reporting, AI limitations if enabled, and what remains the official process.

MFA is required for every pilot user before real-data access. TOTP is the initial method; production-ready recovery codes, factor replacement, supervised recovery, and support procedures must be rehearsed before the pilot.

## 7. Support and incident operations

Provide business-hours support plus emergency escalation appropriate to pilot risk, a status/communication channel, issue severity definitions, workarounds, audit-preserving correction process, provider contacts, and rollback/stop plan. Do not let ad-hoc support bypass permissions or edit production data manually.

## 8. Metrics

| Area | Proposed target |
|---|---|
| Data quality | ≥80% reduction in incomplete/inconsistent required entries |
| Efficiency | ≥30% reduction in median documentation processing time |
| Usability | SUS ≥78; ≥95% critical-task success before commercial release |
| Adoption | ≥80% registered pilot users active weekly; ≥85% eligible assessment adoption |
| Reliability | ≥99% availability excluding approved maintenance; zero lost accepted records |
| Traceability | 100% significant state/approval actions audited |
| Satisfaction | ≥80% willing to continue, measured with question/method documented |

Targets are provisional until baselines and the school’s workflow are agreed.

## 9. Stop/rollback criteria

Immediately pause affected use for cross-tenant exposure, unauthorized approval/change, data loss/integrity uncertainty, incorrect authoritative calculation, restricted-file exposure, unavailable official process, unresolved audit failure, or credible safety concern. Follow incident and evidence-preservation procedures.

## 10. Evaluation and decision

Produce metric definitions/results, qualitative findings by role, defect/incident summary, security/privacy/recovery observations, workflow deviations, requested changes categorized as configuration/core/custom/out-of-scope, cost/support findings, and go/revise/stop recommendation.

Commercial transition requires stable release, customer acceptance of process change, support/SLA and pricing, privacy/security contract readiness, onboarding/offboarding, and a case study only with permission.
