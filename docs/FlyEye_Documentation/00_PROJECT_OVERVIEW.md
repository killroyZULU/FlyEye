# Project Overview

## Vision

FlyEye will be a Philippine-built digital flight-training operations platform that helps flight schools and ATOs manage structured preflight records, dispatch review, personnel and aircraft compliance, CBTA-oriented training assessments, student progression, audit evidence, and operational reporting.

## Problem

Flight-training organizations may rely on paper, spreadsheets, chat messages, shared drives, or disconnected tools. This can make it difficult to detect incomplete records, control revisions, retrieve historical evidence, monitor expirations, compare training performance, and understand operational bottlenecks. FlyEye aims to improve those workflows without pretending to replace authorized aviation judgment.

## Target market and users

The initial market is Philippine general aviation flight schools and ATOs. The product must remain configurable because school forms, approval routes, syllabi, terminology, fleet composition, and operating conditions differ.

| User | Primary outcomes |
|---|---|
| Student pilot | Prepare drafts, submit required information, see returns and progress |
| Flight instructor | Review assigned records, assess lessons, document remediation |
| Dispatcher/operations | Check current operational and compliance information |
| Head of Training/CFI | Monitor progression, recurring weaknesses, and instructor consistency |
| Quality/safety personnel | Retrieve controlled evidence, deviations, actions, and audit history |
| School administrator | Configure users, permissions, aircraft, documents, courses, and forms |
| Platform support | Operate the service through controlled, time-limited, audited access |

## Product positioning

> A localized, configurable, CAAP-aligned-by-design operations and training platform for Philippine flight schools—subject to formal validation by each customer and qualified aviation personnel.

“Aligned-by-design” means the system supports traceability, controlled records, training-data collection, human approvals, and configurable workflows. It is not a claim of approval or compliance certification.

## Product modules

| Module | Purpose | MVP status |
|---|---|---|
| Platform Core | Identity, organizations, permissions, files, notifications, audit | Required |
| FlyEye Dispatch | Draft, validation, review, return, approval, archive, post-flight entry | Required |
| FlyEye Training | Course structures, competency assessment, remediation, progression | Required |
| Compliance Records | Aircraft/personnel documents, qualifications, expiry monitoring | Required |
| Reporting | Operational, training, compliance, and audit reports | Basic MVP |
| FlyEye Safety | Hazard reports, risk, corrective action, trend analytics | Later release |
| FlyEye Scheduling | Aircraft, instructor, student, qualification, and restriction scheduling | Later release |
| FlyEye Debrief | Flight-track replay and instructor-reviewed analysis | Long-term |

## Differentiators

- Philippine market and terminology focus
- Local support and peso-based commercial model
- Configurable school workflows rather than hard-coded custom forks
- Mobile-friendly and weak-connectivity-aware operation
- Auditable record state, revision, and approval history
- Human-supervised AI assistance layered over structured data
- Gradual paper-to-digital migration with a controlled parallel pilot

## What FlyEye is not

- An autonomous dispatcher or GO/NO-GO authority
- An aircraft airworthiness release system
- A replacement for current official weather, NOTAM, aircraft, or personnel sources
- A CAAP database integration unless an official interface and authorization exist
- A full MRO, accounting, airline operations, or flight-control system in the MVP
- A general AI model trained on customer data by default

## Success definition

The proposed overall SMART goal is to complete an eight-week controlled pilot by **31 July 2027** at one Philippine flight school with at least 10 students, 3 instructors, 1 operations user, 2 aircraft, and 75 completed training-flight records; reduce incomplete required fields by at least 80%; reduce median documentation processing time by at least 30%; achieve a System Usability Scale score of at least 78; and maintain at least 99% pilot availability excluding approved maintenance.

All numerical targets are provisional until discovery establishes baselines and a pilot organization accepts the measurement method.

## Guiding principle

> Build deterministic operational reliability first, structured training data second, and AI third.

See [Project Charter](02_PROJECT_CHARTER.md), [Product Requirements](03_PRODUCT_REQUIREMENTS_SRS.md), and [Product Roadmap](14_PRODUCT_ROADMAP.md).

