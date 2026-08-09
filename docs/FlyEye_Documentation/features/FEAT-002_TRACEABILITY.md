# FEAT-002 Traceability

## Evidence boundary

- Feature commit: `fd1bd2f9aef9bce159b93ce76dd7530371f2d897`
- Merge: PR #5 at `4f993f0d0dc40f8a5783ae5176ffe2ef6000ca94`
- Closure documentation: PR #6 at `b2ee3d786a45cb9ea65842bca3ccd2030ffcbd66`
- Environment: Pinned local Supabase stack and local browser tests
- Data: Randomized synthetic `.test` identities and organizations only
- Review: Separate Codex review and automated evidence; no qualified independent human technical/security/privacy review

Pre-merge CI run `30237389881`, post-merge run `30237614093`, and closure-documentation run `30238931694` passed Application quality and Local Supabase security. CI performed no deployment.

## Requirements and results

| Requirement ID | Outcome/control | Evidence | Result and limitation |
|---|---|---|---|
| `FEAT-002-01` | Generic self-service request | `AC-01/02`, `UNIT-01`, `COMP-01`, `AUTH-01`, `ABUSE-01` | Partial pass: generic UI, malformed/offline, provider failure, cooldown, and unknown-account non-creation passed; suspended, banned, deleted, invited-unconfirmed, provider-only, timing-distribution, and active-CAPTCHA cases remain pending |
| `FEAT-002-02` | Recovery creates no account or authority | `AC-02/13`, `AUTH-01`, `TENANT-01`, `REG-01` | Pass locally; no Auth/application record, schema, role, or membership was created |
| `FEAT-002-03` | Short-lived, single-use, prefetch-safe credential | `AC-03`–`AC-06/08`, `UNIT-03`, `AUTH-02/06`, `SEC-01`, `E2E-01` | Pass locally; reverify on Auth/provider upgrade |
| `FEAT-002-04` | Credential secrecy | `AC-06/07/14`, `UNIT-03/04`, `SEC-01`, `SCAN-01` | Pass locally; no durable credential path found |
| `FEAT-002-05` | Server-authoritative password policy | `AC-07/08`, `UNIT-04`, `AUTH-03`, `E2E-01` | Pass locally; breached-password production control pending |
| `FEAT-002-06` | Revoke old sessions and require fresh sign-in | `AC-05/08/09/10`, `UNIT-02`, `COMP-02`, `AUTH-04/06`, `E2E-01`, `REG-01` | Pass locally; hosted session behavior must be reverified |
| `FEAT-002-07` | Fail closed on partial provider/revocation failure | `AC-10`, `UNIT-02`, `COMP-02`, `AUTH-04`, `EVID-11` | Corrected tests pass; live hosted failure injection pending |
| `FEAT-002-08` | Audit and user notification | `AC-11`, `AUTH-05/06`, `CONFIG-01`, `EVID-07/08` | Pass locally; production retention, drains, access, alerting, and ownership unresolved |
| `FEAT-002-09` | Abuse and enumeration resistance | `AC-01/12`, `UNIT-01/02`, `COMP-01`, `ABUSE-01` | Local cooldown/guards pass; active CAPTCHA, distributed/IP/WAF, timing, and provider accessibility pending |
| `FEAT-002-10` | Multi-organization isolation | `AC-13`, `TENANT-01`, `AUTH-01`, `REG-01` | Pass locally; no organization or membership state changed |
| `FEAT-002-11` | Accessible responsive and offline-safe flow | `AC-15`, `COMP-01/02/03`, `E2E-02`, `EVID-10` | Automated/local scope pass; residual human observations listed below |
| `FEAT-002-12` | Reproducible environment configuration | `AC-03/11/12/14`, `CONFIG-01`, `SCAN-01` | Pass locally; hosted origins, providers, secrets, and settings unresolved |
| `FEAT-002-13` | Preserve FEAT-001 Auth, RLS, audit, and tenancy | `AC-05/09/13/14`, `AUTH-06`, `REG-01`, full matrix | Pass on recorded target |
| `FEAT-002-14` | Keep implementation evidence separate from later gates | `EVID-07`–`EVID-12`, PR #5/6, CI | Local implementation and merge evidenced; hosted, real-data, deployment, and production gates remain open |

## Pinned provider findings

- GoTrue `v2.192.0` accepted a recovery token through `recovery`, `email`, and `magiclink`; each produced an OTP-only session without a recovery-purpose JWT claim.
- Direct tenant table/RPC access remained denied. Protected FlyEye bootstrap denied and audited each OTP-only variant because password AMR was absent.
- Password and password-plus-TOTP sessions retained their normal FEAT-001 paths.
- Observed Auth actions were `user_recovery_requested`, `login`, `user_updated_password`, `user_modified`, and `logout`. `token_revoked` was not observed and is not claimed.
- Old refresh tokens and old Auth/bootstrap/Data API/RPC access were denied after password update and global sign-out.

Reverify these findings when the pinned Auth implementation changes.

## Stable evidence and automated identifiers

- `FEAT-002-EVID-01`, `FEAT-002-EVID-02`, `FEAT-002-EVID-02A`, `FEAT-002-EVID-03`, `FEAT-002-EVID-04`, `FEAT-002-EVID-05`, and `FEAT-002-EVID-06` record pinned provider, AMR, access, audit, privacy, and cleanup observations.
- `FEAT-002-EVID-07` records OTP-only bootstrap denial and protected audit.
- `FEAT-002-EVID-08` records recovery, password, notification, and old-session/path denial.
- `FEAT-002-EVID-09` records SQL/RLS, tenancy, generated-type, and FEAT-001 regression evidence.
- `FEAT-002-EVID-10` records automated UI/browser evidence and the focused desktop walkthrough boundary.
- `FEAT-002-EVID-11` records corrected terminal post-password-change failure behavior.
- `FEAT-002-EVID-12` records PR #5 merge and CI publication evidence.

Stable automated IDs are `FEAT-002-UNIT-01`, `FEAT-002-UNIT-02`, `FEAT-002-UNIT-03`, `FEAT-002-UNIT-04`, `FEAT-002-COMP-01`, `FEAT-002-COMP-02`, `FEAT-002-COMP-03`, `FEAT-002-AUTH-01`, `FEAT-002-AUTH-02`, `FEAT-002-AUTH-03`, `FEAT-002-AUTH-04`, `FEAT-002-AUTH-05`, `FEAT-002-AUTH-06`, `FEAT-002-ABUSE-01`, `FEAT-002-SEC-01`, `FEAT-002-TENANT-01`, `FEAT-002-E2E-01`, `FEAT-002-E2E-02`, `FEAT-002-CONFIG-01`, `FEAT-002-SCAN-01`, and `FEAT-002-REG-01`.

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
