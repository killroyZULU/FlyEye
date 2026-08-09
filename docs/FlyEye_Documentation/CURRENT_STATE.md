# Current State

- Last updated: 2026-08-09
- Last verified merged baseline: PR #11 merge `ed731d4`
- Production status: not deployed or approved
- Data boundary: local synthetic data only

This file is the sole active project-status summary. Replace stale entries; do not append implementation history. Durable requirements and decisions belong in their canonical documents, while detailed evidence remains in feature traceability records, pull requests, CI, and Git.

## Delivered foundation

| Outcome | Repository state | Remaining boundary |
|---|---|---|
| FEAT-001 Login and initial RBAC | Merged into `main` | Universal MFA, invitations, user administration, hosted validation, and production readiness remain later work |
| FEAT-002 Password Recovery | Merged through PR #5; closure documentation through PR #6 | Hosted email/provider behavior, remaining accessibility evidence, real-data approval, deployment, and production remain open |
| FEAT-003 Organization Admin and MFA Onboarding | Merged through PR #7 | Hosted synthetic validation, provider activation, real data, deployment, and production remain open |
| FEAT-003 Hosted Synthetic Hardening | Merged through PR #8 at `48ba984`; safeguards remain disabled and target-free | No staging provider/project, credentials, paid plan, executable hosted issuer, or hosted run is authorized or configured |
| FEAT-004 Member Invitations | Complete local matrices and separate technical review pass on `feat/FEAT-004-member-invitations`; pull request pending | CI, merge, hosted email, real data, deployment, and production remain open |

Merged code and green local or CI evidence do not imply hosted validation, qualified regulated review, customer acceptance, real-data authority, deployment, or production approval.

## Current product boundary

- React, TypeScript, Vite PWA, and Supabase remain the approved MVP stack.
- Development and demonstrations use synthetic data.
- No staging or production environment, production domain, or customer-data workflow is currently approved.
- Aviation, legal, privacy, security, accessibility, customer, penetration-test, pilot-readiness, and production review remain risk- and lifecycle-triggered.
- FEAT-004 Member Invitations is implemented for local synthetic verification. FEAT-005 User Management and Basic Profiles and FEAT-006 Role Assignment are not specified.
- The UI design checkpoint remains after FEAT-002 through FEAT-006 unless a later approved decision changes the sequence.

## Next bounded product work

Publish the FEAT-004 review-ready pull request and record green CI evidence in [FEAT-004 Traceability](features/FEAT-004_TRACEABILITY.md). Merge remains a separate Founder/Product Owner decision.

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
