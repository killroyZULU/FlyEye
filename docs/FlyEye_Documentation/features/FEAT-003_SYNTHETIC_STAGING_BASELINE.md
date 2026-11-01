# Feature Specification: FEAT-003 — Shared Synthetic Staging Baseline

## Bounded outcome

Establish one synthetic hosted frontend/backend baseline using existing sign-in
and My Profile, before [S2 hosted evidence verification](FEAT-009_PERSONAL_CREDENTIAL_TRACKER.md#delivery-slices).
Local development continues. This prospective shared-infrastructure contract does
not implement credentials, session enforcement or production readiness.

Execution requires the [hosting decisions](../17_PRODUCT_AND_GOVERNANCE_DECISIONS.md#hosting-and-environments)
and separate approval of exact resources and hosted actions. Provisioning,
accounts/credentials, grants, migrations, deployment, external mail and merging
are outside S0. No new backend, role system, general infrastructure platform,
flight planning or unrelated R5 work is included.

## Existing foundation and required adaptation

Use the accepted [stack](../adr/ADR-0005-LEAN-SUPABASE-STACK.md) and
[school isolation](../adr/ADR-0006-SINGLE-SCHOOL-ISOLATED-DEPLOYMENTS.md): one
static React/Vite deployment, one separate Supabase project and one synthetic
school. Reuse version-controlled migrations, Auth/TOTP, protected Edge/SQL
commands, private Storage, RLS and atomic audit.

The [staging manifest](../../../config/feat-003-staging-environment.json) is
disabled and target-free. [Runtime configuration](../../../supabase/functions/_shared/edge-runtime-configuration.ts)
rejects hosted onboarding/member-management/MFA profiles. The staging issuer is
dormant under [FEAT-003 hardening](FEAT-003_HOSTED_SYNTHETIC_HARDENING.md).
Activation must adapt only the functions/fixture paths required by this
checkpoint, preserve local guards and bind the exact reviewed project/build.
Do not turn a broad environment-variable bypass into staging authority.

Provisioning approval, if later given, identifies the resource owner and intended
provider/plan/region/budget. Once the project reference exists, review the exact
target manifest before fixture or application activation. Provider creation is
not permission for arbitrary application mutations. Fixture issuance uses
existing identities and constrained audited staging provenance, never fabricated
human attribution or an application-accessible grant route.

## Proposed service choices and costs

The following are recommendations, not selected accounts or subscriptions.
Account ownership, quota availability and exact targets require owner decisions.
Official pricing checked 2026-11-01; recheck before activation. Estimates are USD
before tax and usage extras.

| Component             | Recommendation and consequence                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend              | Cloudflare Pages Free, fixed HTTPS `pages.dev` origin; static assets only, no Workers backend or public evidence hosting                    |
| Supabase              | One Free staging project, specific Singapore `ap-southeast-1`; region selection is not privacy/residency approval                           |
| Initial budget        | $0/month ceiling; quota or paid-control requirement stops for a decision                                                                    |
| Optional paid backend | Pro starts at $25/month with compute credit for one Micro project; additional projects from $10/month and usage extras; no upgrade selected |

[Pages limits](https://developers.cloudflare.com/pages/platform/limits/): Free
allows 500 builds/month, 20,000 files and 25 MiB per static asset.
[Static requests](https://developers.cloudflare.com/pages/functions/pricing/)
are free. [Supabase Free](https://supabase.com/pricing) includes 500 MB database,
1 GB Storage, 5 GB egress and 500,000 Edge invocations; at most two active free
projects, pausing after a week of inactivity and one-day API/database logs.
[Singapore](https://supabase.com/docs/guides/platform/regions) is an available
specific region. Supabase's [native session controls](https://supabase.com/docs/guides/auth/sessions)
require Pro+, use refresh-based checks and do not alone satisfy meaningful-user-
activity enforcement. Neither purchase nor enforcement implementation is implied.

## Configuration and delivery contract

Use a single fixed frontend origin, explicit Auth Site URL and exact approved
callback paths. Keep signup restricted, current MFA/assurance and JWT checks,
existing rate policies, private buckets and reviewed grants/RLS. Verify hosted
settings independently; local `config.toml` is not evidence they were applied.
Reject target mismatch, wildcard origins and unsafe browser keys.

Only the staging API URL and publishable key enter frontend build variables.
Keep privileged runtime/deployment/database/limiter secrets environment-specific
in protected provider/operator stores, never source, command arguments, logs or
frontend artifacts. Do not copy local development credentials. Inspect the built
artifact with the existing secret gates. Service credentials remain server-only.

Prefer an explicit operator deployment of a verified commit and prebuilt static
artifact, with recorded build toolchain/hash, frontend deployment, function
versions, migration ledger and redacted configuration receipt. No automatic PR
deployment or production target. [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
supports prebuilt artifacts but cannot later switch to Git integration in the
same project. A later CI deployment must satisfy the existing short-lived
federation rule in [DevSecOps](../10_DEVSECOPS_GUIDE.md#3-pull-request-pipeline).

Apply only reviewed migrations using the existing delivery process. Redeploy the
same revision without reset, duplicate fixture creation or dashboard schema
drift. Retain redeployable frontend/Edge artifacts and a compatible forward-fix/
recovery plan. No destructive cleanup is implicit in failure recovery.

Use a small named fixture set (student and administrator), generated documents
only when later needed, and no-send account establishment. Verify a no-send
configuration/path before activation; if it cannot be guaranteed, stop for a
bounded decision. Do not weaken registration or MFA to avoid email setup.
Retain logs only with safe identifiers/reason codes; nominate a monitoring owner
and capture evidence promptly within provider retention. No extra monitoring
subscription is assumed.

## First checkpoint acceptance

Use the existing [profile contract](FEAT-005_USER_MANAGEMENT_AND_BASIC_PROFILES.md#roles-and-authority),
not aircraft operations or credential uploads. Every criterion needs actual
hosted evidence at the reviewed revision; all are pending.

| ID     | Acceptance and evidence                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STG-01 | Approved project/origin and exact code/artifact/function versions match; no local/production target substitution                                               |
| STG-02 | Migration ledger matches reviewed set; RLS/grants, private buckets, signup, TOTP, JWT, origin and secret configuration checked without exposing values         |
| STG-03 | Synthetic student signs in; administrator reaches privileged access only with existing MFA; no unrestricted registration                                       |
| STG-04 | Real hosted `get_profile` returns only the signed-in member's expected synthetic profile through the protected path                                            |
| STG-05 | Student directory access, another member's profile ID, unauthenticated request and direct protected table/RPC bypass return no protected data                  |
| STG-06 | Exact Site URL/callbacks, deep-link reload and safe invalid callback behavior; refresh, sign-out and reopening characterized separately from server revocation |
| STG-07 | Required audit and sanitized errors/correlation IDs are retrievable; no secrets or restricted payloads in evidence                                             |
| STG-08 | Same approved revision redeploys and repeats smoke checks without duplicate fixtures, schema drift or destructive reset                                        |

Redirect checks do not demonstrate mail delivery. Sign-out UI cleanup does not
demonstrate immediate invalidation of every issued token. Record applicable
[SESS controls](../08_SECURITY_REQUIREMENTS.md#session-control-applicability),
settings, unresolved tests and risk-triggered reviewer requirements before the run.
The first checkpoint does not claim the selected new session policy is enforced.

Cross-school tests use rollback-only local/CI fixtures or separately authorized
isolated deployments, never a second school committed into this project. Staging
smoke is additional evidence, not a substitute for the applicable local/CI matrix.

Stop when STG-01–08 pass with a reviewed limitations record, then request synthetic
baseline acceptance. Target mismatch, leaked privilege, access bypass, missing
mandatory audit or uncertain cleanup blocks acceptance. Record unrelated gaps
separately; do not absorb a broad security/infrastructure project.

## Later gates and dependencies

S0 and independent local S1 work can proceed without STG. Accepted STG precedes
S2 hosted upload verification. Future session enforcement is a separate bounded
security dependency of the affected credential behavior; do not implement it in
the smoke checkpoint. Follow the existing integration policy for stacks/parallel
work and explicit owner decisions for resource/deployment actions.

Keep local SMTP capture and controlled local scheduling for S4 initially. Hosted
Supabase cannot use the laptop's loopback sink. External email/scheduling needs
separate sender/provider, designated test recipients, send/usage ceiling,
schedule, monitoring and stop-switch approval. Test delivery versus acceptance,
duplicate suppression, uncertain outcomes, retry exhaustion and job overlap/
outage. [Default Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp) is
restricted to authorized addresses and currently two messages/hour; it is not a
credential notification service. No external send is part of STG-01–08.

Before a run, approve synthetic retention, revocation, cleanup and recovery
ownership. Preserve completed memberships/audit; remove only authorized exact
owned fixtures after proving no operation can still reference them. Real-data
retention/deletion, safe file processing, privacy, database plus Storage-object
restore, operational readiness and production hosting remain explicit release
prerequisites. [Database backups](https://supabase.com/docs/guides/platform/backups)
do not include Storage object bytes. Synthetic acceptance is not real-document,
real-user, pilot or production acceptance.
