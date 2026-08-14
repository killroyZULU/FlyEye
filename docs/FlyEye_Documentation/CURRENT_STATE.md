# Current State

- Last updated: 2026-08-14
- Last verified merged baseline: Slice A PR #25 merge `835b9dc`
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

Merged code and green local or CI evidence do not imply hosted validation, qualified regulated review, customer acceptance, real-data authority, deployment, or production approval.

## Current product boundary

- React, TypeScript, Vite PWA, and Supabase remain the approved MVP stack.
- Each flight school uses a separate frontend and Supabase/cloud/data deployment from the same versioned product; the application has no school selector.
- Student non-privileged access may use password-authenticated AAL1; instructors, administrators, and authority-bearing actions require TOTP/AAL2.
- Development and demonstrations use synthetic data.
- No staging or production environment, production domain, or customer-data workflow is currently approved.
- Aviation, legal, privacy, security, accessibility, customer, penetration-test, pilot-readiness, and production review remain risk- and lifecycle-triggered.
- FEAT-005 and its PR #16/FIX-006 corrections are merged with required CI green. FEAT-006 Slice A self-service member TOTP enrollment is merged through PR #25 at `835b9dc`. Slice B protected role assignment is implemented, locally verified, and independently reviewed on `feat/FEAT-006-role-assignment` for Issue #26; review-ready PR #27 is open with required CI green.
- The UI design checkpoint remains after FEAT-002 through FEAT-006 unless a later approved decision changes the sequence.

## Next bounded product work

Obtain the human merge decision for [FEAT-006 Member MFA Readiness and Role Assignment](features/FEAT-006_ROLE_ASSIGNMENT.md) Slice B PR #27. Aviation licence, medical, qualification, currency records, and additional school-validated roles remain later work requiring external workflow and authority evidence.

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
