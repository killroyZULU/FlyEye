# ADR-0005: Lean React and Supabase MVP stack

- Status: Accepted
- Date: 2026-07-19
- Supersedes: ADR-0002
- Amends: ADR-0001 and ADR-0003

## Context

The earlier stack used React, a separately hosted ASP.NET Core API, Entity Framework Core, PostgreSQL, Azure object storage, identity, monitoring, and multiple Azure deployment services. It provided strong long-term control but imposed two application languages, a larger infrastructure surface, more generated integration code, and higher setup/operations burden before FlyEye had validated one flight-school pilot.

Replacing PostgreSQL with Firestore would simplify hosting but would move FlyEye’s relational, revision-heavy, report-heavy integrity into schemaless application code. That is not the desired tradeoff for a heavily AI-generated product.

## Decision

Build the MVP with:

- React + TypeScript + Vite as a responsive PWA;
- Supabase Auth for invitation-based users and MFA;
- Supabase PostgreSQL as the relational source of truth;
- deny-by-default PostgreSQL Row-Level Security for every exposed tenant table;
- Supabase private Storage for uploads and generated files;
- Supabase Edge Functions and reviewed PostgreSQL functions for protected commands, integrations, authoritative calculations, exports, and atomic audit-sensitive changes;
- Supabase CLI SQL migrations and generated TypeScript database types;
- a managed static frontend host, separate Supabase staging and production projects, focused CI, and manual production approval.

Direct browser access is permitted only for explicitly approved low-risk reads and editable drafts under tested RLS. Normal client roles cannot directly change approval, finalization, status, role, tenant, audit, or other authority-bearing fields.

## Options considered

| Option | Benefits | Costs/risks | Decision |
|---|---|---|---|
| React + ASP.NET Core + PostgreSQL + Azure | Maximum control, mature backend boundaries | More languages, hosting, integration and DevOps burden for MVP | Deferred until justified |
| React/Flutter + Firebase/Firestore | Fast managed development and strong offline support | Document model and security/query complexity for FlyEye relationships, reports and revisions | Rejected as primary record store |
| React + Supabase PostgreSQL | Relational integrity with managed Auth, Storage, API and functions; one main language | Requires excellent RLS/function discipline and separate Storage backup | Selected |

## Consequences

### Positive

- Faster specification-driven vibe coding in TypeScript and SQL.
- Keeps PostgreSQL relationships, constraints, reporting, transactions, and exportability.
- Removes a separately deployed API and most Azure-specific MVP configuration.
- Makes tenant isolation enforceable through database RLS.
- Provides a credible path from prototype to controlled pilot.

### Tradeoffs and risks

- RLS, grants, views, and security-definer functions become safety-critical code.
- Service-role exposure could bypass RLS and must be treated as a critical secret incident.
- Database backups do not automatically protect Storage objects; object recovery requires a separate process.
- Edge Functions may become awkward for long-running or highly complex workflows.
- A later dedicated API could require command migration, although PostgreSQL data remains portable.

## Guardrails

- RLS on all exposed tenant tables; deny by default.
- Protected functions for authoritative transitions, calculations, exports, roles and integrations.
- Service-role key never in the browser.
- Separate staging/production projects and secrets.
- SQL/RLS/Edge Function and cross-tenant tests block release.
- Authoritative W&B uses server-side decimal/arbitrary-precision or PostgreSQL numeric logic.
- Database and Storage object restores are tested separately and together.
- AI remains optional and human-supervised under ADR-0004.

## Revisit triggers

Consider a dedicated API when protected functions become difficult to govern, long-running work or integrations require durable orchestration, regulatory/customer requirements demand a distinct service boundary, a larger engineering team forms, or measured performance/cost warrants it.

