# Feature Specification: FEAT-001 — Login and Initial RBAC

## Status and ownership

- Status: Security remediation implemented and demonstrated on the synthetic local stack; independent human security/privacy review pending
- Product owner: Approved through the FEAT-001 implementation task on 2026-07-19
- Aviation SME: Required before assigning operational authority to the Admin role
- Technical owner: FlyEye project
- Security/privacy reviewers: Pending human review
- Target release: Initial development baseline

## User outcome and problem

As an invited Student Pilot, Instructor Pilot, or Admin, I want to sign in securely so that FlyEye opens only the school workspace and features authorized by my server-controlled membership, role, and permissions.

## Scope

### Included

- Email/password sign-in through Supabase Auth
- Existing-session restoration and sign-out handling
- Server-derived organization membership, role, and permissions
- Student Pilot, Instructor Pilot, and Admin role codes
- Server-side AAL2 enforcement for Instructor Pilot and Admin access
- Multiple-organization selection when the user has multiple active memberships
- Loading, empty, error, unauthorized, conflict, MFA, organization-selection, and success states
- Deny-by-default RLS with no direct browser table grants
- Protected Edge Function and PostgreSQL access-context function
- Audit-gated final authentication event for every completed protected access-context decision
- Unit, component, SQL/RLS, Edge handler, cross-tenant, and browser E2E tests

### Non-goals

- Public registration
- Invitation, membership, or role-administration UI
- Password recovery, MFA enrollment, passkeys, SSO, or social login
- Operational permissions for dispatch, airworthiness, training finalization, or competency
- Full Student, Instructor, or Admin dashboards
- Production configuration or deployment

## Source and assumptions

| Item | Verified source/owner/version | Status |
|---|---|---|
| Invitation-only accounts | SRS IAM-001 | Verified product requirement |
| Server-derived membership and authorization | SRS IAM-002/003; ADR-0005 | Verified architecture requirement |
| Initial Instructor/Admin MFA and later universal-MFA target | Security Requirements section 3; Product and Governance Decisions section 5 | FEAT-001 implements privileged-role MFA only; universal enrollment, recovery, support, and enforcement remain pending |
| Student/Instructor/Admin initial roles | Product-owner FEAT-001 task, 2026-07-19 | Approved for initial access routing |
| Management pilots may use Admin grouping | Product-owner FEAT-001 task, 2026-07-19 | Approved only as an initial grouping |
| CFI/Head of Training operational permissions | Qualified ATO SME and permission-matrix owner | Pending SME confirmation |
| Multiple roles within one membership | Product/security owner | Deferred; database enforces one initial role per membership |

No aviation authority is inferred from a role label. The initial permissions grant access only to role-specific placeholder workspaces.

## Roles, permissions, and record scope

| Action | Permission | Organization and assignment rule | Reauthentication |
|---|---|---|---|
| Enter Student workspace | `portal.student.access` | Active membership assigned `student_pilot` | Current authenticated session |
| Enter Instructor workspace | `portal.instructor.access` | Active membership assigned `instructor_pilot` | AAL2 MFA required |
| Enter Admin workspace | `portal.admin.access` | Active membership assigned `admin` | AAL2 MFA required |
| Read access context | `auth-bootstrap` plus server-only resolver/audit RPCs | Actor and AAL come from the verified JWT; an optional organization selection is revalidated | Valid user JWT; AAL is enforced per returned membership |

## Preconditions and business rules

1. Public sign-up is disabled.
2. The user authenticates directly with Supabase Auth.
3. Application access requires an active organization and active membership.
4. Exactly one initial role is assigned to each organization membership.
5. The role must contain its corresponding portal permission.
6. Instructor Pilot and Admin workspace access requires an Edge-verified user JWT and a server-enforced `aal2` claim. A missing AAL claim is treated as AAL1 and fails closed for privileged access.
7. Role, permission, and organization identifiers are never accepted from the login request.
8. The browser cannot directly read or mutate RBAC or authentication-event tables.
9. Unknown, missing, or conflicting access data fails closed.

## Workflow and state transitions

```text
CheckingSession -> SignedOut | LoadingAccess
SignedOut -> SigningIn -> SignedOut | LoadingAccess
LoadingAccess -> Empty | Conflict | OrganizationSelection | MfaRequired | Unauthorized | Success
OrganizationSelection -> LoadingAccess -> MfaRequired | Unauthorized | Success
MfaRequired -> VerifyingMfa -> LoadingAccess -> MfaRequired | Unauthorized | Success
Any authenticated state -> SignedOut on sign-out/session revocation
```

Membership activation, suspension, reactivation, role assignment, and role removal are authoritative changes outside FEAT-001 and will require separate protected commands and audit events.

## Data and migration

- Original migration: `20260719000100_feat_001_identity_rbac.sql`
- Security forward fix: `20260719000200_feat_001_security_forward_fix.sql`
- Tables: `organizations`, `organization_memberships`, `roles`, `permissions`, `role_permissions`, `membership_roles`, `authentication_events`
- Tenant-owned membership and assignment rows contain `organization_id`.
- Composite constraints prevent cross-organization membership-role relationships.
- One role per membership is enforced for the initial release.
- Tenant-first membership and audit indexes support access bootstrap and review.
- All exposed tables have RLS enabled and no browser table policies or grants.
- The original migration was already present in local migration history and was not rewritten. The reviewed forward fix adds the remediation in order, preserves existing rows, validates new constraints after backfill, and revokes the deprecated browser RPC.

## Data and protected-function contract

- Edge Function: `POST /functions/v1/auth-bootstrap`
- Request: strict JSON object with only optional `organizationId`; the value is a selection hint and is re-derived against the verified actor's active memberships
- Edge JWT verification: explicitly enabled in `supabase/config.toml`; the function also resolves the Auth user before using the verified JWT AAL claim
- PostgreSQL resolver: server-only `public.resolve_auth_access_context(...)`
- PostgreSQL audit writer: server-only `public.record_authentication_access_decision(...)`
- Response: runtime-validated organizations, role, permissions, membership version, per-membership assurance/access status, final decision, organization context, and correlation ID
- Anonymous/authenticated browser roles cannot execute either server-only RPC. Client-supplied role, permission, metadata, actor, AAL, and unowned organization values are not authority.
- The Edge Function writes exactly one final success or denied event only after runtime contract validation. Audit failure blocks access.
- Safe error statuses: 400, 401, 403, 405, 409, 413, 422, and 500
- Browser code uses only the publishable key. The Edge Function keeps the service-role key in its server environment for the two narrowly granted server-only RPCs; the key is rejected by browser configuration and scanned out of source/build output.

## UI/UX

- Two-panel desktop layout and single-column mobile layout
- Accessible email/password and TOTP inputs
- No public registration, role selector, or pre-authentication organization selector
- Generic non-enumerating credential error
- Explicit session checking, loading, empty, error, unauthorized, conflict, organization selection, MFA, and success states
- Role workspaces remain labelled placeholders until separately approved features exist
- Authentication requires connectivity

## Validation and safety

- Zod validates login input, Edge request bodies, and access-context responses at runtime.
- Supabase Auth remains the credential authority.
- RLS and protected functions remain the authorization authority.
- UI role checks are not treated as security controls.
- No aviation approval, dispatch, airworthiness, training-finalization, or competency behavior exists in this feature.

## Audit, notifications, and observability

- Protected access decisions create one server-side authentication event and correlation ID after response validation.
- `actor_subject_id` retains the Auth UUID as a pseudonymous attribution snapshot if the Auth user is later removed; it does not copy email or mutable profile data.
- `organization_id` records a selected/single organization and `organization_ids` records the complete resolved multi-organization context.
- Database constraints enforce valid event-name/outcome and reason-code combinations.
- Metadata contains only membership count, current assurance level, and whether organization selection occurred; no password, token, email, or authorization internals are recorded.
- Supabase Auth remains the source for password and MFA authentication logs.
- Notifications are not part of FEAT-001.

## Security, privacy, and abuse cases

- Credential stuffing, password spraying, enumeration, MFA guessing, session theft, and rate limits
- Cross-tenant membership and role access
- Client-supplied organization/role/permission attempts
- Stale or revoked membership sessions
- Duplicate organization context and malformed protected-function output
- CORS, method, request-size, and request-schema enforcement
- No credential, token, or sensitive SQL error logging
- Authentication data retention remains subject to the privacy inventory, DPO review, and configured Supabase retention

## Acceptance criteria

- [x] Invited active Student Pilot can sign in and reach only the Student placeholder workspace in component and mocked-service E2E tests.
- [x] Instructor Pilot and Admin AAL1 are denied and AAL2 is granted by the server resolver and real local Auth/TOTP/Edge integration.
- [x] A user with no active membership receives the empty/access-denied state.
- [x] Role and organization are derived from the protected access-context contract, not browser metadata.
- [x] Anonymous and authenticated browser roles have no direct RBAC table access. Migration inspection and live SQL/RLS execution pass.
- [x] Cross-tenant access-context tests return only the actor's organization.
- [x] Every completed protected access-context invocation writes exactly one final event; runtime contract rejection records denied rather than success, and audit failure blocks access.
- [x] Loading, error, unauthorized, conflict, organization-selection, MFA, and success states are covered.
- [x] No service-role key exists in browser code.
- [x] Final remediation formatting, lint, type checking, 32 unit/component/Edge-handler tests, 45 SQL/RLS tests, actual local Auth/TOTP/Edge/browser integration, 8 Playwright E2E scenarios, database lint, dependency audit, production build, generated-type hash comparison, and source/build secret scans pass on 2026-07-19.

## Dependencies

- React, React DOM, TypeScript, Vite
- Supabase JavaScript client and Supabase CLI
- Zod for runtime contract validation
- ESLint and Prettier
- Vitest, Testing Library, jsdom, and Playwright

Packages are pinned in `package.json`; all selected packages reported an MIT or Apache-2.0 license at installation planning time. The lockfile passed the package manager supply-chain policy check.

## Files allowed to change

- Root frontend/package/tooling configuration needed for the initial React/Vite application
- `src/features/auth/**`
- `src/lib/access-context.ts`, `src/lib/database.types.ts`, and `src/lib/supabase.ts`
- Login-specific shared components and styles
- `supabase/config.toml`
- FEAT-001 migration, Edge Function, and SQL/RLS tests
- FEAT-001 browser tests
- This specification, FEAT-001 traceability, and the documentation change log

## Files not allowed to change

- `AGENTS.md`
- Existing ADR decisions
- Unrelated product modules
- Production credentials or deployment configuration
- GitHub Actions workflows

## Known limitations and approvals still required

- CFI, Head of Training, and other management authority requires an approved permission matrix and aviation-SME review.
- MFA enrollment/recovery is not implemented.
- Student users remain allowed at AAL1 in FEAT-001. The later product-owner decision requiring MFA for every user before real-data pilot or production access is not yet implemented.
- Password recovery is not implemented.
- Role and membership administration are not implemented.
- Local Supabase uses ports `55320` through `55328`; optional local analytics is disabled.
- The local Supabase stack exposes development services on the host network and uses shared development credentials. It must never contain production credentials, production data, or unrestricted real personal data. See [FEAT-001 local security testing](FEAT-001_LOCAL_SECURITY_TESTING.md).
- Local TOTP enrollment and verification are enabled only to exercise the existing-factor flow; production MFA enrollment, recovery, support, factor-lifecycle, and rate-control procedures remain pending.
- The generated database type snapshot was refreshed from the migrated local database and an immediate regeneration produced the same SHA-256 hash on 2026-07-19.
- Human security/privacy review remains required before real data.
