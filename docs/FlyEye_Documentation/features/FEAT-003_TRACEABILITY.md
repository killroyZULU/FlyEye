# FEAT-003 Requirements Traceability

## Status and evidence boundary

This record traces the proposed FEAT-003 Organization Admin and MFA Onboarding specification against the authoritative FlyEye requirements and the inspected baseline at `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66`.

Historical record, superseded for local implementation and publication by the
2026-08-02 autonomous-delivery directive: the Founder/Product Owner approved
the bounded outcome and FEAT-003-DEC-01 through FEAT-003-DEC-05 exactly as
written on 2026-07-27. The bracketed amendment instructions in the approval
prompt were not amendments. The Founder/Product Owner later approved a
30-minute non-sliding exact local lifetime for FEAT-003-DEC-04, named the
CLI-only ephemeral `scripts/test-feat-003-runtime.mjs` local fixture, authorized
the documentation-only independent-design-review amendment on 2026-07-27,
authorized the documentation-only limiter-monitoring evidence correction and
staged-review-gate amendment on 2026-07-28, and approved the provisional
local-only limiter and operations choices for documentation-only recording on
2026-07-28. The final strictly read-only post-amendment documentation
verification completed on 2026-07-28 against baseline HEAD
`b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66` and tracked working-tree
fingerprint `95bd2c6fce6f7819725733da692ab827aa0eb85b`; it resolved
`DOC-STATUS-01`, confirmed all substantive documentation requirements, and
found no remaining documentation conflict. The then-current staged-review gate
permitted a separately authorized bounded local synthetic implementation to use
separate agent review plus required automation before competent review, but it
required attributable review before local acceptance or Git publication. The
strictly read-only gate verification completed on 2026-07-28 against tracked
working-tree fingerprint `14dc4252fb90bd0ed3febc33dab3987568bd0db0`; all
fourteen requirements passed and no documentation conflict remained. The
strictly read-only provisional local limiter and operations documentation
verification then completed on 2026-07-28 against tracked working-tree
fingerprint `27014d8b60c17c129dfd29513fea79abe89f9483`; all fourteen
requirements passed and no documentation conflict remained. At that historical
documentation-only checkpoint, schema, RLS, protected-function, limiter, audit,
frontend, fixture, and test impact remained proposed and unimplemented.

Current status superseding the documentation-only baseline: the Founder/Product
Owner later authorized the bounded local synthetic implementation on
`feat/FEAT-003-organization-admin-mfa-onboarding` from the same baseline HEAD.
The preserved uncommitted working tree contains the migration, protected
function, shared authentication evidence, frontend flow, tests, generated type,
and sanitized runtime fixture. Under the 2026-08-02 autonomous-delivery
directive, FEAT-003 is `Locally verified; publication pending`: the stabilized target passed the complete local
synthetic application/database matrix, all three runtime fixtures, repository
and history secret scans, and exact zero-residue cleanup on 2026-08-02.
Contaminated diagnostic transcripts are excluded from acceptance/review
evidence. The corrected separate-agent review and automated evidence satisfy the
local technical publication gate. This status is not Git publication, merge,
hosted validation, real-data approval, deployment, production approval, or
FEAT-004 authority. Qualified-human review is risk-triggered for later regulated,
real-data, hosted, production, penetration-test, or formal-compliance claims.

## Decision traceability

| Decision ID | Question | Approved choice | Authority/evidence still required | Current result |
|---|---|---|---|---|
| FEAT-003-DEC-01 | Does this slice enroll only the first Organization Admin or all existing roles? | First Organization Admin only for the bounded local slice; universal MFA remains mandatory before real data or production. | A scope expansion requires a specification amendment. | Approved 2026-07-27 |
| FEAT-003-DEC-02 | Who may authorize first-admin eligibility? | CLI-only ephemeral `scripts/test-feat-003-runtime.mjs` fixture; loopback-only, randomized `.test` data, local-stack credentials held only in process memory, direct local PostgreSQL insertion, bounded cleanup, and no browser/application issuance path. Production issuer and runbook remain deferred. | Automated and separate-agent review verify the local guard, credential handling, direct-path denial, cleanup failure, and absence of an application issuer. Qualified review remains required before hosted or real-data use. | Approved 2026-07-27; local fixture named 2026-07-27; local evidence passed 2026-08-02 |
| FEAT-003-DEC-03 | How recent must password authentication be? | Server-verified password AMR within 10 minutes at onboarding start and completion; current AAL2/TOTP at completion. | Pinned-runtime evidence remains required during implementation. | Approved 2026-07-27 |
| FEAT-003-DEC-04 | How long may a bootstrap grant remain usable? | Exactly 30 minutes from server-recorded local issuance; non-sliding; rechecked at start and completion; terminal after expiry, revocation, or consumption; replacement requires a new grant. | Implementation and adversarial expiry/replay/concurrency evidence remain required; production duration/operations remain separately reviewed. | Approved 2026-07-27 |
| FEAT-003-DEC-05 | How are existing or duplicate factors handled? | Reuse exactly one verified TOTP; duplicate/mixed/uncertain factor state fails closed; no verified-factor deletion or replacement. | Pinned-runtime factor-lifecycle evidence remains required during implementation. | Approved 2026-07-27 |
| FEAT-003-DESIGN-AMD-01 | How are the independent design-review blockers resolved? | Constrained non-human fixture audit source; strict timestamped AMR and exact 600-second boundary; trusted Edge-to-RPC evidence; PostgreSQL expiry/locking/idempotency; `PUBLIC`/browser denial; complete action contracts; complete factor inventory with no unproven deletion; explicit Auth/database boundary; hardened same-stack transactional fixture. | Automated evidence and corrected separate-agent review satisfy local publication; qualified review is risk-triggered for later applicable claims. | Documentation amendment authorized 2026-07-27; local evidence passed 2026-08-02 |
| FEAT-003-DESIGN-AMD-02 | How are provider/platform limits distinguished from FlyEye endpoint abuse controls? | Record the declared local Supabase Auth values; explicitly record that `auth-bootstrap` has no FlyEye-controlled limiter at the baseline; require an atomic, server-enforced, privacy-reviewed per-action limiter plus mandatory privacy-minimized monitoring/recovery evidence. | The local choices passed automated limiter and recovery evidence plus corrected separate-agent review; hosted evidence and values remain separate. | Documentation clarification authorized 2026-07-27; local automated evidence passed 2026-08-02 |
| FEAT-003-DESIGN-AMD-03 | When must competent human review complete? | Historical answer: the 2026-07 staged model required attributable review before local publication. Current answer: the 2026-08-02 autonomous-delivery directive makes qualified-human review risk-triggered and uses automation plus separate-agent review for local publication. Material defects or unsafe authority still stop work immediately. | This change does not relax hosted, real-data, deployment, production, branch-deletion, or FEAT-004 gates. | Historical amendment retained for provenance; superseded for local publication on 2026-08-02 |
| FEAT-003-DESIGN-AMD-04 | Which limiter and operations choices make the bounded local synthetic implementation executable and testable? | PostgreSQL-authoritative atomic token buckets: `status` 12/60 seconds burst 4; `start` 4/60 seconds burst 2; `complete` 3/60 seconds burst 1; `cancel` 6/60 seconds burst 2. Use HMAC subject/action keys with a dedicated ephemeral local secret, no local IP/forwarded-header trust, 15-minute inactive-state retention and fixture cleanup, fail-closed `status`/`start`/`complete`, safe local cleanup/sign-out for uncertain `cancel`, one-occurrence stop-work monitoring, and no override/bypass. | Local values passed automated and separate-agent review; hosted and production values remain unresolved. | Approved 2026-07-28; local evidence passed 2026-08-02 |

## Requirements matrix

| Need ID | Source/problem | Requirement ID | Feature/design | Data/API impact | Security/privacy/safety control | Planned test IDs/evidence | Current result | Approver/date |
|---|---|---|---|---|---|---|---|---|
| FEAT-003-01 | A flight school needs one controlled first administrator before invitations can begin | IAM-001/002/003; Security Requirements section 4; governance section 4 | Thirty-minute non-sliding single-use first-admin grant and protected completion | New `organization_admin_bootstrap_grants`; CLI-only local fixture; protected status/start/complete/cancel command; atomic completion RPC | PostgreSQL issuance time; constrained `local_fixture` source with null human actor; grant/audit one transaction; no browser/application issuer; audit failure blocks | DEC-02/04; DESIGN-AMD-01; AC-01/02/11/13/23/24/25; SQL-01; RPC-01/03; EDGE-01; FIXTURE-01/02 | Local automated implementation/runtime evidence and corrected separate-agent review passed 2026-08-02 | Founder/Product Owner approvals 2026-07-27 |
| FEAT-003-02 | MFA population must be bounded without weakening the universal release gate | IAM-005; Security Requirements section 3; governance section 5 | Approved first-admin-only local onboarding; universal MFA retained before real data/production | Auth routing and acceptance matrix only after implementation authorization | No Student/Instructor widening; no real data until universal MFA and recovery/support gates pass | DEC-01; AC-20/21/22; REG-01 | Local automated scope/regression evidence passed 2026-08-02; later gates remain closed | Founder/Product Owner specification approval 2026-07-27 |
| FEAT-003-03 | TOTP enrollment must prove possession without leaking the secret | IAM-005/007/009; NFR-004/008 | One in-memory TOTP enrollment with QR and manual-secret alternative | Supabase Auth MFA enroll/challenge/verify; no application secret storage | Secret excluded from database, logs, URL, storage, analytics, snapshots, screenshots, docs, and prompts; safe image rendering | AC-04/05/19; UNIT-05; AUTH-01; SCAN-01 | Local automated implementation/runtime/secret-scan evidence passed 2026-08-02; competent security/privacy/accessibility review pending | Security/privacy/accessibility review pending |
| FEAT-003-04 | Existing MFA users must not receive silent duplicate factors | IAM-005/007; Security Requirements section 3 | Exactly one verified TOTP is challenged; duplicate/mixed state conflicts | Factor inventory validation; no verified-factor mutation | Fail closed; no automatic factor choice, deletion, replacement, or downgrade | DEC-05; AC-07/08; UNIT-04; AUTH-03; COMP-04 | Local automated implementation/runtime evidence passed 2026-08-02; competent security review pending | Founder/Product Owner specification approval 2026-07-27; security review pending |
| FEAT-003-05 | Invalid, cancelled, stale, or failed onboarding must not create authority | IAM-003/005/007; NFR-008 | Bounded retries, no automatic unproven factor deletion, stale-operation invalidation, safe terminal states | Provider challenge plus protected cancellation audit; cleanup is a non-atomic provider boundary | No membership until atomic completion; without server-verifiable binding no unenroll call occurs; uncertainty fails closed | DESIGN-AMD-01; AC-06/09/10/18/29/30; UNIT-02/03; COMP-02; AUTH-02; SEC-02 | Local automated failure/provider-boundary evidence passed 2026-08-02; competent security/accessibility review pending | Security/accessibility review pending |
| FEAT-003-06 | Protected access needs fresh password and TOTP evidence | IAM-003/005/006; architecture section 7 | Exact 600-second strict password AMR at start/completion; current AAL2/TOTP at completion; password AMR plus current AAL2/TOTP for placeholder access | Edge validates strict timestamped objects and complete factors; internal evidence only; RPC rechecks password time against PostgreSQL transaction time | String-only/malformed/future/stale/client evidence ignored; OTP-only recovery/email/magic-link denied | DEC-03; DESIGN-AMD-01; AC-02/05/11/14/26/30; UNIT-03; EDGE-01; SEC-01/02 | Local automated implementation/runtime evidence and corrected separate-agent review passed 2026-08-02 | Founder/Product Owner amendment 2026-07-27 |
| FEAT-003-07 | A multi-school identity must choose one tenant without widening access | IAM-002/003/010; architecture section 6 | Explicit membership/grant selection and revalidation; identity-scoped factor | Opaque membership/grant hint; organization derived server-side | Prior tenant UI cleared; factor grants no membership; direct and protected cross-tenant denial | AC-03; COMP-03; RLS-02; TENANT-01; E2E-02 | Local automated cross-tenant evidence passed 2026-08-02; competent security/privacy review pending | Security/privacy review pending |
| FEAT-003-08 | Organization Admin authority must remain administrative only | IAM-011; governance section 4; safety constraints | Administration placeholder and built-in `admin` portal permission only | No operational domain API/schema | No Head of Training/CFI, safety, quality, operations, dispatch, assessment, airworthiness, competency, or approval authority | AC-15; scope/diff review; REG-01 | Local automated scope evidence passed 2026-08-02; aviation review is required only if scope changes | Founder/Product Owner specification approval 2026-07-27; aviation review only if scope changes |
| FEAT-003-09 | First-admin completion must be atomic and attributable | IAM-007; REC-001/002/003; Security Requirements section 9 | One database transaction creates membership/role, consumes grant, and writes constrained actor/audit evidence | Server-only completion RPC; additive `authentication_events` actor/source fields; existing human writer remains strict | Roll back on constraint, insert, update, or audit failure; ordinary roles cannot edit evidence; no fabricated human actor | DESIGN-AMD-01; AC-11/13/25; RPC-01/03; AUDIT-01 | Local automated atomicity/audit/rollback evidence passed 2026-08-02; competent database/security/privacy review pending | Database/security/privacy review pending |
| FEAT-003-10 | Two bootstrap attempts must not create competing first admins | IAM-003/012; NFR-008/010 | Organization-row-first then grant-row locking, in-transaction rechecks, expected version, and actor+grant+action idempotency | Transaction serialization; completion key hash retained on consumed grant; safe `409` conflict | Same/different-grant races create at most one first active admin; loser receives no partial authority | DESIGN-AMD-01; AC-12/27; RPC-04; SEC-02 | Local automated concurrency evidence passed 2026-08-02; competent database/security review pending | Database/security review pending |
| FEAT-003-11 | Existing and last-active administrators must be protected | IAM-012; Security Requirements section 4 | First-admin command conflicts if an active admin exists; no removal/demotion path | No general member or role-management command | Existing admin unchanged; FEAT-005/006 must later enforce ordinary last-admin guards | AC-16; RPC-02; scope/diff inspection | Local automated implementation/negative evidence and corrected separate-agent review passed 2026-08-02 | Founder/Product Owner specification approval recorded 2026-07-27 |
| FEAT-003-12 | Browser users must not directly mutate tenant authority | IAM-003/008/009; ADR-0005 | Deny-by-default grant table and service-role-only narrow functions | New RLS-enabled table; revoke `PUBLIC`, `anon`, and `authenticated` CRUD/EXECUTE; inspect defaults/overloads/owner | Fixed `search_path`, strict schema, exact origin, bounded body, no service-role browser path | DESIGN-AMD-01; AC-01/02/19/28; RLS-01/02; EDGE-01; SCAN-01 | Local automated RLS/grant/direct-access evidence passed 2026-08-02; competent database/security review pending | Database/security review pending |
| FEAT-003-13 | Administrative onboarding must remain separate from invitations | IAM-001/004; roadmap sequence | Only first-admin bootstrap; no other user or invitation | No invitation table, email, redirect, resend, revoke, or member creation | Prevents FEAT-004 authority and abuse scope from entering FEAT-003 | Scope inspection; AC-21; REG-01 | Specification boundary approved | Founder/Product Owner specification approval recorded 2026-07-27 |
| FEAT-003-14 | Administrative onboarding must remain separate from user/profile management | IAM-004; privacy requirements | No member list/search/suspend/reactivate/profile/factor console | No FEAT-005 table, API, or UI | No personal-profile expansion or ordinary last-admin mutation | Scope inspection; AC-21; REG-01 | Specification boundary approved | Founder/Product Owner specification approval recorded 2026-07-27 |
| FEAT-003-15 | First-admin assignment must not become general role assignment | IAM-003/011/012; governance section 4 | One system assignment of built-in `admin` during completion only | No general role-change endpoint or multiple-role schema | No client role input; FEAT-006 remains separately gated with separation-of-duties review | AC-11/15/16; RPC-01/02; REG-01 | Specification boundary approved | Founder/Product Owner specification approval recorded 2026-07-27 |
| FEAT-003-16 | Users need understandable complete states on weak connectivity and failure | NFR-003/004/005/008; QA sections 2 and 7 | Loading, empty, unauthorized, invalid, conflict, offline, failure, recovery, and success states | Online-only flow; queue nothing | Safe guidance, correlation ID, operation invalidation, no stale or offline authority | AC-06/10/18; COMP-01/02; E2E-03 | Local automated component/browser evidence passed 2026-08-02; competent UX/accessibility review pending | UX/accessibility review pending |
| FEAT-003-17 | MFA onboarding must be accessible across devices and assistive technology | NFR-004; UI/UX section 10 | Responsive semantic flow, keyboard/focus/live regions, autofill, zoom/reflow, contrast, target size, manual secret | Frontend implementation only; provider challenge boundary | QR is not sole path; secrets not announced; active CAPTCHA requires accessible fallback and privacy review | AC-17; COMP-01/02; A11Y-01; CAPTCHA-01 | Automated semantic/focus/responsive evidence passed 2026-08-02; human accessibility evidence remains unresolved | Accessibility reviewer pending |
| FEAT-003-18 | Lost-device and replacement uncertainty must not create a bypass | IAM-005/006/007; Security Requirements section 3 | Explicit recovery/support boundary; no replacement or downgrade in FEAT-003 | No recovery-code or support-elevation API | Fail closed; real-data/production blocked until recovery codes, replacement, supervised recovery, throttling, and support are approved | AC-08/22; COMP-04; AUTH-03 | Deferred behavior explicitly blocks later gates | Founder/Product Owner specification approval 2026-07-27; later recovery policy and security/privacy/operations review pending |
| FEAT-003-19 | Provider/runtime behavior must be evidenced, not assumed | NFR-008/010/011; QA sections 6/7 | Pinned local Auth/TOTP/complete-factor/session/audit/two-client evidence and explicit Auth/PostgreSQL consistency boundary | Local Supabase/Auth integration only; pre/post provider checks around the database transaction | Minimized evidence; no raw audit rows, tokens, secrets, full email, or IP values; final access fails closed on factor/provider drift | DESIGN-AMD-01; AC-29/30; AUTH-01/02/03; AUDIT-01; CONFIG-01; SEC-02 | All three sanitized local runtime fixtures passed 2026-08-02; competent technical/security/privacy review pending | Technical/security/privacy review pending |
| FEAT-003-20 | Existing login, recovery, RLS, and tenant isolation must remain intact | IAM-003/005/007/008/009/010; FEAT-001/002 | Bounded additions plus full identity regression | Preserve current migrations/functions except approved narrow changes | Password-AMR gate, AAL/TOTP, direct table/RPC denial, audit, and two-org behavior remain green | AC-20; REG-01; full required matrix | Complete local regression matrix passed 2026-08-02; competent technical/security review pending | Technical/security review pending |
| FEAT-003-21 | Documentation approval must not be mistaken for implementation or release | QA sections 7 and 9; governance section 10 | Explicit local, hosted, real-data, Git, deployment, and production gates | Bounded implementation is locally verified and unpublished | No implementation evidence row marked Pass or Verified without reproducible implementation and review evidence | AC-21; final diff/scope/evidence report | Locally verified; publication pending | Founder/Product Owner specification, implementation authorizations, and 2026-08-02 autonomous-delivery directive |
| FEAT-003-22 | Provider and platform limits must not be mistaken for protected-endpoint abuse control | Security Requirements section 6; API Specification section 11; NFR-008/011 | Declared local Auth limits are baseline configuration only; FEAT-003 requires reviewed server-enforced per-action limits and mandatory privacy-minimized monitoring/recovery evidence | Protected Edge limiter for `status`/`start`/`complete`/`cancel`; approved provisional local token-bucket design | Atomic concurrent decision; HMAC subject/action key; no local IP trust; safe `429`; no enumeration or raw secrets/IP retention; fail-closed authority and status; safe uncertain-cancel cleanup; safe request/decision/audit/recovery correlation; stop-work monitoring; no override | DESIGN-AMD-02/04; AC-06/19/31; EDGE-02; MON-01; SEC-02; CONFIG-01; SCAN-01 | Local automated limiter/runtime/recovery evidence and corrected separate-agent review passed 2026-08-02; hosted values remain pending | Founder/Product Owner approval 2026-07-28; hosted/production review later if applicable |

## Planned synthetic tenant matrix

| Identity | Organization A | Organization B | Purpose |
|---|---|---|---|
| `first-admin-a@example.test` | Pending first-admin grant; no membership initially | Active Student Pilot membership | Prove multi-membership selection and that identity-level TOTP grants no cross-tenant admin authority |
| `attacker-b@example.test` | No membership or grant | Active role membership | Negative cross-organization grant/list/direct-ID/complete attempts |
| `existing-admin-b@example.test` | No access | Active Organization Admin | Prove first-admin bootstrap conflicts without changing an existing admin |
| `race-admin-a2@example.test` | Separately authorized synthetic competing grant only for concurrency test | No access | Prove at most one first administrator is created |
| `no-access@example.test` | No membership or grant | No membership or grant | Empty/non-enumerating state |

All addresses are randomized or synthetic `example.test` values during execution. No real school, person, student, credential, factor secret, or provider audit value may enter evidence.

## Negative, replay, concurrency, rollback, and regression evidence

Implementation acceptance requires explicit evidence for:

- anonymous, invalid JWT, stale JWT, OTP-only recovery/email/magic-link, passwordless, missing/malformed/string-only/future AMR, 599/600/601-second password boundaries, AAL1, and missing TOTP denial;
- wrong subject, wrong grant, other-organization direct ID, inactive organization, inactive role, existing admin, expired/revoked/consumed grant, conflicting membership, and user-metadata authority denial;
- complete-inventory zero, one unverified, one verified, multiple verified, stale unverified, removed, phone, WebAuthn, unknown, mixed, duplicate-ID, and convenience-array-inconsistent factor states;
- invalid/expired TOTP, guessing/throttling, duplicate submit, challenge replay, scoped idempotency replay, route refresh, sign-out, factor removal, two sessions, refresh/delayed downgrade, and concurrent tabs;
- per-action HMAC subject/action rate limits using the approved rates and bursts; proof that changed grant, organization, or idempotency hints do not create fresh buckets; explicit absence of local IP/forwarded-header trust; allowed and rate-limited decisions; concurrent Edge isolates, replay, and synthetic distributed-key attempts; limiter-unavailable and recovery-after-window behavior; safe `429` non-enumeration; accessible wait/retry/failure/recovery states; and privacy-minimized request/limiter-decision/applicable-audit/recovery correlation for `status`, `start`, `complete`, and `cancel`;
- same-grant and different-grant attempts racing under the organization-row-first lock order for one organization's first administrator;
- membership insert, role insert, grant update, audit write, provider verification, session refresh, and final access-bootstrap failure;
- transaction rollback, no partial membership/role/grant success, and no fail-open workspace;
- `PUBLIC`/anonymous/authenticated direct access, default privileges, overloads, function owner/search path, schema-wide RLS discovery, grants, privileged functions, views, triggers, indexes, constraints, generated types, database lint, and migration reset;
- local API/database/container/project same-stack attestation, remote/linked/ambiguous refusal, `ON_ERROR_STOP`, explicit transaction/postconditions, injected grant/audit failure, minimized credential handling, and cleanup uncertainty;
- Auth factor removal/provider failure immediately before and after completion with final provider/bootstrap denial;
- FEAT-001 password/AAL/TOTP/organization/audit behavior and FEAT-002 password-AMR recovery isolation/session behavior;
- source/history/build/output/snapshot/documentation scans for service-role material, passwords, TOTP credentials, real data, tokens, and restricted logs; and
- responsive and human accessibility review with exact unresolved limitations.

## 2026-08-02 local automated verification evidence

The final stabilized uncommitted target was verified locally from branch
`feat/FEAT-003-organization-admin-mfa-onboarding` at unchanged baseline HEAD
`b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66`. Credential-bearing and
provider-derived output was suppressed. Every contaminated diagnostic transcript
is excluded from this evidence.

- Application verification passed formatting, ESLint, TypeScript, 103
  unit/component/handler tests, production build, browser-secret scanning, 10
  desktop/mobile Playwright scenarios, and a high-severity dependency audit with
  no known vulnerabilities. The build retained one non-blocking 509.55 kB chunk
  warning.
- Database verification passed a migration reset, 101 SQL/RLS tests, the earlier
  Edge/browser runtime fixture, the unchanged FEAT-002 recovery fixture, the
  FEAT-003 runtime fixture, database lint with no findings, and generated-type
  drift checking.
- The runtime orchestrator performed one bounded loopback-only Auth-template
  readiness recovery after reset. The FEAT-002 recovery fixture remained byte
  unchanged at SHA-256
  `99f86241479d8f3008cb2d2259ac792dff11e3df3052dbcdfb57cdc18db08f0c`.
- Focused corrections made heading focus occur after the result DOM commit,
  matched the Edge limiter HMAC representation in the fixture, preserved each
  runtime fixture's exact pre-run limiter baseline, and removed secret-scan
  false-positive literal shapes without weakening assertions.
- Checksum-verified Gitleaks `8.30.1` scans passed for complete Git history and
  the current source/worktree, excluding only generated dependency, build,
  coverage, Git, and local Supabase temporary directories. No scan report was
  retained.
- Final aggregate cleanup found zero Auth users, organizations, memberships,
  membership roles, bootstrap grants, authentication events, limiter state, and
  limiter events. The zero-residue local stack was stopped without backup and no
  FlyEye containers remained.
- A fresh independent read-only agent review found one non-bypass defect in the
  combined factor-inventory and mandatory-audit failure path: access remained
  denied, but the response reported provider unavailability instead of
  `auth.audit_unavailable`. The handler and focused regression test were
  corrected, the stale competent-review-package verification gate was updated,
  and the complete application/database matrix plus exact cleanup passed again.

This evidence advances FEAT-003 to `Locally verified; publication pending` under
the 2026-08-02 autonomous-delivery directive. It satisfies the local technical
publication gate but does not satisfy Git publication, merge, hosted validation,
real-data use, deployment, production approval, branch deletion, or FEAT-004
authority. Qualified-human validation remains risk-triggered for claims that
inherently require it.

## Explicit evidence and approval gates

| Gate | Required record | Current state |
|---|---|---|
| Documentation baseline | Exact branch/HEAD, clean starting tree, authoritative docs, inspected implementation/dependencies/migrations/types/evidence | Established at `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66` |
| Specification decision | Founder/Product Owner approves or amends DEC-01 through DEC-05 | Approved as written on 2026-07-27 |
| Implementation-readiness values | Founder/Product Owner records exact local lifetime and local issuer/test setup | Approved on 2026-07-27: 30 minutes, non-sliding; CLI-only `scripts/test-feat-003-runtime.mjs` fixture |
| Independent-design-review amendment | Founder/Product Owner records exact controls for audit source, AMR/evidence, time/locking/idempotency, grants/actions, factors/race, and fixture | Documentation amendment authorized and recorded on 2026-07-27 |
| Post-amendment verification | Read-only review confirms every prior blocking finding is resolved and records remaining provider/human gates | Completed on 2026-07-28 as documentation-consistency evidence only; `DOC-STATUS-01` resolved; no implementation/runtime, qualified-human-review, product-acceptance, authorization, or release evidence |
| Historical staged-review-gate amendment | Formerly required human review before acceptance/publication; superseded for local delivery by the 2026-08-02 autonomous-delivery directive | Documentation amendment authorized and recorded on 2026-07-28; retained only as history |
| Historical staged-review-gate verification | Strictly read-only review of the former staged model | Completed on 2026-07-28 as documentation-consistency evidence only; retained only as history and not a current publication gate |
| Provisional local limiter/operations decisions | Separate AI-guided recommendation and Founder/Product Owner approval of executable, reversible local-only choices | Approved for documentation-only recording on 2026-07-28 under FEAT-003-DESIGN-AMD-04; later bounded local implementation remains unaccepted and cannot establish hosted/production values |
| Provisional local limiter/operations verification | Strictly read-only review confirms the exact approved local choices, limitations, unresolved hosted/production decisions, competent-review requirement, fingerprints, and closed downstream gates | Completed on 2026-07-28 as documentation-consistency evidence only against tracked fingerprint `27014d8b60c17c129dfd29513fea79abe89f9483`; all fourteen requirements passed and no documentation conflict remained; no implementation or release gate was satisfied |
| Implementation | Separate explicit local synthetic authorization and implementation branch | Granted and locally implemented on `feat/FEAT-003-organization-admin-mfa-onboarding`; uncommitted and unpublished |
| Risk-triggered human review | Qualified review when regulated, real-data, hosted, production, penetration-test, or formal-compliance claims inherently require it | Not required for local synthetic Git publication under the 2026-08-02 directive |
| Local verification | Full planned matrix, exact implementation diff, minimized evidence, known limitations | Completed on 2026-08-02; complete application/database matrix, all three sanitized runtime fixtures, repository/history secret scans, zero-residue cleanup, corrected separate-agent review, and final re-review passed |
| Local technical publication gate | Local verification plus corrected separate-agent review | Completed on 2026-08-02 |
| Git staging, commit, and publication | One-time explicit override of this task's earlier no-publication boundary | Not yet granted for this already-open task; after the override, autonomous delivery may continue through a green review-ready pull request and merge remains human-only |
| Hosted validation | Separate synthetic hosted environment/provider/cost/privacy authorization | Not granted |
| Real-data pilot | Universal MFA plus recovery codes, replacement, supervised recovery, support, monitoring, retention, privacy, and recovery evidence | Blocked |
| Deployment | Named environment, migration/rollback, secrets, monitoring, and manual approval | Not granted |
| Production | Human security/privacy/accessibility/operations acceptance and production checklist | Not granted |

## Evidence rules

- Do not mark a row Pass, Verified, Implemented, Accepted, or Approved because the specification or documentation checks pass.
- Record exact commit, dependency/Auth versions, migration hashes, synthetic fixtures, commands, redacted results, limitations, reviewer competence, date, and environment for future evidence.
- Treat Supabase provider audit rows, TOTP QR/URI/secret, codes, tokens, cookies, full email, and IP values as restricted. Retain only safe action/field names, counts, booleans, status codes, hashes, and correlation IDs.
- Limiter monitoring evidence must correlate the request, limiter decision, mandatory audit where applicable, and recovery using only privacy-minimized action/outcome names, counts, booleans, status codes, hashes, and safe correlation IDs; it must not reveal hidden tenant/account/grant/factor identifiers, configured thresholds, provider internals, unrestricted IP addresses, or secrets.
- Treat the fixed `local_fixture` source code as provenance only. It cannot satisfy a human actor, membership, permission, support override, or production issuer requirement.
- Treat declared local Supabase Auth values and hosted provider/platform quotas as defense-in-depth, not proof of a FlyEye-controlled protected-endpoint limiter.
- A factor is identity evidence, not organization membership or authorization.
- Client organization selection, role labels, factor state, AAL, AMR, timestamps, and metadata are never authorization sources.
- The Auth provider and PostgreSQL cannot commit atomically; final provider and protected access-bootstrap revalidation must deny access when state changes or becomes uncertain.
- Any cross-tenant result, unauthorized first-admin creation, partial transaction, missing mandatory audit, service-role browser exposure, TOTP secret leakage, OTP-only workspace access, or stale-session fail-open is a critical blocker.
- Under the 2026-08-02 autonomous-delivery directive, schema, RLS, grant,
  tenant-authority, privileged-function, MFA, privacy, and accessibility-supporting
  changes may proceed through local synthetic publication when they are
  fail-closed, covered by negative/tenant tests, and corrected after separate
  agent review. Human escalation remains mandatory for real data, hosted or
  production risk acceptance, unsupported regulated authority, formal compliance
  claims, and other documented hard stops.
- The autonomous-delivery directive covers bounded Git publication through a
  green review-ready pull request. Merge, hosted validation, real-data use,
  deployment, and production approval remain separate human decisions.
