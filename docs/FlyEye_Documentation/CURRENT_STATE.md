# Current State

- Last updated: 2026-09-08
- Last verified merged baseline: `main` at `1a85ae6` (PR #29)
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

The repository-wide audit precedes newer features. [Issue #39](https://github.com/killroyZULU/FlyEye/issues/39)
owns its coverage checklist, findings and remaining corrections. Passing automated
checks or inventorying files does not complete their manual review.

- Active slice: [Issue #40](https://github.com/killroyZULU/FlyEye/issues/40), CI coverage for stacked PRs, Markdown section-link validation, and canonical documentation consistency.
- Branch: `chore/structural-reinforcement`, based on merged `main` at `1a85ae6`.
- Implementation: CI/link validation and documentation consistency corrections are complete locally, including the Browserslist security patch. Application verification passes (276 tests, 20 browser scenarios); separate review is clear. Publication and PR CI remain pending.
- Audit coverage: the scoped documentation/tooling review is complete. Broader Markdown, frontend and backend reviews were interrupted; recovered findings and unverified hypotheses are recorded separately in Issue #39. No whole-area audit is claimed complete.
- Next: publish the maintenance PR and follow its required CI, then obtain the merge decision. The next code correction is A008: reproduce and guard a late MFA-assurance rejection after session invalidation.
- Resume: read this section and Issue #39, inspect `git status`/diff and the current PR checks, then continue the next unfinished step. Do not restart completed review areas or close the whole audit after one slice.

## Existing unmerged work

| Work | Review location | Audit baseline |
|---|---|---|
| Aircraft registry | [PR #32](https://github.com/killroyZULU/FlyEye/pull/32) | `7658c1f` |
| Aircraft document specification | [PR #36](https://github.com/killroyZULU/FlyEye/pull/36), stacked on registry | `fbea354` |
| Aircraft document implementation | [PR #38](https://github.com/killroyZULU/FlyEye/pull/38), stacked on specification | `1e16af4` |
| Authenticated dashboard | [PR #34](https://github.com/killroyZULU/FlyEye/pull/34) | `1dc61c1` |
| Earlier visual-design documentation | [PR #30](https://github.com/killroyZULU/FlyEye/pull/30) | Superseded UI context to reconcile during audit |

These branches remain unmerged. PR #38 has no attached checks at its recorded
head; the maintenance slice removes the `main`-only PR filter. Recheck live CI
before delivery claims. Merge and feature integration require separate decisions.

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
