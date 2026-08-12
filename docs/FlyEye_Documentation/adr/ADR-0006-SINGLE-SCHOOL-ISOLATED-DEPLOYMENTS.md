# ADR-0006: Single-school isolated deployments

- Status: Accepted
- Date: 2026-08-11
- Supersedes: ADR-0003
- Amends: ADR-0005

## Context

FlyEye is intended to serve one flight school per application deployment. A different school receives a separate frontend deployment, Supabase project, database, Auth tenant, Storage boundary, secrets, backups, and provider configuration. The earlier shared multi-school SaaS decision created an organization-selection workflow and cross-customer blast radius that the product does not need.

The relational model already uses `organization_id`, composite integrity, Row-Level Security, protected commands, and audit scoping. Those controls remain useful within one school and protect against forged identifiers, stale data, import mistakes, and future regressions.

## Decision

Use one school per isolated deployment while maintaining one shared versioned codebase and migration history.

- A deployed database contains at most one `organizations` row.
- A user has at most one organization membership in that deployment.
- The application derives the school from server-controlled membership and deployment data; users never choose or submit an organization during authentication bootstrap.
- Every school-owned row retains `organization_id`; deny-by-default RLS, composite integrity, protected commands, Storage scoping, and atomic audit remain mandatory.
- A second school is provisioned as a separate cloud and data boundary, not another row in the same production database and not a customer-specific source fork.
- Tests may create adversarial School A/School B data only inside rollback-only database transactions or separate isolated test deployments. Committed runtime fixtures obey the one-school invariant.

## Authentication consequence

TOTP/AAL2 remains mandatory for administrators, instructors, and any future role or action with privileged, instructional, approval, safety, configuration, export, or access-management authority. Student portal access may use a current password-authenticated AAL1 session unless a protected action explicitly requires recent authentication or stronger assurance. Email links or codes may verify mailbox control and support recovery, but email is not the privileged second factor.

## Consequences

Positive: simpler sign-in and support, smaller cross-customer blast radius, independent school lifecycle and recovery, and no organization selector.

Tradeoffs: each school adds infrastructure, monitoring, upgrade, backup, provider, and cost overhead; consolidated cross-school reporting and shared identities are out of scope; migrations must be deployed consistently across isolated projects.

## Guardrails

- Database constraints fail deployment or migration if more than one school or more than one membership per user exists.
- Provisioning is an administrative infrastructure operation, not a browser workflow.
- Requests containing organization-selection hints fail closed.
- Cross-school authorization tests remain release-blocking even though normal runtime data contains one school.
- Moving to a shared multi-school deployment requires a new ADR, migration plan, threat review, and explicit authorization.
