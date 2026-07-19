# Production Release Checklist

## Release identity

- Version/commit/artifact:
- Date/window:
- Owner and approvers:
- Change log and known limitations:

## Scope and evidence

- [ ] Approved requirements/features and traceability are complete
- [ ] Diff is bounded and independently reviewed
- [ ] ADRs and documentation are current
- [ ] SBOM, dependency/license review, and release artifacts recorded

## Quality

- [ ] Builds, lint/type checks, unit/component/integration/E2E tests pass
- [ ] RLS, Storage policy, protected-function authorization, and cross-tenant negative tests pass
- [ ] Critical aviation calculations/rules pass verified scenarios
- [ ] Generated database types, protected-function contracts, and PDF/export tests pass
- [ ] Accessibility/usability and performance evidence is acceptable
- [ ] No unresolved critical defect

## Security and privacy

- [ ] SAST, secret, dependency, infrastructure, and DAST checks pass
- [ ] No unresolved exploitable high-severity issue
- [ ] File-upload, Supabase Auth/session, rate-limit, service-role exposure, and sensitive-log tests pass
- [ ] PIA/DPA/subprocessor/retention impacts reviewed
- [ ] Access review, secrets, certificates, WAF, and monitoring are healthy

## Data and recovery

- [ ] SQL migration, RLS, grants, functions, triggers and views reviewed and rehearsed on staging/representative volume
- [ ] Database and Storage-object backups are healthy; combined restore/reconciliation evidence is within the required interval
- [ ] Rollback or forward-fix plan is rehearsed/credible
- [ ] Retention, object versioning/soft delete, and audit integrity are healthy

## Operations

- [ ] Staging smoke/UAT approved
- [ ] Alerts, dashboards, jobs, provider status, and support coverage ready
- [ ] Customer/aviation SME approval recorded where required
- [ ] Incident contacts and communication plan current
- [ ] Manual production approver authorizes deployment

## Post-deployment

- [ ] Frontend, Supabase Auth, RLS, tenant-scoped critical workflow, audit, Edge Functions, files, and data checked
- [ ] Metrics/errors/security signals watched through agreed window
- [ ] Release outcome and any deviation recorded

## Decision

- Go / No-go / Rolled back
- Human approver, time, and rationale:
