# FEAT-003 Risk-Triggered Human Review Scope

## Status

No qualified-human review is required merely to retain the merged local synthetic FEAT-003 implementation or its disabled hosted-hardening safeguards. Automated verification and separate agent review are recorded in [FEAT-003 Traceability](FEAT-003_TRACEABILITY.md).

Use the [Risk-Triggered Review Template](../templates/RISK_TRIGGERED_REVIEW_TEMPLATE.md) when a later hosted, real-data, regulated, formal-compliance, penetration-test, or production claim requires attributable human evidence.

## Review target

The reviewer must identify the exact commit, migrations, runtime configuration, environment, data classification, and evidence package. A review of one target cannot be reused after material code, dependency, configuration, provider, or evidence changes.

## Domain-specific scope

### Database and protected authority

- `organization_id`, RLS, grants, views, triggers, security-definer functions, locking, idempotency, and atomic audit
- Public/browser-role denial and service-role containment
- Last-active-administrator and cross-tenant behavior
- Migration and recovery safety

### Security and privacy

- Password AMR, TOTP/AAL2, factor inventory, grant expiry/consumption, enumeration, replay, and concurrency
- Secret separation, telemetry minimization, trusted network source, rate controls, alert ownership, incident handling, and retention
- Provider and hosting configuration for the exact reviewed environment

### Accessibility

- QR and manual-secret enrollment, keyboard and focus behavior, error identification, live announcements, wait/retry/recovery states, reflow, contrast, target size, password-manager behavior, and provider challenges

### Operations

- Limiter availability and recovery, monitoring and alert tests, credential handling, synthetic grant issuance, cleanup, session invalidation, evidence retention, incident ownership, and emergency behavior

## Unresolved hosted and production decisions

Local values and fixtures are not hosted or production evidence. Before a hosted run or production claim, establish and review the exact provider/project, region and plan, origin, credentials, trusted network rules, rate thresholds, capacity, retention, monitoring, alert ownership, recovery, cleanup, incident process, support model, cost, and any override or emergency behavior.

## Gate preservation

A completed review supports only the stated target and claim. It does not by itself authorize merge, hosted mutation, real-data use, deployment, production, destructive cleanup, branch deletion, or another feature.
