# Feature Specification: FEAT-009 — Personal Credential Tracker

## Purpose and source

One school member maintains evidence-backed personal credentials for designated
school review. Approval records school acceptance of submitted details; it does
not verify authenticity with a regulator or establish fitness for a flight.

Source: owner-supplied `FlyEye_Personal_Credential_Tracker_Requirements_v0.1.docx`.
The CR and AC identifiers below preserve its business boundary. Its embedded
coding prompt is not execution authority. The [decision register](../17_PRODUCT_AND_GOVERNANCE_DECISIONS.md#personal-credential-tracker)
distinguishes selected product decisions from remaining proposals. This is a
prospective contract; [traceability](FEAT-009_TRACEABILITY.md) owns evidence.

Excluded: flight planning, dispatch/eligibility engines, regulator verification,
OCR, signatures, bulk imports, owner impersonation, public sharing, additional
credential categories, delegated/emergency approval, multiple-role redesign,
school-specific forks and unrelated R5 work. Real-data and production acceptance
follow the existing release gates. Shared synthetic staging has its own
[contract](FEAT-003_SYNTHETIC_STAGING_BASELINE.md), not feature rollout authority.

## Requirements

### CR01 Shared person and applicability

Use one existing school membership/profile and Auth identity for trainee,
instructor or both. Dual applicability uses instructor requirements without
duplicating shared credentials. Mother license and medical certificate are
required for both. Trainees may mark NTC radio license and ELP not yet obtained;
instructors require them and additionally see optional FI/GI licenses.

### CR02 Mother license

Allow one current mother license, type SPL/PPL/CPL/ATPL. Approved replacement
supersedes the previous version while preserving its approval and history.
License type is credential data, not an application authorization role.

### CR03 Dates and category fields

Store issue date, either expiry date or explicit No expiry, mother-license number
and ELP level where applicable. No expiry requires evidence and review, including
SPL and ELP Level 6; never infer it from type, level or a blank date. Use TD02 and
TD07 for date/field semantics.

### CR04 Access scope

Derive school, membership and permissions from server-controlled records on every
read, command, evidence request and notification destination. UI visibility and
job titles are not authority. Apply the TD01 matrix through existing RBAC.

### CR05 Evidence-backed submissions

Every initial submission and replacement requires evidence tied to that exact
version. All required uploads must pass validation and synthetic processing
before a submission becomes reviewable. Failed, missing, quarantined or unknown
files cannot produce metadata-only continuation. Apply TD04.

### CR06 Pending uniqueness

Permit at most one pending submission per owner/category. Submitted content is
immutable. Withdrawal preserves history; correction or replacement creates a new
submission with evidence. Different categories can be reviewed independently.

### CR07 Current versus pending

An existing approved version remains current during pending, rejected or
withdrawn replacement. Its expiry continues normally. Show proposed values
separately; first submission has no approved current version. Missing, optional,
not-yet-obtained, expired and pending are distinct states.

### CR08 Designated decisions

Only an active, permitted same-school HoT/CFI can decide another owner's pending
submission. Deny both self-approval and self-rejection. Without an eligible
reviewer the submission remains pending; ordinary Admin cannot bypass this.

### CR09 Rejection

Rejection requires a nonblank reason visible to the owner. Approval requires no
reason. Rejection preserves any current approval; correction uses a new
evidence-backed submission.

### CR10 Atomic approval

Approve exactly the reviewed immutable version. Serialize the credential and
submission; recheck authority, school, owner and expected state after relevant
waits and before effects. Atomically record the decision, current pointer,
supersession, mandatory audit and notification intents. Audit failure rolls back
the action. External delivery occurs afterward.

### CR11 History

Preserve attributable submission, withdrawal, approval, rejection and
supersession events: actor, UTC timestamp, credential/version identifiers,
changed fields and applicable reason. Owners see their own history; authorized
school readers see personnel history. TD05 owns evidence retention boundaries.

### CR12 My Credentials

Use existing authenticated navigation for applicable cards, approved details,
evidence/history, initial/replacement submission, withdrawal, missing/optional
items, expiry cues and rejection feedback. Use readable labels, keyboard access
and loading, empty, error, unauthorized, conflict and success states.

### CR13 Personnel Credentials

Provide permitted school readers search, missing/expiring/expired filters, pending
queue and history. Reviewers compare current values, submitted values and
evidence together. Only eligible reviewers have enabled decision actions.

### CR14 Scheduled reminders

Notify owner and eligible school readers in-app and by email at 30 days, 15 days
and expiry day, once per approved version/recipient/threshold. Keep expired cues
visible. Pending renewal does not suppress current-record warnings; explicit
no-expiry produces none. TD03 defines catch-up and channel deduplication.

### CR15 Late approval and renewal

Approval inside a missed threshold creates the current-band warning under TD03.
Approved renewal stops undispatched reminders for the superseded version;
preserve historical events. Approval of an already-expired record is allowed but
never resets its dates or removes its expired cue.

### CR16 Review notifications

Submission notifies eligible designated approvers; decision notifies the owner,
in-app and by email. Exclude the owner from actionable self-review notifications.
Other school readers track history without every review email.

### CR17 Delivery outcome

Persist in-app events independently of email success. Track channel attempts and
sanitized failure/uncertainty. Recheck recipient school, membership, permission
and event relevance before each dispatch. Revoked recipients receive no later
private notification. Email contains only the action/warning and authenticated
link, never license numbers, medical details, attachments or public evidence URLs.

### CR18 Server validation

Submitted values and evidence form one immutable reviewable unit. Validate
required fields and dates server-side: issue date cannot exceed expiry; No expiry
excludes an expiry date. TD07 defines school-entered fields, not regulator rules.

### CR19 Private evidence

Protect staging, preview and download against unauthenticated, expired,
cross-owner and cross-school access, including direct identifiers/links. Validate
actual bytes, extension/type, size and bounds. Only clean synthetic files are
available. New fetches require current authorization; previously downloaded bytes
cannot be recalled. Reusable signed links are not assumed to meet revocation
requirements; settle the serving design before S2.

### CR20 Concurrency and retry

Use exact submission/version, expected concurrency state and idempotency key.
Concurrent decisions produce one final outcome/current version. Same-key,
same-payload retry returns its recorded outcome after current authorization,
without duplicate decisions, audit or notices; changed payload fails. A different
request against a withdrawn, replaced or decided version returns conflict and
requires refresh. Lost responses require outcome reconciliation, not blind replay.

### CR21 Current authority

Revoked review authority blocks a later decision even with an open review screen.
Owner commands cannot target another person's identifiers. Deny cross-school
search, metadata, evidence, history and notification-link access. Verify races
with observed ordering and complete state comparison, not elapsed-time guesses.

### CR22 Approved-record boundary

Retain stable approved-version IDs, category/type, dates, explicit no-expiry and
approval metadata. Future consumers reference the approved version used; renewal
does not rewrite historical references. Pending submissions are ineligible. No
flight-planning API or eligibility engine is included.

## Selected technical decisions

### TD01 Applicability and reviewer bundles

Administrators manage trainee/instructor/both applicability through a protected,
audited command. Applicability changes completeness, never permissions. Keep one
assigned role per membership and the existing assignment safeguards, MFA readiness,
recent-authentication requirements and last-admin protection.

| Actor                    | Credential permissions                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                    | Own read/evidence/history; submit, withdraw and replace own pending                                                                                                        |
| Other trainee/instructor | None for another owner, including their students                                                                                                                           |
| Organization Admin       | Same-school personnel/evidence/history read and expiry notices; applicability management; no credential editing or review                                                  |
| HoT / CFI                | Identical credential permission set: school read/history/evidence, expiry and submission notices, decisions for other owners; retain existing Instructor Pilot permissions |

HoT/CFI are version-controlled bundles in existing RBAC, not custom/multiple roles.
No automatic account administration, invitation, role-assignment or operational
authority is added. Combined Admin/reviewer assignment remains a separate decision.
Expiry recipients qualify through explicit credential school-read/reminder
permissions. Role assignment is protected and audited; no self-assignment.

### TD02 Calendar semantics

Use server-calculated date-only values in Asia/Manila, regardless of device zone.
An approved record remains unexpired through its expiry date and becomes expired
at the following midnight. Audit timestamps remain UTC.

### TD03 Current-band catch-up

| Days remaining | Immediate applicable event/cue       |
| -------------- | ------------------------------------ |
| More than 30   | No warning                           |
| 16–30          | 30-day band                          |
| 1–15           | 15-day band                          |
| 0              | Expires today / expiry event         |
| Below 0        | Expired / same expiry-event identity |

Use one current-band catch-up on late approval, job recovery or new recipient
eligibility; never replay all missed bands. Later thresholds remain scheduled.
Deduplicate by school, approved version, recipient membership and threshold, with
separate channel attempts. Overlapping owner/admin eligibility is one recipient.
An expiry-day notice prevents another overdue email the next day; the cue changes.

### TD04 Synthetic file policy

Accept one PDF OR one/two JPG/JPEG/PNG images (mixed image formats allowed), never
PDF plus images. Maximum 10,000,000 bytes per file, 200 PDF pages, 40 megapixels
per image. Reject malformed, encrypted or password-protected PDFs and unsupported
content. Show clean images in-app; PDF uses authenticated download. Use private
staging and deterministic synthetic validation only. Real-upload scanning and
safe processing remain unresolved release gates.

### TD05 Retention boundary

Retain current/superseded/rejected/withdrawn synthetic records and evidence for
the development lifecycle. Deactivation revokes access and preserves history.
Abandoned/failed unlinked objects remain inaccessible until controlled cleanup
proves no operation can still link them. Only exact owned disposable synthetic
fixtures may be removed under an authorized lifecycle. No age purge, user
permanent deletion or account cascade. Real-data periods, holds, backup/object
deletion and permanent-deletion procedures must be settled before real uploads;
this is not a real-data retain-forever policy.

### TD06 Synthetic delivery

Use local capture/synthetic sender and a controlled local clock/runner first.
Allow five total attempts: initial plus transient retries on the selected
1-minute, 5-minute, 30-minute and 2-hour schedule. Before S4, specify whether these
are intervals or offsets, clock origin and retry exhaustion behavior; do not
silently interpret that unresolved detail. Permanent failures stop. Ambiguous
provider acceptance becomes uncertain; retry only with idempotency/reconciliation.
Provider acceptance is not delivery. Authorized failure visibility is sanitized.
External delivery and hosted scheduling follow the separate staging gate.

### TD07 Field and completeness rules

Mother-license number: trimmed 1–80 characters, preserve leading zeros, letters
and punctuation; reject control characters, without a regulator-format regex.
ELP: school-entered levels 1–6 matching evidence. Issue date is required and no
later than today in Manila; expiry or No expiry is exclusive. Expired dates may
be submitted. Trainee NTC/ELP may be Not yet obtained; optional FI/GI may be Not
provided. Neither hides an existing approval. Removing instructor applicability
preserves records, pending work and history; FI/GI become Not currently required.
Adding instructor applicability makes NTC/ELP required without auto-approval.
Reviewers see current applicability. Role changes do not silently change it.

## Architecture and unresolved design

Reuse `organizations`, `organization_memberships`, `organization_member_profiles`,
existing roles/permissions and protected assignment. A proposed credential
aggregate is unique by school/owner/category, with immutable submissions,
current-approved pointer, decision transitions and append-only events. Every
tenant row retains `organization_id`, composite integrity and deny-by-default RLS.
Table/function names and exact migration design require S1/S2 review.

Existing aircraft versioning, audit, idempotency and notification patterns are
reusable; aircraft-bound `stored_files` is not a personal-evidence store. Propose
a dedicated private bucket/metadata boundary without broadening aircraft access.
PostgreSQL/Storage are not one transaction: failed linking leaves private orphans
for TD05 handling. Extend existing notification capabilities without a parallel
identity, permission or notification system.

Credential authentication follows [the selected session policy](../08_SECURITY_REQUIREMENTS.md#selected-session-policy).
The shared enforcement mechanisms, qualifying reauthentication, activity
coalescing, endpoint/file bypass inventory and hosted evidence remain unverified
design work. Do not fold their implementation into S0 or the staging smoke test.

## Delivery slices

| Slice | Reviewable outcome and dependency                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0    | Canonical contract, decision/policy reconciliation, linked CR/AC map and staging contract; repository documentation only                                       |
| STG   | Separately bounded [synthetic hosted baseline](FEAT-003_SYNTHETIC_STAGING_BASELINE.md); independent of credential implementation                               |
| S1    | Applicability/access using existing identity/RBAC and empty permission-filtered views; depends on S0/TD01; safe local work need not await STG                  |
| S2    | Evidence-backed owner submission, withdrawal/replacement; depends on S1, TD04/TD07 and evidence/session design; STG accepted before hosted upload verification |
| S3    | Reviewer comparison, atomic decision/audit, history and review-notification intents; depends on S2                                                             |
| S4    | Date cues/filtering, deduplicated notices and synthetic delivery attempts; depends on S3 and TD02/TD03/TD06; external email/scheduler separately approved      |
| S5    | Synthetic journeys and CR/AC evidence closure at identified local/hosted revisions; release limitations remain explicit                                        |

Follow the existing [integration checkpoint](../09_AI_DEVELOPMENT_GUIDE.md#integration-checkpoint)
for prerequisite merges or an explicitly directed stack. Shared staging is a
dependency of hosted verification, not permission to provision. Acceptance is
the [AC matrix](FEAT-009_TRACEABILITY.md#acceptance-and-planned-evidence), not
completion of documents or mock tests alone.
