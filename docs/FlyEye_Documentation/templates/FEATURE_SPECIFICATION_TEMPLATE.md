# Feature Specification: FEAT-XXX — Name

Follow `DOCUMENTATION_STANDARD.md`. This file defines the stable feature contract; implementation history and test results belong in traceability, Git, pull requests, and CI.

## Status

- State: Draft | Approved | Implemented | Verified | Merged
- Current SDLC phase:
- Owner:
- Baseline and task branch:
- Related requirement/decision IDs:

## User outcome

As a **role**, I want **outcome**, so that **verified value**.

## Scope

Included:

-

Non-goals:

-

## Sources, assumptions, and unresolved questions

| Item | Source/owner/version | State |
|---|---|---|
| | | Verified / assumed / unresolved |

Do not implement an unverified aviation, aircraft, legal, privacy, or operational rule as authoritative.

## Roles and authority

| Action | Permission | Tenant/record rule | Direct RLS or protected command | Reauthentication |
|---|---|---|---|---|
| | | | | |

## Workflow and business rules

```text
CurrentState --authorized action--> NewState
```

Define preconditions, invalid transitions, idempotency, concurrency, cancellation, amendment, and fail-closed behavior.

## Data and server contract

- Entities, fields, constraints, indexes, and `organization_id` behavior:
- Classification and retention:
- Migration and rollback/forward-fix:
- Edge Function or PostgreSQL function:
- Request, response, and stable error families:
- RLS, grants, Storage, and generated-type impact:

## UI behavior

- Entry point and responsive behavior:
- Loading, empty, error, unauthorized, conflict, offline, and success states:
- Keyboard, focus, labels, announcements, reflow, and other applicable accessibility behavior:
- Source, freshness, limitation, and AI labels:

## Audit and observability

- Atomic audit event and non-sensitive metadata:
- Notifications and idempotency:
- Metrics, logs, alerts, and failure behavior:

## Security, privacy, and abuse cases

Record only feature-specific controls and link global requirements by ID. Cover cross-tenant direct-ID/list/search/RPC/Edge/file/export attempts, unauthorized role/assignment/state, enumeration, injection, replay/race, request/file abuse, and sensitive-data minimization as applicable.

## Acceptance criteria

- [ ] `FEAT-XXX-AC-01` Given / when / then criterion

## Planned verification

| Test ID | Level | Scenario | Expected result |
|---|---|---|---|
| | | | |

## Dependencies

List only feature-specific packages or providers. For a new dependency, record purpose, maintenance, vulnerability posture, license, operational/bundle impact, and existing alternative.

## Change boundary

Allowed areas:

-

Excluded areas:

- Unrelated modules
- Architecture or authority changes outside this specification
- Merge, real data, production deployment, destructive actions, and branch deletion

Do not restate the global delivery envelope or hard stops; reference `AGENTS.md`.

## Definition of done

- [ ] Contract, sources, assumptions, and unresolved items are explicit
- [ ] Data/RLS/protected-command/frontend/audit behavior is implemented in scope
- [ ] Applicable positive, negative, cross-tenant, concurrency, failure, and accessibility checks pass
- [ ] Secrets and service-role authority remain server-only
- [ ] Traceability contains the evidence and limitations
- [ ] Documentation checks and separate review pass
- [ ] Scoped branch has a green review-ready pull request
