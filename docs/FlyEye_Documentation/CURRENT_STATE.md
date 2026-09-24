# Current State

- Last updated: 2026-09-24
- Delivery state: [main](https://github.com/killroyZULU/FlyEye/tree/main) and the linked PR/CI evidence below
- Production status: not deployed or approved
- Data boundary: local synthetic data only

This is the canonical status summary. Replace stale entries; keep requirements in their designated documents and detailed evidence in traceability, PRs, CI, and Git.

## Delivered foundation

| Outcome | Repository state | Remaining boundary |
|---|---|---|
| FEAT-001 Login and initial RBAC | Merged into `main`; FIX-006 removes school selection and preserves Student AAL1 plus Instructor/Admin TOTP/AAL2 | Hosted validation and production readiness remain later work |
| FEAT-002 Password Recovery | Merged through PR #5; closure documentation through PR #6 | Hosted email/provider behavior, remaining accessibility evidence, real-data approval, deployment, and production remain open |
| FEAT-003 Organization Admin and MFA Onboarding | Merged through PR #7 | Hosted synthetic validation, provider activation, real data, deployment, and production remain open |
| FEAT-003 Hosted Synthetic Hardening | Merged through PR #8 at `48ba984`; safeguards remain disabled and target-free | No staging provider/project, credentials, paid plan, executable hosted issuer, or hosted run is authorized or configured |
| FEAT-004 Member Invitations | Merged through PR #12 at `558e8e6`; complete local matrices, separate technical review, and required CI passed | Hosted email, formal accessibility evidence, real data, deployment, and production remain open |
| FEAT-005 User Management and Basic Profiles | Merged through PR #15 at `a3a39ca`; correction PR #16 merged at `b63b6a0`; single-school FIX-006 merged through PR #17 at `a162e0c` with required CI green | Formal accessibility evidence, real data, hosted validation, deployment, and production remain open |
| FEAT-006 Member MFA Readiness and Role Assignment | Slice A merged through PR #25 at `835b9dc`; Slice B merged through PR #27 at `65d11aa` after local matrices, separate technical review, and required CI passed | Factor recovery/replacement, formal accessibility evidence, qualified aviation role matrix, hosted validation, real data, deployment, and production remain open |

Merged code and green local or CI evidence do not imply hosted validation, qualified regulated review, customer acceptance, real-data authority, deployment, or production approval.

## Current product boundary

- React, TypeScript, Vite PWA, and Supabase remain the approved MVP stack.
- Each flight school uses a separate frontend and Supabase/cloud/data deployment from the same versioned product; the application has no school selector.
- Student non-privileged access may use password-authenticated AAL1; instructors, administrators, and authority-bearing actions require TOTP/AAL2.
- Development and demonstrations use synthetic data.
- No staging or production environment, production domain, or customer-data workflow is currently approved.
- Aviation, legal, privacy, security, accessibility, customer, penetration-test, pilot-readiness, and production review remain risk- and lifecycle-triggered.
- FEAT-001 through FEAT-006 are merged with their recorded local synthetic and required CI evidence. No larger operational product module is implemented.
- The [Visual Design System](DESIGN.md) is a reversible working direction merged through PR #30; implementation remains separately bounded.
- Aircraft records/documents and the authenticated dashboard are composed on `main` through PR #34. They do not establish operational or dispatch authority.

## Structural reinforcement checkpoint

[Issue #39](https://github.com/killroyZULU/FlyEye/issues/39) owns the remaining audit
coverage and findings. Passing automated checks does not complete manual review.

- Completed maintenance: PR #41 delivered CI/documentation/tooling corrections; [PR #43 evidence](features/FEAT-006_TRACEABILITY.md#runtime-fixture-maintenance) covers MFA cleanup. PR #45 integration checkpoints and PR #47 secret prevention are merged.
- Guidance audit: 59 tracked Markdown files and related instruction/check configuration reviewed at `893a68b`. Task 1 corrected D01/D02 through [PR #49](https://github.com/killroyZULU/FlyEye/pull/49), merged at `c2f6032` with green [post-merge CI](https://github.com/killroyZULU/FlyEye/actions/runs/35966616418). Broader frontend, backend and fixture reviews remain incomplete.
- Integration: PR #34 combines aircraft and dashboard modules with permission-filtered navigation and access-revocation handling. Issue #20 is closed against merged FEAT-006 evidence.
- Corrected findings: A008 stale MFA-assurance rejection and A009 invalid-file metadata-only continuation, with regressions. Aircraft SQL clock and seeded-category fixture cleanup corrections preserve production behavior.
- Guidance sequence: [Task 2 / Issue #50](https://github.com/killroyZULU/FlyEye/issues/50) tracks D03 verification/workflow consolidation; then checker alignment, session-contract applicability and evidence mappings (Tasks 3–5). Remaining code/dependency findings and authorization hypotheses stay queued in #39. Preserve the occupied local database.

## Aircraft and dashboard integration

| Work | Review location | Delivered scope |
|---|---|---|
| Aircraft registry | [PR #32](https://github.com/killroyZULU/FlyEye/pull/32) | Minimal identity records; audited create/edit/archive/reactivate |
| Aircraft document specification | [PR #36](https://github.com/killroyZULU/FlyEye/pull/36) | Approved ARROWI record contract |
| Aircraft documents | [PR #38](https://github.com/killroyZULU/FlyEye/pull/38) | Metadata versions, private attachments, configured status, notifications and bounded status-only access |
| Authenticated dashboard | [PR #34](https://github.com/killroyZULU/FlyEye/pull/34) | Persistent shell, role dashboards and available aircraft/member modules |

PRs #30, #32, #36, #38, #34 merged with green [integration CI](https://github.com/killroyZULU/FlyEye/actions/runs/35861588094); exact targets are in [FEAT-007](features/FEAT-007_TRACEABILITY.md#final-integration-evidence) and [FEAT-008](features/FEAT-008_TRACEABILITY.md#reconciliation-verification) traceability. Issue #22
requires qualified school workflow evidence; Issue #39 remains the unfinished
audit. The combined build still exceeds the 500 kB entry-bundle warning; measure
route/module splitting without weakening the warning or security boundaries.

FEAT-003 hosted-readiness planning and activation remain deferred under the threshold and preserved gates in [Product and Governance Decisions](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md#hosting-and-environments).

## Open decisions requiring external evidence

- Current regulatory sources, approved school workflows, and retention requirements
- Pilot school agreement, named sponsor, baseline metrics, and authorized source artifacts
- Aviation-approved permission and separation-of-duties matrix
- Minor-student authority/consent, safeguarding, access, retention, correction, and rights procedures
- Production hosting, Supabase region/plan, email delivery, domain, recovery commitments, and cost
- Customer export, deletion, and end-of-contract procedures
- Weather/NOTAM provider, licensing, provenance, and freshness rules

See `17_PRODUCT_AND_GOVERNANCE_DECISIONS.md` for active decisions and `14_PRODUCT_ROADMAP.md` for planned sequence.
