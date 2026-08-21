# FlyEye Aviation Training Operations Platform

FlyEye is a responsive PWA for one Philippine flight school per isolated deployment. It supports controlled operations and training records while keeping dispatch, airworthiness, instruction, assessment, and competency decisions with authorized people.

This repository describes a product under development. It does not claim CAAP certification, regulatory approval, customer acceptance, deployment, or production readiness.

## Start here

1. [Current State](CURRENT_STATE.md) — what is delivered, open, and next
2. [Master Handoff](01_MASTER_HANDOFF.md) — concise product and delivery orientation
3. [Product Requirements / SRS](03_PRODUCT_REQUIREMENTS_SRS.md)
4. [System Architecture](04_SYSTEM_ARCHITECTURE.md)
5. [Security Requirements](08_SECURITY_REQUIREMENTS.md)
6. [Product and Governance Decisions](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md)
7. The specification and traceability record for the bounded feature

AI contributors must also read the root `AGENTS.md`. Anyone editing Markdown must follow the [Documentation Standard](DOCUMENTATION_STANDARD.md).

## Documentation map

| Area | Documents |
|---|---|
| Product | [Overview](00_PROJECT_OVERVIEW.md), [Charter](02_PROJECT_CHARTER.md), [SRS](03_PRODUCT_REQUIREMENTS_SRS.md), [Roadmap](14_PRODUCT_ROADMAP.md) |
| Technical design | [Architecture](04_SYSTEM_ARCHITECTURE.md), [Database](05_DATABASE_DESIGN.md), [API](06_API_SPECIFICATION.md), [ADRs](adr/README.md) |
| Quality and risk | [UI/UX](07_UI_UX_GUIDELINES.md), [Visual design](DESIGN.md), [Security](08_SECURITY_REQUIREMENTS.md), [DevSecOps](10_DEVSECOPS_GUIDE.md), [QA](11_QA_TEST_PLAN.md), [Privacy](12_PRIVACY_DATA_PROTECTION.md), [Risk Register](15_RISK_REGISTER.md) |
| Delivery | [AI Development Guide](09_AI_DEVELOPMENT_GUIDE.md), [Pilot Plan](13_PILOT_IMPLEMENTATION_PLAN.md), [Change Log](16_CHANGE_LOG.md), [Current State](CURRENT_STATE.md) |
| Governance | [Product and Governance Decisions](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md), [Documentation Standard](DOCUMENTATION_STANDARD.md) |
| Features | [`features/`](features/) specifications, traceability, and feature-specific evidence |
| Templates | [`templates/`](templates/) for feature specifications, traceability, risk-triggered review, and production release |

## Canonical architecture

- React + TypeScript + Vite responsive PWA
- Supabase Auth, PostgreSQL, private Storage, Row-Level Security, and Edge Functions
- One isolated frontend and Supabase project per school, with internal `organization_id` scoping and deny-by-default RLS
- Protected server-side commands for authority-bearing changes and atomic audit evidence
- Version-controlled SQL migrations and generated database types
- Managed static frontend hosting with separate staging and production Supabase projects when later approved
- AI that is optional, permission-aware, minimized, reviewable, and unable to exercise operational authority

See [ADR-0005](adr/ADR-0005-LEAN-SUPABASE-STACK.md) for the MVP stack and [ADR-0006](adr/ADR-0006-SINGLE-SCHOOL-ISOLATED-DEPLOYMENTS.md) for deployment isolation.

## Document authority

When documents conflict, use this order:

1. Approved legal, regulatory, aircraft, and flight-school source material
2. Accepted ADRs
3. SRS and Security Requirements
4. System Architecture and Database/API specifications
5. Active Product and Governance Decisions
6. Approved feature specification
7. Current State, roadmap, and handoff narrative
8. Chat history or AI-generated suggestions

Report conflicts instead of silently selecting weaker behavior. Unverified aviation rules remain unresolved until a qualified source owner validates them.

## Documentation rule

One fact has one canonical home. Other documents link to it instead of restating it. Current status belongs in `CURRENT_STATE.md`; implementation history belongs in Git, pull requests, CI, and concise traceability records. Run `pnpm check:docs` before publishing documentation changes.
