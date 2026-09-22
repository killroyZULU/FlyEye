# FEAT-003 Hosted Synthetic Hardening

## Status and boundary

- Status: Merged through PR #8 at `48ba984`
- Parent feature: FEAT-003 Organization Admin and MFA Onboarding
- Baseline: remote `main` merge commit
  `00dcfd2239de45b33890bc805ff27a667defabd1`
- Purpose: remove avoidable repository-level risk before any hosted synthetic
  validation decision
- Data: synthetic identities and organizations only

This hardening slice did not create or configure a Supabase project, select a
paid plan or provider, deploy an application, contact a hosted application
service, use customer data, authorize production, or begin FEAT-004.

## Outcome

FlyEye must refuse accidental or ambiguous hosted FEAT-003 execution. A future
staging operator must use an exact reviewed environment manifest, a distinct
non-human staging provenance, an explicit synthetic-only runtime profile, and a
version-controlled activation contract. Local fixture provenance and local-only
configuration must never be reused as hosted evidence.

## Decisions

### FEAT-003-HS-01: Hosted staging is disabled by default

The committed staging-environment manifest starts with `enabled: false` and no
project, API, database, or frontend target. Validation or issuance tooling must
stop before reading credentials or making a network or database request unless
the manifest is separately changed in a reviewed repository commit.

Enabling the manifest later requires an exact staging project reference, API
origin, database host, frontend origin, synthetic-only data classification,
and the approved staging limiter profile. A repository change does not create
or mutate the named environment.

### FEAT-003-HS-02: Hosted provenance is distinct and constrained

Local issuance remains `actor_kind = 'local_fixture'` and
`authorization_source_kind = 'local_fixture'` with source code
`feat-003-local-cli-fixture`.

A future staging-only synthetic issuance uses
`actor_kind = 'staging_fixture'` and
`authorization_source_kind = 'staging_fixture'` with source code
`feat-003-staging-synthetic-cli`. Both forms require null human actor fields, a
random source-instance identifier, a random issuance correlation identifier,
and one transaction containing the grant and issuance audit. No browser,
anonymous, authenticated, or ordinary application role receives table or RPC
authority to issue a grant.

Production issuance remains unsupported and blocked. The staging source is not
a production operator, support role, approval, or human attribution.

### FEAT-003-HS-03: Runtime configuration fails closed

The current Organization Admin onboarding Edge Function accepts only
`local-synthetic-v1` against exact loopback hosts or the local Supabase `kong`
host. Arbitrary HTTPS, custom domains, hosted Supabase, staging, production,
non-synthetic data, unknown limiter policy, missing configuration, and reused
Supabase/limiter keys stop function startup.

`staging-synthetic-v1` is a reserved value that the current runtime always
rejects. A later activation must bind an exact reviewed project identity to the
version-controlled manifest and runtime build; an environment variable or
syntactically valid project reference is not enough. The existing exact-origin,
secret length and separation, JWT, RLS, protected-function, audit, and
fail-closed checks remain in force.

### FEAT-003-HS-04: Staging limiter evidence is explicit and limited

The versioned `subject-action-v1` policy identifies the already tested
subject-plus-action token-bucket behavior and is recorded with each limiter
decision. It is currently local synthetic evidence only. A later staging
activation may retain it only through an explicit reviewed migration/runtime
contract. It is not production abuse-control, trusted-proxy,
distributed-network, capacity, cost, or availability evidence.

Any future threshold, proxy/network dimension, retention, alert, override, or
production change requires a separate reviewed migration and representative
evidence. No environment may silently select a wider or unrecorded profile.

### FEAT-003-HS-05: Staging issuance remains dormant

This hardening slice adds only the constrained staging provenance vocabulary.
It does not add an executable SQL, CLI, RPC, Edge Function, browser, Data API,
or generally deployable staging issuer. An environment variable that merely
claims `staging` cannot distinguish a staging target from production and is not
sufficient authority.

After an exact provider and project reference are selected, a separate reviewed
activation may add a CLI-only staging issuer that validates the enabled
version-controlled project allowlist before obtaining credentials or starting
network, provider, database, or child-process work. That later issuer must use a
version-controlled transaction, keep database credentials out of arguments and
output, prove one atomic constrained grant/audit pair, and emit only fixed
sanitized status. No application-accessible issuance route is permitted.

### FEAT-003-HS-06: Cleanup and evidence remain conservative

This slice does not delete hosted data or provider resources. The later hosted
run must define retention, revocation, session invalidation, evidence capture,
and any destructive project or data cleanup before execution. Uncertain cleanup
is a hard stop. Completed membership and audit evidence are not silently
removed to make a test appear clean.

## Acceptance criteria

- [x] **FEAT-003-HS-AC-01:** The committed staging manifest is disabled and
      contains no provider target or credential.
- [x] **FEAT-003-HS-AC-02:** The disabled manifest rejects provider targets;
      malformed, non-HTTPS, project-mismatched, non-synthetic, or ambiguous
      manifest values fail validation. The current runtime rejects every remote,
      staging, and production target before privileged client creation.
- [x] **FEAT-003-HS-AC-03:** Local and staging fixture provenance are mutually
      constrained; fabricated human attribution, mixed source fields, unknown
      source kinds, and browser/application issuance remain rejected.
- [x] **FEAT-003-HS-AC-04:** The Edge Function accepts the local profile only
      against exact loopback or local `kong`, rejects all remote/staging/
      production profiles, and requires synthetic-only data plus the exact
      limiter policy. Exact staging project identity remains a later activation
      gate.
- [x] **FEAT-003-HS-AC-05:** Limiter evidence records the selected policy version
      without weakening atomicity, privacy, RLS, grants, or fail-closed behavior.
- [x] **FEAT-003-HS-AC-06:** No executable hosted issuer or runtime staging
      escape hatch exists. The disabled manifest and local-only runtime prevent
      an unselected hosted target from advancing to provider or database work;
      exact staging-versus-production identity remains a later activation gate.
- [x] **FEAT-003-HS-AC-07:** No new package, hosted access, real data, email,
      CAPTCHA, deployment credential, production path, destructive cleanup, or
      FEAT-004 behavior is introduced.
- [x] **FEAT-003-HS-AC-08:** Focused tests, the complete local application and
      database matrix, secret/history scans, scope review, and a fresh separate
      agent review pass before publication.

## Local verification evidence

The recorded local matrix and resolved review findings are maintained in
[FEAT-003 Traceability](FEAT-003_TRACEABILITY.md#final-local-matrix).

## Remaining later gates

Hosted validation remains pending until
the Founder/Product Owner separately approves the exact staging provider,
project, region, plan/cost ceiling, fixed frontend origin, environment manifest,
credential path, monitoring owner, retention/cleanup plan, and one bounded
synthetic execution. Qualified review is risk-triggered against that exact
environment and evidence. Real data, deployment to production, production
approval, and branch deletion remain separate.
