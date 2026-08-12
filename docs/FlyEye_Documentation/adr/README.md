# Architecture Decision Records

ADRs preserve durable decisions so future developers and AI agents do not repeatedly redesign FlyEye. Accepted ADRs override general narrative where they directly conflict.

## Index

| ADR | Status | Decision |
|---|---|---|
| [ADR-0001](ADR-0001-WEB-FIRST-PWA.md) | Accepted; amended by ADR-0005 | Responsive web-first PWA; native mobile later if justified |
| [ADR-0002](ADR-0002-MODULAR-MONOLITH.md) | Superseded by ADR-0005 | Earlier ASP.NET Core modular-monolith decision |
| [ADR-0003](ADR-0003-POSTGRESQL-TENANCY.md) | Superseded by ADR-0006 | Earlier shared multi-school PostgreSQL tenancy decision |
| [ADR-0004](ADR-0004-AI-HUMAN-AUTHORITY.md) | Accepted | AI is optional advisory assistance under human authority |
| [ADR-0005](ADR-0005-LEAN-SUPABASE-STACK.md) | Accepted | Lean React/TypeScript + Supabase MVP stack |
| [ADR-0006](ADR-0006-SINGLE-SCHOOL-ISOLATED-DEPLOYMENTS.md) | Accepted | One isolated deployment per flight school; internal organization scoping retained |
| [Template](ADR-TEMPLATE.md) | Template | Format for future decisions |

## Rules

- Number sequentially and never reuse a number.
- Do not rewrite the history of an accepted decision. Supersede it with a new ADR.
- Include safety, security, privacy, operations, cost, and migration consequences.
- A chat suggestion or AI-generated change does not supersede an ADR.
