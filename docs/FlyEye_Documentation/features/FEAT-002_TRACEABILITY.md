# FEAT-002 Traceability

## Evidence boundary

- Feature commit: `fd1bd2f9aef9bce159b93ce76dd7530371f2d897`
- Merge: [PR #5](https://github.com/killroyZULU/FlyEye/pull/5) at `4f993f0d0dc40f8a5783ae5176ffe2ef6000ca94`
- Closure documentation: [PR #6](https://github.com/killroyZULU/FlyEye/pull/6) at `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66`
- Environment: Pinned local Supabase stack and local browser tests
- Data: Randomized synthetic `.test` identities and organizations only
- Review: Separate Codex review and automated evidence; no qualified independent human technical/security/privacy review

Pre-merge CI run [30237389881](https://github.com/killroyZULU/FlyEye/actions/runs/30237389881), post-merge run [30237614093](https://github.com/killroyZULU/FlyEye/actions/runs/30237614093), and closure-documentation run [30238931694](https://github.com/killroyZULU/FlyEye/actions/runs/30238931694) passed Application quality and Local Supabase security. CI performed no deployment.

These historical results predate ADR-0006. Later singleton-school and membership
regression evidence is recorded in [FIX-006 Traceability](FEAT-005_SINGLE_SCHOOL_DEPLOYMENT_TRACEABILITY.md).

## Requirements and results

| Requirement ID | Outcome/control                                        | Evidence                                                                                                                                                                                                                                                                                                                   | Result and limitation                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FEAT-002-01`  | Generic self-service request                           | [AC-01, AC-02](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [UNIT-01](#feat-002-unit-01), [COMP-01](#feat-002-comp-01), [AUTH-01](#feat-002-auth-01), [ABUSE-01](#feat-002-abuse-01)                                                                                                                                | Partial pass: generic UI, malformed/offline, provider failure, cooldown, and unknown-account non-creation passed; suspended, banned, deleted, invited-unconfirmed, provider-only, timing-distribution, and active-CAPTCHA cases remain pending |
| `FEAT-002-02`  | Recovery creates no account or authority               | [AC-02, AC-13](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [AUTH-01](#feat-002-auth-01), [TENANT-01](#feat-002-tenant-01), [REG-01](#feat-002-reg-01)                                                                                                                                                              | Pass locally; no Auth/application record, schema, role, or membership was created                                                                                                                                                              |
| `FEAT-002-03`  | Short-lived, single-use, prefetch-safe credential      | [AC-03–06, AC-08](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [UNIT-03](#feat-002-unit-03), [AUTH-02](#feat-002-auth-02), [AUTH-06](#feat-002-auth-06), [SEC-01](#feat-002-sec-01), [E2E-01](#feat-002-e2e-01)                                                                                                     | Pass locally; reverify on Auth/provider upgrade                                                                                                                                                                                                |
| `FEAT-002-04`  | Credential secrecy                                     | [AC-06, AC-07, AC-14](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [UNIT-03](#feat-002-unit-03), [UNIT-04](#feat-002-unit-04), [SEC-01](#feat-002-sec-01), [SCAN-01](#feat-002-scan-01)                                                                                                                             | Pass locally; no durable credential path found                                                                                                                                                                                                 |
| `FEAT-002-05`  | Server-authoritative password policy                   | [AC-07, AC-08](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [UNIT-04](#feat-002-unit-04), [AUTH-03](#feat-002-auth-03), [E2E-01](#feat-002-e2e-01)                                                                                                                                                                  | Pass locally; breached-password production control pending                                                                                                                                                                                     |
| `FEAT-002-06`  | Revoke old sessions and require fresh sign-in          | [AC-05, AC-08, AC-09, AC-10](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [UNIT-02](#feat-002-unit-02), [COMP-02](#feat-002-comp-02), [AUTH-04](#feat-002-auth-04), [AUTH-06](#feat-002-auth-06), [E2E-01](#feat-002-e2e-01), [REG-01](#feat-002-reg-01)                                                            | Pass locally; hosted session behavior must be reverified                                                                                                                                                                                       |
| `FEAT-002-07`  | Fail closed on partial provider/revocation failure     | [AC-10](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [UNIT-02](#feat-002-unit-02), [COMP-02](#feat-002-comp-02), [AUTH-04](#feat-002-auth-04), [EVID-11](#feat-002-evid-11)                                                                                                                                         | Corrected tests pass; live hosted failure injection pending                                                                                                                                                                                    |
| `FEAT-002-08`  | Audit and user notification                            | [AC-11](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [AUTH-05](#feat-002-auth-05), [AUTH-06](#feat-002-auth-06), [CONFIG-01](#feat-002-config-01), [EVID-07](#feat-002-evid-07), [EVID-08](#feat-002-evid-08)                                                                                                       | Pass locally; production retention, drains, access, alerting, and ownership unresolved                                                                                                                                                         |
| `FEAT-002-09`  | Abuse and enumeration resistance                       | [AC-01, AC-12](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [UNIT-01](#feat-002-unit-01), [UNIT-02](#feat-002-unit-02), [COMP-01](#feat-002-comp-01), [ABUSE-01](#feat-002-abuse-01)                                                                                                                                | Local cooldown/guards pass; active CAPTCHA, distributed/IP/WAF, timing, and provider accessibility pending                                                                                                                                     |
| `FEAT-002-10`  | Membership non-disclosure and non-mutation             | [AC-13](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [TENANT-01](#feat-002-tenant-01), [AUTH-01](#feat-002-auth-01), [REG-01](#feat-002-reg-01)                                                                                                                                                                     | Historical multi-organization fixture passed; no organization or membership state changed. Later deployment constraints use FIX-006 evidence above                                                                                             |
| `FEAT-002-11`  | Accessible responsive and offline-safe flow            | [AC-15](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [COMP-01](#feat-002-comp-01), [COMP-02](#feat-002-comp-02), [COMP-03](#feat-002-comp-03), [E2E-02](#feat-002-e2e-02), [EVID-10](#feat-002-evid-10)                                                                                                             | Automated/local scope pass; residual human observations listed below                                                                                                                                                                           |
| `FEAT-002-12`  | Reproducible environment configuration                 | [AC-03, AC-11, AC-12, AC-14](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [CONFIG-01](#feat-002-config-01), [SCAN-01](#feat-002-scan-01)                                                                                                                                                                            | Pass locally; hosted origins, providers, secrets, and settings unresolved                                                                                                                                                                      |
| `FEAT-002-13`  | Preserve FEAT-001 Auth, RLS, audit, and tenancy        | [AC-05, AC-09, AC-13, AC-14](FEAT-002_PASSWORD_RECOVERY.md#acceptance-criteria), [AUTH-06](#feat-002-auth-06), [REG-01](#feat-002-reg-01), [full matrix](#feat-002-reg-01)                                                                                                                                                 | Pass on recorded target                                                                                                                                                                                                                        |
| `FEAT-002-14`  | Keep implementation evidence separate from later gates | [EVID-07](#feat-002-evid-07), [EVID-08](#feat-002-evid-08), [EVID-09](#feat-002-evid-09), [EVID-10](#feat-002-evid-10), [EVID-11](#feat-002-evid-11), [EVID-12](#feat-002-evid-12), [PR #5](https://github.com/killroyZULU/FlyEye/pull/5), [PR #6](https://github.com/killroyZULU/FlyEye/pull/6), [CI](#evidence-boundary) | Local implementation and merge evidenced; hosted, real-data, deployment, and production gates remain open                                                                                                                                      |

## Pinned provider findings

- GoTrue `v2.192.0` accepted a recovery token through `recovery`, `email`, and `magiclink`; each produced an OTP-only session without a recovery-purpose JWT claim.
- Direct tenant table/RPC access remained denied. Protected FlyEye bootstrap denied and audited each OTP-only variant because password AMR was absent.
- Password and password-plus-TOTP sessions retained their normal FEAT-001 paths.
- Observed Auth actions were `user_recovery_requested`, `login`, `user_updated_password`, `user_modified`, and `logout`. `token_revoked` was not observed and is not claimed.
- Old refresh tokens and old Auth/bootstrap/Data API/RPC access were denied after password update and global sign-out.

Reverify these findings when the pinned Auth implementation changes.

## Stable evidence and automated identifiers

Historical IDs link to their original records at closure commit `b2ee3d7`.
Those records retain their original observations and limitations; they are not
current requirements or fresh execution results.

### FEAT-002-EVID-01

[Provider token-type matrix](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L39).

### FEAT-002-EVID-02

[Client events and JWT claims](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L40).

### FEAT-002-EVID-02A

[Password/TOTP AMR compatibility](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L41).

### FEAT-002-EVID-03

[Pre-amendment bootstrap gap; historical, corrected by EVID-07](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L42).

### FEAT-002-EVID-04

[Initial post-change sign-out probes](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L43).

### FEAT-002-EVID-05

[Auth audit action and field structure](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L44).

### FEAT-002-EVID-06

[Evidence minimization and temporary-harness cleanup](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L45).

### FEAT-002-EVID-07

[Implemented OTP-only denial and audit](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L46).

### FEAT-002-EVID-08

[Recovery, notification and two-client revocation](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L47).

### FEAT-002-EVID-09

[Original regression and multi-organization evidence; superseded deployment contract](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L48).

### FEAT-002-EVID-10

[Automated UI and bounded human desktop observations](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L49).

### FEAT-002-EVID-11

[Terminal post-password-change correction](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L50).

### FEAT-002-EVID-12

[Publication, merge and CI](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L51).

## Automated evidence map

File links track the checked-out revision; execution results belong to the
historical boundary above or the bounded evidence below. IDs retain the
`FEAT-002-` prefix and identify evidence families, not literal runner filters.
Source navigation does not establish execution or complete planned-family coverage.
Remaining gaps stay under [#39](https://github.com/killroyZULU/FlyEye/issues/39).

### FEAT-002-UNIT-01

[Recovery contracts](../../../src/features/auth/recovery.test.ts), test
`normalizes email and permits only the exact local recovery callbacks`;
[gateway suite](../../../src/features/auth/services/auth-gateway.test.ts),
`uses the exact recovery redirect and keeps provider outcomes generic`.

### FEAT-002-UNIT-02

[Gateway suite](../../../src/features/auth/services/auth-gateway.test.ts),
`maps revocation_failed and attempts local cleanup when global logout %s`;
[recovery UI](../../../src/features/auth/components/RecoveryFlow.test.tsx),
`fails closed and clears recovery state after an unexpected post-change revocation failure`.
The same file's `FEAT-002 recovery transitions` suite covers concurrent dispatch,
pending update/revocation, verification retry, rejected-password clearing and
late verification success/failure after remount with the same gateway.
`finishes required revocation for an issued password update without changing a newer recovery screen`
preserves post-update cleanup. Browser navigation is mapped under [E2E-02](#feat-002-e2e-02).

### FEAT-002-UNIT-03

[Recovery contracts](../../../src/features/auth/recovery.test.ts),
`reads only one token hash from the fixed route and rejects supplied workflow authority`
and `scrubs credential material from browser history`;
[gateway suite](../../../src/features/auth/services/auth-gateway.test.ts),
`always verifies token hashes as recovery and maps rejection safely`.

### FEAT-002-UNIT-04

[Recovery contracts](../../../src/features/auth/recovery.test.ts),
`applies the approved password baseline without composition rules`;
[gateway suite](../../../src/features/auth/services/auth-gateway.test.ts),
`maps %s without exposing provider details`.

### FEAT-002-COMP-01

[Recovery UI](../../../src/features/auth/components/RecoveryFlow.test.tsx),
`shows the same acknowledgement for %s` and
`validates malformed email and blocks offline submission without queueing it`.

### FEAT-002-COMP-02

[Recovery UI](../../../src/features/auth/components/RecoveryFlow.test.tsx),
`does not consume a recovery credential until explicit confirmation`,
`changes the password, globally signs out, and requires fresh sign-in`,
`uses the same safe invalid state for missing and rejected credentials`,
and the terminal-failure test in [UNIT-02](#feat-002-unit-02).

### FEAT-002-COMP-03

[Recovery UI](../../../src/features/auth/components/RecoveryFlow.test.tsx),
`validates malformed email and blocks offline submission without queueing it`.
The transition test `does not queue offline password updates or automatically submit on reconnection`
also asserts no update while offline or on reconnection, followed by an explicit successful retry.

### FEAT-002-AUTH-01

[Recovery runtime](../../../scripts/test-recovery-runtime.mjs):
`usersBeforeUnknownRequest` checks unknown-email non-creation; `recoveryMessage`
checks the known user's Mailpit callback. This is not the full account-state matrix.

### FEAT-002-AUTH-02

[Recovery runtime](../../../scripts/test-recovery-runtime.mjs):
`verifyProviderAlias`, `recoveryData` and `replayError` cover provider aliases,
verification and replay. Expiry, concurrent redemption and resend/supersession
assertions are not present in this fixture; historical provider observations
remain in [EVID-01](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L39).

### FEAT-002-AUTH-03

[Recovery runtime](../../../scripts/test-recovery-runtime.mjs):
`samePasswordError`, `weakPasswordError`, `recoveredPassword` and `updateError`
cover provider policy/errors and update. Browser input attributes and schema
checks do not establish human password-manager/autofill behavior; see
[residual limitations](#residual-evidence-limitations).

### FEAT-002-AUTH-04

[Recovery runtime](../../../scripts/test-recovery-runtime.mjs): the two
`oldSession` loops after global sign-out check refresh rejection and
`directPathStatuses` (Auth user, bootstrap, organizations table, resolver RPC).
This combined password-change/sign-out scenario does not establish ordinary
logout, all later endpoints or hosted revocation; see
[session evidence](FEAT-001_TRACEABILITY.md#session-control-evidence).

### FEAT-002-AUTH-05

[Recovery runtime](../../../scripts/test-recovery-runtime.mjs):
`passwordChangedContent` and `auditActions` check notification exclusions and
observed actions, including the absence of `token_revoked`. Historical field
inspection is [EVID-05](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L44); it is not a current field-structure assertion.

### FEAT-002-AUTH-06

[Recovery runtime](../../../scripts/test-recovery-runtime.mjs):
`assertOtpBootstrapDenied`, `assertOtpDenialAudit`, `directBeforePassword`
and `fresh`; [bootstrap handler tests](../../../supabase/functions/auth-bootstrap/handler.test.ts),
OTP-only denial cases and `retains password plus TOTP sessions for the existing AAL2 authorization path`.

### FEAT-002-ABUSE-01

[Recovery runtime](../../../scripts/test-recovery-runtime.mjs), `cooldownError`
asserts HTTP 429; [UNIT-01](#feat-002-unit-01) and [COMP-01](#feat-002-comp-01)
cover generic outcomes and CAPTCHA-token forwarding. Active CAPTCHA, timing and
distributed abuse remain unverified; forwarding a token is not provider validation.

### FEAT-002-SEC-01

[UNIT-03](#feat-002-unit-03) locates parser/history assertions;
[recovery UI](../../../src/features/auth/components/RecoveryFlow.test.tsx),
`does not consume a recovery credential until explicit confirmation`, checks
URL removal and no automatic verification. These are not exhaustive browser
storage, logging, analytics or referrer-leakage tests.

### FEAT-002-TENANT-01

The original multi-organization result is [EVID-09](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L48).
Current [recovery runtime](../../../scripts/test-recovery-runtime.mjs) uses one
organization and checks tenant-neutral mail and `protectedDenial` audit context.
[FIX-006 evidence](FEAT-005_SINGLE_SCHOOL_DEPLOYMENT_TRACEABILITY.md) and
[single-school SQL tests](../../../supabase/tests/fix_006_single_school_deployment_test.sql)
own the later singleton/forged-ID regression boundary. No equivalence with the
old multi-membership fixture is asserted.

### FEAT-002-E2E-01

[Active browser runner](../../../scripts/run-e2e.mjs), `runScenario`'s `recovery`
branch, uses mocked Supabase responses. Real Mailpit/password/replay probes are in
[AUTH-01](#feat-002-auth-01), [AUTH-02](#feat-002-auth-02) and
[AUTH-04](#feat-002-auth-04); these separate checks do not demonstrate one
provider-backed recovery browser journey.

### FEAT-002-E2E-02

The same [browser runner](../../../scripts/run-e2e.mjs) checks visible/focused
headings and URL scrubbing at desktop/mobile viewports.
[Navigation assertions](../../../scripts/lib/recovery-browser-navigation.mjs),
`checkUnverifiedRecoveryNavigation` and `checkCompletedRecoveryNavigation`,
cover reload/Back with no recovered credential, completed UI or automatic mutation.
[COMP-01](#feat-002-comp-01) and [COMP-02](#feat-002-comp-02) supply bounded
failure, offline and focus assertions; [EVID-10](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L49) records the
human walkthrough and its exclusions. Formal accessibility acceptance remains open.

### FEAT-002-CONFIG-01

[Auth configuration](../../../supabase/config.toml), sections `auth` and
`auth.email`; [recovery template](../../../supabase/templates/recovery.html);
[runtime orchestration](../../../scripts/run-runtime-matrix.mjs),
`waitForRecoveryTemplate`; [AUTH-01](#feat-002-auth-01),
[AUTH-03](#feat-002-auth-03) and [ABUSE-01](#feat-002-abuse-01) exercise selected
settings. Configuration inspection is not a complete settings-drift test.

### FEAT-002-SCAN-01

[Browser scanner](../../../scripts/check-browser-secrets.mjs),
[general scanner](../../../scripts/check-repository-secrets.mjs) and
[CI workflow](../../../.github/workflows/ci.yml), application secret-scan steps.
The original result is bounded by the [recorded target](#evidence-boundary);
current scanner rules do not prove historical coverage or detect every sensitive value.

### FEAT-002-REG-01

[Identity SQL suite](../../../supabase/tests/feat_001_identity_rbac_test.sql),
[Auth/Edge runtime](../../../scripts/test-edge-runtime.mjs),
[AuthApp tests](../../../src/features/auth/AuthApp.test.tsx) and
[CI workflow](../../../.github/workflows/ci.yml), application/database jobs.
Original result: [EVID-09](https://github.com/killroyZULU/FlyEye/blob/b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66/docs/FlyEye_Documentation/features/FEAT-002_TRACEABILITY.md#L48) and
[recorded CI](#evidence-boundary). These are regression entry points, not a new
claim that every historical assertion still exists unchanged.

## Recovery transition regression evidence

[FIX-007 / #60](https://github.com/killroyZULU/FlyEye/issues/60) records the reviewed
target and delivery checks. On 2026-09-26, four new component cases failed against
`7b6bdeb`: concurrent events invoked request, verification or password-update
methods twice before disabled controls rendered. Synchronous guards corrected
these duplicates without changing provider/session policy. The focused recovery,
contract and gateway group passed 62 tests (17 recovery UI cases, including 10 new
cases); the active browser runner passed 26 desktop/mobile scenarios, including
the added navigation assertions. Existing terminal revocation failure remains
fail-closed. These results cover the FIX-007 worktree based on `7b6bdeb`; final
publication evidence is linked from #60.

Delayed-result tests establish component-instance isolation and continuation of
required revocation after an issued password update. They do not establish
cancellation of provider operations, cross-tab/session-identity races or real
provider revocation timing. Browser evidence covers normal document navigation
with synthetic responses; back-forward-cache restoration, real Auth expiry,
concurrent redemption/resend and the combined real-provider browser journey remain
unverified. The original result cells above retain their historical scope.

## Residual evidence limitations

The Founder/Product Owner exercised the local synthetic desktop request, link, password, validation, completion, and return-to-sign-in flow and reported no material defect in that path. These were not separately recorded as human observations:

- mobile and 200% zoom/reflow;
- assistive-technology live-region behavior;
- password-manager/autofill behavior;
- measured contrast and target sizes;
- injected invalid, offline, and fail-closed states; and
- active CAPTCHA-provider accessibility.

These limitations were accepted only for the bounded local publication decision. They are not formal accessibility compliance evidence.

## Gates preserved

Hosted callbacks, domain, email provider/sender, CAPTCHA, breached-password service, Supabase plan/region/residency, WAF/IP controls, monitoring/alerts, recovery/support procedures, real data, deployment, production, and applicable qualified review remain separate. Agent review and green CI cannot grant them.
