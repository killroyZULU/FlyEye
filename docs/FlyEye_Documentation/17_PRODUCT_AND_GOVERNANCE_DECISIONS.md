# Product and Governance Decisions

## Status and authority

This register contains active Founder/Product Owner decisions. It guides product work but is not legal advice, regulatory approval, customer acceptance, a pilot agreement, or production authorization.

The decision-maker is identified as Founder/Product Owner without naming the person or candidate school. Aviation, privacy, legal, security, customer, penetration-test, pilot, and production reviewers retain their applicable responsibilities.

Superseded decision processes remain available through Git history. They are not active policy and must not be copied into feature documents.

## Product and commercial direction

- FlyEye will evolve from a capstone into a licensable Philippine flight-school product.
- The product serves flight schools and their authorized students, instructors, operations personnel, and administrators; it is not a standalone student application.
- Customers retain ownership and control of their data. FlyEye may process it only under an approved agreement and documented instructions.
- Initial commercial testing focuses on one anonymous candidate school and a PPL-first workflow. Participation or endorsement cannot be implied before written agreement.
- Pricing, contract, warranty, support, intellectual-property, and service-level terms remain unresolved.

## School deployments, memberships, and roles

- Each flight school receives a separate frontend, cloud/Supabase project, database, Auth, Storage, secrets, backups, and provider configuration from the same versioned product; the platform does not host multiple schools in one deployment.
- A deployment contains at most one organization and one membership per user. The application derives school context and provides no school selector.
- `organization_id`, deny-by-default RLS, protected commands, and cross-school negative tests remain mandatory defense-in-depth.
- One role per membership is the initial default. Future multiple roles require explicit assignment and an approved separation-of-duties matrix.
- School-validated FlyEye roles are version-controlled permission bundles. Interfaces and protected actions check permissions rather than treating a job title as authority; adding a role never grants aviation or operational authority by implication.
- Organization Admin is an access-administration role. It grants no automatic training, safety, quality, operations, dispatch, assessment, or approval authority.
- Membership and role changes use protected, audited commands with appropriate reauthentication.
- Ordinary administration cannot remove or demote the last active Organization Admin.
- The first Organization Admin uses the protected audited FEAT-003 bootstrap; later members use the separately scoped FEAT-004 invitation workflow.

## Authentication and account recovery

- Accounts are invitation-only; unrestricted public registration is disabled.
- TOTP/AAL2 is mandatory for administrators, instructors, and any authority-bearing role or protected action. Student non-privileged portal access may use password-authenticated AAL1.
- Email links or codes may verify mailbox control and support recovery but do not replace privileged MFA.
- Production readiness requires single-use recovery codes, audited factor replacement, supervised recovery, throttling, and support procedures.
- Password recovery uses a short-lived single-use email link, generic non-enumerating responses, throttling, and session revocation. Administrators never view or assign passwords.
- A production domain, email identity, provider configuration, and support process are not yet selected.

## Privacy, minors, and test data

- Development, tests, logs, screenshots, demonstrations, and prompts use synthetic data unless a later explicit real-data decision is made.
- The likely model is the flight school as Personal Information Controller and FlyEye as Personal Information Processor, subject to contract and qualified review.
- Before processing a minor's data, the controller must establish qualified legal/privacy review, guardian authority or consent where required, notices, safeguards, access, retention, correction, and rights procedures.
- Source forms, syllabi, checklists, and workflow samples may enter the repository only after authorization to use them is confirmed and their requirements are reviewed.

## Pilot and operational boundary

- The proposed pilot is PPL-first and runs beside the school's existing approved process.
- FlyEye does not become the official record or operational authority until the school completes its approvals and change procedures.
- Pilot scale, duration, participants, baseline metrics, success measures, source workflows, training, support, incident roles, and exit criteria require a written agreement.
- Later CPL, IR, MER, and other stages require separate validated sources and specifications.

## Hosting and environments

- The frontend remains a managed static deployment; the provider is undecided.
- Separate Supabase projects, credentials, buckets, provider secrets, frontend deployments, backups, and monitoring are required for every school and lifecycle environment.
- Development remains local and synthetic. No production environment or real-data workflow is approved.
- A hosted synthetic run requires an exact approved target, provider/plan/region, cost ceiling, secure credential path, fixed frontend origin, monitoring owner, retention, cleanup, recovery plan, and any applicable risk-triggered qualified review.
- FEAT-003 hosted-readiness planning is deferred until at least two non-identity-and-access product-workflow features are merged with their applicable local synthetic verification recorded. Login, password recovery, MFA and administrator onboarding, invitations, user/profile administration, and role assignment do not count toward this threshold. Reaching the threshold reopens hosted-readiness planning; it does not authorize a hosted resource, paid plan, credential use, real data, deployment, or production.
- Production hosting, domain, email, data residency, backup, recovery, monitoring, and cost commitments remain separate decisions.

## Delivery and review policy

- A direct request for one bounded feature, fix, documentation task, or chore authorizes routine work through a green review-ready pull request under `AGENTS.md`.
- The agent owns safe reversible choices supported by repository evidence. It does not request approval for each command, routine value, correction, local check, commit, push, or pull-request creation.
- A separate agent review plus applicable automation is the default technical gate for bounded local or repository-only work. It is not qualified independent human review.
- Detailed evidence is recorded once and referenced while the reviewed target remains unchanged.
- Merge, real data, production deployment, destructive actions, branch deletion, unsupported regulated authority, and the other hard stops in `AGENTS.md` remain human or external boundaries.
- Legal, aviation, privacy, security, customer, penetration-test, formal-accessibility, pilot-readiness, and production review is requested when the claim or risk inherently requires qualified human evidence.
- Every substantive work update uses the compact SDLC progress strip in `AGENTS.md`; it is orientation, not authorization.

## Delivery order

The approved near-term identity-and-access sequence is FEAT-004 Member Invitations, FEAT-005 User Management and Basic Profiles, and FEAT-006 Role Assignment. Hosted activation remains deferred under [Hosting and environments](#hosting-and-environments) and does not interrupt that sequence.

After FEAT-002 through FEAT-006, hold a UI design checkpoint before expanding the operational modules. The detailed sequence is maintained in [Product Roadmap](14_PRODUCT_ROADMAP.md).

## Decisions still requiring qualified validation

- Licensing, intellectual-property, warranty, support, pricing, and customer-contract terms
- Pilot school agreement, named sponsor, baseline metrics, and permission to identify the school
- Regulatory source register and approved school workflows
- Aviation permission and separation-of-duties matrix
- Minor-student safeguards and exact privacy/retention procedures
- Hosting provider, Supabase region/plan, domain, email, recovery, monitoring, and cost
- Customer export, deletion, and end-of-contract procedures
- Authorization to use source forms, syllabi, and workflow artifacts

Feature completion and current project status belong in [Current State](CURRENT_STATE.md) and feature traceability records, not in this decision register.
