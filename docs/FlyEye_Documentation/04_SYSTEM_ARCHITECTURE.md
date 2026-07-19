# System Architecture

## 1. Architecture decision

FlyEye will use a **lean React/TypeScript PWA backed by Supabase**. This replaces the earlier separate ASP.NET Core/Azure application design for the MVP. The relational, multi-tenant, auditable data model remains; the infrastructure and language surface are reduced.

The architecture targets one pilot school and early commercial adoption without requiring a separately hosted custom API, container platform, or multiple programming languages.

## 2. System form

```text
Desktop / Tablet / Mobile Browser / Installed PWA
                         |
                 React + TypeScript
                    Vite build
                         |
          Supabase JavaScript client (user JWT)
             /                 |                 \
     Approved direct       Protected Edge       Private Storage
     reads/drafts          Functions / RPC       with RLS policies
             \                 |                 /
                   Supabase PostgreSQL
                 deny-by-default table RLS
                         |
                 Audit and domain records
```

The frontend is deployed on a managed static host. Staging and production use separate Supabase projects and separate frontend deployments.

## 3. Recommended MVP stack

| Layer | Baseline |
|---|---|
| Frontend | React + TypeScript + Vite |
| PWA | Web manifest and cached application shell; offline drafts deferred until online workflows stabilize |
| UI/forms | One maintained component library plus the minimum form/schema tools justified by implemented features |
| Managed backend | Supabase Auth, PostgreSQL, Storage, Edge Functions, generated Data API, and optional Realtime |
| Authorization | PostgreSQL Row-Level Security plus explicit checks in protected Edge/PostgreSQL functions |
| Migrations/types | Supabase CLI SQL migrations and generated TypeScript database types |
| Hosting | Managed static frontend hosting plus managed Supabase projects |
| Delivery | GitHub, protected main branch, focused GitHub Actions, staging, manual production approval |
| Testing | Vitest/component tests, SQL/RLS tests, Edge Function integration tests, Playwright E2E, security/recovery tests |

Exact package and runtime versions must be verified when implementation starts. Do not pin versions from old planning documents without checking current support.

## 4. Responsibility boundaries

### Browser may perform directly

Only explicitly approved, low-risk operations under tested RLS, such as:

- reading records the user is authorized to see;
- creating or updating the user’s editable drafts;
- reading reference/configuration data permitted to the role;
- requesting a signed download after storage authorization.

### Protected server-side command required

Use Supabase Edge Functions or reviewed PostgreSQL functions for:

- inviting users and changing roles or memberships;
- submitting, returning, approving, rejecting, cancelling, completing, or reopening dispatch records;
- finalizing or reopening assessments;
- authoritative weight-and-balance calculation and snapshot creation;
- generating official PDFs or large exports;
- applying retention/deletion operations;
- writing actions that must atomically create audit evidence;
- calling weather/NOTAM, email, malware-scanning, or AI providers;
- any operation requiring a service-role secret.

The service-role key is never shipped to the browser. Protected functions validate the user JWT and then re-check active membership, permission, organization, record scope, state, concurrency, and required reason.

## 5. Product module boundaries

```text
Identity & Membership
Organizations & Permissions
Aircraft & Aircraft Documents
Personnel & Qualifications
Dispatch & Preflight
Weight & Balance
Weather & NOTAM Records
Training & Competencies
Assessments & Progression
Files & Generated Documents
Reporting & Exports
Notifications
Audit & Record Control
AI Assistance
```

The repository should mirror these bounded areas in frontend features, Edge Functions, migrations, tests, and documentation. A feature must not write another module’s tables casually; shared mutations are formal commands or reviewed database functions.

## 6. Multi-tenancy

Initial model: one Supabase project and one shared PostgreSQL schema per environment. Tenant-owned rows contain `organization_id`.

Required defenses:

- Every exposed tenant table has RLS enabled and deny-by-default policies.
- Membership is stored server-side and joined/checked in RLS; client metadata is not trusted as authorization.
- Policies distinguish `select`, `insert`, `update`, and `delete` and include `WITH CHECK` conditions.
- Protected functions set or verify organization context rather than accepting it as authority from the request body.
- Database constraints prevent cross-organization relationships where practical.
- Storage paths and policies include the organization and record scope.
- Cross-tenant list, direct-ID, search, RPC, Edge Function, file, report, and export tests are release-blocking.
- Views exposed to clients must honor RLS and must not accidentally run with unsafe definer privileges.
- Service-role access is limited to narrowly scoped server functions and operational automation.

## 7. Authentication and permissions

Use Supabase Auth with invitation-only account creation. MFA is mandatory for privileged and operational roles before a real-data pilot. Application permissions are stored in PostgreSQL membership/role tables; user-editable metadata is never an authorization source.

Every protected command checks:

```text
Valid user JWT?
  -> Active membership?
  -> Same organization?
  -> Required permission?
  -> Assignment/record scope permitted?
  -> Current state permits action?
  -> Fresh MFA/reauthentication required?
  -> Audit write can succeed?
```

## 8. Data and record integrity

- PostgreSQL foreign keys, unique constraints, checks, numeric types, transactions, and RLS are the authoritative data boundary.
- Operational state changes occur through explicit transactional commands, not general client updates to a `status` column.
- Drafts use optimistic concurrency; finalized records become immutable snapshots and corrections create controlled revisions.
- Database triggers or protected command functions create append-only domain audit events in the same transaction as the business change.
- Timestamps are UTC; the organization timezone is stored separately.
- Uploaded/generated binaries live in private Storage; metadata and cryptographic hashes live in PostgreSQL.

## 9. Weight-and-balance architecture

Weight-and-balance remains deterministic and non-AI. The authoritative engine runs inside a protected Edge Function or reviewed PostgreSQL function, never only in browser code. It must use decimal/arbitrary-precision arithmetic or PostgreSQL `numeric`, explicit rounding and unit rules, versioned aircraft configurations, and approved reference examples.

The frontend may preview a result for usability, but submission recalculates server-side. Final records preserve every input, output, engine/configuration version, and approval source so historical results can be reproduced.

## 10. Offline design

Do not enable general Firestore-style last-write-wins synchronization. The first MVP is online-first. After workflows stabilize, add IndexedDB only for local drafts and a controlled sync queue.

Online is required for final submission, approval, current compliance and weather/NOTAM information, official documents, aircraft status changes, assessment finalization, and record reopening. Reconnection triggers server revalidation and explicit conflict handling.

## 11. AI boundary

```text
Authorized user action
  -> Edge Function validates user, organization, permission, and purpose
  -> minimize/redact context
  -> provider-independent AI adapter
  -> validate restricted structured response
  -> human review/edit/reject
  -> acceptance outcome audited
```

AI providers receive no Supabase credentials and cannot call authoritative commands. Core workflows work when AI is disabled or unavailable.

## 12. Storage and backup

Supabase database backups protect PostgreSQL according to the selected paid plan. Storage objects are not assumed to be included in database backups. Production therefore requires a separate tested export/versioning/replication procedure for restricted uploads and generated PDFs, plus reconciliation between database metadata and stored objects.

Recovery objectives are commitments only after database and object restore drills prove them.

## 13. Deployment environments

| Environment | Frontend | Supabase project | Data |
|---|---|---|---|
| Development | Local Vite | Local Supabase CLI or dedicated dev project | Synthetic |
| Staging | Managed preview/staging | Separate staging project | Synthetic or explicitly controlled pilot-like data |
| Production | Managed production host | Separate production project | Approved real customer data |

Do not share project URLs, service-role keys, buckets, databases, AI keys, or email providers between staging and production.

## 14. Capacity

The platform is suitable for the proposed 5–20 pilot concurrent users and 50–150 early-commercial concurrent users, subject to representative load tests and the selected Supabase plan. Capacity is measured rather than inferred from vendor branding.

## 15. Evolution triggers

A dedicated API may be introduced later if protected-function complexity, long-running work, integration requirements, regulatory controls, team ownership, or measured performance make it necessary. The first candidate would be a narrow service for document generation, AI processing, or flight-track analysis—not a rewrite of the entire product.

See [ADR-0005](adr/ADR-0005-LEAN-SUPABASE-STACK.md).
