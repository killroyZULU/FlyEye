# FEAT-001 Requirements Traceability

| Need ID     | Source/problem                                         | Requirement ID            | Feature/design                                                             | Security/privacy/safety control                                                                                            | Demonstrated evidence                                                                                           | Current result                                       | Approval                                                      |
| ----------- | ------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| FEAT-001-01 | Invited users need secure entry                        | IAM-001, IAM-002          | Email/password login and session restoration                               | Global public sign-up disabled; email provider enabled for existing users; generic credential errors                       | Real local Auth/browser login; public-signup denial; component and Playwright tests                             | Locally demonstrated with synthetic users            | Product approval 2026-07-19; security review pending          |
| FEAT-001-02 | Access differs by role and assurance                   | IAM-003, IAM-005          | Server-resolved role, permission, and per-membership AAL decision          | Student AAL1; Instructor/Admin AAL2 under ADR-0006                                                                         | 45-test pgTAP suite; handler tests; real local password/TOTP/AAL1/AAL2 Edge integration                         | Locally demonstrated for the FEAT-001 baseline       | Recovery, support, and hosted enforcement remain later gates  |
| FEAT-001-03 | Schools must remain isolated                           | IAM-003, IAM-008, IAM-010 | Organization-scoped membership; sole school derived by server              | Composite FK; no browser table/RPC grants; no metadata authority                                                           | Historical two-organization SQL/Edge evidence plus FIX-006 singleton and forged-ID tests                        | Amended by FIX-006                                   | Independent security review pending                           |
| FEAT-001-04 | Initial privileged MFA must be authoritative           | IAM-005                   | Server resolver applies verified JWT `aal`; UI reboots access after TOTP   | React never grants privileged success from its own MFA state; stale operations invalidated                                 | SQL AAL matrix; component revocation races; real Instructor/Admin TOTP integration; real browser Instructor MFA | Locally demonstrated for Instructor/Admin            | Stronger factor methods remain future options                 |
| FEAT-001-05 | Access decisions require accurate evidence             | IAM-007, REC-001/002/003  | Edge validates final runtime contract, then calls server-only audit writer | Exactly one success/denied event; audit failure blocks; actor UUID snapshot; organization ID set; constrained combinations | Handler contract-failure/audit-failure tests; SQL constraints/removal test; real Edge audit-row checks          | Locally demonstrated                                 | Privacy retention/DPO and independent security review pending |
| FEAT-001-06 | UI must explain non-happy states without stale success | NFR-003/004               | Loading, empty, error, unauthorized, conflict, MFA, success                | Operation-generation invalidation on sign-out, revocation, cancellation, and disposal; post-MFA revalidation               | Component race tests; mocked Playwright viewport tests; real browser Student and Instructor paths               | Locally demonstrated                                 | UX/accessibility human review pending                         |
| FEAT-001-07 | Browser secrets must remain outside output             | IAM-009                   | Publishable-key-only browser configuration                                 | Reject obvious secret/service-role keys; scan browser inputs and `dist`                                                    | Unit validation plus final source/build secret scan                                                             | Locally demonstrated; no matching key material found | Independent security review pending                           |
| FEAT-001-08 | Migrations must remain reproducible                    | NFR-010                   | Applied original migration retained; additive ordered forward fix          | Backfill then validate constraints; revoke deprecated RPC; generated types from migrated schema                            | Local `db reset`, migration list, 45 SQL tests, database lint, repeated type generation with matching SHA-256   | Locally demonstrated                                 | Database review pending                                       |
| FEAT-001-09 | Management authority cannot be inferred                | Safety constraints        | Admin/Instructor open placeholders only                                    | No dispatch, airworthiness, assessment, competency, or operational authority added                                         | Scope/diff inspection                                                                                           | Demonstrated for remediation scope                   | Aviation-SME approval pending for future authority            |

## Evidence boundary

The local evidence uses synthetic users and organizations only. On 2026-07-19, formatting, lint, type checking, 32 unit/component/Edge-handler tests, 45 SQL/RLS tests, actual local Auth/TOTP/Edge/browser integration, 8 Playwright E2E scenarios, database lint, dependency audit, production build, generated-type hash comparison, and source/build secret scans passed. This is not production validation, an independent penetration test, privacy approval, aviation-SME approval, or deployment authorization.

## Password-entry visual foundation

[#174](https://github.com/killroyZULU/FlyEye/issues/174) tracks the
[password-entry contract](FEAT-001_LOGIN_AND_RBAC.md#password-entry-visual-foundation).

| Requirement                                                                   | Evidence locator                                                                                                                                                                                                   | Result and boundary                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [FEAT-001-VF-01](FEAT-001_LOGIN_AND_RBAC.md#password-entry-visual-foundation) | [Entry suite](../../../src/features/auth/components/AuthEntryView.test.tsx): `password-entry presentation boundary`                                                                                                | Two password states opt in; twelve other states and three separate routes retain the existing presentation.                                                                                                                                                                                  |
| [FEAT-001-VF-02](FEAT-001_LOGIN_AND_RBAC.md#password-entry-visual-foundation) | [Form suite](../../../src/features/auth/components/LoginForm.test.tsx): `sign-in foundation behavior preservation`; [browser helper](../../../scripts/lib/sign-in-foundation-browser.mjs): `checkSignInFoundation` | Invalid input makes no request; pending submission disables controls; repeated submission makes one mocked request; rejection preserves input identity, values and visibility.                                                                                                               |
| [FEAT-001-VF-03](FEAT-001_LOGIN_AND_RBAC.md#password-entry-visual-foundation) | Browser helper: `inspectLayout`, `assertLayout`, keyboard/AX-tree, font-failure and touch assertions                                                                                                               | Six reference widths, 44 px targets, text contrast, focus order, error descriptions, live-status semantics and fallback reflow passed in Edge. Reduced viewport and emulated touch checks do not establish actual browser zoom, screen-reader output or physical software-keyboard behavior. |
| [FEAT-001-VF-04](FEAT-001_LOGIN_AND_RBAC.md#password-entry-visual-foundation) | [Auth UI suite](../../../src/features/auth/AuthApp.test.tsx); [compiled-browser runner](../../../scripts/run-e2e.mjs) and browser helper's recovery-boundary assertions                                            | Existing transition/race coverage is retained. The linked delivery PR owns full application and disposable database CI execution results.                                                                                                                                                    |
| [FEAT-001-VF-05](FEAT-001_LOGIN_AND_RBAC.md#password-entry-visual-foundation) | Delivery PR's desktop/phone before-and-after evidence and separate-agent review                                                                                                                                    | Synthetic captures compare baseline `7f5c5d994798fa2309f37b13616ea5fb3502fa65` with this slice. One correction batch and one confirmation assessed sign-in emphasis, alignment and readability; this is bounded visual judgment, not formal WCAG evidence.                                   |

Visual captures, taken on 2026-10-15 in headless Edge with synthetic frontend
configuration and no backend traffic: desktop 1280×900
([before](evidence/FEAT-001-sign-in-foundation/before-desktop.png),
[after](evidence/FEAT-001-sign-in-foundation/after-desktop.png)); phone 390×844
([before](evidence/FEAT-001-sign-in-foundation/before-phone.png),
[after](evidence/FEAT-001-sign-in-foundation/after-phone.png)). Images capture the
full page, so image height may exceed viewport height. The baseline is the
commit identified above; the after images show this slice's reviewed source.

On 2026-10-15, the owner confirmed that the synthetic sign-in page in Edge worked
at actual 200% browser zoom without horizontal scrolling and that Windows
Narrator output was understandable. The task script covered control names,
empty-field validation, pending/rejected sign-in and preserved entered values.
The temporary page rendered the changed Auth UI with an in-memory gateway that
returned a generic rejection; it made no backend requests. This human-reported
workflow check supplements the automated evidence and does not claim formal WCAG
conformance or physical-device/software-keyboard validation.

### Bundled font provenance

Unmodified Latin WOFF2 assets are served locally with system fallbacks and no
runtime Google Fonts request. [Archivo](../../../public/fonts/archivo-latin-600-700.woff2)
(34,928 bytes) and [IBM Plex Sans](../../../public/fonts/ibm-plex-sans-latin-400-600.woff2)
(45,712 bytes) came from the official
[Archivo delivery URL](https://fonts.gstatic.com/s/archivo/v25/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLydOxI.woff2)
and [IBM Plex Sans delivery URL](https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxeKYY.woff2).
Their SHA-256 values are respectively
`8f704806dbedeaaeca334b11ec348bc3ac3a439d6431544b3afb54f534ee4967`
and `e2291e842cf5af167122a22881a740c7f2dda7716f1e8cd76680264f4a859470`.
The accompanying [Archivo license](../../../public/fonts/Archivo-OFL.txt) and
[IBM Plex Sans license](../../../public/fonts/IBMPlexSans-OFL.txt) retain SIL OFL 1.1
notices from [Google Fonts commit 9430147](https://github.com/google/fonts/tree/94301472b4d809299b4775bc6502592b83dd6934).
These are static font assets, not new packages. Hashes and licenses establish
provenance; they do not constitute a font-parser security assessment.

## A010 bootstrap limiter

[SEC-004 / #120](https://github.com/killroyZULU/FlyEye/issues/120) implements the
[A010 contract](FEAT-001_LOGIN_AND_RBAC.md#a010-bootstrap-application-limiter).

| Requirement                                                                 | Evidence locator                                                                                                                                                                                                                                                                   | Boundary                                                                                                               |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [A010-01/02](FEAT-001_LOGIN_AND_RBAC.md#a010-bootstrap-application-limiter) | [SQL suite](../../../supabase/tests/sec_004_auth_bootstrap_rate_limit_test.sql): exact thirty-request burst, fractional refill, idle cap; [concurrency fixture](../../../scripts/test-a010-limiter.mjs): `concurrent-insertion`, `final-token`, `bounded-lock-failure`, `recovery` | Shared PostgreSQL decisions; synthetic disposable CI only                                                              |
| [A010-03/04](FEAT-001_LOGIN_AND_RBAC.md#a010-bootstrap-application-limiter) | [Handler suite](../../../supabase/functions/auth-bootstrap/rate-limit.test.ts): `A010 auth-bootstrap limiting`; SQL audit-failure rollback assertions; [real Edge fixture](../../../scripts/test-edge-runtime.mjs): exact-run exhaustion, audit and recovery assertions            | Existing Auth/TOTP/authorization/audit scenarios still run; no hosted validation                                       |
| [A010-05](FEAT-001_LOGIN_AND_RBAC.md#a010-bootstrap-application-limiter)    | SQL role grants/RLS, unknown-user and independent-user assertions; handler key-spoofing cases; concurrency fixture residue assertion and `--cleanup-probe`                                                                                                                         | Pre-membership subject state, not a tenant-authority source; school separation retains existing FEAT-001/FIX-006 tests |
| Retry UX                                                                    | [Gateway suite](../../../src/features/auth/services/auth-gateway.test.ts): `A010 bootstrap gateway errors`                                                                                                                                                                         | Safe manual retry; no automatic retry or new session policy                                                            |

The [CI workflow](../../../.github/workflows/ci.yml) runs the concurrency and
interrupted-fixture cleanup probes before the unchanged H002 scenarios and full
runtime matrix. Generated-type equality is checked against the migrated disposable
database. Existing local databases are preserved. The linked delivery issue/PR
owns exact-head execution and independent-review results. This slice does not
extend or close [H002's untested schedules](FEAT-007_TRACEABILITY.md#sql-inspection-boundary).

## Authentication bootstrap extraction

[A003 / #102](https://github.com/killroyZULU/FlyEye/issues/102) separates the
[HTTP handler](../../../supabase/functions/auth-bootstrap/handler.ts),
[access decisions](../../../supabase/functions/auth-bootstrap/access-decision.ts),
[administrator-factor checks](../../../supabase/functions/auth-bootstrap/admin-factor.ts),
[responses](../../../supabase/functions/auth-bootstrap/responses.ts), and
[dependency contracts](../../../supabase/functions/auth-bootstrap/contracts.ts).
The handler retains its factory and type exports; its file-size and complexity
exceptions were removed.

The [handler suite](../../../supabase/functions/auth-bootstrap/handler.test.ts)
`auth-bootstrap extraction compatibility` adds 24 cases for HTTP validation order
and headers, denied-context reasons, exact audit payloads and correlation IDs,
administrator-factor outcomes, combined backend/audit failures, rejected tenant
contexts, the existing optional factor dependency, and awaiting audit completion.
Together with the [access-context](../../../src/lib/access-context.test.ts) and
[authentication-evidence](../../../supabase/functions/_shared/authentication-evidence.test.ts)
suites, all 71 tests passed before and after extraction; adding the
[maintainability suite](../../../scripts/lib/code-maintainability.test.mjs) produced
79 passing focused tests. These are synthetic handler/contract checks; database
and real Auth/Edge evidence comes from the disposable PR CI matrix. The occupied
local database was preserved. A010 evidence is recorded [above](#a010-bootstrap-limiter).

## Gateway contract separation

[A002 / #84](https://github.com/killroyZULU/FlyEye/issues/84) separates the
[gateway contract](../../../src/features/auth/services/auth-gateway-contract.ts)
from its [Supabase implementation](../../../src/features/auth/services/auth-gateway.ts),
which retains the existing type exports. Compared with `3ca82f5`, the moved
declarations and emitted gateway JavaScript are identical; the contract emits no
runtime imports. Both files satisfy the normal file-size limit. The existing
[gateway service suites](../../../src/features/auth/services/auth-gateway.test.ts)
and sibling service suites, plus the
[maintainability suite](../../../scripts/lib/code-maintainability.test.mjs), passed
all 322 focused tests before and after extraction. Existing consumers type-check
through the original exports. This evidence does not extend session or hosted
validation coverage.

## Session-control evidence

Source inspection at `4e21562` supports the observations below. These are bounded
evidence statements, not replacements for [SESS-01 through SESS-05](../08_SECURITY_REQUIREMENTS.md#session-control-applicability)
or new runtime validation. [Task 4 / #56](https://github.com/killroyZULU/FlyEye/issues/56)
tracks this applicability reconciliation.

| Control   | Existing evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Limitation / outstanding evidence                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESS-01` | [Browser client](../../../src/lib/supabase.ts) enables persistence and automatic refresh without custom storage. The lockfile-pinned Auth SDK `2.110.7` selects browser localStorage when available and memory otherwise. The [auth gateway](../../../src/features/auth/services/auth-gateway.ts) delegates sessions and function invocation to the SDK.                                                                                                                        | JavaScript-managed session storage is not an HttpOnly-cookie boundary. No application cookie-backed session implementation is demonstrated. Final storage/transport and XSS/CSRF review remain unresolved.                                                                |
| `SESS-02` | SDK refresh is enabled in the browser client.                                                                                                                                                                                                                                                                                                                                                                                                                                   | Configuration is not adversarial rotation/reuse evidence. No dedicated session-rotation/reuse suite is identified by this bounded inspection; verify the selected target behavior before claiming compliance.                                                             |
| `SESS-03` | [Local configuration](../../../supabase/config.toml) declares no explicit session timebox or inactivity policy; the browser client enables refresh.                                                                                                                                                                                                                                                                                                                             | No approved global inactivity definition, absolute lifetime or enforcement evidence is established. Provider defaults are not an approved FlyEye policy.                                                                                                                  |
| `SESS-04` | [Recovery traceability](FEAT-002_TRACEABILITY.md) and [runtime fixture](../../../scripts/test-recovery-runtime.mjs) cover password change plus global sign-out, two old refresh tokens, and four old-access probes: Auth user, bootstrap, organizations table and resolver RPC. [Auth UI tests](../../../src/features/auth/AuthApp.test.tsx) cover sign-out/revocation races; [member evidence](FEAT-005_TRACEABILITY.md) covers server access after membership status changes. | Recovery is a combined scenario. These probes do not demonstrate every subsequently added function, Storage path, ordinary logout or hosted revocation timing. Current-session detection and UI invalidation do not by themselves establish server-side token revocation. |
| `SESS-05` | Existing [member-administration](FEAT-005_USER_MANAGEMENT_AND_BASIC_PROFILES.md#roles-and-authority) and [role-assignment](FEAT-006_ROLE_ASSIGNMENT.md#roles-and-authority) contracts specify action-level reauthentication; their traceability records hold results.                                                                                                                                                                                                           | Retain those contracts during extraction. They do not establish a single global session timeout or evidence for future sensitive actions.                                                                                                                                 |

Provider references, checked 2026-09-26: [session lifetime and refresh semantics](https://supabase.com/docs/guides/auth/sessions),
[sign-out scope and access-token limitations](https://supabase.com/docs/guides/auth/signout),
and [browser/server cookie considerations](https://supabase.com/docs/guides/auth/server-side/advanced-guide).
These explain why automatic refresh, cookie expiry, refresh revocation and issued
JWT acceptance need separate evidence; they do not select FlyEye policy or replace
validation against its pinned runtime and intended deployment.

## Auth fixture cleanup evidence

[A026 / #142](https://github.com/killroyZULU/FlyEye/issues/142) implements the
[cleanup contract](FEAT-001_LOCAL_SECURITY_TESTING.md#edge-and-recovery-fixture-cleanup).
The [Auth cleanup suite](../../../scripts/lib/auth-runtime-cleanup.test.mjs)
covers exact ownership, schema/collision preflight, checked SQL/Auth errors,
independent cleanup stages, 404 with residue, captured descendant IDs, foreign
state preservation, redaction and scenario/interruption failure propagation.
The [runner suite](../../../scripts/lib/runtime-matrix-diagnostics.test.mjs)
covers probe-before-normal ordering and a failed probe blocking the next run.
Existing [mail tests](../../../scripts/lib/invitation-runtime-cleanup.test.mjs)
cover exact recipients, foreign messages, pagination, empty-delete protection
and inventory/delete/residue errors.

The [edge](../../../scripts/test-edge-runtime.mjs) and
[recovery](../../../scripts/test-recovery-runtime.mjs) probes require disposable
CI for real Auth/schema/Mailpit evidence; the linked PR/CI owns final execution
results. Local databases remain occupied and untouched. Provider audit inventory
is attributable-only and deliberately retained until teardown; child-ID checks cover parents captured at cleanup, and normal/interrupted
passes cannot establish historical cleanup or hosted recovery/session policy.
