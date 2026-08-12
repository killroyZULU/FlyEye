# Feature Specification: FEAT-005 — Single-school deployment amendment (FIX-006)

## Status

- State: Locally verified; publication pending
- Current SDLC phase: PR/CI
- Owner: Founder/Product Owner
- Baseline and task branch: PR #16 head `d415e09`; `fix/FIX-006-single-school-deployment`
- Related requirements/decisions: IAM-002/003/005/008/010; ADR-0006

## User outcome

As a user of one flight school, I want FlyEye to derive my school automatically and require MFA only when my role or action warrants it, so sign-in stays simple without weakening privileged access.

## Scope

Included:

- Enforce at most one school and one membership per user in a deployment.
- Remove the school-selection request and UI contract.
- Reject ambiguous/multiple membership contexts and selection hints.
- Keep Student Pilot access at AAL1 and Instructor Pilot/Organization Admin access at TOTP/AAL2.
- Amend canonical architecture, product, security, test, and IAM documentation.

Non-goals:

- Email one-time codes as a privileged second factor
- Provisioning or deploying another school's cloud resources
- Removing `organizations`, `organization_id`, RLS, protected commands, or cross-school security tests
- FEAT-006 role-assignment implementation

## Assumptions and decisions

| Item | Source | State |
|---|---|---|
| One school receives one isolated deployment and data boundary | Founder/Product Owner; ADR-0006 | Accepted |
| The same codebase and migrations serve separate deployments | ADR-0006 | Accepted |
| TOTP/AAL2 remains required for instructors, administrators, and authority-bearing actions | IAM-005; ADR-0006 | Accepted |
| Student non-privileged access may use password-authenticated AAL1 | IAM-005; ADR-0006 | Accepted |

## Data and server contract

- Migration preflight fails if existing data has multiple organizations or multiple memberships for one user.
- A singleton deployment slot uniquely constrains `organizations`; `organization_memberships.user_id` is unique.
- Authentication-event organization arrays contain at most one organization.
- `auth-bootstrap` accepts only an empty object, derives the sole membership server-side, and fails closed on ambiguous context.
- `organization_id`, composite keys, RLS, protected functions, audit, and generated types remain in place.
- Constraints are deferrable only so rollback-only SQL isolation tests can construct adversarial School A/School B data; committed transactions must satisfy them.

## UI behavior

- No pre-authentication or post-authentication school selector is rendered.
- Zero membership shows the existing no-access path; one membership continues to the role workspace; multiple memberships show a conflict and grant no workspace.
- Student Pilot AAL1 proceeds. Instructor Pilot and Organization Admin AAL1 enter the existing TOTP enrollment/challenge flow and only AAL2 proceeds.

## Security and privacy

- Organization request hints, duplicate membership IDs, multiple organization IDs, or inconsistent server results fail closed.
- A forged organization ID remains a negative authorization case even though normal deployment data contains one school.
- Email verification/recovery does not satisfy privileged MFA.
- No provider, dependency, real data, hosted resource, or production change is included.

## Acceptance criteria

- [x] `FIX-006-AC-01` A deployment cannot commit a second organization.
- [x] `FIX-006-AC-02` A user cannot commit a second organization membership.
- [x] `FIX-006-AC-03` Authentication bootstrap rejects organization-selection input and multiple contexts.
- [x] `FIX-006-AC-04` The application exposes no school-selection UI.
- [x] `FIX-006-AC-05` Student AAL1 remains allowed; Instructor/Admin require TOTP/AAL2.
- [x] `FIX-006-AC-06` Existing organization scoping, RLS, protected authority, audit, and negative boundary tests remain.
- [ ] `FIX-006-AC-07` Applicable app/database verification, separate review, PR, and CI are green; local verification and review pass, while PR/CI remain pending.

## Planned verification

| Test ID | Level | Scenario | Expected result |
|---|---|---|---|
| `FIX-006-DB-01` | pgTAP | Second school, second membership, multi-school audit context | Constraint failure |
| `FIX-006-AUTH-01` | Unit/handler | Empty, selected, duplicate, and multiple context | Sole context accepted; ambiguity denied |
| `FIX-006-UI-01` | Component/E2E | Student and privileged sign-in | No selector; role-based assurance enforced |
| `FIX-006-REG-01` | Matrix | Existing app, SQL, runtime, lint, build, docs, types, audit | Green with synthetic data |

## Change boundary

Allowed areas: authentication bootstrap, access UI/tests, deployment-invariant migration/tests, synthetic runtime fixtures, generated types, and directly conflicting canonical documents.

Excluded: unrelated features, hosted or production resources, real data, FEAT-006 implementation, and deletion of organization security boundaries.

## Definition of done

- [x] Stable contract and ADR are recorded.
- [x] Data, server, frontend, and focused tests are implemented.
- [x] Full local verification and separate review pass.
- [ ] Scoped commit, review-ready pull request, and required CI are green.
