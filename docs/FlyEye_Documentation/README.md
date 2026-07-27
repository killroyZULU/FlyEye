# FlyEye Aviation Training Operations Platform

Professional project documentation for a Philippine-built, web-first platform serving general aviation flight schools and Approved Training Organizations (ATOs).

## Purpose

This repository is the canonical context package for product planning, AI-assisted implementation, aviation-domain review, quality assurance, security review, pilot preparation, and handoff to another developer or LLM. It describes a proposed product; it does **not** claim regulatory approval, CAAP certification, or production readiness.

## Product in one sentence

FlyEye is a multi-tenant, responsive Progressive Web App (PWA) that digitizes flight-school dispatch, training assessment, compliance records, and operational reporting while keeping all safety-critical decisions under authorized human control.

## Start here

1. [Project Overview](00_PROJECT_OVERVIEW.md)
2. [Master Handoff](01_MASTER_HANDOFF.md)
3. [Project Charter](02_PROJECT_CHARTER.md)
4. [Product Requirements / SRS](03_PRODUCT_REQUIREMENTS_SRS.md)
5. [System Architecture](04_SYSTEM_ARCHITECTURE.md)
6. [Implementation and AI Development Guide](09_AI_DEVELOPMENT_GUIDE.md)

## Document index

| Document | Purpose |
|---|---|
| [00 Project Overview](00_PROJECT_OVERVIEW.md) | Concise business and product orientation |
| [01 Master Handoff](01_MASTER_HANDOFF.md) | Full context for a new human or AI collaborator |
| [02 Project Charter](02_PROJECT_CHARTER.md) | Governance, SMART goals, scope, stakeholders, and gates |
| [03 Product Requirements (SRS)](03_PRODUCT_REQUIREMENTS_SRS.md) | Functional, non-functional, safety, and acceptance requirements |
| [04 System Architecture](04_SYSTEM_ARCHITECTURE.md) | Web-first PWA, Supabase platform, tenancy, offline, and hosting design |
| [05 Database Design](05_DATABASE_DESIGN.md) | Relational model, record control, tenancy, and audit principles |
| [06 API Specification](06_API_SPECIFICATION.md) | REST conventions, resources, workflows, errors, and authorization |
| [07 UI/UX Guidelines](07_UI_UX_GUIDELINES.md) | Workflow-first responsive interaction and design-system guidance |
| [08 Security Requirements](08_SECURITY_REQUIREMENTS.md) | Security controls, threat model, identity, isolation, and incident response |
| [09 AI Development Guide](09_AI_DEVELOPMENT_GUIDE.md) | Specification-driven vibe coding and vertical-slice workflow |
| [10 DevSecOps Guide](10_DEVSECOPS_GUIDE.md) | Source control, CI/CD, scanning, environments, release, and monitoring |
| [11 QA and Test Plan](11_QA_TEST_PLAN.md) | Verification strategy, release gates, test evidence, and defect severity |
| [12 Privacy and Data Protection](12_PRIVACY_DATA_PROTECTION.md) | Philippine privacy roles, minimization, retention, rights, and AI privacy |
| [13 Pilot Implementation Plan](13_PILOT_IMPLEMENTATION_PLAN.md) | Controlled flight-school pilot, parallel operation, training, and metrics |
| [14 Product Roadmap](14_PRODUCT_ROADMAP.md) | Evidence-gated delivery sequence and future modules |
| [15 Risk Register](15_RISK_REGISTER.md) | Product, technical, safety, security, delivery, and commercial risks |
| [16 Change Log](16_CHANGE_LOG.md) | Documentation and decision history |
| [17 Product and Governance Decisions](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md) | Founder-approved commercial, membership, security, privacy, pilot, hosting, and scope direction |
| [FEAT-002 Password Recovery](features/FEAT-002_PASSWORD_RECOVERY.md) | Bounded local synthetic implementation, correction, agent review, automated verification, focused human desktop walkthrough, and Founder/Product Owner local MVP acceptance are complete; Git publication of the feature branch and a draft pull request is authorized, while merge, hosted validation, deployment, real-data, and production gates remain pending |
| [FEAT-002 Traceability](features/FEAT-002_TRACEABILITY.md) | Password-recovery requirements, corrected local automated evidence, risk-based review record, unresolved accessibility judgment, and separate Founder/Product Owner gates |
| [ADR index](adr/README.md) | Accepted architecture decisions and ADR template |
| [Feature Specification template](templates/FEATURE_SPECIFICATION_TEMPLATE.md) | Required format for every implementation slice |
| [Traceability template](templates/REQUIREMENTS_TRACEABILITY_TEMPLATE.md) | Need-to-requirement-to-test evidence |
| [Release checklist](templates/PRODUCTION_RELEASE_CHECKLIST.md) | Human-approved production gate |

## Canonical decisions

- Product form: responsive web application with PWA capabilities; native mobile is deferred.
- Frontend: React + TypeScript with Vite and PWA capabilities; add only the UI/form libraries that a validated feature needs.
- Platform: Supabase Auth, PostgreSQL, private Storage, Row-Level Security, and Edge Functions.
- Data: relational PostgreSQL records plus private object storage for uploaded/generated files.
- Architecture: lean backend-as-a-service design with bounded feature modules and authoritative server-side commands.
- Deployment baseline: managed static frontend hosting plus separate Supabase staging and production projects.
- Delivery method: hybrid Stage-Gated Agile using contract-first, specification-driven AI implementation.
- AI policy: advisory only, permission-aware, reviewable, optional, and unable to approve dispatch, airworthiness, or competency.
- Safety rule: deterministic business rules and authoritative calculations precede AI assistance.
- Governance: the founder is the unnamed product owner; risk-based agent review is the default bounded-local technical gate, while explicit human escalation and aviation, privacy, security, legal, customer, and production approval duties remain risk- and lifecycle-based.
- Commercial direction: evolve the capstone into a licensable Philippine flight-school product while customers retain ownership and control of their data.

The production browser may directly perform only explicitly approved low-risk reads and draft operations under tested Row-Level Security. Dispatch transitions, assessment finalization, role changes, exports, authoritative weight-and-balance, audit-sensitive actions, and AI requests must pass through controlled Edge Functions or reviewed PostgreSQL functions.

See [Product and Governance Decisions](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md) for the current product-owner decisions and the professional validations that remain outstanding.

## Document authority

When documents conflict, use this order:

1. Approved legal, regulatory, aircraft, and flight-school source material
2. Approved Architecture Decision Records (ADRs)
3. Product Requirements / SRS and Security Requirements
4. System Architecture and Database/API specifications
5. Approved feature specification
6. Roadmap and handoff narrative
7. Chat history or AI-generated suggestions

Any aviation rule must be verified by qualified Philippine ATO personnel before implementation or production use. Store verified rules as version-controlled configuration or documented deterministic logic, never as an LLM assumption.

## Working with an AI coding agent

Give the agent this README, the Master Handoff, the relevant requirements, one approved feature specification, and the exact files it may change. Require an analysis and implementation plan before code. Require tests, authorization, tenant isolation, audit behavior, documentation updates, and a diff review for every slice.
