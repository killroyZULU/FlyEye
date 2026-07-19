# ADR-0002: Modular monolith with vertical slices

- Status: Superseded by ADR-0005
- Date: 2026-07-17

## Context

The MVP spans identity, aircraft, dispatch, calculations, training, reports, audit, and integrations, but expected pilot/early-commercial load does not justify microservices. A solo/small team needs simple deployment, debugging, transactions, and AI context.

> Supersession note: the no-microservices and bounded-module principles remain useful, but [ADR-0005](ADR-0005-LEAN-SUPABASE-STACK.md) removes the separately deployed ASP.NET Core monolith from the MVP.

## Decision

Use one ASP.NET Core deployable organized into explicit modules and bounded vertical feature slices. Use one primary PostgreSQL database. Modules expose interfaces/events and do not depend on another module’s internal implementation.

## Consequences

Positive: lower cost/operational burden, easier testing and deployment, strong transactions, manageable AI-generated changes.

Tradeoffs: module discipline must be enforced in code review; one deployment scales together; a badly coupled monolith can become difficult to split.

## Evolution trigger

Extract a service only when measured independent scaling, compute/security isolation, separate team ownership, or availability needs justify it. Likely candidates are AI processing and flight-track analytics.
