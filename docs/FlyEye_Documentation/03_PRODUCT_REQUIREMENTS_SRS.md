# Product Requirements / Software Requirements Specification

## 1. Purpose and status

This SRS defines the proposed MVP requirements. It is a controlled baseline to be validated during discovery; it is not an approved ATO procedure or regulatory interpretation. Each accepted requirement must be linked to design and test evidence using the [traceability template](templates/REQUIREMENTS_TRACEABILITY_TEMPLATE.md).

Priority uses Must, Should, Could, and Won't for the MVP.

## 2. System context

FlyEye is a multi-tenant PWA used by flight-school students, instructors, operations, training management, quality/safety, and administrators. The server is authoritative. External providers may supply email, file scanning, weather/NOTAM information, and optional AI assistance.

## 3. Functional requirements

### 3.1 Identity, organization, and access

| ID | Requirement | Priority |
|---|---|---|
| IAM-001 | Accounts shall be created by organization invitation; unrestricted public registration shall be disabled. | Must |
| IAM-002 | The system shall derive organization membership from authenticated server-side records. | Must |
| IAM-003 | Row-Level Security and protected server-side functions shall enforce permission, organization, record assignment, and allowed-state checks. | Must |
| IAM-004 | Authorized administrators shall invite, suspend, reactivate, and review members. | Must |
| IAM-005 | Privileged and operational roles shall use MFA before production pilot access. | Must |
| IAM-006 | Privileged actions shall require recent authentication where risk warrants it. | Should |
| IAM-007 | Security-sensitive account events shall be logged and alertable. | Must |
| IAM-008 | Every tenant-owned table exposed through the Supabase Data API shall use deny-by-default Row-Level Security with tested action-specific policies. | Must |
| IAM-009 | Supabase service-role credentials shall never be delivered to browser code and shall be restricted to protected operational functions. | Must |

### 3.2 Aircraft and personnel compliance

| ID | Requirement | Priority |
|---|---|---|
| CMP-001 | Authorized users shall manage organization-scoped aircraft records and operational status. | Must |
| CMP-002 | Authorized users shall store document metadata, validity dates, source, status, and private attachments. | Must |
| CMP-003 | The system shall monitor configured expiry dates and produce notifications. | Must |
| CMP-004 | Student and instructor profiles shall support school-approved licence, rating, medical, qualification, and currency metadata. | Must |
| CMP-005 | Current compliance shall be revalidated by the server at submission and approval. | Must |
| CMP-006 | Historical records shall retain the compliance/configuration snapshot relevant at finalization. | Must |

### 3.3 Dispatch and preflight

| ID | Requirement | Priority |
|---|---|---|
| DSP-001 | An authorized student or staff user shall create and save an organization-scoped dispatch draft. | Must |
| DSP-002 | A draft shall link the planned activity, date/time, aircraft, student, instructor, and configured form data. | Must |
| DSP-003 | The server shall reject submission when required or deterministic business rules fail. | Must |
| DSP-004 | Supported states shall include Draft, Submitted, UnderReview, ReturnedForCorrection, Approved, Rejected, Cancelled, Completed, and Archived, subject to approved workflow. | Must |
| DSP-005 | Every transition shall check permission, tenant, record, current state, concurrency version, and required reason/acknowledgement. | Must |
| DSP-006 | Returning a record shall preserve the submitted version and create a controlled editable revision. | Must |
| DSP-007 | Approval shall remain an explicit action by an authorized human and shall not be performed by AI. | Must |
| DSP-008 | The system shall create a final immutable snapshot and generated PDF with source/configuration versions. | Must |
| DSP-009 | Authorized post-flight entry shall record actual time, Hobbs/tach values, outcome, and basic squawk data. | Should |
| DSP-010 | Reopening/final amendment shall be restricted, reasoned, versioned, and audited. | Must |

### 3.4 Weight and balance

| ID | Requirement | Priority |
|---|---|---|
| WAB-001 | Weight-and-balance calculations shall use deterministic decimal arithmetic, not AI. | Must |
| WAB-002 | Aircraft configuration, stations, arms, limits, and envelopes shall be versioned and approved by authorized personnel. | Must |
| WAB-003 | The engine shall calculate weight, moment, CG, and configured envelope result reproducibly. | Must |
| WAB-004 | Final records shall retain inputs and the exact configuration version used. | Must |
| WAB-005 | Calculation and boundary cases shall be verified against approved examples by an aviation SME. | Must |
| WAB-006 | Changing a current aircraft configuration shall not alter historical results. | Must |

### 3.5 Weather and NOTAM information

| ID | Requirement | Priority |
|---|---|---|
| WXN-001 | The system shall preserve raw source content, provider/source, retrieval time, validity/freshness, and user acknowledgement. | Must |
| WXN-002 | Structured interpretation shall not replace access to original source information. | Must |
| WXN-003 | Stale, unavailable, or failed retrieval shall be visibly distinguished. | Must |
| WXN-004 | AI summaries, if enabled, shall be labelled advisory, source-linked, editable/rejectable, and human-reviewed. | Could |

### 3.6 Training and CBTA-oriented records

| ID | Requirement | Priority |
|---|---|---|
| TRN-001 | Authorized users shall configure courses, stages, lessons, competencies, observable behaviors, grading scales, and prerequisites. | Must |
| TRN-002 | Assigned instructors shall record assessment outcomes, strengths, weaknesses, remarks, and remediation. | Must |
| TRN-003 | Only authorized instructors shall finalize an assessment; students shall not edit finalized instructor content. | Must |
| TRN-004 | Reopening shall be restricted, reasoned, versioned, and audited. | Must |
| TRN-005 | The system shall show student progression and repeated competency results over time. | Must |
| TRN-006 | Progression gates shall be configurable and shall not allow AI to mark competence. | Must |
| TRN-007 | Student acknowledgement shall be recorded separately from instructor approval. | Should |

### 3.7 Reporting, audit, and records

| ID | Requirement | Priority |
|---|---|---|
| REC-001 | Significant creation, change, transition, approval, access, export, and administrative actions shall create an attributable audit event. | Must |
| REC-002 | Audit events shall include organization, actor, time, action, target, correlation, and non-sensitive change metadata. | Must |
| REC-003 | Audit evidence shall not be editable by ordinary application roles. | Must |
| REC-004 | Authorized users shall search and export organization-scoped operational and training records. | Must |
| REC-005 | Large exports shall require permission, reason where configured, rate controls, and logging. | Must |
| REC-006 | Basic dashboards shall cover progress, repeated items, expiries, incomplete/returned records, assessment completion, and utilization. | Should |
| REC-007 | Database and Storage-object backup/restore procedures shall be tested together and shall reconcile file metadata, hashes, and objects. | Must |

### 3.8 Offline behavior

| ID | Requirement | Priority |
|---|---|---|
| OFF-001 | After online workflows stabilize, the PWA should support local draft capture in IndexedDB. | Should |
| OFF-002 | Offline mode shall clearly show status, freshness, pending sync, failure, and conflicts. | Must if offline enabled |
| OFF-003 | Final submission, approval, current compliance checks, official PDF, and safety-relevant transitions shall require connectivity and server revalidation. | Must |
| OFF-004 | The system shall not silently overwrite conflicting server or local changes. | Must |

### 3.9 AI assistance

| ID | Requirement | Priority |
|---|---|---|
| AIA-001 | Core workflows shall remain usable when AI is disabled, unavailable, slow, or rejected. | Must |
| AIA-002 | AI requests shall pass through permission checks, data minimization/redaction, and a provider adapter. | Must |
| AIA-003 | AI outputs shall use a restricted schema and be labelled, reviewable, editable, rejectable, and logged. | Must |
| AIA-004 | AI shall not directly access the production database or final operational status functions. | Must |
| AIA-005 | Customer data shall not train a general model by default. | Must |
| AIA-006 | The first candidate feature is an instructor comment structuring assistant after the non-AI assessment workflow is stable. | Could |

## 4. Non-functional requirements

| ID | Requirement | Initial target |
|---|---|---|
| NFR-001 | Availability | ≥99% during pilot, excluding approved maintenance |
| NFR-002 | Accepted data durability | Zero lost submitted/finalized pilot records |
| NFR-003 | Usability | SUS ≥78; critical task success ≥95% before commercial release |
| NFR-004 | Accessibility | Keyboard operability, semantic labels, visible focus, contrast; target WCAG 2.2 AA review |
| NFR-005 | Performance | Define/test p95 targets after baseline; common interactions should feel responsive on school connectivity |
| NFR-006 | Scalability | Pilot 5–20 concurrent; early commercial 50–150; load tested rather than assumed |
| NFR-007 | Recovery | Initial RPO ≤1 hour and RTO ≤8 hours, proven by drills |
| NFR-008 | Security | Meet approved [Security Requirements](08_SECURITY_REQUIREMENTS.md); no unresolved critical/high exploitable issue |
| NFR-009 | Privacy | Complete PIA, data inventory, agreements, rights and retention procedures before real data |
| NFR-010 | Maintainability | Bounded modules, ADRs, tests, generated Supabase database types, documented SQL migrations and dependencies |
| NFR-011 | Observability | Health, errors, performance, security signals, audit failures, backups, jobs, and sync failures monitored |
| NFR-012 | Portability | Managed Supabase baseline while keeping domain logic independent of any AI provider and exportable from PostgreSQL |

## 5. Safety and operational constraints

- Authorized personnel retain dispatch, airworthiness, instruction, assessment, and override responsibility.
- The product must display the current source, timestamp, version, and limitations when decisions depend on external or configured information.
- Warnings cannot be silently dismissed. Any allowed override records actor, time, reason, source state, and resulting status.
- Failure to write required audit evidence blocks the associated sensitive action.
- Rules originating in aviation documents require a verified source, owner, version, effective dates, and test evidence.

## 6. Data requirements

Every operational aggregate shall include an opaque identifier, `organization_id`, status, version/concurrency token, creation/modification attribution, timestamps in UTC, archive/retention state, and audit linkage. Sensitive documents live in private Supabase Storage buckets, not as public URLs or large database binaries.

See [Database Design](05_DATABASE_DESIGN.md).

## 7. Acceptance and release

A requirement is accepted only when its implementation, automated/manual test evidence, security/tenant checks, audit behavior, documentation, known limitations, product-owner acceptance, and aviation-SME acceptance where relevant are recorded. See [QA and Test Plan](11_QA_TEST_PLAN.md).
