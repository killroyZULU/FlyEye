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

## 10. Decisions still requiring qualified validation

- Final licensing, intellectual-property, warranty, support, and customer-contract language
- Pilot school agreement, named sponsor, and authorization to identify the school
- Aviation-approved permission and separation-of-duties matrix
- Minor-student consent, safeguarding, privacy, retention, and rights procedures
- Regulatory source register and approved school workflows
- Production domain, email delivery, hosting provider, Supabase region/plan, data residency, recovery, and cost
- Exact retention schedules and end-of-contract export/deletion procedures
- Review and authorization of source forms, syllabi, and workflow artifacts
