# ADR-0003: PostgreSQL shared-schema multi-tenancy

- Status: Superseded by ADR-0006
- Date: 2026-07-17

## Context

FlyEye data is relational and report/audit heavy. Early customers should share a managed deployment without the operational cost of one database per school, but cross-school exposure is a critical risk.

> Amendment note: [ADR-0005](ADR-0005-LEAN-SUPABASE-STACK.md) keeps shared-schema PostgreSQL and makes Supabase Row-Level Security the primary database-enforced tenant boundary, supplemented by protected functions and tests.

> Supersession note: [ADR-0006](ADR-0006-SINGLE-SCHOOL-ISOLATED-DEPLOYMENTS.md) replaces shared multi-school hosting with one isolated deployment per school while retaining internal organization scoping and RLS.

## Decision

Use PostgreSQL with a shared schema. Tenant-owned records include `OrganizationId`; authenticated membership establishes context. Apply organization isolation in authorization, queries, constraints, object paths, caches, jobs, reports, exports, audit, and automated tests.

## Consequences

Positive: relational integrity/reporting, manageable migrations/cost, straightforward early SaaS operation.

Tradeoffs: every data path must carry tenant context; one isolation error can be severe; large enterprise customers may later require dedicated deployment/database.

## Guardrails

Cross-tenant negative tests are release-blocking. Row-level security is evaluated as an additional defense, not a replacement for application checks.
