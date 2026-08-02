# Product and Governance Decisions

## 1. Status and authority

This register records product-owner decisions confirmed by the FlyEye founder in July 2026. It guides planning and feature specifications but does not constitute legal advice, a transfer of intellectual property, privacy approval, aviation approval, CAAP approval, a pilot agreement, or production authorization.

The documentation identifies the decision-maker as **Founder/Product Owner** without naming the person. Qualified aviation, privacy, security, legal, customer, and production reviewers retain the approval responsibilities assigned to them elsewhere in this documentation.

## 2. Product and commercial direction

- FlyEye began as a capstone project and is intended to continue development toward a real commercial product for flight schools in the Philippines.
- The intended default is that the founder or a future FlyEye company retains ownership of the platform and licenses or provides subscription access to flight schools.
- Each customer owns and controls its data. Customer data is not a FlyEye commercial training dataset.
- A transfer or sale of the platform's intellectual property occurs only through a specific written sale or assignment agreement. Final ownership, licensing, support, warranty, and data terms require a reviewed contract.
- Pricing, infrastructure budget, and the eventual commercial package remain undecided and may be adjusted to the founder's budget and validated customer value.

## 3. Pilot identity and stakeholder status

- A potential first flight school has been identified, but it remains anonymous in general project documentation until the founder prepares an approved proposal for that school.
- The founder knows potential flight-school stakeholders but has not formally approached them.
- The pilot sponsor, CFI/Head of Training or aviation SME, privacy/DPO reviewer, security reviewer, and other required approvers remain unassigned until formally engaged.
- No school participation, endorsement, approval, or commitment may be implied before written confirmation.

## 4. Organizations, memberships, and roles

- FlyEye is designed for a flight school and the people authorized under that school, not as a standalone student-only application.
- One person may have separate memberships in more than one flight school. Each membership has its own organization context and role, and selecting one school never grants access to another school's data.
- One role per organization membership remains the initial implementation default. Multiple roles may be introduced only after an approved permission matrix demonstrates the need.
- Initial demonstrations use synthetic Student Pilot, Instructor Pilot, and Organization Admin users.
- Organization Admin is a system-administration role for accounts, invitations, access, and approved configuration. It does not automatically grant Head of Training, Chief Flight Instructor, safety, quality, operations, dispatch, assessment, or other aviation authority.
- Head of Training/CFI, safety, quality, operations, and other management or operational roles require explicit future definitions, permissions, human review, and aviation-SME approval.
- A person may later hold more than one approved role when a small school's real workflow requires it, but each role must be assigned explicitly, protected by MFA and appropriate reauthentication, and audited.
- An active Organization Admin may invite, suspend, reactivate, or change roles only through protected and audited server-side commands. The system must prevent removal or demotion of the school's last active administrator.
- The first administrator is created through a protected, audited bootstrap process and then invites the school's other users.
- Separation of duties is the intended default. Administrative access does not imply operational approval authority, but the detailed self-review, self-approval, delegation, and emergency-override matrix remains pending qualified workflow review.

## 5. Authentication and account recovery

- MFA is mandatory for every user before any real-data pilot or production access.
- TOTP through an authenticator application is the initial MFA method.
- The production process must include single-use recovery codes, audited factor replacement, supervised recovery, throttling, and support procedures. SMS is not the primary MFA method.
- Password recovery uses a short-lived single-use email link, generic non-enumerating responses, throttling, and session revocation after reset. Administrators never view or manually assign user passwords.
- FlyEye does not yet have a production domain or production email identity. These may be acquired when the application approaches production readiness.

## 6. Privacy, minors, and test data

- The controlled pilot may include student pilots under 18 because minors can be enrolled in flight schools.
- Before any minor's real data is processed, the flight school as the likely data controller must obtain qualified DPO/legal review and establish the required guardian consent or authority, notices, access restrictions, safeguarding, retention, correction, and rights procedures.
- FlyEye may record consent or authority status and evidence but does not decide whether consent is legally sufficient.
- Medical and licensing records begin with necessary status, document number, validity, and expiry metadata. Private document copies are added only when the school establishes a legitimate requirement and approves access, retention, backup, and recovery controls. Diagnoses and unrelated clinical details are not collected.
- Development, automated tests, demonstrations, screenshots, and AI-assisted work use synthetic users, schools, aircraft, and records only.
- Real customer or student data remains prohibited until an approved pilot agreement, data-processing agreement, privacy review and PIA, retention schedule, named reviewers, access review, and security/recovery evidence exist.
- The founder has access to flight-school forms, checklists, syllabi, or workflow samples that may support discovery, but each artifact must be confirmed as authorized and reviewed before it is copied into the repository or implemented.

## 7. Pilot and operational boundary

- The first pilot prioritizes the Private Pilot Licence (PPL) stage.
- Commercial Pilot Licence (CPL), Instrument Rating (IR), Multi-Engine Rating (MER), and other training stages follow only after the PPL workflow is validated and separately specified.
- FlyEye is intended to improve and support flight-school operations.
- During the pilot, FlyEye runs beside the school's existing approved process and does not replace the official record or operational authority until the school completes its formal approvals and change procedures.

## 8. Hosting and environments

- The frontend remains a managed static deployment, but the provider is not yet selected.
- Separate Supabase staging and production projects on an appropriate paid plan are required before real data.
- Hosting provider, Supabase plan and region, data residency, latency, recovery capability, cost, support, and contractual terms remain subject to review.
- Development and demonstration remain local and synthetic. No staging or production environment is currently deployed.
- A production domain may be purchased when the application is sufficiently developed and production planning begins.

## 9. Delivery order and deferred scope

The approved identity-foundation sequence is:

```text
Password recovery
 -> Organization admin and MFA onboarding
 -> Member invitations
 -> User management and basic profiles
 -> Role assignment
 -> UI design checkpoint
```

The team will focus on the core identity, compliance, dispatch, operational-support, training, record-control, and reporting workflows before advanced features.

The following remain deferred until the relevant core workflows and evidence are mature:

- AI assistance;
- advanced offline synchronization;
- native mobile applications;
- intelligent scheduling;
- billing and accounting;
- full maintenance work orders;
- a safety-management suite;
- predictive student-performance or cancellation models;
- flight-data debrief and maneuver analytics;
- direct regulatory integration; and
- later training stages beyond the separately validated PPL-first pilot.

Deferred features require their own evidence, approved specification, security/privacy review, and aviation review where applicable. AI remains advisory and cannot approve dispatch, release aircraft, calculate authoritative weight and balance, or mark a student competent.

## 10. Development review and evidence governance

### Current autonomous-delivery directive — 2026-08-02

The Founder/Product Owner replaced the earlier multi-gate feature workflow with
an autonomous-delivery default. A direct request for a bounded feature, fix,
documentation task, or chore authorizes the agent to define/refine the
specification, choose safe reversible defaults, implement, verify, correct,
review, document, stage scoped files, commit, push the task branch, open a
review-ready pull request, and follow CI through green. The routine human
decision is whether to merge.

The agent does not request separate approval for specification choices,
implementation start, local acceptance, ordinary dependencies with an acceptable
license/security/maintenance assessment, commit, push, or pull-request creation.
It uses repository requirements, existing architecture, synthetic data,
fail-closed security behavior, automated negative/tenant tests, and separate
agent review to maintain quality.

Explicit narrower user boundaries override the standing envelope. Read-only,
local-only, no-commit, no-push, no-PR, draft-only, or otherwise restricted
requests stop before the prohibited action.

Human interruption is limited to merge; an irreducible product or architecture
conflict; unsupported aviation/legal/operational authority; credential or
restricted-data exposure; cross-tenant or fail-open behavior; missing mandatory
audit; destructive or uncertain cleanup; new paid providers or material
recurring costs; hosted application/provider/infrastructure/data-service
mutations other than the scoped repository branch/PR/CI publication workflow;
external messages to real recipients; real-data use; production deployment;
destructive Git/data operations; and
branch deletion. Qualified-human review is risk-triggered rather than a routine
feature gate. Legal, aviation, production, penetration-test, formal compliance,
and real-data decisions still require appropriate people when their evidence
cannot be produced by the delivery/review agents.

This directive supersedes the older authorization, acceptance, publication,
mandatory qualified-review, decision-status, proximity-report, and copy-ready
prompt requirements below for all current and future unmerged work. The older
text remains as historical evidence of how FEAT-002 and early FEAT-003 work was
governed; it must not be used to reintroduce routine approval forms.

- For bounded local development changes, a separate agent review plus the required automated verification is the default technical code-review gate. An agent review is never described or recorded as qualified independent human review.
- Review evidence may be reused when the branch, HEAD, complete working-tree content hashes, dependencies, configuration, and referenced evidence have not changed. Repeated review or a repeated full verification matrix is not required for an identical review target.
- After a correction, run focused checks for the affected behavior and then one final required verification matrix. Store or reference detailed evidence once; later status reports summarize the unchanged evidence and its identifier or location.
- Material technical findings are corrected and reverified autonomously. Human escalation is required only for the hard stops recorded above, including unsupported aviation-authoritative calculations/approvals/competency/dispatch behavior, real-data or production risk acceptance, or formal evidence that the agents cannot produce.
- The standing directive authorizes bounded Git publication through a green review-ready pull request. Merge, real-data use, deployment, and production approval remain explicit human decisions. Agent review and green automation cannot grant or imply those later decisions.
- Human aviation, privacy/legal, customer, penetration-test, pilot-readiness, and production-review duties elsewhere in the documentation remain in force where their stated risk or lifecycle gate applies.
- Every substantive FlyEye response must provide a compact evidence-based `SDLC progress` strip covering Discovery, Specification, Design, Implementation, Verification, Review, PR/CI, Merge, and Release. It identifies the current phase and next action without adding a form, approval, percentage, or acceptance gate.

### Historical 2026-07 model — guided Founder/Product Owner decisions

The Founder/Product Owner has directed Codex and other project agents to provide
guided decision support rather than expecting unaided technical or policy
choices. For each decision reserved to the Founder/Product Owner, the agent
must:

- state plainly whether a decision is needed now, later, not at all, or is
  blocked pending qualified-human validation;
- provide one evidence-based recommended option and explain why it is preferred;
- present realistic alternatives with their material benefits, risks,
  uncertainties, reversibility, and cost or schedule effects where relevant;
- state the exact authorization created by approval and every gate that remains
  closed;
- offer a short copy-ready approval response while allowing the Founder/Product
  Owner to ask questions, compare alternatives, or decline the recommendation;
  and
- combine related decisions into one concise feature decision brief where
  practical.

Agents may decide routine, reversible implementation details autonomously when
they remain within an approved specification, architecture, dependency set,
allowed file scope, and local synthetic boundary. Founder/Product Owner
decisions remain required for product outcome and scope, user-visible policy,
role or authority, risk acceptance, exact security/retention/operational values,
provider or cost commitments, implementation authorization, product acceptance,
Git actions, hosted access, real-data use, deployment, and production.

AI recommendations are advisory decision support. They do not make the
Founder/Product Owner a qualified aviation, legal, privacy, security,
accessibility, customer, or operations reviewer and do not replace any
competent-human validation required by another gate. Agents must identify
uncertainty, distinguish recommendations from verified facts, and never convert
a conversational approval into authority broader than the decision presented.

### Historical 2026-07 model — consolidated feature-delivery authorization

The Founder/Product Owner has directed the project to avoid one prompt per
command, diagnostic, test failure, or in-scope correction. The normal feature
interaction model is:

1. one bundled specification and product/security decision;
2. one bounded local-synthetic delivery envelope;
3. one local acceptance decision, optionally extended explicitly through a
   green draft pull request; and
4. separate merge, hosted-validation, real-data, deployment, and production
   decisions only when applicable.

The approved local-delivery envelope may include implementation, routine
read-only diagnosis, safe named local-service lifecycle, synthetic fixtures,
correction within allowed files and approved decisions, focused reruns, one
final verification matrix, privacy-safe evidence updates, and separate agent
review. Agents continue through recoverable local failures without requesting
another Founder/Product Owner prompt.

Material specification/architecture conflicts, scope or authority expansion,
new security/retention values, dependency/provider commitments, credential or
restricted-data exposure, cross-tenant or fail-open behavior, missing mandatory
audit, destructive or uncertain cleanup, real data, hosted access, Git activity
outside an explicit publication envelope, merge, deployment, production, and
the next feature remain stop/escalation boundaries.

An explicit authorization "through a green draft PR" may combine final checks,
scoped staging, one reviewed commit, push of the current feature branch,
draft-PR creation, and CI follow-up/correction. It never includes merge,
deployment, production, destructive Git/data actions, or scope expansion.

### Historical 2026-07 model — feature implementation proximity reporting

The Founder/Product Owner has directed every FlyEye final response to state how
close the current feature is to implementation and how the next documented
features are positioned.

The current-feature report must identify the bounded outcome, evidence-backed
stage, supporting evidence, smallest next gate, and later gates that remain
closed. The approved stages are:

1. `Not specified`
2. `Specification or decisions in progress`
3. `Ready for implementation-authorization decision`
4. `Implementation authorized, not started`
5. `Implementation in progress`
6. `Locally implemented; required verification pending`
7. `Locally verified; competent review or product acceptance pending`
8. `Locally accepted; Git publication pending`
9. `Published; hosted validation pending`
10. `Hosted validated; deployment or production approval pending`
11. `Production approved`

These stages report evidence, not probability or elapsed effort. A numeric
percentage may be used only when it names a defined checklist and denominator.
No stage completes or widens implementation authorization, competent review,
product acceptance, Git publication, hosted validation, real-data use,
deployment, or production approval.

Each response must also provide a concise upcoming-feature outlook. When
available, it covers the next three named features and records each feature's
stage, predecessor or blocking dependency, and next evidence needed before it
may start. More distant roadmap work may be grouped. Agents must not invent
dates, effort estimates, specifications, authorization, or completion.

For corrected FEAT-002, the completed Codex review and automated verification are the technical code-review evidence. The full verification matrix is not repeated while the implementation fingerprint, dependencies, configuration, and evidence remain unchanged. No qualified independent human technical or security/privacy review was performed. The Founder/Product Owner completed the focused human desktop keyboard/visual walkthrough and, on 2026-07-27, accepted the bounded local MVP outcome together with the documented residual local evidence limitations for the current publication decision. The feature was then normally merged through PR #5 from retained branch commit `fd1bd2f9aef9bce159b93ce76dd7530371f2d897` into development `main` at merge commit `4f993f0d0dc40f8a5783ae5176ffe2ef6000ca94`; pre-merge CI run `30237389881` and post-merge `main` CI run `30237614093` both passed Application quality and Local Supabase security. This merge performed no deployment and grants no hosted validation, real-data use, production approval, or FEAT-003 authority. The accepted residual local accessibility limitations remain unchanged.

On 2026-07-27, the Founder/Product Owner separately authorized documentation work for FEAT-003 Organization Admin and MFA Onboarding from exact development baseline `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66` and approved FEAT-003-DEC-01 through FEAT-003-DEC-05 exactly as written. The approved specification limits the bounded local outcome to first-Organization-Admin onboarding, uses a server-held local synthetic bootstrap grant unavailable to browser roles, requires server-verified password AMR no older than 10 minutes plus current TOTP/AAL2 at completion, requires finite grant expiry, and fails closed for duplicate, mixed, unknown, or uncertain factor states without verified-factor replacement or deletion. At that specification-approval point, the exact local grant lifetime remained a blocking implementation-start decision; the later implementation-readiness decision below resolves it. This specification approval does not authorize implementation, Git publication, hosted access, real data, deployment, production, or FEAT-004.

The Founder/Product Owner later approved the FEAT-003 implementation-readiness values on 2026-07-27. Local synthetic grants expire exactly 30 minutes after server-recorded issuance with no sliding extension, must be rechecked at onboarding start and atomic completion, and are terminal after expiry, revocation, or consumption. The future local issuer/test setup is the CLI-only ephemeral `scripts/test-feat-003-runtime.mjs` fixture, restricted to loopback Supabase, randomized `.test` data, local administrative credentials held only in process memory, direct local PostgreSQL insertion, bounded cleanup, and no browser/application issuance path. Production grant issuance and its operating runbook remain deferred and blocked. This documentation-only decision grants no implementation, Git publication, hosted access, real-data, deployment, production, or FEAT-004 authority.

After a read-only independent design review identified implementation-blocking ambiguities, the Founder/Product Owner authorized a documentation-only FEAT-003 amendment on 2026-07-27. The approved direction uses an explicit non-human local-fixture audit source; strict timestamped AMR and an exact 600-second password window at onboarding start/completion; server-only authentication evidence into the completion RPC; PostgreSQL-authoritative grant time, locking, and idempotency; explicit `PUBLIC` and browser-role denial; defined protected action contracts; complete factor inventory with no automatic deletion without server-verifiable ownership; fail-closed handling of the Auth/database consistency boundary; and hardened local fixture attestation/transaction/cleanup evidence. The administration placeholder requires password AMR and current AAL2/TOTP but not a continuously renewed 10-minute password window; later sensitive administrative commands require their own approved recent-authentication rule. These controls remain proposed and require post-amendment verification, competent human risk review, and separate implementation authorization.

## 11. Decisions still requiring qualified validation

- Final licensing, intellectual-property, warranty, support, and customer-contract language
- Pilot school agreement, named sponsor, and authorization to identify the school
- Aviation-approved permission and separation-of-duties matrix
- Minor-student consent, safeguarding, privacy, retention, and rights procedures
- Regulatory source register and approved school workflows
- Production domain, email delivery, hosting provider, Supabase region/plan, data residency, recovery, and cost
- Exact retention schedules and end-of-contract export/deletion procedures
- Review and authorization of source forms, syllabi, and workflow artifacts
