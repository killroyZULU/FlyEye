# Feature Specification: FEAT-XXX — Name

## Status and ownership

- Status: Draft | Reviewed | Approved | Implemented | Verified | Released
- Current SDLC phase: Discovery | Specification | Design | Implementation | Verification | Review | PR/CI | Merge | Release
- Product owner:
- Aviation SME:
- Technical owner:
- Security/privacy reviewers:
- Target release:

## User outcome and problem

As a **role**, I want **outcome**, so that **verified value**.

## Scope

### Included

-

### Non-goals

-

## Source and assumptions

| Item | Verified source/owner/version | Status |
|---|---|---|
| Aviation/business rule | | Verified / pending |

Do not implement an unverified safety/regulatory rule as authoritative.

## Roles, permissions, and record scope

| Action | Permission | RLS / protected-function organization and assignment rule | Reauthentication |
|---|---|---|---|
| | | | |

## Preconditions and business rules

1.

## Workflow and state transitions

```text
CurrentState --authorized action--> NewState
```

Define invalid, duplicate/idempotent, concurrent, cancellation, and amendment behavior.

## Data and migration

- Entities/fields/constraints/indexes:
- `organization_id` behavior:
- Classification and retention:
- Concurrency/versioning:
- Migration/backfill/rollback or forward-fix:

## Data and protected-function contract

- Direct table operation or protected Edge/PostgreSQL function:
- Method/path or RPC name:
- Request/response examples:
- Error codes:
- Idempotency/concurrency:
- RLS/grant/Storage policy impact:
- Generated database type impact:

## UI/UX

- Entry point and responsive behavior:
- Loading, empty, error, unauthorized, offline, conflict, and success states:
- Accessibility:
- Source/freshness/AI labels:

## Validation and safety

- Authoritative server validation:
- Deterministic calculations/configuration:
- Human authority/approval:
- Failure behavior and fallback:

## Audit, notifications, and observability

- Audit event and non-sensitive metadata:
- Notification recipients/idempotency:
- Metrics/logs/alerts:

## Security, privacy, and abuse cases

- Cross-tenant direct Data API/list/search/RPC/Edge Function/file/export attempts
- Unauthorized role/assignment/state
- Injection, request/file abuse, enumeration, replay/race
- Sensitive data minimization and log/prompt redaction

## Acceptance criteria

- [ ] Given / when / then criterion

## Tests and evidence

| Test ID | Level | Scenario | Expected result |
|---|---|---|---|
| | | | |

## Dependencies

List providers/packages. New dependencies require purpose, maintenance, vulnerability, license, bundle/operations, and alternative assessment.

## Files allowed to change

-

## Files not allowed to change

- Authentication/tenancy architecture unless explicitly approved
- Unrelated modules

## Autonomous delivery boundary

A request for this bounded feature authorizes specification refinement,
implementation, local synthetic verification, in-scope correction, separate
agent review, documentation, scoped commit/push, a review-ready pull request,
and CI follow-up through green.

- Branch and baseline:
- Bounded outcome and non-goals:
- Expected implementation, migration, test, fixture, documentation, and tooling
  areas:
- Safe reversible defaults selected by the agent:
- Material hard-stop conditions:
- Always excluded: merge, real data, production deployment, destructive Git/data
  actions, branch deletion, unsupported regulated authority, and unrelated
  features:

## Verification tiers

- Focused checks for implementation and corrections:
- Complete feature-specific evidence:
- One final application/database matrix after the review target stabilizes:
- Fingerprint/evidence location used to avoid unchanged reruns:

## Definition of Done

- [ ] Requirements and sources approved
- [ ] Code/SQL migration/RLS/protected-function/client implemented in bounded scope
- [ ] Unit, component, SQL/RLS, Edge Function, authorization, tenant, E2E, and relevant security tests pass
- [ ] Service-role key and privileged functions remain server-only and narrowly scoped
- [ ] Audit/observability and failure paths verified
- [ ] Accessibility/responsive/offline behavior reviewed as applicable
- [ ] Docs, traceability, ADR/change log updated
- [ ] Separate diff review completed
- [ ] Risk-triggered aviation/legal/production/formal-compliance reviews recorded
      when inherently required
- [ ] Scoped branch is committed, pushed, and represented by a green
      review-ready pull request
