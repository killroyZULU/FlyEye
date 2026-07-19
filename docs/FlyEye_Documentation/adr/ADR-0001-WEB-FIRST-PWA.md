# ADR-0001: Web-first responsive PWA

- Status: Accepted; implementation details amended by ADR-0005
- Date: 2026-07-17

## Context

Students and instructors use phones/tablets, while dispatchers, administrators, Heads of Training, and quality users need desktop tables, configuration, reports, and audit review. A small AI-assisted team must deploy frequent updates across mixed customer devices and weak connectivity.

> Historical note: the original decision below named a same-origin ASP.NET Core API. [ADR-0005](ADR-0005-LEAN-SUPABASE-STACK.md) replaces that implementation detail with Supabase while retaining the web-first PWA decision.

## Decision

Build one responsive React/TypeScript web application with PWA installation and limited offline draft capture. Use a same-origin ASP.NET Core API. Defer a Flutter/native companion until continuous GPS, background collection, Bluetooth/device integration, deep camera capture, or long-duration offline requirements are validated.

## Consequences

Positive: URL-based deployment, centralized updates, broad device reach, efficient administration, one UI codebase, simpler security and support.

Tradeoffs: browser/PWA background and device integration limitations; offline authority must be constrained; mobile UX requires explicit responsive design.

## Guardrails

Final submission, approval, current compliance/weather/NOTAM checks, official PDFs, aircraft status change, and record reopening require server connectivity and revalidation.
