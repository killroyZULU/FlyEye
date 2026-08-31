# Feature Specification: FEAT-008 — Authenticated dashboard shell

## Status

- State: Review-ready
- Current SDLC phase: Merge decision
- Owner: Founder/Product Owner
- Baseline and task branch: `main` at `1a85ae6`; `feat/FEAT-008-authenticated-dashboard-shell`
- Related requirements and decisions: `REC-006`, UI/UX Guidelines Sections 1–3 and 10, `IAM-002/003/005/010/011`
- Tracking: Issue #33

## User outcome

As an authenticated FlyEye user, I want a designated dashboard and persistent navigation for my approved role, so that the application clearly separates account access from signed-in work.

## Scope

Included:

- A full-width authenticated application shell after server-approved access is granted.
- Student, Instructor, Administration, and safe future-role dashboard labels.
- Persistent navigation for Home, available permission-approved modules, My profile, Account security, and Sign out.
- Desktop and mobile reflow, current-view indication, keyboard focus, and semantic navigation.
- Existing module panels rendered inside the authenticated shell.

Non-goals:

- Aircraft Registry workflow or visual redesign.
- New operational metrics, notifications, aviation states, approvals, records, roles, or permissions.
- Changes to authentication, MFA, RLS, protected functions, database schema, audit behavior, or packages.

## Sources, assumptions, and unresolved questions

| Item | Source | State |
|---|---|---|
| Authenticated screens require a dedicated dashboard and navigation; the sign-in introduction must disappear after access is granted | Founder/Product Owner, 2026-08-31 | Approved |
| Navigation is role-sensitive but cannot act as authorization | UI/UX Guidelines Section 3; `IAM-003` | Verified |
| Basic dashboards are planned, but operational content needs implemented source workflows | `REC-006`; Current State | Verified |
| Role labels and permissions come from the protected access context | `IAM-002/003/010/011` | Verified |

No unresolved aviation, legal, privacy, or operational rule is required for this shell.

## Roles and authority

| UI action | Availability | Authority rule |
|---|---|---|
| Open Home | Every granted workspace | Membership has its required portal permission |
| Open an application module | Existing module is supplied and required permission is present | Server and module authorization remain authoritative |
| Open My profile or Account security | Every granted workspace | Existing protected flows remain authoritative |
| Sign out | Every granted workspace | Existing Auth sign-out flow |

The shell consumes the server-approved `AccessMembership`. It does not accept client-selected organization or role values and grants no new authority.

## UI contract

### Authentication boundary

The existing two-panel authentication presentation remains for sign-in, recovery, invitation, onboarding, MFA, and access-failure states. When the state is `success` with one active membership, FlyEye replaces that presentation with the authenticated shell. The “Secure school access” copy is not rendered in the authenticated shell.

### Application header and navigation

The header shows the FlyEye identity, deployment school, current role label, and Sign out. A semantic primary navigation bar remains visible across authenticated views. Home is always first. Module entries follow when the frontend module is available and the membership contains its required permission. My profile and Account security remain available to every granted membership.

The selected navigation item uses visible styling and `aria-current="page"`. Navigation buttons preserve the existing in-memory view model and do not claim to replace server authorization. On narrow screens the header stacks and the navigation scrolls horizontally without creating page-level horizontal overflow.

### Role dashboards

The role label determines the heading only:

- `student_pilot`: Student dashboard
- `instructor_pilot`: Instructor dashboard
- `admin`: Administration dashboard
- future approved role: `<server role label> dashboard`, otherwise FlyEye dashboard

Each dashboard shows the school, role, access-verified status, and a structured list of currently available destinations. It does not fabricate counts, progress, expiry, utilization, compliance, dispatch, training, notification, or approval information. Areas without implemented source workflows are omitted.

### Existing module views

Invitations, member administration, profile, security, and any later supplied Aircraft Registry panel render within the same shell. Existing module loading, empty, error, conflict, unauthorized, and success behavior remains owned by each module. Existing “Back to workspace” actions return Home.

## Security, privacy, and accessibility

- Permission filtering uses only the server-approved membership contract.
- Hidden navigation is usability behavior, never an authorization control.
- No new personal data, tenant data, secrets, logs, audit events, or browser storage are introduced.
- The shell uses landmarks, an accessible navigation label, visible focus, current-page semantics, sufficient target sizes, and responsive reflow.
- Sign-out and access-revocation transitions clear the active membership and return to the signed-out or revalidated state without leaving stale authenticated content.

## Acceptance criteria

- [x] `FEAT-008-AC-01` Granted users see a full-width authenticated shell and never see the signed-out brand introduction.
- [x] `FEAT-008-AC-02` Student, Instructor, Admin, and safe future-role access contexts receive the correct dashboard heading.
- [x] `FEAT-008-AC-03` Primary navigation persists across authenticated views and marks the current view.
- [x] `FEAT-008-AC-04` Module navigation appears only when the module exists and the server-approved permission is present.
- [x] `FEAT-008-AC-05` Home, My profile, Account security, and Sign out remain available to every granted membership.
- [x] `FEAT-008-AC-06` The shell reflows at mobile and 200% zoom-equivalent widths without page-level horizontal overflow.
- [x] `FEAT-008-AC-07` Session revocation, sign-out, and access loss cannot leave stale authenticated shell content.
- [x] `FEAT-008-AC-08` Focused component/browser checks and the full application verification gate pass.

## Planned verification

| Test ID | Level | Scenario | Expected result |
|---|---|---|---|
| `FEAT-008-UNIT-01` | Unit | Role and future-role labels | Correct dashboard heading |
| `FEAT-008-COMP-01` | Component | Student/Admin granted access | Auth introduction absent; shell and role dashboard present |
| `FEAT-008-COMP-02` | Component | Permission and module combinations | Exact navigation entries only |
| `FEAT-008-COMP-03` | Component | Navigate among Home/Profile/Security/administration modules | Persistent nav and correct current item |
| `FEAT-008-COMP-04` | Component | Sign-out and revoked session races | Shell removed; stale success rejected |
| `FEAT-008-E2E-01` | Browser | Desktop and mobile authenticated shell | Responsive navigation and no page overflow |
| `FEAT-008-REG-01` | Regression | Full application quality gate | Existing authentication and feature behavior pass |

## Change boundary

Allowed areas:

- Authentication application composition, dashboard/shell components, shared UI styling, focused tests, browser fixtures, and this fix’s canonical documentation.

Excluded areas:

- Aircraft Registry behavior or styling.
- Database, RLS, Edge Function, permission, role, audit, and dependency changes.
- Unrelated modules, merge, deployment, production, real data, and branch deletion.

## Definition of done

- [x] The authenticated shell and role dashboards satisfy all acceptance criteria.
- [x] Existing authority, tenancy, MFA, and stale-session protections remain unchanged.
- [x] Traceability records evidence and limitations.
- [x] Documentation, application verification, browser evidence, and separate review pass.
- [x] The scoped branch has a green review-ready pull request linked to Issue #33.
