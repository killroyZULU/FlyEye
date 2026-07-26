# Project Charter

## Project title

FlyEye Aviation Training Operations Platform

## Sponsor and governance

The potential pilot flight school remains anonymous until an approved proposal is prepared. Its sponsor and named Head of Training/CFI are to be confirmed. The product owner/project manager is identified as the Founder/Product Owner without a personal name. Aviation, privacy, security, legal, customer, and production approval cannot be self-certified by the developer alone.

## Purpose

Continue the former capstone as a secure digital platform that can be validated, built, piloted, and eventually offered commercially to Philippine flight schools. It should reduce incomplete flight-training operational records, improve processing and retrieval, support competency-oriented assessment, and create trustworthy audit evidence.

## SMART overall goal

By 31 July 2027, design, develop, test, and complete an eight-week controlled pilot of the FlyEye MVP at one Philippine flight school, supporting at least 10 student pilots, 3 instructors, 1 operations user, 2 aircraft, and 75 completed training-flight records, while reducing incomplete required fields by at least 80%, reducing median documentation-processing time by at least 30%, achieving an SUS score of at least 78, and maintaining at least 99% availability excluding approved maintenance.

Targets must be baselined and approved during discovery.

## Supporting objectives

| ID | Objective | Target |
|---|---|---|
| OBJ-01 | Validate the problem | 12 stakeholder interviews across ideally 3 schools |
| OBJ-02 | Map the pilot workflow | 100% of agreed steps from preparation through archive |
| OBJ-03 | Validate UX | ≥85% unassisted critical-task success in prototype testing |
| OBJ-04 | Prevent incomplete submissions | Server-side validation for 100% of configured required fields |
| OBJ-05 | Improve data quality | ≥80% reduction in incomplete/inconsistent required entries |
| OBJ-06 | Improve efficiency | ≥30% reduction in median preparation/review processing time |
| OBJ-07 | Demonstrate training records | ≥75 completed lesson assessments during pilot |
| OBJ-08 | Maintain traceability | 100% of significant state/approval/change actions audited |
| OBJ-09 | Establish usability | SUS ≥78; all critical usability issues resolved |
| OBJ-10 | Establish reliability | ≥99% pilot availability; zero lost accepted records |
| OBJ-11 | Preserve human authority | Zero autonomous dispatch, airworthiness, or competency decisions |
| OBJ-12 | Validate market interest | 1 written pilot agreement and 2 additional expressions of interest |

## In scope for MVP

- Organization and tenant-aware platform foundation
- Invitation accounts, authentication, permissions, and audit trail
- Aircraft/personnel profiles, document metadata, private uploads, expirations
- Dispatch drafts, review state machine, deterministic validation, final snapshot/PDF
- Versioned weight-and-balance configuration and calculation
- Structured weather/NOTAM capture with source/freshness evidence
- Course, lesson, competency, assessment, remediation, and progression records
- Basic reports, notifications, exports, backups, monitoring, and support procedures
- Limited offline draft capture after online workflows stabilize

## Out of scope for MVP

- Autonomous GO/NO-GO or airworthiness release
- Full scheduling optimizer, billing, accounting, MRO work orders, or airline operations
- Safety-management suite and flight-data debrief module
- Predictive student performance or cancellation models
- Native Flutter/mobile client
- Direct CAAP integration without official authorization
- Customer-specific hard-coded forks

## Delivery approach

Hybrid Stage-Gated Agile, two-week sprints, human-centered discovery, compliance/safety/privacy/security by design, bounded product modules, and ADDIE-aligned training-system thinking. Implementation is contract-first and vertical-slice based on the lean React/TypeScript + Supabase architecture in ADR-0005.

## Indicative lifecycle

| Phase | Indicative window | Exit evidence |
|---|---|---|
| Initiation | Jul–Aug 2026 | Approved charter, preliminary scope/risk/stakeholders |
| Discovery | Aug–Sep 2026 | Confirmed problem, workflows, forms, baselines |
| Requirements/compliance | Sep–Oct 2026 | SME/customer-approved requirements and traceability |
| UX/system design | Oct–Nov 2026 | Tested prototype and accepted architecture |
| Technical foundation | Nov–Dec 2026 | Deployable shell, auth, database, audit, CI/CD |
| MVP delivery | Jan–Mar 2027 | Critical requirements implemented and traceable |
| Verification/validation | Mar–May 2027 | Release candidate with no critical defects |
| Controlled pilot | May–Jul 2027 | PPL-first pilot evidence and agreed metrics |
| Commercial decision | Jul 2027 | Go/revise/stop decision and roadmap |

Dates are planning assumptions and should be rebaselined when a pilot school and team capacity are confirmed.

## Roles

| Role | Accountability |
|---|---|
| Project sponsor | Pilot authorization, resources, escalation |
| Product owner | Vision, prioritization, acceptance, commercial direction |
| Project manager | Scope, schedule, risks, communication, gates |
| Technical lead | Architecture, engineering quality, deployment |
| Aviation SME / CFI | Operational and training validity |
| Quality/compliance reviewer | Record, procedure, audit, traceability review |
| Privacy/DPO reviewer | Privacy roles, PIA, rights, breach obligations |
| Security reviewer | Threat model, controls, penetration/release review |
| User representatives | Prototype, UAT, pilot feedback |

## Stage gates

| Gate | Minimum criterion |
|---|---|
| G1 Problem validation | At least one school confirms value and continued participation |
| G2 Requirements | Aviation SME and school representative approve critical requirements |
| G3 Design | ≥85% critical-task success; critical workflow issues addressed |
| G4 Feature completion | Critical MVP requirements implemented and traced to tests |
| G5 Pilot readiness | No critical defect; security, isolation, audit, backup and recovery pass |
| G6 Pilot success | Agreed operational/adoption/usability targets met or corrective plan accepted |
| G7 Commercial readiness | Stable service, contracts, support, pricing, security/privacy evidence |

## Constraints and assumptions

- Development is likely solo/small-team and heavily AI-generated.
- Aviation and privacy interpretation needs qualified review.
- Connectivity and device quality may vary by location.
- The pilot continues the school’s approved process in parallel until formally changed.
- The architecture targets pilot to early commercial scale, not airline-scale infrastructure.

## Approval

Approval names, dates, version, and conditions must be recorded here before Gate 2 and updated at material scope changes.
