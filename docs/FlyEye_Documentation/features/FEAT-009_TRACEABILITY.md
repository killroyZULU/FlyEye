# FEAT-009 Traceability

## Evidence boundary

The [contract](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md) preserves source v0.1 IDs.
All feature execution below is **pending**: no credential implementation, hosted
run, real delivery or real-document safety is demonstrated by S0 documentation.
Future results must identify commit, test locator, environment, migration,
synthetic fixture, expected/actual result, artifacts and review under
[QA evidence policy](../11_QA_TEST_PLAN.md#9-test-evidence).

## Acceptance and planned evidence

These rows define AC01–AC14; planned assertions have no executable locators yet.
Add actual test links when implemented, retaining original result targets.

| Criterion | Contract mapping                                                                                                                                                                                                                          | Slice and required assertions                                                                                                                                                    | Result  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| AC01      | [CR01](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr01-shared-person-and-applicability), [CR02](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr02-mother-license), [CR03](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr03-dates-and-category-fields) | S1/S2: trainee has four categories; instructor adds optional FI/GI; dual applicability shares credentials and requires NTC/ELP; not-yet-obtained is not approval                 | Pending |
| AC02      | [CR02](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr02-mother-license), [CR11](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr11-history)                                                                                                         | S3: SPL-to-PPL approval leaves one current mother license and preserves prior approval/changes                                                                                   | Pending |
| AC03      | [CR03](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr03-dates-and-category-fields), [CR18](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr18-server-validation)                                                                                    | S2/S4: ELP/no-expiry round-trip; reject blank expiry without selection and issue-after-expiry; approved no-expiry has no warnings                                                | Pending |
| AC04      | [CR05](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr05-evidence-backed-submissions), [CR19](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr19-private-evidence)                                                                                   | S2: initial/replacement PDF and front/back images; reject missing, unsupported, oversized, failed or unprocessed evidence; hosted synthetic upload/access                        | Pending |
| AC05      | [CR06](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr06-pending-uniqueness), [CR07](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr07-current-versus-pending)                                                                                      | S2/S3: concurrent pending uniqueness, withdrawal/replacement, current approval preserved during pending/rejected/withdrawn; initial pending has no current approval              | Pending |
| AC06      | [CR08](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr08-designated-decisions), [CR09](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr09-rejection)                                                                                                 | S3: Admin decision denial; designated same-school other-owner approval/rejection; self-approval and self-rejection denied; no reviewer leaves pending                            | Pending |
| AC07      | [CR09](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr09-rejection)                                                                                                                                                                            | S3: blank rejection fails, reason reaches owner, approval needs no reason, corrected evidence starts new submission                                                              | Pending |
| AC08      | [CR04](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr04-access-scope), [CR21](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr21-current-authority)                                                                                                 | S1–S3: unrelated owner/instructor list/read/write/preview/download denial; cross-school admin search/ID/URL/notification denial                                                  | Pending |
| AC09      | [CR10](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr10-atomic-approval), [CR20](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr20-concurrency-and-retry), [CR21](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr21-current-authority)                  | S3: two reviewers, withdrawal/replacement/revocation races, stale screen, same-key replay and changed-payload conflict; one decision/current version; no duplicate audit/notices | Pending |
| AC10      | [CR11](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr11-history)                                                                                                                                                                              | S2/S3: all transitions attributable; scoped owner/admin history; mandatory-audit failure leaves no partial transition                                                            | Pending |
| AC11      | [CR12](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr12-my-credentials), [CR13](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr13-personnel-credentials)                                                                                           | S1–S4: navigation, queue, filters, comparison/evidence, keyboard and text labels; expiry versus submission status; loading/error/empty/denied/conflict/success                   | Pending |
| AC12      | [CR14](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr14-scheduled-reminders), [CR15](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr15-late-approval-and-renewal)                                                                                  | S4: Manila 31/30/16/15/1/0/expired boundaries, midnight/device zone, no-expiry, late/expired approval, outage/new-recipient catch-up, overlap dedupe, renewal cancellation       | Pending |
| AC13      | [CR16](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr16-review-notifications), [CR17](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr17-delivery-outcome)                                                                                          | S3/S4: eligible approvers/owner, both synthetic channels, failure/uncertainty/retry exhaustion, no rollback or lost in-app event, revoked recipient suppression                  | Pending |
| AC14      | [CR19](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr19-private-evidence), [CR22](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#cr22-approved-record-boundary)                                                                                      | S2/S5: current authorization for direct/file-link fetch, safe email, stable historical approved reference, pending exclusion; no speculative flight integration                  | Pending |

## Shared session verification plan

The [selected policy](../08_SECURITY_REQUIREMENTS.md#selected-session-policy)
requires separate implementation/evidence. These are planned test families, not
test names, passes or an approved implementation design. Each is pending.

| Family | Required evidence                                                                             |
| ------ | --------------------------------------------------------------------------------------------- |
| SE-01  | Session/authentication binding, old/missing state and forged actor/school fail closed         |
| SE-02  | Server clock immediately before, exactly at and after both deadlines                          |
| SE-03  | Approved activity types versus refresh/polling/focus/mouse movement/download                  |
| SE-04  | Duplicate, reordered, concurrent, delayed and fabricated activity cannot resurrect expiry     |
| SE-05  | Active use/token refresh cannot extend maximum lifetime                                       |
| SE-06  | Both five-minute warnings, earliest deadline, keyboard/screen reader, no focus theft or grace |
| SE-07  | Shared-session tabs, lost messages and no token/draft broadcast                               |
| SE-08  | Independent sessions retain independent activity, renewal and timeout                         |
| SE-09  | Sleep/offline/reconnect/device-clock change/back-forward cache revalidation                   |
| SE-10  | Student AAL1 metadata, evidence MFA, privileged assurance and no separate credential timer    |
| SE-11  | Factor removal/replacement, stale AAL2 and refresh after expiry                               |
| SE-12  | Complete protected Edge/SQL/RPC/Storage path inventory with no expiry bypass                  |
| SE-13  | Membership/role revocation, self-review and rollback-only/separate-school denials             |
| SE-14  | Expiry/revocation during observed waits and audit failure; complete state comparison          |
| SE-15  | Same-user memory-only recovery; account/school switch, denial, reload and tab isolation       |
| SE-16  | Lost reply before/after commit, outcome reconciliation and no automatic replay                |
| SE-17  | Interrupted upload, pre-issued links, preview cleanup and controlled orphan handling          |
| SE-18  | Provider/state/audit outage, rate limits, migration/interruption and owned-fixture cleanup    |

Preserve existing shorter role-assignment/status-change recent-password contracts
and account-recovery behavior. A protected-action harness does not verify an
unimplemented credential workflow. Hosted baseline evidence is separately
defined by [STG acceptance](FEAT-003_SYNTHETIC_STAGING_BASELINE.md#first-checkpoint-acceptance).

## S0 verification record

S0 changes requirements and plans only. Its local checks cover document structure,
links, formatting, exact diff, secret prevention and manual contract comparison.
Separate technical review and fresh full-route final-head PR CI are required.
Execution results belong in [issue #208](https://github.com/killroyZULU/FlyEye/issues/208)
and its linked PR; no pending check is credited here.

Earlier local evidence may be reused only after the reviewed comparison required
by [QA reuse](../11_QA_TEST_PLAN.md#evidence-reuse). Existing CI is evidence for
its own revision, not the new policy or hosted target. Preserve the original
environment and limitations when linking results.
