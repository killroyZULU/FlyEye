# Current State

- Last updated: 2026-09-05
- Last verified merged baseline: `main` at `1a85ae6`
- Production status: not deployed or approved
- Data boundary: local synthetic data only

This file is the sole active project-status summary. Replace stale entries; do not append implementation history. Durable requirements and decisions belong in their canonical documents, while detailed evidence remains in feature traceability records, pull requests, CI, and Git.

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

## Current delivery target

FEAT-007 Slice A Aircraft Registry Foundation is implemented on
`feat/FEAT-007A-aircraft-registry` for Issue #31 and PR #32. Local app,
desktop/mobile browser, database, and runtime matrices pass. Review corrections
pass the 303-test app gate, 382 rollback-only SQL assertions, all eight local
runtime fixtures, schema lint, and generated-type verification. Final technical
re-review is clear, and required pull-request checks passed for implementation
commit `cd6a937`. After four intermittent later-head CI failures in the
pre-existing FEAT-006 runtime fixture, bounded fail-closed diagnostics isolated
the failure to protected completion after TOTP verification without exposing
child output. The reviewed diagnostic head `ef61821` passes all required PR
checks, including all eight runtime fixtures; documentation head `7658c1f`
records that green evidence and PR #32 remains open and clean. The slice contains
administrative identity records only and creates no operational, airworthiness,
compliance, registration-validity, ownership, or dispatch authority.

FEAT-007B Aircraft Document Records specification and design remain independently
review-ready in PR #36 for Issue #35. The approved implementation is complete on
`feat/FEAT-007B-aircraft-documents`, stacked on specification head `fbea354`.
Local application, database, and nine-fixture runtime checks pass. Technical
review is clear; see [FEAT-007 Traceability](features/FEAT-007_TRACEABILITY.md#slice-b-aircraft-document-records-evidence).
Issue #37 tracks publication; commit and pull-request CI are next. Hosted
activation, deployment, real-data use, and production remain unapproved.

FEAT-008 Authenticated Dashboard Shell remains independently review-ready in PR
#34 at `1dc61c1`; Application quality, Local Supabase security, and the required
aggregate gate pass. It remains unmerged and is a later FEAT-007B UI integration
dependency rather than part of this stacked specification branch.

## Current product boundary

- React, TypeScript, Vite PWA, and Supabase remain the approved MVP stack.
- Each flight school uses a separate frontend and Supabase/cloud/data deployment from the same versioned product; the application has no school selector.
- Student non-privileged access may use password-authenticated AAL1; instructors, administrators, and authority-bearing actions require TOTP/AAL2.
- Development and demonstrations use synthetic data.
- No staging or production environment, production domain, or customer-data workflow is currently approved.
- Aviation, legal, privacy, security, accessibility, customer, penetration-test, pilot-readiness, and production review remain risk- and lifecycle-triggered.
- FEAT-001 through FEAT-006 are merged with their recorded local synthetic and required CI evidence. FEAT-007A has green corrected local synthetic, technical-review, and required current-head CI evidence but remains unmerged. No operational-status module is implemented.
- FEAT-008 has green local, independent-review, and required PR evidence but remains unmerged; it supersedes the earlier UI-checkpoint status for authenticated workspace navigation.

## Next bounded product work

Publish the verified and reviewed FEAT-007B implementation pull request and
follow required CI through green without
merging or changing the independent FEAT-007A and FEAT-008 decisions. Preserve
the configured-record-only boundary; do not introduce aviation status,
approval, or dispatch-eligibility rules.

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
