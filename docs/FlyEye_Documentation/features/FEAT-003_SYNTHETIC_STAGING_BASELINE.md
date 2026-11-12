# Feature Specification: FEAT-003 — Shared Synthetic Staging Baseline

## Bounded outcome

Establish one synthetic hosted frontend/backend baseline using existing sign-in
and My Profile, before [S2 hosted evidence verification](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#delivery-slices).
Local development continues. This shared-infrastructure contract does not
implement credentials, session enforcement or production readiness.

[Hosting decisions](../17_PRODUCT_AND_GOVERNANCE_DECISIONS.md#hosting-and-environments)
own provider/account/name, budget, custody and operating-policy selections.
The repository-only contract update authorizes no application/infrastructure
implementation, hosted mutation or merge. Resource creation and deployment are
separate gates below. No new backend, role system, general infrastructure
platform, flight planning, regulator verification or unrelated R5 work is included.

## Existing foundation and required adaptation

Reuse the accepted [stack](../adr/ADR-0005-LEAN-SUPABASE-STACK.md) and
[school isolation](../adr/ADR-0006-SINGLE-SCHOOL-ISOLATED-DEPLOYMENTS.md): static
React/Vite, one isolated Supabase project/synthetic school, reviewed migrations,
Auth/TOTP, protected Edge/SQL commands, private Storage, RLS and atomic audit.
Repository observations and provider readiness are recorded separately in
[traceability](FEAT-003_STAGING_TRACEABILITY.md#staging-readiness-evidence).

The [manifest](../../../config/feat-003-staging-environment.json) and
[reviewed target](../../../config/feat-003-staging-target.mjs) supply the P3a
repository binding; its [validator](../../../scripts/lib/feat-003-staging-manifest.mjs)
checks identity, not deployment authorization. [Runtime configuration](../../../supabase/functions/_shared/edge-runtime-configuration.ts)
accepts only the [P3c runtime contract](#p3c-exact-target-runtime-guards) for
staging. The separate [P3b issuer](#p3b-cli-only-grant-issuance) grants no runtime
authority or hosted activation.

| Surface                 | Bounded adaptation before activation                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight and packaging | Validate a redacted run package, artifact hashes, exact target bindings, selected actions and approval references; reject missing/mismatched data before credential access or network/process work. Preserve disabled defaults and local guards.                                                                                                                                                                                                                                                              |
| First administrator     | After an exact project exists, implement/review the HS-05 CLI-only staging issuer with constrained staging provenance, null human attribution, one atomic grant/audit transaction and sanitized output. No browser/application grant route.                                                                                                                                                                                                                                                                   |
| Synthetic members       | Review a no-send, preconfirmed Auth fixture path plus membership/profile/role establishment for exactly the selected three accounts. Use existing identities, roles and protected/audited semantics; no public provisioning API, direct browser grant or fabricated human audit. Provider Auth and PostgreSQL are not one transaction: journal exact owned IDs, resume/reconcile partial outcomes and stop on uncertainty.                                                                                    |
| Protected runtime       | Review the minimum `auth-bootstrap`, `organization-admin-onboarding`, `member-mfa` and `member-administration` deployment/action inventory. `get_profile` belongs to member-administration. Bind runtime to the exact manifest/build, retaining per-function limiter policy, origin, current-factor, JWT, permission and atomic-audit controls. Unneeded actions/functions remain unavailable; do not activate invitations, recovery mail, aircraft or notifications just because they are in the repository. |
| Auth and browser        | Verify key-format/gateway compatibility without disabling JWT checks, signup closure, TOTP, exact callback URLs, startup/deep-link routing, staging label/noindex and safe handling of unavailable workflows. Keep provider defaults from exposing a send route outside the UI.                                                                                                                                                                                                                               |
| Storage and operations  | Apply only reviewed bucket/policy/configuration requirements, keep buckets private, inventory logs/errors and retain deployment/recovery packages. No first-checkpoint evidence upload or file-processing claim.                                                                                                                                                                                                                                                                                              |

An environment-variable bypass or syntactically valid project reference is never
staging authority. If the minimum dependency inventory cannot meet this boundary,
stop for a bounded design decision rather than expanding the checkpoint.

## Service constraints

Use the selected services only. Published limits checked 2026-11-01 are planning
inputs, not reserved capacity or a guarantee of future price/availability.
[Pages Free](https://developers.cloudflare.com/pages/platform/limits/) allows
500 builds/month, 20,000 files and 25 MiB per static asset; [static requests](https://developers.cloudflare.com/pages/functions/pricing/)
are free. No Pages Functions/Workers backend is planned. [Supabase Free](https://supabase.com/pricing)
includes 500 MB database, 1 GB Storage, 5 GB egress and 500,000 Edge invocations,
with two active Free projects across eligible owner/admin organizations and
inactivity pausing. Recheck account eligibility, region and the project quote
immediately before creation; a quota or paid requirement stops execution.

[Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
accepts prebuilt artifacts; that project cannot later switch to built-in Git
integration. A later CI deployment needs the existing [short-lived federation policy](../10_DEVSECOPS_GUIDE.md#3-pull-request-pipeline).
Supabase [native session controls](https://supabase.com/docs/guides/auth/sessions)
require Pro+ and do not alone implement meaningful-user-activity enforcement.
No paid upgrade or new session implementation is included.

## Credential loading

Before secret-bearing work, the owner must confirm Bitwarden setup, MFA,
independent recovery-kit access and a password-protected encrypted-export
recovery check. Provider MFA evidence does not establish vault readiness.
[Password-protected exports](https://bitwarden.com/help/encrypted-export/) can
be imported into a different account; account-restricted exports cannot supply
that recovery route. Recovery testing must preserve the working vault and avoid
plain-text exports, duplicate live entries or secret-bearing evidence.

The owner unlocks the vault and fills verified provider sites, completing MFA
personally. Approved tools receive only necessary staging credentials through a
reviewed non-echoing local prompt and process-scoped loading. Inspect the pinned
CLI's actual credential persistence and transport before selecting commands.
No secret in arguments, shell history, Git, chat, screenshots, logs or frontend
artifacts; disable clipboard history/sync for secret copying and clear afterward.
Any unavoidable credential file/keychain use needs a reviewed location, access
restriction and cleanup contract before execution. No persistent vault session
or whole-vault access for an agent. Clear task-owned process credentials on exit.

Only the staging API URL and public publishable key enter frontend variables.
Runtime/limiter secrets stay in protected Supabase storage; deployment/database
credentials remain owner-controlled and environment-specific. Do not copy
local/production keys. Record secret names/purposes and scoped identities, never
values. Apply the [source and artifact secret gates](../10_DEVSECOPS_GUIDE.md#2-source-control-model).
Credential rotation/revocation after suspected exposure needs an authorized
containment action; deleting displayed text is not remediation.

## Target manifest and run package

P3a permits the reviewed exact-target manifest transition described below.
Creation produces identifiers, not application authorization. The complete P4
run package still requires:

- Selected provider account/organization IDs, project names, actual Pages project
  ID/canonical origin, Supabase project reference/API origin, region/plan, and
  independently checked database connection target; no local/production target.
- Manifest schema version, enabled state, synthetic classification and onboarding
  limiter policy. The current schema pins `db.<projectRef>.supabase.co`; if Free
  connectivity requires a provider pooler, stop for an explicit reviewed
  project-binding/schema adaptation, never silently substitute its hostname.
- Exact source commit, lockfile/toolchain versions, manifest and static/Edge
  artifact hashes; migration filenames/order/checksums and expected ledger;
  function/action allowlist, versions, JWT configuration and each limiter profile.
- Exact Site URL, permitted callback paths and CORS origins; signup/TOTP settings,
  approved public-key type, private bucket/RLS/grant inventory, synthetic banner,
  deep-link behavior and all reachable preview/deployment URL handling. No
  wildcard Auth redirects or implicit production deployment alias.
- Three named synthetic fixture identities with existing role names and one school,
  issuance/audit provenance, idempotency/resume rules and exact disposable-resource
  ownership ledger. Keep credentials and MFA enrollment material outside it.
- No-send implementation/configuration evidence, secret-loading references,
  monitoring owner, retained artifact/backup locations, approved containment,
  expected STG results and sanitized evidence/cleanup destinations.
- Separate creation and deployment approval references, allowed operations,
  review/CI target, applicable [SESS controls](../08_SECURITY_REQUIREMENTS.md#session-control-applicability)
  and unresolved risks/reviewer requirements. A changed target, artifact,
  migration set or authority-bearing configuration requires renewed review and
  approval; no operator improvisation after a mismatch.

A run-package reference is not an instruction to commit secrets or activation
settings in this documentation PR. Final command lines are reviewed against
pinned CLI help after adaptation; placeholder commands are not an executable plan.

## Finite execution sequence

### P1 offline preflight contract

The [offline validator](../../../scripts/lib/feat-003-staging-preflight.mjs)
accepts UTF-8 manifest, execution-package and separate review-record JSON text,
an in-memory map of artifact bytes, and the independently captured checkout's
full commit SHA. It accepts no file paths, credentials or execution callbacks.
Disabled manifests stop first. P3a additionally binds enabled inputs to the
reviewed repository target; tests use synthetic packages without hosted IO.

The version-1 execution package binds staging/synthetic classification, provider
account/organization and project identities, matching manifest targets, Singapore,
Free/$0, the canonical Pages origin, source revision and the exact manifest-byte
SHA-256. Its artifact inventory requires one nonempty byte bundle each named
`configuration`, `edge`, `frontend`, `lockfile` and `migrations`, with SHA-256
digests. These are opaque bundles: configuration/toolchain inventories and ordered
migration contents still require P3 semantic review; hashing proves consistency,
not safe content or build provenance.

The fixed declarative operation sequence is `migrations`, `configuration`,
`functions`, `fixtures`, `frontend`, `checkpoint`, `redeployment`. It cannot execute
those operations. Distinct creation/deployment approval references must match the
separate review record, which pins the entire execution-package byte digest,
target and source revision. Whitespace changes also invalidate byte digests.
The caller must independently establish review-record provenance, actual checkout
identity and current owner authority; self-supplied matching JSON is not approval.

| ID      | Acceptance                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| P1-AC01 | Reject disabled execution first; repository target population is permitted only under the P3a contract below.      |
| P1-AC02 | Reject missing, malformed or mismatched target identities.                                                         |
| P1-AC03 | Bind checkout/review/package revisions, manifest digest and required artifact bytes.                               |
| P1-AC04 | Require distinct, separately recorded creation/deployment approvals for the exact package.                         |
| P1-AC05 | Fixed sanitized rejection, no credential/network/child-process access, and no execution authority even on success. |

Successful offline validation returns `executionAuthorized: false`. No P2–P4 or
STG acceptance follows from it.

### P3a exact-target repository binding

P3a changes only the manifest, offline validation/tests and canonical evidence.
The immutable [target record](../../../config/feat-003-staging-target.mjs) owns
provider account/organization, opaque Pages ID, project names, origins, database
host, region, Free plan and $0 ceiling. The enabled version-1 manifest must match
that record exactly. Its `enabled` flag permits offline target validation; it
does not authorize hosted execution or change the local-only runtime.

Package and review records must match the repository target as well as each
other. Matching caller-supplied records cannot authorize target substitution.
Do not add an override, environment-selected allowlist or executable issuer.
P1's revision, byte-digest, artifact and distinct approval checks remain required;
P3a approval is not the separate P4 deployment approval. No real execution package
or placeholder deployment approval is committed by this slice.

| ID       | Acceptance                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3A-AC01 | Accept only the reviewed P2 manifest and complete target record, including the independently observed opaque Pages ID.                                                 |
| P3A-AC02 | Reject missing/substituted identities even when manifest, package, review and hashes agree with one another; reject disabled/unreviewed manifests before later inputs. |
| P3A-AC03 | Retain P1 revision/artifact/approval checks, fixed sanitized errors, no credential/network/process capability and `executionAuthorized: false`.                        |
| P3A-AC04 | Preserve local examples, JWT checks, hosted-runtime rejection and dormant issuer; no hosted mutation, migration, account, role or deployment implementation.           |
| P3A-AC05 | Pass focused regressions, applicable repository verification, independent review and full final-head CI; stop at the reviewed green PR. Merge is separate.             |

Verify identity metadata read-only before implementation. A missing identifier,
pooler requirement or necessary runtime/issuer change stops for a bounded decision.
Database connectivity, hosted no-send behavior and STG acceptance remain later
evidence. Retain prior evidence only under the QA input-equivalence rule.

### P3b CLI-only grant issuance

P3b permits a repository-only executable issuer under the
[HS-05 transition](FEAT-003_HOSTED_SYNTHETIC_HARDENING.md#feat-003-hs-05-cli-only-staging-issuance).
It reuses P1/P3a and existing tables; it installs no RPC, role, schema or runtime
escape hatch. Issuance creates a pending grant, not an account, membership, role
assignment or MFA bypass. Hosted execution requires the separate P4 decision.

The [CLI](../../../scripts/issue-feat-003-staging-grant.mjs) accepts only absolute
`--package-dir` and `--psql` paths. The directory holds `package.json`,
`review.json` and the five P1 byte artifacts under `artifacts/`, named exactly by
their inventory keys. Metadata files are bounded to 64 KiB, artifacts to 16 MiB
each and the reviewed PostgreSQL 17 executable to 64 MiB. Keep the package outside
the clean checkout on trusted local storage, without network mounts or redirected
parent directories. Explicit UNC/device paths are rejected before filesystem reads;
the operator remains responsible for local filesystem/mount provenance.
The configuration artifact additionally binds
`stagingGrantToolSha256` and `stagingGrant`: distinct UUIDv4 `organizationId`,
`eligibleUserId`, `grantId`, `sourceInstanceId`, `issuanceCorrelationId`, and
`transactionSha256` for the exact version-controlled SQL bytes. Changes require
new artifact/package review; hashes and typed references do not authenticate
approval or establish trusted provenance.

Before operator callbacks, credential entry, network or child execution, reject
invalid manifest/package/review/revision/bytes/request. Then verify an interactive
terminal, reviewed executable digest, clean matching checkout, PostgreSQL 17 and
typed deployment approval reference. The trusted operator host must provide the
reviewed client and dependencies; no executable is downloaded by the CLI.
The native non-echo password prompt receives manual input only after these gates.
Do not pass credentials in arguments, environment, package files or output.
Inherited connection/credential/startup variables are excluded; the direct host,
port, database/user and verified TLS are fixed. A pooler, unsupported client,
unavailable terminal or connectivity change requires a separate decision.

The [transaction](../../../scripts/sql/feat-003-staging-grant.sql) locks the school
before checking one active school, a confirmed/nondeleted/nonbanned eligible
Auth user, no membership, no active administrator and no live pending grant.
It commits exactly one constrained grant/audit pair or rolls back both, preserving
the existing server-issued 30-minute grant expiry. Concurrent issuance serializes;
replay rejects without granting authority. Fixed output reports confirmed issuance
or uncertain outcome. Any transport/error/ambiguous acknowledgement stops for
reconciliation without retry; a failed command does not prove rollback.

| ID       | Acceptance                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P3B-AC01 | Reuse exact-target preflight before all operator capabilities; bind reviewed SQL, tool and request bytes.                                   |
| P3B-AC02 | Reject invalid file/terminal/tool/checkout/confirmation inputs; pin the connection and keep credentials/raw output private.                 |
| P3B-AC03 | Atomically create one pending staging-provenance grant/audit pair, with null human attribution and no membership/role changes.              |
| P3B-AC04 | Deny ineligible/cross-school/application-role requests, duplicates and races; prove grant/audit failure rollback and owned-fixture cleanup. |
| P3B-AC05 | Return only fixed status; stop on uncertain outcome without retry or claimed rollback.                                                      |
| P3B-AC06 | Independent review and applicable full CI pass; preserve hosted runtime rejection and stop at a reviewed green PR.                          |

Offline tests and the attested disposable-CI transaction fixture supply repository
evidence. No hosted credentials, connectivity, prompt, deployment or STG acceptance
can be inferred from them. Existing local stacks are not reset for this slice.

### P3c exact-target runtime guards

P3c transitions [HS-03](FEAT-003_HOSTED_SYNTHETIC_HARDENING.md#feat-003-hs-03-runtime-configuration-fails-closed)
through repository code and synthetic tests only. The runtime imports the P2
[target record](../../../config/feat-003-staging-target.mjs); no environment value
can substitute another project or frontend. Require exact API/origin/project-ref,
`FLYEYE_RUNTIME_PROFILE=staging-synthetic-v1`,
`FEAT003_STAGING_PROJECT_REF` and
`FLYEYE_STAGING_ACTION_POLICY_VERSION=minimum-actions-v1` before client creation.
Missing or conflicting settings stop startup with fixed errors.

| Function                      | Staging actions                              | Required limiter policy / configuration prefix   |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------ |
| auth-bootstrap                | Existing empty-body access resolution only   | auth-bootstrap-subject-v1 / FEAT001              |
| organization-admin-onboarding | status, start, complete, cancel              | subject-action-v1 / FEAT003                      |
| member-mfa                    | status, start, bind_factor, complete, cancel | member-mfa-subject-action-v1 / FEAT006           |
| member-administration         | get_profile only                             | member-administration-subject-scope-v1 / FEAT005 |

Each prefix requires `_DATA_CLASSIFICATION=synthetic-only` and
`_LIMITER_POLICY_VERSION` as above. Existing HMAC length/key-separation rules
remain for FEAT003/005/006; bootstrap retains its database limiter without a new
HMAC secret. The versioned server action policy denies unlisted actions before
business commands. Authenticated denials retain mandatory audit and fail closed
on audit failure. Existing JWT, current-factor, assurance, recent-password,
permission, organization, idempotency and atomic-audit checks remain authoritative.
A runtime profile never grants user authority. Local actions remain unchanged;
other functions remain unavailable under the staging profile.

| ID       | Acceptance                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3C-AC01 | Reject missing/substituted targets, profile, origin, classification and limiter policy before privileged client creation or network work.                                                      |
| P3C-AC02 | Enforce only the versioned function/action inventory above; deny unknown actions and preserve mandatory denial audit.                                                                          |
| P3C-AC03 | Preserve JWT, authentication/current-factor, permissions, cross-school isolation, idempotency and atomic audit; no new identity or role system.                                                |
| P3C-AC04 | Synthetic positive/failure tests cover startup order, coherent target substitution, denied actions, assurance/tenant denial and unchanged local behavior; retain preflight/issuer regressions. |
| P3C-AC05 | Update HS-03 and canonical traceability; no schema, package, account-lifecycle, credential-loading, browser packaging or deployment change.                                                    |
| P3C-AC06 | Applicable verification, separate review and full final-head CI pass; stop at a reviewed green PR.                                                                                             |

Runtime acceptance establishes configuration consistency, not independent provider
attestation or deployment approval. P4 still binds reviewed revision/artifacts,
settings and approvals. No-send/account lifecycle and browser packaging remain
separate P3 work; absence of email functions does not disable provider Auth mail.
Stop for a scope decision if a migration, new dependency or hosted operation is
needed. Local tests cannot establish STG acceptance.

### Execution gates

| Gate                                  | Deliverable and acceptance                                                                                                                                                                                                                      | Dependency and stop                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 Repository preparation             | Smallest next implementation: disabled manifest/run-package preflight validation and tests for incomplete/mismatched identities, artifacts and approvals; fail before credentials/network/child processes. Use synthetic test manifests only.   | This contract's reviewed merge and separate implementation authorization. No hosted issuer, credentials, configuration or activation. Stop at its reviewed green PR.                                                                                                                                    |
| P2 Resource creation                  | Owner separately approves only the two empty projects in the selected accounts, current Free quote/region, names and $0 ceiling. Record actual IDs/origins and defaults; no app users, roles, migrations, functions, buckets or app deployment. | Owner/vault readiness and P1 available; recheck costs/capacity/name availability. Pages empty Direct Upload creation must be possible without uploading an artifact; otherwise stop and clarify that boundary. Project creation may generate provider-managed credentials; keep values out of evidence. |
| P3 Exact-target repository adaptation | Reviewed exact-target manifest plus CLI issuer, three-fixture no-send lifecycle, required runtime guards/action inventory, browser/config packaging and failure/recovery tests. Reuse existing workflows; local/CI synthetic tests only.        | P2 identifiers and separate repository implementation authorization. Review each coherent issuer/runtime/browser change under normal integration rules; the executable issuer cannot precede HS-05's exact target gate. Stop at reviewed green PRs; merge separately authorized.                        |
| P4 Hosted deployment/checkpoint       | Owner separately approves the exact merged revision/run package and bounded hosted operations below. Capture actual STG-01–08 evidence and same-revision redeployment.                                                                          | P3 integrated green, no-send readiness, credential custody and current approvals verified. Stop on any failure; on success stop for synthetic-baseline acceptance.                                                                                                                                      |

P4 performs this ordered checklist, with each step dependent on the preceding
receipt, not on a successful command exit alone:

1. Verify owner authorization, provider identities, cost/limits, exact artifact
   hashes and manifest/configuration; load only the approved credentials. Check
   actual provider/database state and expected empty or known ledger before writes.
2. Apply the exact reviewed migration set once through versioned migrations;
   verify ledger, schema/grants/RLS and private bucket policies. Preserve existing
   data first if the operation can affect it. No reset or dashboard schema edits.
3. Apply and independently read back approved Auth/origin/no-send/runtime settings
   and secrets; deploy only the reviewed Edge inventory with JWT checks. Record
   versions and sanitized startup/health results. No account creation until the
   no-send path is verified; no credential values in the receipt.
4. Establish or reconcile the three synthetic accounts and one school through the
   reviewed fixture/bootstrap paths, including required Instructor/Admin MFA and
   atomic authority/audit evidence. Preserve completed memberships/audit. A
   partial failure stops for exact reconciliation, not broad teardown/recreation.
5. Manually upload the verified static artifact to Pages Direct Upload, record
   the actual deployment/version and confirm canonical/deployment URLs and Auth
   callbacks match the package. No Git-triggered deployment or paid add-on.
6. Execute STG-01–07, capture sanitized expected/actual results and limitations,
   inspect provider usage/errors and owned disposable residue. Export the
   accepted database state securely; record coverage limitations without claiming
   an Auth/Storage restore has been proved.
7. Redeploy the same approved compatible frontend/Edge artifacts without replaying
   migrations or creating fixtures; repeat smoke checks for STG-08. Complete only
   approved exact disposable cleanup, verify retained records, review evidence
   and stop for owner synthetic-baseline acceptance.

These are future hosted mutations, not permissions granted by the documentation
or repository implementation PR. CI is verification-only throughout.

## Synthetic fixtures and no-send boundary

Use the [selected three-account stage](../17_PRODUCT_AND_GOVERNANCE_DECISIONS.md#hosting-and-environments)
with one identity/membership/role each; HoT/CFI activation follows S1 implementation
and separate approval, with credential review evidence in S3. Do not grant those
roles or use Organization Admin as a substitute reviewer now.

No application email, invitations, password-reset sends, magic links or scheduled
notifications in the first checkpoint. A preconfirmed synthetic Auth user is a
fixture exception, not a change to the invitation-only product contract. Retain
MFA and protected bootstrap/assignment controls. Absence of custom SMTP is not
no-send proof: [default Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
can send. Review provider endpoints as well as application routes, demonstrate
non-delivery locally, and read back hosted restrictions without sending a probe
email. If the provider cannot guarantee this boundary, stop before fixture
activation for an explicit decision. Provider-account security messages are
separate from application test delivery.

CLI derivatives ([Windows](../../../scripts/no-send-cli/build.ps1),
[Linux x64](../../../scripts/no-send-cli/build-linux.mjs)) pin source/compiler and
[reviewed platform hashes](../../../scripts/lib/no-send-cli-artifact.mjs) before
Docker. Guards permit five services with exact loopback/network/ports and
temporary Auth/Storage/Realtime schema jobs with pinned images/commands, the owned
database, no published ports or extra Docker options. Lifecycle, cleanup and
post-start checks remain unchanged; process-scoped overrides cannot replace the
installed CLI or configure hosted targets. Linux candidates cannot activate
fixtures; CI rejects pending hashes before acquisition and compares rebuilds
against independently reviewed locks. Builds do not prove
startup, fallback, unmodified-CLI compatibility, Linux reproducibility or hosted
readiness. Full runtime/cleanup gates require separately approved execution.

## First checkpoint acceptance

Use the existing [profile contract](FEAT-005_USER_MANAGEMENT_AND_BASIC_PROFILES.md#roles-and-authority).
Every criterion requires actual hosted evidence for the approved revision;
[readiness observations](FEAT-003_STAGING_TRACEABILITY.md#staging-readiness-evidence) do
not pass these checks.

| ID     | Acceptance and evidence                                                                                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STG-01 | Approved project/origin, account IDs and exact code/artifact/function versions match; no target substitution.                                                                                  |
| STG-02 | Ledger matches reviewed migrations; RLS/grants/private buckets, signup, no-send, TOTP, JWT, exact origins and secret configuration verified without values.                                    |
| STG-03 | Student signs in with permitted AAL1; Instructor and Admin reach privileged access only after existing MFA. Unrestricted registration and unapproved roles remain unavailable.                 |
| STG-04 | Real hosted `get_profile` returns each signed-in member's expected synthetic profile through the protected path.                                                                               |
| STG-05 | Student directory access, another member's profile ID, anonymous requests and direct protected table/RPC bypass return no protected data; Instructor/Admin AAL1 cannot gain privileged access. |
| STG-06 | Exact Site URL/callbacks, deep-link reload and safe invalid-callback behavior; refresh, sign-out and reopening tested and characterized separately from server revocation.                     |
| STG-07 | Required audit and sanitized errors/correlation are retrievable; no secrets/restricted payloads in evidence; no application-email side effects.                                                |
| STG-08 | Same approved revision redeploys and repeats sign-in/read/denial checks without duplicate fixtures, schema drift or destructive reset; retained records and cleanup ledger reconcile.          |

Record tester/date, actual targets, expected/actual outcome, safe evidence and
limitations using [QA evidence policy](../11_QA_TEST_PLAN.md#9-test-evidence).
Redirect checks do not demonstrate mail delivery; sign-out UI cleanup does not
prove immediate invalidation of every issued token. The first checkpoint does
not claim the new selected session policy is enforced. Cross-school tests use
rollback-only local/CI fixtures or separately approved isolated deployments,
never a second school committed here. Reuse prior evidence only under
[QA input-equivalence review](../11_QA_TEST_PLAN.md#evidence-reuse), keeping its
original revision/environment. Local/CI success cannot replace hosted checks.

## Retention recovery and monitoring

Apply the [selected lifecycle policy](../17_PRODUCT_AND_GOVERNANCE_DECISIONS.md#hosting-and-environments).
Retain reusable fixtures and later credential/evidence history; deactivation
revokes access and preserves history. Remove only approved exact disposable
resources after proving ownership and absence of references/in-flight operations.
No account cascade, age purge or duplicate fixture set per deployment.

Retain verified frontend/Edge packages and redacted configuration/migration
receipts. Keep encrypted owner-controlled database exports after accepted
checkpoints and before risky changes; preserve future Storage objects separately.
[Database backups](https://supabase.com/docs/guides/platform/backups) omit Storage
bytes. Auth restore coverage, database/object reconciliation and actual restore
ability remain unproved until a separately approved drill. Frontend rollback
requires backend compatibility and never rolls back the database. Destructive
restore/rebuild/retirement requires an exact separate approval; a backup does
not authorize destruction.

The owner checks existing provider logs, errors, audit and usage before/during/
after each run and captures sanitized evidence within provider retention. No
continuous-monitoring service or availability guarantee is implied. Review
retention/recovery/access at checkpoint completion and every 30 days; this is a
manual responsibility, not an installed scheduler.

Stop on wrong target/version/configuration, authorization bypass, leaked secrets,
missing mandatory audit, real data, unexpected application mail, costs/quotas
outside the ceiling, a failed required check, or uncertain integrity/cleanup/
recovery. Preserve evidence and use only preapproved narrow containment; do not
reset, delete, rotate credentials or silently retry an ambiguous mutation.
After STG-01–08 pass and limitations are reviewed, stop for owner acceptance.
Record unrelated gaps separately instead of expanding this task.

## Later gates and dependencies

S0 and safe independent local S1 need not await staging; accepted STG precedes
S2 hosted uploads. Shared session enforcement remains a separate bounded
security dependency. Keep S0–S5 and the existing [integration checkpoint](../09_AI_DEVELOPMENT_GUIDE.md#integration-checkpoint).

S4 initially uses local SMTP capture and controlled local scheduling; hosted
Supabase cannot use laptop loopback capture. External email and hosted scheduling
require separate approval of sender/provider, designated test recipients,
send/usage limits, schedule, monitoring and stop switch. Test deduplication,
uncertain delivery/retry exhaustion and overlap/outage only within that scope.

Safe file processing, real-data retention/permanent deletion, privacy, tested
recovery, operations/support readiness and production hosting remain explicit
release prerequisites. Synthetic acceptance is not real-document, real-user,
pilot or production acceptance.
