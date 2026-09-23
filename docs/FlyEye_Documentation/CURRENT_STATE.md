# Current State

- Last updated: 2026-09-23
- Merged baseline: `main` at `813dbd9` (PR #43); post-merge quality gates passed
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
- Aircraft records/documents and the authenticated dashboard are implemented on separate unmerged branches; see their PRs below. They do not establish operational or dispatch authority.

## Structural reinforcement checkpoint

[Issue #39](https://github.com/killroyZULU/FlyEye/issues/39) owns the remaining audit
coverage and findings. Further refactoring follows reconciliation of the existing
pull requests and issues. Passing automated checks does not complete manual review.

- Completed maintenance: PR #41 delivered CI, documentation and tooling corrections. [PR #43](https://github.com/killroyZULU/FlyEye/pull/43) corrected MFA fixture readiness and cleanup; [post-merge CI](https://github.com/killroyZULU/FlyEye/actions/runs/35843256944) passed all gates. Issue #42 is closed. The exact historical cleanup failure remains unconfirmed.
- Audit coverage: the scoped documentation/tooling review is complete; broader Markdown, frontend and backend reviews remain incomplete.
- Active slice: reconcile [Issue #31](https://github.com/killroyZULU/FlyEye/issues/31) / PR #32 with current `main`, preserving the aircraft registry contract and the merged MFA fixture corrections.
- Next: verify and review PR #32, then propagate the updated registry baseline through PRs #36 and #38 and reconcile the dashboard. A008, A009 and A013 remain tracked findings; broad refactors remain deferred. Preserve the occupied local aircraft database.
- Resume from this checkpoint, Issue #39 and live PR checks; do not restart completed reviews or close the umbrella audit after one slice.

## Existing unmerged work

| Work | Review location | Audit baseline |
|---|---|---|
| Aircraft registry | [PR #32](https://github.com/killroyZULU/FlyEye/pull/32) | `7658c1f` |
| Aircraft document specification | [PR #36](https://github.com/killroyZULU/FlyEye/pull/36), stacked on registry | `fbea354` |
| Aircraft document implementation | [PR #38](https://github.com/killroyZULU/FlyEye/pull/38), stacked on specification | `1e16af4` |
| Authenticated dashboard | [PR #34](https://github.com/killroyZULU/FlyEye/pull/34) | `1dc61c1` |
| Visual-design documentation | [PR #30](https://github.com/killroyZULU/FlyEye/pull/30) | Reconciliation with current `main` in progress |

These branches remain unmerged. Their recorded heads have successful historical
checks; reconciliation requires fresh verification. PR #36 depends on #32, and
#38 depends on #36. Merge and feature integration require separate decisions.

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
