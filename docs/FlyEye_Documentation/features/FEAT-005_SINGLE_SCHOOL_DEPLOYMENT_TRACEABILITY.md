# FEAT-005 Traceability

Amendment scope: FIX-006 single-school deployment and role-based MFA.

## Evidence boundary

- Reviewed target: Complete scoped tree on `fix/FIX-006-single-school-deployment`; publication commit recorded in Git/PR
- Verification date: 2026-08-11
- Local/hosted/data boundary: local synthetic only; no hosted mutation
- Pull request and CI: pending
- Known limitations: no real-data, deployment, production, formal accessibility, or qualified external review claim

## Requirements and results

| Requirement/AC ID | Design or control | Test/evidence ID | Result | Limitation or later gate |
|---|---|---|---|---|
| `IAM-010`, `AC-01/02` | Singleton school and unique user membership constraints | `FIX-006-DB-01`; 243 pgTAP assertions | Pass | Local synthetic database only |
| `IAM-002/003`, `AC-03/04` | Empty bootstrap request; server-derived sole membership; no selector | `FIX-006-AUTH-01`, `FIX-006-UI-01`; 211 app tests; 16 E2E scenarios | Pass | Hosted Auth not exercised |
| `IAM-005`, `AC-05` | Student AAL1; Instructor/Admin TOTP/AAL2 | FEAT-001 access matrix plus five real local runtime fixtures | Pass | Stronger MFA method remains future option |
| `IAM-003/008`, `AC-06` | Internal `organization_id`, RLS, protected commands, negative school-boundary tests retained | SQL/RLS/runtime matrix; database lint; generated-type check | Pass | Separate deployments not provisioned |
| `AC-07` | Full checks, separate review, PR, CI | `verify:app`, `verify:database:running`, separate review | Local pass; PR/CI pending | Merge remains a separate decision |

The application gate passed formatting, documentation, lint, TypeScript, 211 tests, production build, browser-secret scanning, 16 desktop/mobile E2E scenarios, and dependency audit. The clean database gate passed 243 pgTAP assertions, five runtime fixtures, database lint, generated-type drift, and zero-residue cleanup. Separate review found no remaining actionable issue after correction.
