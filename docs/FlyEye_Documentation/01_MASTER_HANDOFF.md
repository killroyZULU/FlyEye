# Master Handoff

## Purpose

This is the concise orientation for a new product, engineering, security, privacy, aviation, or AI collaborator. Read it with the [Current State](CURRENT_STATE.md), then consult the canonical specialist document for the work at hand.

## Product direction

FlyEye modernizes fragmented, manual, and audit-heavy flight-school workflows. It is a web-first product delivered as a responsive PWA for desktop, tablet, and mobile use, with one isolated application and data deployment per flight school.

The MVP sequence covers:

1. Organizations, invitation-based accounts, permissions, audit, files, and notifications
2. Aircraft and personnel compliance records
3. Dispatch drafts, controlled review, final records, and post-flight entry
4. Deterministic weight and balance and source-controlled weather/NOTAM records
5. Training structures, assessments, remediation, acknowledgement, and progression
6. Basic operational, training, compliance, and audit reporting

Scheduling, billing, full maintenance work orders, safety-management modules, predictive features, native mobile, direct regulatory integration, and training stages beyond a separately validated PPL-first pilot are deferred.

Exact CAAP, PCAR, aircraft, and school requirements must be verified from current authorized sources before any regulated claim or authoritative workflow is approved.

## Architecture

| Concern | Decision |
|---|---|
| Client | React + TypeScript responsive PWA built with Vite |
| Platform | Supabase PostgreSQL, Auth, private Storage, RLS, and Edge Functions |
| Authority | Edge Functions or reviewed PostgreSQL functions for protected commands and calculations |
| School isolation | Separate deployment per school; internal `organization_id`; deny-by-default RLS on exposed tables |
| Delivery | Version-controlled SQL migrations, generated types, protected `main`, focused CI, manual production approval |
| AI | Provider-independent, minimized, structured, logged, human-reviewed, and non-authoritative |

Direct browser access is limited to approved low-risk reads and editable drafts under tested RLS. Status changes, approvals, finalization, role or tenant changes, authoritative calculations, exports, and mandatory-audit actions use protected server-side commands.

See [System Architecture](04_SYSTEM_ARCHITECTURE.md), [ADR-0005](adr/ADR-0005-LEAN-SUPABASE-STACK.md), [Database Design](05_DATABASE_DESIGN.md), and [API Specification](06_API_SPECIFICATION.md).

## Safety and human authority

FlyEye provides information support and record control. It cannot independently:

- dispatch or approve a flight;
- release an aircraft as airworthy;
- mark a student competent;
- override an authorized person or approved source; or
- use an AI summary as the authoritative weather, NOTAM, manual, or operational record.

Weight and balance uses deterministic server-side decimal logic verified against approved aircraft information. Finalized calculations retain their inputs and configuration version.

## Security, privacy, and evidence

- Accounts are invitation-based; administrators, instructors, and authority-bearing actions require TOTP/AAL2, while non-privileged student portal access may use password-authenticated AAL1.
- Each school has an isolated deployment; internal school scoping is enforced at the database boundary and cross-school attacks remain negative-tested.
- Protected state changes create audit evidence atomically and fail closed if required evidence cannot be written.
- Supabase service-role and provider secrets stay in protected server/CI stores and never enter browser code, examples, prompts, or logs.
- Operational files remain private and require validated upload, authorized access, and separate object-recovery evidence.
- Development, tests, screenshots, logs, and prompts use synthetic data only.
- The likely controller/processor relationship, minor-student safeguards, retention, customer rights, and incident obligations require qualified review before real data.

See [Security Requirements](08_SECURITY_REQUIREMENTS.md), [Privacy and Data Protection](12_PRIVACY_DATA_PROTECTION.md), and [QA Plan](11_QA_TEST_PLAN.md).

## Delivery model

FlyEye uses bounded, contract-first vertical slices. A direct request authorizes routine specification, implementation, local synthetic verification, correction, separate agent review, documentation, scoped Git publication, and CI follow-up through a review-ready pull request.

The agent stops for the hard-stop conditions in `AGENTS.md`. Merge, hosted mutation requiring a separate decision, real data, production deployment, destructive operations, and branch deletion remain outside the standing envelope.

The detailed process is in [AI Development Guide](09_AI_DEVELOPMENT_GUIDE.md) and [DevSecOps Guide](10_DEVSECOPS_GUIDE.md). Feature documents must not duplicate those global instructions.

## Pilot boundary

The proposed initial pilot is PPL-first and runs beside the school's approved process. FlyEye does not become the official record or operational authority until the school completes its own approvals and change procedures. The pilot identity, final scale, metrics, permissions, privacy terms, source forms, retention, hosting, recovery, and support commitments remain evidence-gated decisions.

See [Pilot Implementation Plan](13_PILOT_IMPLEMENTATION_PLAN.md) and [Product and Governance Decisions](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md).

## Where to find current information

- Current delivered state, dependencies, and next work: [CURRENT_STATE.md](CURRENT_STATE.md)
- Product requirements: [03_PRODUCT_REQUIREMENTS_SRS.md](03_PRODUCT_REQUIREMENTS_SRS.md)
- Active founder decisions: [17_PRODUCT_AND_GOVERNANCE_DECISIONS.md](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md)
- Feature contract and evidence: the relevant files under [`features/`](features/)
- Historical implementation detail: Git commits, pull requests, CI, and linked traceability evidence

Do not append implementation chronology to this handoff. Update `CURRENT_STATE.md` by replacing stale status and keep the detailed evidence at its source.
